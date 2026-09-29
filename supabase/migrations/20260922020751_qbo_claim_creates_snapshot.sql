-- qbo_claim_post must CREATE the snapshot, not just update one.
--
-- THE BUG
-- qbo_claim_post was written as an UPDATE. That silently assumed a snapshot row
-- already existed for the month — which is only true if someone had previously
-- pressed "Mark as entered". Posting a month nobody has hand-entered (the
-- normal case) matched zero rows, and the claim failed with
-- "Could not claim this entry for posting", which reads like a concurrency
-- problem and is nothing of the sort.
--
-- Found by posting August 2026: no row existed for 2026-08, so the claim could
-- never succeed no matter how many times it was retried.
--
-- THE FIX
-- INSERT ... ON CONFLICT DO UPDATE. The conflict branch carries the same guard
-- the UPDATE had, so the safety properties are unchanged:
--   * a fresh month inserts and is claimed
--   * an 'idle'/'failed' row is re-claimed
--   * 'manual', 'posted', 'posting' and 'unknown' all fail the WHERE, affect
--     zero rows, and the claim is refused exactly as before
--
-- The lines and totals are written as part of the claim rather than after the
-- POST. The snapshot is the write-ahead record: if the POST succeeds and the
-- response is lost, what we sent must already be on disk, or the recovery path
-- has nothing to compare against.

BEGIN;

CREATE OR REPLACE FUNCTION public.qbo_claim_post(
  p_month TEXT,
  p_je_type TEXT,
  p_doc_number TEXT,
  p_realm_id TEXT,
  p_je_date DATE,
  p_lines JSONB,
  p_total_debits NUMERIC,
  p_total_credits NUMERIC,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (id UUID, lease_id UUID, doc_number TEXT, request_id TEXT, attempts INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO qbo_je_snapshots AS s
    (month, je_type, je_date, lines, total_debits, total_credits,
     post_state, post_lease_id, post_lease_expires_at,
     doc_number, qbo_request_id, qbo_realm_id, post_attempts)
  VALUES
    (p_month, p_je_type, p_je_date, p_lines, p_total_debits, p_total_credits,
     'posting', gen_random_uuid(), NOW() + make_interval(secs => p_lease_seconds),
     p_doc_number, gen_random_uuid()::text, p_realm_id, 1)
  ON CONFLICT (month, je_type) DO UPDATE
  SET post_state = 'posting',
      post_lease_id = gen_random_uuid(),
      post_lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
      -- Refresh what we are about to send, so the snapshot always reflects the
      -- attempt in flight rather than a stale earlier computation.
      je_date = EXCLUDED.je_date,
      lines = EXCLUDED.lines,
      total_debits = EXCLUDED.total_debits,
      total_credits = EXCLUDED.total_credits,
      doc_number = COALESCE(s.doc_number, EXCLUDED.doc_number),
      qbo_request_id = COALESCE(s.qbo_request_id, EXCLUDED.qbo_request_id),
      qbo_realm_id = EXCLUDED.qbo_realm_id,
      post_attempts = s.post_attempts + 1,
      post_error = NULL
  WHERE s.qbo_txn_id IS NULL
    -- 'manual' and 'unknown' remain excluded. See 20260922015839.
    AND s.post_state IN ('idle', 'failed')
    AND (s.post_lease_expires_at IS NULL OR s.post_lease_expires_at < NOW())
  RETURNING s.id, s.post_lease_id, s.doc_number, s.qbo_request_id, s.post_attempts;
$$;

-- The old 5-argument signature would otherwise linger as an overload and could
-- be resolved by accident.
DROP FUNCTION IF EXISTS public.qbo_claim_post(TEXT, TEXT, TEXT, TEXT, INTEGER);

REVOKE ALL ON FUNCTION public.qbo_claim_post(TEXT, TEXT, TEXT, TEXT, DATE, JSONB, NUMERIC, NUMERIC, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qbo_claim_post(TEXT, TEXT, TEXT, TEXT, DATE, JSONB, NUMERIC, NUMERIC, INTEGER)
  TO service_role;

COMMIT;
