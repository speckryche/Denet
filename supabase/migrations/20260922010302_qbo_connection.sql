-- QuickBooks Online connection: OAuth tokens, the authorize state, and the
-- refresh lease.
--
-- SERVICE_ROLE ONLY — A DEPARTURE FROM EVERY OTHER TABLE HERE
-- Every other table in this project grants at least SELECT to `authenticated`
-- and carries an "Authenticated users full access" policy. These do not, on
-- purpose. They hold a live OAuth refresh token for the company's accounting
-- system; anyone who can read it can post to QuickBooks as us, indefinitely.
--
-- RLS is enabled with NO policy at all, and no grants are issued to anon or
-- authenticated. With RLS on and no policy those roles match no rows even if a
-- grant were added by mistake — two independent locks. service_role bypasses
-- RLS and is deliberately never mentioned, matching 20260918002050.
--
-- The app never reads these tables. It learns connection state through the
-- qbo-* edge functions, which return only non-sensitive fields. Tokens never
-- reach the browser.
--
-- WHY A LEASE AND NOT AN ADVISORY LOCK
-- Intuit rotates the refresh token on every refresh and invalidates the old
-- one, so two concurrent refreshes brick the connection. The obvious fix —
-- pg_advisory_xact_lock in an RPC — does NOT work here, and it is worth writing
-- down why: the critical section spans an HTTP call to Intuit made by Deno, but
-- a transaction-scoped advisory lock releases when the RPC returns, which is
-- BEFORE that call is made. Verified against this database: a fresh
-- pg_try_advisory_xact_lock on the same key succeeds on the next statement.
-- A session-level lock is no better, because PostgREST pools connections and a
-- leaked session lock would be worse than the race.
--
-- So the critical section is guarded by a lease column claimed with an atomic
-- conditional UPDATE. Crucially the COMMIT is also conditional on still holding
-- that lease: a slow winner whose lease expired discards its result rather than
-- overwriting a newer token. Two successful refreshes where the older one
-- writes last is just as fatal as an invalid_grant, and only the commit guard
-- prevents it.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. qbo_connection — exactly one row, ever.
--
-- CHECK (id = 1) makes the singleton structural: the refresh flow can address a
-- known primary key, and a second connection cannot appear by accident.
--
-- previous_refresh_token exists for self-healing. If this process crashes
-- between Intuit rotating the token and us persisting it, the stored token is
-- already dead. Keeping the prior one lets a single retry recover instead of
-- demanding a human reconnect.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qbo_connection (
  id                           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  realm_id                     TEXT NOT NULL,
  company_name                 TEXT,
  environment                  TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  access_token                 TEXT NOT NULL,
  refresh_token                TEXT NOT NULL,
  previous_refresh_token       TEXT,
  previous_refresh_rotated_at  TIMESTAMPTZ,
  access_token_expires_at      TIMESTAMPTZ NOT NULL,
  -- Intuit refresh tokens last ~100 days. Surfaced so the UI can warn before a
  -- long-idle connection dies silently.
  refresh_token_expires_at     TIMESTAMPTZ,
  status                       TEXT NOT NULL DEFAULT 'connected'
                                 CHECK (status IN ('connected', 'needs_reconnect')),
  last_error                   TEXT,
  last_refreshed_at            TIMESTAMPTZ,
  -- Refresh lease. NULL / expired means free.
  refresh_lease_id             UUID,
  refresh_lease_expires_at     TIMESTAMPTZ,
  connected_by                 TEXT,
  connected_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE qbo_connection ENABLE ROW LEVEL SECURITY;
-- No policy, by design. See the header.

-- ---------------------------------------------------------------------------
-- 2. qbo_oauth_state — one-time CSRF state for the authorize round trip.
--
-- return_url rides here rather than in the callback URL so the callback cannot
-- be talked into redirecting elsewhere: the value was allowlisted at mint time
-- and is looked up, not parsed from the request.
--
-- used_at makes consumption observable instead of deleting the row, so a
-- replayed callback is distinguishable from an unknown one in the logs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qbo_oauth_state (
  state         TEXT PRIMARY KEY,
  return_url    TEXT NOT NULL,
  environment   TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_qbo_oauth_state_expires ON qbo_oauth_state(expires_at);

ALTER TABLE qbo_oauth_state ENABLE ROW LEVEL SECURITY;
-- No policy, by design.

-- ---------------------------------------------------------------------------
-- 3. Refresh-lease RPCs. SECURITY DEFINER so they can reach a table with no
-- policies; EXECUTE granted to service_role only, so only an edge function can
-- call them. search_path pinned per advisor 0011.
-- ---------------------------------------------------------------------------

-- Read the connection. Returns nothing when unconfigured.
CREATE OR REPLACE FUNCTION public.qbo_get_connection()
RETURNS SETOF qbo_connection
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$ SELECT * FROM qbo_connection WHERE id = 1 $$;

-- Claim the right to refresh. Single-statement UPDATE ... RETURNING takes the
-- row lock atomically; a concurrent caller gets zero rows and must wait+re-read
-- rather than refreshing in parallel.
CREATE OR REPLACE FUNCTION public.qbo_begin_refresh(p_lease_seconds INTEGER DEFAULT 60)
RETURNS TABLE (lease_id UUID, refresh_token TEXT, previous_refresh_token TEXT,
               previous_refresh_rotated_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE qbo_connection
  SET refresh_lease_id = gen_random_uuid(),
      refresh_lease_expires_at = NOW() + make_interval(secs => p_lease_seconds)
  WHERE id = 1
    AND (refresh_lease_expires_at IS NULL OR refresh_lease_expires_at < NOW())
  RETURNING refresh_lease_id, refresh_token, previous_refresh_token, previous_refresh_rotated_at;
$$;

-- Persist a successful refresh — but ONLY if we still hold the lease. A slow
-- winner whose lease expired writes nothing, so it cannot clobber the token a
-- later refresh already stored.
CREATE OR REPLACE FUNCTION public.qbo_commit_refresh(
  p_lease_id UUID,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_access_expires_at TIMESTAMPTZ,
  p_refresh_expires_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE updated INTEGER;
BEGIN
  UPDATE qbo_connection
  SET previous_refresh_token = refresh_token,
      previous_refresh_rotated_at = NOW(),
      access_token = p_access_token,
      refresh_token = p_refresh_token,
      access_token_expires_at = p_access_expires_at,
      refresh_token_expires_at = COALESCE(p_refresh_expires_at, refresh_token_expires_at),
      status = 'connected',
      last_error = NULL,
      last_refreshed_at = NOW(),
      refresh_lease_id = NULL,
      refresh_lease_expires_at = NULL,
      updated_at = NOW()
  WHERE id = 1 AND refresh_lease_id = p_lease_id;
  GET DIAGNOSTICS updated = ROW_COUNT;
  RETURN updated = 1;
END;
$$;

-- Record a failed refresh and release the lease.
--
-- p_terminal distinguishes "this will never work again" (invalid_grant: the
-- token was rotated away or revoked) from "Intuit was unreachable". Only the
-- former sets needs_reconnect; a transient 5xx must not push the operator into
-- a pointless re-authorisation.
CREATE OR REPLACE FUNCTION public.qbo_fail_refresh(
  p_lease_id UUID, p_error TEXT, p_terminal BOOLEAN
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  UPDATE qbo_connection
  SET status = CASE WHEN p_terminal THEN 'needs_reconnect' ELSE status END,
      last_error = p_error,
      refresh_lease_id = NULL,
      refresh_lease_expires_at = NULL,
      updated_at = NOW()
  WHERE id = 1 AND refresh_lease_id = p_lease_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. Realm scoping for the account mapping.
--
-- THE HAZARD THIS CLOSES. qbo_account_map.qbo_account_id and
-- crypto_assets.qbo_*_account_id are bare ids with no record of WHICH company
-- file they came from. Sandbox and production are different companies with
-- independent id spaces. Map against sandbox, later connect production, and
-- those ids either resolve to nothing or — worse — to an unrelated account
-- that happens to share the id. That is a silent path to posting real money to
-- the wrong account.
--
-- Recording the realm the ids were mapped under lets the poster refuse when the
-- connected realm differs, rather than trusting a stale id.
-- ---------------------------------------------------------------------------
ALTER TABLE qbo_account_map
  ADD COLUMN IF NOT EXISTS qbo_realm_id  TEXT,
  ADD COLUMN IF NOT EXISTS qbo_synced_at TIMESTAMPTZ;

ALTER TABLE crypto_assets
  ADD COLUMN IF NOT EXISTS qbo_realm_id  TEXT,
  ADD COLUMN IF NOT EXISTS qbo_synced_at TIMESTAMPTZ;

-- The Coinbase vendor for EntityRef on the Coinbase JE. Lives beside the
-- account it belongs to rather than in JeLine: the vendor is a property of the
-- posting, not of the accounting computation, and is fully derivable from which
-- account a line hits.
ALTER TABLE qbo_account_map
  ADD COLUMN IF NOT EXISTS qbo_entity_type TEXT CHECK (qbo_entity_type IN ('Vendor', 'Customer', 'Employee')),
  ADD COLUMN IF NOT EXISTS qbo_entity_id   TEXT,
  ADD COLUMN IF NOT EXISTS qbo_entity_name TEXT;

-- ---------------------------------------------------------------------------
-- 5. Posting idempotency markers on the snapshot.
--
-- qbo_request_id is written BEFORE the POST, so a POST that succeeds in QBO but
-- whose response is lost leaves a trace. On retry the poster queries QBO by
-- DocNumber and adopts the existing entry rather than creating a duplicate.
-- qbo_txn_id (from 20260921200107) remains the success record.
--
-- doc_number is UNIQUE because QBO does NOT enforce uniqueness on DocNumber —
-- the API will happily create a second journal entry with the same number. This
-- constraint makes Postgres enforce what Intuit won't.
-- ---------------------------------------------------------------------------
ALTER TABLE qbo_je_snapshots
  ADD COLUMN IF NOT EXISTS doc_number      TEXT,
  ADD COLUMN IF NOT EXISTS qbo_request_id  TEXT,
  ADD COLUMN IF NOT EXISTS qbo_realm_id    TEXT,
  ADD COLUMN IF NOT EXISTS qbo_sync_token  TEXT,
  ADD COLUMN IF NOT EXISTS qbo_posted_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qbo_posted_by   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qbo_je_snapshots_doc_number
  ON qbo_je_snapshots(doc_number) WHERE doc_number IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Grants. Nothing for anon or authenticated on the token tables.
--
-- The REVOKE is not redundant with "no GRANT": new tables can inherit
-- privileges from role defaults, and RLS is NOT enforced for TRUNCATE, so a
-- stray inherited grant would be a hole no policy could close.
-- ---------------------------------------------------------------------------
REVOKE ALL PRIVILEGES ON public.qbo_connection  FROM anon, authenticated, PUBLIC;
REVOKE ALL PRIVILEGES ON public.qbo_oauth_state FROM anon, authenticated, PUBLIC;

REVOKE ALL ON FUNCTION public.qbo_get_connection()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qbo_begin_refresh(INTEGER)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qbo_commit_refresh(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qbo_fail_refresh(UUID, TEXT, BOOLEAN)                   FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.qbo_get_connection()                                    TO service_role;
GRANT EXECUTE ON FUNCTION public.qbo_begin_refresh(INTEGER)                              TO service_role;
GRANT EXECUTE ON FUNCTION public.qbo_commit_refresh(UUID, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.qbo_fail_refresh(UUID, TEXT, BOOLEAN)                   TO service_role;

COMMIT;
