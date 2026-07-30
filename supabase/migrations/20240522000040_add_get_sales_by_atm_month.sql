-- Migration: get_sales_by_atm_month — completed-only sales/fees by ATM by month.
--
-- Root-cause fix for the commission sales-basis bug: this function (and the
-- calculate-commissions edge function's inline aggregation) summed transactions
-- with NO status filter, so a machine/month basis included non-completed
-- transactions (e.g. ATM 3997 June 2026 returned $10,900 instead of the
-- completed-only $8,900 after a $2,000 tx moved to 'under_review').
--
-- SOURCE OF TRUTH for status→surface rules is src/lib/transaction-status.ts
-- (mirrored for Deno in supabase/functions/_shared/transaction-status.ts).
-- This is a FINANCIAL surface, so it counts COMPLETED transactions only —
-- i.e. FINANCIAL_STATUSES = ['completed']. SQL cannot import the TS config, so
-- the 'completed' literal below is hardcoded ON PURPOSE. If the financial-status
-- set ever changes in transaction-status.ts, this function MUST be updated in
-- lockstep (same discipline as the Deno mirror).

create or replace function public.get_sales_by_atm_month(
  p_start_date date default null,
  p_end_date   date default null
)
returns table (
  atm_id             text,
  year_month         text,
  total_sales        numeric,
  total_fees         numeric,
  total_bitstop_fees numeric,
  txn_count          bigint
)
language sql
stable
as $$
  select
    t.atm_id,
    to_char(t.date::date, 'YYYY-MM')      as year_month,
    coalesce(sum(t.sale), 0)              as total_sales,
    coalesce(sum(t.fee), 0)               as total_fees,
    coalesce(sum(t.bitstop_fee), 0)       as total_bitstop_fees,
    count(*)                              as txn_count
  from transactions t
  where t.status = 'completed'                       -- FINANCIAL_STATUSES (see header)
    and (p_start_date is null or t.date >= p_start_date)
    and (p_end_date   is null or t.date <  (p_end_date + 1))   -- inclusive of end day
  group by t.atm_id, to_char(t.date::date, 'YYYY-MM');
$$;

comment on function public.get_sales_by_atm_month(date, date) is
  'Completed-only sales/fees by ATM by month. FINANCIAL surface: counts status = ''completed'' only. Source of truth: src/lib/transaction-status.ts (FINANCIAL_STATUSES) — keep in lockstep.';

grant execute on function public.get_sales_by_atm_month(date, date) to authenticated, service_role;
