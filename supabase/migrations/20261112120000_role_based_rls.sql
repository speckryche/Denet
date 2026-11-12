-- Role-based RLS.
--
-- Before: every public table had one policy, "Authenticated users full access",
-- so the admin/standard split existed only in the frontend.
--
-- After: every signed-in user can read; writes are admin-only except what a
-- standard user needs on the pages they have full access to (Home, CSV
-- Uploads, Pending Resolution, Commissions, Cash Management, Liquidity).
-- Each exception below is traced to the call that needs it.
--
-- The role comes from the JWT's app_metadata, which only the admin API can
-- write. A role change reaches the server on the user's next token refresh
-- (up to an hour) or next sign-in.
--
-- qbo_connection and qbo_oauth_state are deliberately absent: they have no
-- policies at all (service role only) and stay that way.

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

do $$
declare
  r    record;
  cmd  text;
  expr text;
begin
  for r in
    select * from (values
      -- CSV upsert (CsvUploads.tsx) needs both; Pending updates (resolve-transaction.ts)
      ('transactions',              array['insert','update']),
      -- CSV insert only. DELETE stays admin: transactions_upload_id_fkey is
      -- ON DELETE CASCADE and cascades bypass RLS, so deleting an upload
      -- would wipe its transactions.
      ('uploads',                   array['insert']),
      -- CSV Uploads creates unknown ATMs / tickers on import
      ('atm_profiles',              array['insert']),
      ('ticker_mappings',           array['insert']),
      -- Commissions page; inserts happen in calculate-commissions (service role)
      ('commissions',               array['update','delete']),
      ('commission_details',        array['delete']),
      -- Cash Management
      ('cash_pickups',              array['insert','update','delete']),
      ('deposits',                  array['insert','update','delete']),
      ('deposit_pickup_links',      array['insert','delete']),
      -- inserts go through apply_target_adjustment (security definer)
      ('balance_adjustments',       array['update','delete']),
      -- Liquidity
      ('liquidity_categories',      array['insert','update']),
      ('liquidity_snapshots',       array['insert','update','delete']),
      ('liquidity_snapshot_values', array['insert','update','delete']),
      ('crypto_investments',        array['insert','update','delete']),
      -- Admin-only writes
      ('app_settings',              array[]::text[]),
      ('balance_adjustment_history',array[]::text[]),  -- written by a security-definer trigger
      ('bitstop_audit_items',       array[]::text[]),
      ('bitstop_column_mappings',   array[]::text[]),
      ('bitstop_commissions',       array[]::text[]),
      ('bitstop_fee_overrides',     array[]::text[]),
      ('bitstop_report_lines',      array[]::text[]),
      ('coinbase_balances',         array[]::text[]),
      ('coinbase_buy_treatment',    array[]::text[]),
      ('coinbase_transactions',     array[]::text[]),
      ('crypto_assets',             array[]::text[]),
      ('ctr_filings',               array[]::text[]),
      ('people',                    array[]::text[]),
      ('qbo_account_map',           array[]::text[]),
      ('qbo_je_snapshots',          array[]::text[]),
      ('sales_reps',                array[]::text[]),
      ('transaction_refunds',       array[]::text[])
    ) as t(tbl, std_cmds)
  loop
    execute format('drop policy if exists "Authenticated users full access" on public.%I', r.tbl);
    foreach cmd in array array['select','insert','update','delete'] loop
      execute format('drop policy if exists %I on public.%I', r.tbl || '_' || cmd, r.tbl);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (true)',
      r.tbl || '_select', r.tbl);

    foreach cmd in array array['insert','update','delete'] loop
      expr := case when cmd = any(r.std_cmds) then 'true' else '(select public.is_admin())' end;
      if cmd = 'insert' then
        execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
          r.tbl || '_insert', r.tbl, expr);
      elsif cmd = 'update' then
        execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
          r.tbl || '_update', r.tbl, expr, expr);
      else
        execute format('create policy %I on public.%I for delete to authenticated using (%s)',
          r.tbl || '_delete', r.tbl, expr);
      end if;
    end loop;
  end loop;

  -- Guard: no table may keep the old blanket policy.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and policyname = 'Authenticated users full access'
  ) then
    raise exception 'a table still has the blanket policy; the list above is incomplete';
  end if;
end $$;

-- QBO Entries is admin-only; enforce it on the server too.
-- Body copied from the live database (repo migrations diverge from it).
create or replace function public.qbo_mark_entered_manually(
  p_month text, p_je_type text, p_je_date date, p_lines jsonb,
  p_total_debits numeric, p_total_credits numeric, p_entered_by text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.is_admin() then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  insert into qbo_je_snapshots
    (month, je_type, je_date, lines, total_debits, total_credits, entered_by, entered_at, post_state)
  values
    (p_month, p_je_type, p_je_date, p_lines, p_total_debits, p_total_credits, p_entered_by, now(), 'manual')
  on conflict (month, je_type) do update
  set je_date       = excluded.je_date,
      lines         = excluded.lines,
      total_debits  = excluded.total_debits,
      total_credits = excluded.total_credits,
      entered_by    = excluded.entered_by,
      entered_at    = now(),
      post_state    = case when qbo_je_snapshots.qbo_txn_id is not null
                           then qbo_je_snapshots.post_state else 'manual' end;
end;
$function$;

-- No caller in the app or any Edge Function.
revoke execute on function public.qbo_unmark_snapshot(text, text) from authenticated;
