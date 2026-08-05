-- Add 'partial' as an eighth allowed transaction status.
--
-- 'partial' appeared in real Bitstop CSV data (DisplayStage='Pending') — a
-- not-yet-final transaction. Until it was allowed here, the importer defaulted
-- it to 'completed' (with a visible warning). Adding it to the CHECK lets it be
-- stored raw/distinctly; re-uploading the source CSV then upserts the affected
-- row(s) to 'partial'.
--
-- Behavior lives in src/lib/transaction-status.ts (the single source of truth):
-- 'partial' is treated identically to frozen/sending/under_review — counts
-- toward CTR, excluded from revenue, resolution='pending' (surfaces in the
-- Pending Resolution tracker's actionable group) — pending Nonce's confirmation.
-- That's a one-line config change, no migration, since the value is now allowed.
--
-- Recreate the check (auto-named 'transactions_status_check') with the expanded
-- value set (all eight statuses).
alter table public.transactions
  drop constraint if exists transactions_status_check;

alter table public.transactions
  add constraint transactions_status_check
  check (status in (
    'completed', 'frozen', 'sending', 'refunded',
    'expired', 'under_review', 'failed', 'partial'
  ));
