-- Stop manually-entered months from being posted a second time.
--
-- THE BUG
-- post_state defaults to 'idle', and qbo_claim_post accepts
-- post_state IN ('idle','failed','unknown') AND qbo_txn_id IS NULL. Every
-- snapshot created by the old "Mark as entered" button matches that: it was
-- typed into QuickBooks by hand, so it has no qbo_txn_id and was never posted
-- through the API.
--
-- Verified before writing this: all three existing snapshots (2026-01, 2026-02,
-- 2026-03 sales, entered by shansen@denetllc.com) evaluate the claim predicate
-- to TRUE. Pressing "Post to QBO" on any of them would have created a SECOND
-- journal entry in QuickBooks for a month already entered — and because QBO
-- does not enforce DocNumber uniqueness, nothing downstream would have caught
-- it either. The DocNumber pre-flight query would not have saved us: those
-- entries were keyed in by hand and carry whatever number a human typed, not
-- our DEN-YYYY-MM-SALES format.
--
-- THE FIX
-- A distinct 'manual' state meaning "this month is entered in QuickBooks, but
-- not by us". It is deliberately NOT in the claimable set. 'idle' now means
-- only "created by the posting flow and never attempted".
--
-- The backfill is unconditional for existing rows because every snapshot that
-- exists today predates API posting by definition — there is no other way one
-- could have been created.

BEGIN;

ALTER TABLE qbo_je_snapshots DROP CONSTRAINT IF EXISTS qbo_je_snapshots_post_state_check;
ALTER TABLE qbo_je_snapshots
  ADD CONSTRAINT qbo_je_snapshots_post_state_check
  CHECK (post_state IN ('idle', 'manual', 'posting', 'unknown', 'posted', 'failed'));

-- Every pre-existing snapshot was entered by hand. Guarded on qbo_txn_id so a
-- re-run can never demote a row that has since been posted through the API.
UPDATE qbo_je_snapshots
SET post_state = 'manual'
WHERE qbo_txn_id IS NULL
  AND post_state = 'idle';

-- ---------------------------------------------------------------------------
-- Claim: 'manual' and 'unknown' are both excluded now.
--
-- 'manual' because the month is already in QuickBooks and posting would
-- duplicate it.
--
-- 'unknown' because a row in that state MIGHT already exist in QuickBooks — the
-- POST outcome was never confirmed. Claiming it blindly is exactly the
-- duplicate-entry risk the state was invented to prevent. qbo-post-je must
-- query QBO by DocNumber first and adopt the entry if it is there; only then
-- may it claim, through qbo_claim_post_recovered below, which is explicit about
-- what it is doing rather than hiding the recovery inside the normal path.
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
      qbo_request_id = COALESCE(qbo_request_id, gen_random_uuid()::text),
      qbo_realm_id = p_realm_id,
      post_attempts = post_attempts + 1,
      post_error = NULL
  WHERE month = p_month
    AND je_type = p_je_type
    AND qbo_txn_id IS NULL
    -- 'manual' and 'unknown' are NOT here, on purpose. See the header.
    AND post_state IN ('idle', 'failed')
    AND (post_lease_expires_at IS NULL OR post_lease_expires_at < NOW())
  RETURNING qbo_je_snapshots.id, post_lease_id, qbo_je_snapshots.doc_number,
            qbo_request_id, post_attempts;
$$;

-- Claim an 'unknown' row, for use ONLY after qbo-post-je has queried QuickBooks
-- by DocNumber and established the entry is not there. Separate from
-- qbo_claim_post so that "we checked, it is genuinely absent" is a decision the
-- caller has to make explicitly and a reader can see in the code.
CREATE OR REPLACE FUNCTION public.qbo_claim_post_recovered(
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
      -- A fresh request id: the previous attempt's id may already be associated
      -- with a request Intuit remembers, and we have just proven nothing landed.
      qbo_request_id = gen_random_uuid()::text,
      qbo_realm_id = p_realm_id,
      post_attempts = post_attempts + 1,
      post_error = NULL
  WHERE month = p_month
    AND je_type = p_je_type
    AND qbo_txn_id IS NULL
    AND post_state = 'unknown'
    AND (post_lease_expires_at IS NULL OR post_lease_expires_at < NOW())
  RETURNING qbo_je_snapshots.id, post_lease_id, qbo_je_snapshots.doc_number,
            qbo_request_id, post_attempts;
$$;

-- Adopt an entry found in QuickBooks that we did not record — the recovery for
-- a POST whose response was lost. No lease involved: nothing is in flight, we
-- are simply recording what is already true in the other system.
CREATE OR REPLACE FUNCTION public.qbo_adopt_post(
  p_month TEXT, p_je_type TEXT, p_txn_id TEXT, p_sync_token TEXT,
  p_realm_id TEXT, p_adopted_by TEXT
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
      qbo_realm_id = p_realm_id,
      qbo_posted_at = COALESCE(qbo_posted_at, NOW()),
      qbo_posted_by = p_adopted_by,
      post_state = 'posted',
      post_lease_id = NULL,
      post_lease_expires_at = NULL,
      post_error = NULL
  WHERE month = p_month AND je_type = p_je_type AND qbo_txn_id IS NULL;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated = 1;
END;
$$;

-- "Mark as entered" now records that a human keyed it in, so the row can never
-- be picked up by the posting flow. Replaces the app's direct upsert.
CREATE OR REPLACE FUNCTION public.qbo_mark_entered_manually(
  p_month TEXT, p_je_type TEXT, p_je_date DATE, p_lines JSONB,
  p_total_debits NUMERIC, p_total_credits NUMERIC, p_entered_by TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  INSERT INTO qbo_je_snapshots
    (month, je_type, je_date, lines, total_debits, total_credits, entered_by, entered_at, post_state)
  VALUES
    (p_month, p_je_type, p_je_date, p_lines, p_total_debits, p_total_credits, p_entered_by, NOW(), 'manual')
  ON CONFLICT (month, je_type) DO UPDATE
  SET je_date = EXCLUDED.je_date,
      lines = EXCLUDED.lines,
      total_debits = EXCLUDED.total_debits,
      total_credits = EXCLUDED.total_credits,
      entered_by = EXCLUDED.entered_by,
      entered_at = NOW(),
      -- Re-marking a row that was POSTED through the API must not relabel it as
      -- manual; that would make it claimable again and invite a duplicate.
      post_state = CASE WHEN qbo_je_snapshots.qbo_txn_id IS NOT NULL
                        THEN qbo_je_snapshots.post_state ELSE 'manual' END;
END;
$$;

REVOKE ALL ON FUNCTION public.qbo_claim_post_recovered(TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qbo_adopt_post(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qbo_mark_entered_manually(TEXT, TEXT, DATE, JSONB, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.qbo_claim_post_recovered(TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.qbo_adopt_post(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)         TO service_role;
GRANT EXECUTE ON FUNCTION public.qbo_mark_entered_manually(TEXT, TEXT, DATE, JSONB, NUMERIC, NUMERIC, TEXT) TO authenticated, service_role;

COMMIT;
