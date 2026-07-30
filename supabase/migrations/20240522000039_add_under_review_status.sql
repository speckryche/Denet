-- Add 'under_review' as a sixth allowed transaction status.
--
-- 'under_review' appeared in real Bitstop data after migration 20240522000038.
-- Until it was allowed here, the importer defaulted it to 'completed' (with a
-- visible warning). Adding it to the CHECK lets it be stored raw/distinctly.
--
-- Behavior lives in src/lib/transaction-status.ts (the single source of truth):
-- interim it counts toward CTR but is excluded from revenue — identical to
-- frozen/sending — pending Nonce's confirmation (likely a manual hold). That's
-- a one-line config change, no migration, since the value is already allowed.
--
-- Postgres auto-named the original check 'transactions_status_check' (verified).
-- Recreate it with the expanded value set.
alter table public.transactions
  drop constraint if exists transactions_status_check;

alter table public.transactions
  add constraint transactions_status_check
  check (status in ('completed', 'frozen', 'sending', 'refunded', 'expired', 'under_review'));
