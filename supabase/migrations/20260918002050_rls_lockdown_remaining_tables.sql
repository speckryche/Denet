-- Extend the migration 041 lockdown to the remaining 19 public tables.
--
-- BACKGROUND
-- 20240522000041 closed the anon hole on `transactions` and `uploads` and
-- established the pattern: policies are the filter, grants are the backstop.
-- The other 19 tables were left as they were. An audit found:
--
--   1. anon holds GRANT ALL (including TRUNCATE) on all 19. RLS IS NOT
--      ENFORCED FOR TRUNCATE, so the 11 tables carrying a correct
--      "authenticated only" policy can still be emptied by anyone holding the
--      anon key -- which ships in the client bundle. This is the single
--      largest exposure and no policy change can fix it.
--   2. 8 tables carry a permissive USING(true)/WITH CHECK(true) policy, giving
--      anon full read/write/delete: app_settings, balance_adjustments,
--      balance_adjustment_history, bitstop_fee_overrides, crypto_investments,
--      liquidity_categories, liquidity_snapshots, liquidity_snapshot_values.
--   3. Three SECURITY DEFINER functions are executable by anon. They run as the
--      owner and bypass RLS entirely; update_atm_state writes atm_profiles,
--      defeating that table's otherwise-correct policy.
--
-- WHY THE FUNCTION REVOKES TARGET `PUBLIC` AND NOT JUST `anon`
-- Postgres grants EXECUTE on new functions to PUBLIC by default. Revoking from
-- anon alone leaves the PUBLIC grant in place and anon still executes. Every
-- function below is therefore revoked FROM PUBLIC first, then granted back to
-- the specific roles that need it.
--
-- WHY THE APP IS UNAFFECTED
-- Every route in src/App.tsx is wrapped in ProtectedRoute, which renders
-- <Login /> unless useAuth() yields a user. All app queries therefore run as
-- `authenticated`. The calculate-commissions edge function uses the
-- service_role key; service_role retains full grants on all 21 tables and is
-- untouched below.
--
-- GRANT DERIVATION
-- The per-table grants below are taken from actual call sites in src/ and
-- supabase/functions/, not from assumption. Each table's grant line carries the
-- evidence. Note that a PostgREST .upsert() requires INSERT + UPDATE, and that
-- operations performed only by the edge function need no `authenticated` grant.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Replace the 8 permissive USING(true) policies with the authenticated-only
--    shape the other 11 tables already use. Shape is matched exactly
--    (TO public + auth.role() test) for consistency with the existing
--    "Authenticated users full access" policies; `TO authenticated` would be
--    marginally tighter but would make the 21 tables inconsistent.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow all"          ON public.app_settings;
DROP POLICY IF EXISTS "Allow all for anon" ON public.balance_adjustment_history;
DROP POLICY IF EXISTS "Allow all for anon" ON public.balance_adjustments;
DROP POLICY IF EXISTS "Allow all"          ON public.bitstop_fee_overrides;
DROP POLICY IF EXISTS "Allow all"          ON public.crypto_investments;
DROP POLICY IF EXISTS "Allow all"          ON public.liquidity_categories;
DROP POLICY IF EXISTS "Allow all"          ON public.liquidity_snapshot_values;
DROP POLICY IF EXISTS "Allow all"          ON public.liquidity_snapshots;

CREATE POLICY "Authenticated users full access" ON public.app_settings
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.balance_adjustment_history
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.balance_adjustments
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.bitstop_fee_overrides
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.crypto_investments
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.liquidity_categories
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.liquidity_snapshot_values
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON public.liquidity_snapshots
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 2 + 3. Strip anon entirely and reset authenticated from the inherited
--        GRANT ALL (which carried TRUNCATE, REFERENCES and TRIGGER that no
--        code path uses). Nothing in the shipped app queries any of these
--        tables before login, so anon needs no access at all.
-- ---------------------------------------------------------------------------

REVOKE ALL PRIVILEGES ON
  public.app_settings,
  public.atm_profiles,
  public.balance_adjustment_history,
  public.balance_adjustments,
  public.bitstop_commissions,
  public.bitstop_fee_overrides,
  public.cash_pickups,
  public.commission_details,
  public.commissions,
  public.crypto_investments,
  public.ctr_filings,
  public.deposit_pickup_links,
  public.deposits,
  public.liquidity_categories,
  public.liquidity_snapshot_values,
  public.liquidity_snapshots,
  public.people,
  public.sales_reps,
  public.ticker_mappings
FROM anon, authenticated;

-- --- Grant back the minimum each table actually needs -----------------------

-- app_settings: BitstopCommissionTracking.tsx:63 select, :82 upsert (=I+U);
-- CsvUploads.tsx:578 + PlatformComparison.tsx:156 select. No delete anywhere.
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;

-- atm_profiles: 19 select sites; insert (ATMManagement.tsx:311,
-- BTMDetails.tsx:231, CsvUploads.tsx:241); update (BTMDetails.tsx:195);
-- upsert (ATMManagement.tsx:538); delete (ATMManagement.tsx:424).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.atm_profiles TO authenticated;

-- balance_adjustment_history: no application call sites at all (only the
-- generated type in src/types/supabase.ts). Rows are written exclusively by
-- the log_balance_adjustment_change trigger, which is SECURITY DEFINER and so
-- runs with owner privileges -- the caller needs no INSERT. SELECT only, so
-- the audit trail stays readable and stays append-only from the app's side.
GRANT SELECT ON public.balance_adjustment_history TO authenticated;

-- balance_adjustments: Adjustments.tsx:98 select, :163 update, :200 delete.
-- No client-side INSERT -- rows are created through the apply_target_adjustment
-- RPC (SECURITY DEFINER, granted below), so INSERT is deliberately withheld.
GRANT SELECT, UPDATE, DELETE ON public.balance_adjustments TO authenticated;

-- bitstop_commissions: BitstopCommissionTracking.tsx + BitstopCommissions.tsx
-- perform select, insert, upsert and delete.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bitstop_commissions TO authenticated;

-- bitstop_fee_overrides: ATMProfitLoss.tsx:236 select, :477 delete, :484 upsert
-- (=I+U); also read by ATMSalesSummary, ATMTransactions and lib/pnl.ts.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bitstop_fee_overrides TO authenticated;

-- cash_pickups: CashPickups.tsx select/insert/update/delete; read by
-- CashManagement.tsx, Deposits.tsx and ATMManagement.tsx.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_pickups TO authenticated;

-- commission_details: app does SELECT (CommissionCalculator.tsx:183/:388,
-- ATMProfitLoss.tsx:227, PlatformComparison.tsx:289, lib/pnl.ts:266) and
-- DELETE (CommissionCalculator.tsx:245). INSERT happens only in the
-- calculate-commissions edge function under service_role, so no INSERT here.
GRANT SELECT, DELETE ON public.commission_details TO authenticated;

-- commissions: app does SELECT (:104), UPDATE (:199 mark paid, :219 mark
-- unpaid) and DELETE (:252). The upsert at index.ts:400 is the edge function
-- under service_role, so no INSERT for authenticated.
GRANT SELECT, UPDATE, DELETE ON public.commissions TO authenticated;

-- crypto_investments: CryptoInvestments.tsx select/insert/update/delete.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crypto_investments TO authenticated;

-- ctr_filings: CTRReport.tsx:163/:201 select, :224 upsert (=I+U), :343/:376
-- update; Dashboard.tsx:269 select. No delete path -- CTR records are
-- regulatory filings and the app never removes one.
GRANT SELECT, INSERT, UPDATE ON public.ctr_filings TO authenticated;

-- deposit_pickup_links: Deposits.tsx + CashPickups.tsx select/insert/delete.
-- No UPDATE site -- links are dropped and recreated rather than edited.
GRANT SELECT, INSERT, DELETE ON public.deposit_pickup_links TO authenticated;

-- deposits: Deposits.tsx:128 select, :206/:213 insert/update, :248 delete.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deposits TO authenticated;

-- liquidity_categories: CategoryManager.tsx:148 insert, :122/:163/:187/:191
-- update, Liquidity.tsx:109 select. Deletion is soft (update active=false at
-- :163), so no DELETE grant.
GRANT SELECT, INSERT, UPDATE ON public.liquidity_categories TO authenticated;

-- liquidity_snapshot_values: AddSnapshotDialog.tsx:273 delete, :308 insert;
-- ImportSnapshotsDialog.tsx:320 insert; Liquidity.tsx:228 update. SELECT is
-- required for the embedded read in Liquidity.tsx fetchSnapshots(), which
-- nests liquidity_snapshot_values inside the liquidity_snapshots select --
-- PostgREST embedding checks privileges on the child table.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.liquidity_snapshot_values TO authenticated;

-- liquidity_snapshots: Liquidity.tsx:118 select, :145 delete;
-- AddSnapshotDialog.tsx:260/:277 insert/update; ImportSnapshotsDialog.tsx:268/:285.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.liquidity_snapshots TO authenticated;

-- people: PeopleManagement.tsx select/insert/update/delete; read by
-- Adjustments, CashPickups, CashManagement and Deposits.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO authenticated;

-- sales_reps: ATMManagement.tsx:127 select, :249 insert, :370 delete,
-- :455 upsert (=I+U); read by BTMDetails.tsx:92.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_reps TO authenticated;

-- ticker_mappings: TickerMappings.tsx:39 select, :82 upsert (=I+U);
-- CsvUploads.tsx:226 insert, :443 select. No delete path.
GRANT SELECT, INSERT, UPDATE ON public.ticker_mappings TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. SECURITY DEFINER functions. These execute as the owner and bypass RLS,
--    so an anon EXECUTE grant is a direct write path into protected tables.
--    Revoked FROM PUBLIC (see header) and granted back only where the app
--    actually calls them.
-- ---------------------------------------------------------------------------

-- update_atm_state: called from BulkPlatformConversion.tsx:140,
-- UpdateMachineStateModal.tsx:213 and CsvUploads.tsx:357 -- all behind
-- ProtectedRoute, therefore as `authenticated`. Keeps the authenticated grant.
REVOKE ALL ON FUNCTION public.update_atm_state(
  text, date, text, text, text, text, text, text, text,
  numeric, numeric, numeric, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_atm_state(
  text, date, text, text, text, text, text, text, text,
  numeric, numeric, numeric, text
) TO authenticated, service_role;

-- apply_target_adjustment: called from AdjustBalanceModal.tsx:83, also behind
-- ProtectedRoute. This is the only INSERT path into balance_adjustments, which
-- is why that table gets no INSERT grant above.
REVOKE ALL ON FUNCTION public.apply_target_adjustment(uuid, numeric, text, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_target_adjustment(uuid, numeric, text, date)
  TO authenticated, service_role;

-- log_balance_adjustment_change: a trigger function. Postgres invokes trigger
-- functions through the trigger mechanism, which does not consult EXECUTE on
-- the calling role, so it needs no grant to anyone. Revoked outright; it
-- should never have been reachable over /rest/v1/rpc.
REVOKE ALL ON FUNCTION public.log_balance_adjustment_change()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Advisor 0011: pin the mutable search_path on get_sales_by_atm_month.
--    NOTE: this function has no call sites in src/ or supabase/functions/ --
--    it appears to be unused. It is hardened rather than dropped; removing it
--    is a separate decision.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.get_sales_by_atm_month(date, date)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_sales_by_atm_month(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_atm_month(date, date)
  TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- 6. FK CASCADE REVIEW (no statements -- analysis recorded for the reviewer)
--
-- Migration 041 had to include `uploads` because transactions.upload_id
-- CASCADEs: a referential action runs with owner privileges and does not
-- re-check RLS or grants on the referencing table. Every FK in public was
-- re-examined for the same shape. Results:
--
--   commissions -> commission_details            ON DELETE CASCADE
--     authenticated holds DELETE on BOTH, so the cascade reaches nothing the
--     role could not already delete directly. No bypass. (The app deletes the
--     details explicitly first at CommissionCalculator.tsx:245 anyway.)
--
--   liquidity_snapshots -> liquidity_snapshot_values   ON DELETE CASCADE
--     authenticated holds DELETE on BOTH. No bypass.
--
--   deposits    -> deposit_pickup_links          ON DELETE CASCADE
--   cash_pickups -> deposit_pickup_links         ON DELETE CASCADE
--     authenticated holds DELETE on all three. No bypass.
--
--   balance_adjustments -> balance_adjustment_history  ON DELETE SET NULL
--     NOT a cascade delete: audit rows survive, their adjustment_id is nulled.
--     Worth noting that the SET NULL is a referential action, so deleting an
--     adjustment mutates a history row even though authenticated is granted
--     only SELECT there. The audit record is not destroyed, only unlinked, so
--     this is accepted rather than blocked -- blocking it would require
--     switching the FK to ON DELETE NO ACTION, which changes app behaviour and
--     is out of scope for a grants migration. Flagged for a follow-up decision.
--
--   sales_reps -> commissions -> commission_details    CASCADE, then CASCADE
--     A two-hop chain: deleting a sales rep (ATMManagement.tsx:370) silently
--     removes every commission and commission detail for that rep. No
--     privilege bypass -- authenticated may delete all three directly -- but it
--     is a large destructive blast radius behind one button. Flagged as a
--     product concern, not a security hole; unchanged here.
--
--   atm_profiles -> cash_pickups                 ON DELETE SET NULL
--   sales_reps   -> atm_profiles                 ON DELETE SET NULL
--     Same shape as above, nulling a reference rather than deleting. Accepted.
--
--   uploads -> transactions                      ON DELETE CASCADE
--     Pre-existing and deliberate: 041 grants authenticated DELETE on uploads
--     but withholds it on transactions, letting the documented
--     "delete this upload" button cascade. Unchanged.
-- ---------------------------------------------------------------------------
