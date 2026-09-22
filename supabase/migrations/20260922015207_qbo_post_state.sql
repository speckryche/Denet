-- Posting state for journal entries, with the claim/commit RPCs.
--
-- THE PROBLEM THIS SOLVES
-- Posting a journal entry is a write to someone else's system that we cannot
-- roll back. The failure that matters is not "the POST failed" — that is safe,
-- nothing was created. It is "the POST succeeded and we never found out":
-- a timeout, a cold start, a dropped connection. Retrying blindly then creates
-- a SECOND journal entry in the general ledger, and QBO does not enforce
-- DocNumber uniqueness, so nothing upstream would stop it.
--
-- The ordering that prevents this is: persist the INTENT before the network
-- call, so a retry can recognise its own earlier attempt and go looking for the
-- entry instead of creating another.
--
-- post_state:
--   idle      never attempted
--   posting   claimed, POST in flight
--   unknown   POST outcome unknown — a human must check QBO. NEVER auto-retried.
--   posted    confirmed, qbo_txn_id set
--   failed    QBO rejected it outright; safe to fix and retry, nothing created
--
-- A 'posting' row whose lease has expired is reclassified as 'unknown', not
-- 'failed'. A process killed between the POST and the commit must route to the
-- human re-check path, never to a second POST.

BEGIN;

ALTER TABLE qbo_je_snapshots
  ADD COLUMN IF NOT EXISTS post_state             TEXT NOT NULL DEFAULT 'idle'
    CHECK (post_state IN ('idle', 'posting', 'unknown', 'posted', 'failed')),
  ADD COLUMN IF NOT EXISTS post_lease_id          UUID,
  ADD COLUMN IF NOT EXISTS post_lease_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS post_error             TEXT,
  ADD COLUMN IF NOT EXISTS post_attempts          INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Claim the right to post. Single-statement UPDATE ... RETURNING takes the row
-- lock, so two simultaneous clicks cannot both proceed — the loser gets zero
-- rows. Refuses outright once qbo_txn_id is set.
--
-- The request id is generated HERE and persisted as part of the claim, before
-- any network call, so a retry of the same attempt reuses it and Intuit can
-- deduplicate server-side. A request id minted after the POST would be useless.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qbo_claim_post(
  p_month TEXT,
  p_je_type TEXT,
  p_doc_number TEXT,
  p_realm_id TEXT,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (id UUID, lease_id UUID, doc_number TEXT, request_id TEXT, attempts INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE qbo_je_snapshots
  SET post_state = 'posting',
      post_lease_id = gen_random_uuid(),
      post_lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
      doc_number = COALESCE(doc_number, p_doc_number),
      -- Reuse the existing request id when retrying the same attempt; mint one
      -- only on a first claim.
      qbo_request_id = COALESCE(qbo_request_id, gen_random_uuid()::text),
      qbo_realm_id = p_realm_id,
      post_attempts = post_attempts + 1,
      post_error = NULL
  WHERE month = p_month
    AND je_type = p_je_type
    AND qbo_txn_id IS NULL
    AND post_state IN ('idle', 'failed', 'unknown')
    AND (post_lease_expires_at IS NULL OR post_lease_expires_at < NOW())
  RETURNING qbo_je_snapshots.id, post_lease_id, qbo_je_snapshots.doc_number,
            qbo_request_id, post_attempts;
$$;

-- Record a confirmed post. Conditional on still holding the lease.
CREATE OR REPLACE FUNCTION public.qbo_commit_post(
  p_lease_id UUID, p_txn_id TEXT, p_sync_token TEXT, p_posted_by TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE updated INTEGER;
BEGIN
  UPDATE qbo_je_snapshots
  SET qbo_txn_id = p_txn_id,
      qbo_sync_token = p_sync_token,
      qbo_posted_at = NOW(),
      qbo_posted_by = p_posted_by,
      post_state = 'posted',
      post_lease_id = NULL,
      post_lease_expires_at = NULL,
      post_error = NULL
  WHERE post_lease_id = p_lease_id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated = 1;
END;
$$;

-- Record a failure. p_unknown distinguishes "QBO said no" (safe, nothing
-- created) from "we never found out" (a human must look in QuickBooks).
CREATE OR REPLACE FUNCTION public.qbo_fail_post(
  p_lease_id UUID, p_error TEXT, p_unknown BOOLEAN
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE qbo_je_snapshots
  SET post_state = CASE WHEN p_unknown THEN 'unknown' ELSE 'failed' END,
      post_error = p_error,
      post_lease_id = NULL,
      post_lease_expires_at = NULL
  WHERE post_lease_id = p_lease_id;
$$;

-- ---------------------------------------------------------------------------
-- Un-marking a posted entry must not silently orphan a live journal entry.
--
-- `authenticated` holds DELETE on qbo_je_snapshots and the Un-mark button uses
-- it. Once posting exists, deleting a posted snapshot destroys the only record
-- of the QBO transaction id — the entry stays in QuickBooks and we lose the
-- pointer to it. DELETE is revoked and routed through this RPC instead, which
-- refuses on a posted row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.qbo_unmark_snapshot(p_month TEXT, p_je_type TEXT)
RETURNS TABLE (deleted BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE txn TEXT; removed INTEGER;
BEGIN
  SELECT qbo_txn_id INTO txn FROM qbo_je_snapshots WHERE month = p_month AND je_type = p_je_type;
  IF txn IS NOT NULL THEN
    RETURN QUERY SELECT FALSE,
      'This entry was posted to QuickBooks (txn ' || txn || '). Un-marking would discard the only link to it. '
      || 'Void or delete it in QuickBooks first — nothing here ever changes QuickBooks automatically.';
    RETURN;
  END IF;
  DELETE FROM qbo_je_snapshots WHERE month = p_month AND je_type = p_je_type;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN QUERY SELECT removed > 0, NULL::TEXT;
END;
$$;

REVOKE DELETE ON public.qbo_je_snapshots FROM authenticated;

REVOKE ALL ON FUNCTION public.qbo_claim_post(TEXT, TEXT, TEXT, TEXT, INTEGER)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qbo_commit_post(UUID, TEXT, TEXT, TEXT)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qbo_fail_post(UUID, TEXT, BOOLEAN)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qbo_unmark_snapshot(TEXT, TEXT)                     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.qbo_claim_post(TEXT, TEXT, TEXT, TEXT, INTEGER)  TO service_role;
GRANT EXECUTE ON FUNCTION public.qbo_commit_post(UUID, TEXT, TEXT, TEXT)          TO service_role;
GRANT EXECUTE ON FUNCTION public.qbo_fail_post(UUID, TEXT, BOOLEAN)               TO service_role;
-- The app calls unmark directly; it is guarded internally rather than by grant.
GRANT EXECUTE ON FUNCTION public.qbo_unmark_snapshot(TEXT, TEXT)                  TO authenticated, service_role;

COMMIT;
