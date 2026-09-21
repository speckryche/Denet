-- financial_transactions — the one definition of "this sale counts".
--
-- WHY A VIEW
-- The financial surface was previously expressed 26 separate times: 22
-- `.in('status', FINANCIAL_STATUSES)` filters across src/, one hardcoded
-- 'completed' literal in SQL, one in the edge function, and four in-memory
-- countsFinancial() predicates. Adding refund overrides to that by hand would
-- mean editing every one of them and keeping them in agreement forever.
--
-- Refund exclusion cannot ride the existing filter anyway: it keys on
-- transaction id, not status, so there is no `.in(...)` to extend. A view puts
-- both rules — status AND refund override — in a single place that the app,
-- the SQL layer, and any future consumer all read through.
--
-- SECURITY: security_invoker = true. THIS IS LOAD-BEARING.
-- A Postgres view runs with the privileges of its OWNER by default, and RLS on
-- the underlying table is evaluated against that owner rather than the caller.
-- A default view over `transactions` would therefore hand every caller the
-- owner's unrestricted read — re-opening precisely the hole that migration
-- 20260918002050 closed when it revoked anon's access. With security_invoker
-- the view evaluates `transactions`' RLS as the calling role, so the view can
-- never grant more than the caller already had.
-- Requires PG15+, which this project is on.
--
-- GRANTS: authenticated only. anon gets nothing, deliberately and explicitly —
-- a view is a separate object with its own grants, so anon's revocation on the
-- base table does not automatically carry over here.
--
-- NOT SWAPPED: the calculate-commissions edge function. It runs under
-- service_role, and rather than depend on service_role's default privileges
-- reaching a brand-new object, it applies the refund exclusion in code against
-- the base table. Same rule, same source of truth (transaction_refunds), no
-- extra grant surface.

BEGIN;

CREATE OR REPLACE VIEW public.financial_transactions
WITH (security_invoker = true) AS
SELECT t.*
FROM public.transactions t
WHERE
  -- FINANCIAL_STATUSES from src/lib/transaction-status.ts. SQL cannot import
  -- the TS config, so this literal is hardcoded ON PURPOSE and MUST be updated
  -- in lockstep — the same discipline as the Deno mirror and
  -- 20240522000040_add_get_sales_by_atm_month.sql.
  t.status = 'completed'
  -- Refund override: a sale refunded after the fact stops counting, even though
  -- the provider's CSV still reports it as completed and a YTD re-upload keeps
  -- overwriting the status back to 'completed'.
  AND NOT EXISTS (
    SELECT 1 FROM public.transaction_refunds r
    WHERE r.transaction_id = t.id
  );

COMMENT ON VIEW public.financial_transactions IS
  'Transactions that count financially: status in FINANCIAL_STATUSES and not refund-overridden. security_invoker=true so the caller''s RLS applies.';

REVOKE ALL PRIVILEGES ON public.financial_transactions FROM anon;
REVOKE ALL PRIVILEGES ON public.financial_transactions FROM authenticated;
GRANT SELECT ON public.financial_transactions TO authenticated;

COMMIT;
