-- get_sales_by_atm_month: read financial_transactions instead of filtering
-- transactions by a hardcoded status literal.
--
-- WHY
-- 20260921225254 introduced `financial_transactions` as the single definition
-- of "this sale counts" — completed AND not refund-overridden — and Stage 2
-- swapped all 21 application query sites onto it. This function was missed:
-- the swap was a source edit across TypeScript files, and a SQL function body
-- living in the database is not reachable that way.
--
-- Left as-is it is now actively wrong, not merely stale. Its own header (see
-- 20240522000040) documents the `'completed'` literal as something that MUST be
-- updated in lockstep with FINANCIAL_STATUSES. That discipline was written for
-- a rule expressible in status alone. A refund override is not: the transaction
-- is still stored as 'completed', so this function would keep counting a sale
-- that every other surface in the app has stopped counting. Pointing it at the
-- view removes the lockstep obligation entirely rather than restating it.
--
-- PRESERVED EXACTLY
--   * signature, including both DEFAULT NULL::date parameters
--   * RETURNS TABLE column names, order and types
--   * LANGUAGE sql, STABLE
--   * SET search_path TO 'public', 'pg_temp'   (advisor 0011, set in 20260918002050)
--   * SECURITY INVOKER — i.e. no SECURITY DEFINER clause, matching the current
--     definition. This matters more than it looks: the view is declared
--     security_invoker = true, so RLS on `transactions` is evaluated as the
--     CALLER both through the function and through the view. Making either one
--     definer-rights would silently hand callers the owner's unrestricted read.
--   * grants: EXECUTE for authenticated and service_role only
--
-- CREATE OR REPLACE preserves a function's existing ACL, so the grants below
-- are technically redundant today. They are restated so the intended privilege
-- set is visible in one place and survives any later DROP + CREATE, which
-- would otherwise reset EXECUTE to PUBLIC.
--
-- Both EXECUTE-holders can read the view: authenticated was granted SELECT by
-- 20260921225254, and service_role holds it through Supabase's default
-- privileges. anon has neither EXECUTE here nor SELECT on the view.
--
-- Behaviour change: rows with a transaction_refunds override stop appearing in
-- the aggregate. No caller exists in the repo today (this function has zero
-- references in src/ and supabase/functions/), so nothing in the app moves.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_sales_by_atm_month(
  p_start_date date DEFAULT NULL::date,
  p_end_date   date DEFAULT NULL::date
)
RETURNS TABLE(
  atm_id             text,
  year_month         text,
  total_sales        numeric,
  total_fees         numeric,
  total_bitstop_fees numeric,
  txn_count          bigint
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    select
      t.atm_id,
      to_char(t.date::date, 'YYYY-MM')      as year_month,
      coalesce(sum(t.sale), 0)              as total_sales,
      coalesce(sum(t.fee), 0)               as total_fees,
      coalesce(sum(t.bitstop_fee), 0)       as total_bitstop_fees,
      count(*)                              as txn_count
    -- financial_transactions already applies the status rule AND the refund
    -- overrides, so there is no status predicate here on purpose.
    from financial_transactions t
    where (p_start_date is null or t.date >= p_start_date)
      and (p_end_date   is null or t.date <  (p_end_date + 1))
    group by t.atm_id, to_char(t.date::date, 'YYYY-MM');
  $function$;

REVOKE ALL ON FUNCTION public.get_sales_by_atm_month(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_atm_month(date, date)
  TO authenticated, service_role;

COMMIT;
