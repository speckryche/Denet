-- Add transaction status to support Bitstop/Denet CSV "Stage" handling.
--
-- Five raw statuses are stored distinctly:
--   completed | frozen | sending | refunded | expired
-- Business rules live in ONE place — src/lib/transaction-status.ts — and are
-- enforced by the Stage 2 calculation filters, NOT here. For reference:
--   - CTR report counts completed + frozen + sending; EXCLUDES refunded and
--     (interim) expired.
--   - Every other financial surface (P&L, sales, fees, commissions, cash mgmt,
--     reconciliation, liquidity, dashboards) counts completed ONLY.
--   - 'sending' behaves identically to 'frozen' everywhere but is stored as its
--     own value.
--   - 'expired' is interim-excluded from everything (like refunded), pending a
--     confirmed rule; when confirmed it changes in the config file only — no
--     new migration needed, since it's already an allowed value here.
--
-- Stage 1 is schema + import parsing only. Adding the column with DEFAULT
-- 'completed' leaves every existing row counted exactly as it is today (no
-- behavior change until the Stage 2 calculation filters land). The known
-- refunds/frozen rows are corrected in a later stage.
alter table public.transactions
  add column if not exists status text not null default 'completed'
  check (status in ('completed', 'frozen', 'sending', 'refunded', 'expired'));

-- Supports the status='completed' predicate every calculation query will carry
-- from Stage 2 onward.
create index if not exists idx_transactions_status
  on public.transactions (status);
