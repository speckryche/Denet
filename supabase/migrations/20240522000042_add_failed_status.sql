-- Add 'failed' as a seventh allowed transaction status.
--
-- 'failed' appeared in real Denet CSV data on 2026-07-31. Until it is allowed
-- here, the importer's unknown-status guard normalizes it to 'completed' (with
-- a visible warning) — which is the worst possible home for it: a transaction
-- that never completed gets counted as revenue. Exactly one row is currently
-- mislabeled this way (Denet id 1038049, ATM 1106, 2026-04-02, $14,077).
--
-- Behavior lives in src/lib/transaction-status.ts (the single source of truth,
-- mirrored for Deno in supabase/functions/_shared/transaction-status.ts):
--   financial: false, ctr: false  -> excluded from EVERYTHING, exactly like
--                                    refunded and (interim) expired
--   resolution: 'final'           -> terminal, so the Pending Resolution
--                                    tracker lists it as informational-only
--                                    and offers no resolve buttons
--   manualTarget: false           -> not a status a human sets by hand
-- INTERIM pending Nonce's confirmation of what 'failed' means; when confirmed,
-- that is a one-line config change with NO migration, because the value is
-- already permitted by the constraint below.
--
-- Same pattern as migration 20240522000039, which added 'under_review'.
-- Postgres auto-named the original check 'transactions_status_check'; recreate
-- it with the expanded value set.
--
-- Adding a value to a CHECK constraint cannot invalidate existing rows (every
-- stored value remains in the allowed set), so this is safe to apply with no
-- downtime and no data migration.

alter table public.transactions
  drop constraint if exists transactions_status_check;

alter table public.transactions
  add constraint transactions_status_check
  check (status in ('completed', 'frozen', 'sending', 'refunded', 'expired', 'under_review', 'failed'));
