-- QBO Entries (Stage 1) — monthly journal-entry computation for QuickBooks Online.
--
-- Two journal entries are recorded each month, both dated the last day of the month:
--   A) Sales JE    — Denet-platform machine sales only (Bitstop machines excluded).
--   B) Coinbase JE — crypto purchased on Coinbase Prime that month.
--
-- This migration adds the reference data (account + asset mapping), the Coinbase
-- Prime statement import tables, the per-buy treatment override, and the JE
-- snapshot table used for "mark as entered" + drift detection.
--
-- STAGE 2 FORWARD-COMPATIBILITY
-- qbo_*_account_id columns and qbo_je_snapshots.qbo_txn_id are nullable
-- placeholders for the API-posting stage. Nothing reads them yet.
--
-- SECURITY
-- Authenticated-only, following 20240522000041 (the anon lockdown) rather than
-- the older "Allow all for anon" style: policies filter, grants are the backstop
-- (RLS is not enforced for TRUNCATE, so anon is revoked outright). The app runs
-- every route behind ProtectedRoute, so it always operates as `authenticated`.
-- Admin-only access to this module is enforced client-side (user_metadata.role),
-- consistent with the rest of the app — RLS does not distinguish admins.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. crypto_assets — one row per coin the business handles.
-- default_treatment decides whether a Coinbase buy lands in inventory or in
-- long-term investments; it is a DEFAULT only — coinbase_buy_treatment (table 5)
-- overrides it per trade. Machine sales always credit the inventory account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crypto_assets (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol                     TEXT NOT NULL UNIQUE,
  name                       TEXT NOT NULL,
  default_treatment          TEXT NOT NULL DEFAULT 'inventory'
                               CHECK (default_treatment IN ('inventory', 'investment')),
  inventory_account_name     TEXT NOT NULL,
  investment_account_name    TEXT NOT NULL,
  qbo_inventory_account_id   TEXT,
  qbo_investment_account_id  TEXT,
  active                     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE crypto_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON crypto_assets
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

INSERT INTO crypto_assets
  (symbol, name, default_treatment, inventory_account_name, investment_account_name)
VALUES
  ('BTC', 'Bitcoin', 'inventory',  'Inventory - Bitcoin', 'Long-term Investments:Bitcoin'),
  ('SOL', 'Solana',  'investment', 'Inventory - Solana',  'Long-term Investments:Solana (SOL)')
ON CONFLICT (symbol) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. qbo_account_map — the fixed (non per-coin) accounts, keyed by a stable
-- code the app references. account_name is what shows on the JE; editable in
-- Settings so a QBO rename doesn't require a deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qbo_account_map (
  key             TEXT PRIMARY KEY,
  account_name    TEXT NOT NULL,
  qbo_account_id  TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE qbo_account_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON qbo_account_map
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

INSERT INTO qbo_account_map (key, account_name) VALUES
  ('machine_cash',     'BTC Machine Cash'),
  ('transaction_fees', 'Transaction Fees'),
  ('bitstop_fees',     'Bitstop Fees'),
  ('exchange_account', 'Exchange Account - Coinbase'),
  ('exchange_fees',    'Exchange Fees')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. coinbase_transactions — raw detail_*.csv rows from the Coinbase Prime
-- monthly ZIP, stored as imported.
--
-- IDEMPOTENCY: row_hash is a SHA-256 over the row's normalized source fields,
-- computed client-side at import. Re-uploading the same statement upserts onto
-- row_hash and changes nothing. activity_id (the file's "ID" column) is NOT
-- unique — a trade writes one USD-side row and one coin-side row sharing it —
-- so it must not be a key. Quantities use NUMERIC(38,18): Coinbase reports
-- full-precision balances (e.g. 0.0000000099769453).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coinbase_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  row_hash              TEXT NOT NULL UNIQUE,
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,
  date_completed        TIMESTAMPTZ NOT NULL,
  activity_id           TEXT NOT NULL,
  activity_type         TEXT NOT NULL,
  activity_description  TEXT,
  asset                 TEXT NOT NULL,
  status                TEXT,
  amount                NUMERIC(38,18) NOT NULL DEFAULT 0,
  fee                   NUMERIC(38,18) NOT NULL DEFAULT 0,
  total_balance_impact  NUMERIC(38,18) NOT NULL DEFAULT 0,
  wallet                TEXT,
  wallet_type           TEXT,
  wallet_id             TEXT,
  portfolio             TEXT,
  portfolio_id          TEXT,
  entity                TEXT,
  source_filename       TEXT NOT NULL,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coinbase_transactions_date_completed ON coinbase_transactions(date_completed);
CREATE INDEX IF NOT EXISTS idx_coinbase_transactions_activity_id    ON coinbase_transactions(activity_id);
CREATE INDEX IF NOT EXISTS idx_coinbase_transactions_period         ON coinbase_transactions(period_start, period_end);

ALTER TABLE coinbase_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON coinbase_transactions
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 4. coinbase_balances — asset_balances_*.csv rows. Drives the USD tie-out
-- check: starting USD + SUM(total_balance_impact of every USD row) = ending USD.
-- The *_usd columns are the file's "notional USD" values, kept for display only;
-- the tie-out uses the full-precision starting/ending columns.
-- Assets appear here that were never traded (e.g. a dust LINK balance), so this
-- table is NOT a source of truth for which coins need a crypto_assets row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coinbase_balances (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start          DATE NOT NULL,
  period_end            DATE NOT NULL,
  asset                 TEXT NOT NULL,
  portfolio             TEXT,
  portfolio_id          TEXT NOT NULL DEFAULT '',
  starting_balance      NUMERIC(38,18) NOT NULL DEFAULT 0,
  ending_balance        NUMERIC(38,18) NOT NULL DEFAULT 0,
  starting_balance_usd  NUMERIC(20,2),
  ending_balance_usd    NUMERIC(20,2),
  source_filename       TEXT NOT NULL,
  imported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_start, period_end, portfolio_id, asset)
);

CREATE INDEX IF NOT EXISTS idx_coinbase_balances_period ON coinbase_balances(period_start, period_end);

ALTER TABLE coinbase_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON coinbase_balances
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 5. coinbase_buy_treatment — per-trade override of crypto_assets.default_treatment.
-- Keyed on (activity_id, asset_symbol): activity_id identifies the trade, and
-- asset_symbol is the COIN BOUGHT (parsed from "BUY BTC/USD - LIMIT"), not the
-- USD side. No row means "use the asset default".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coinbase_buy_treatment (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   TEXT NOT NULL,
  asset_symbol  TEXT NOT NULL,
  treatment     TEXT NOT NULL CHECK (treatment IN ('inventory', 'investment')),
  updated_by    TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id, asset_symbol)
);

ALTER TABLE coinbase_buy_treatment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON coinbase_buy_treatment
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 6. qbo_je_snapshots — what was actually entered in QBO, per (month, je_type).
-- lines is the full JE as computed at the moment of entry:
--   [{ "account": "...", "debit": 0, "credit": 0, "description": "..." }, ...]
-- On later views the JE is recomputed and compared against this snapshot; any
-- difference (e.g. a transaction status changed after entry) surfaces as drift.
-- month is 'YYYY-MM' text, matching the bitstop_fee_overrides.year_month
-- precedent rather than the commissions.month_year DATE style.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qbo_je_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month          TEXT NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  je_type        TEXT NOT NULL CHECK (je_type IN ('sales', 'coinbase')),
  je_date        DATE NOT NULL,
  lines          JSONB NOT NULL,
  total_debits   NUMERIC(14,2) NOT NULL,
  total_credits  NUMERIC(14,2) NOT NULL,
  entered_by     TEXT,
  entered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  qbo_txn_id     TEXT,
  UNIQUE (month, je_type)
);

CREATE INDEX IF NOT EXISTS idx_qbo_je_snapshots_month ON qbo_je_snapshots(month);

ALTER TABLE qbo_je_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON qbo_je_snapshots
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 7. Grants. anon gets nothing (see 20240522000041 — grants are the backstop
-- because RLS does not cover TRUNCATE). authenticated gets the minimal set the
-- app actually uses:
--   crypto_assets / qbo_account_map        — Settings CRUD (assets can be added)
--   coinbase_transactions / _balances      — statement import (upsert) + read
--   coinbase_buy_treatment                 — per-buy toggle, DELETE = revert to default
--   qbo_je_snapshots                       — mark entered, re-mark, and un-mark
-- ---------------------------------------------------------------------------
REVOKE ALL PRIVILEGES ON public.crypto_assets          FROM anon;
REVOKE ALL PRIVILEGES ON public.qbo_account_map        FROM anon;
REVOKE ALL PRIVILEGES ON public.coinbase_transactions  FROM anon;
REVOKE ALL PRIVILEGES ON public.coinbase_balances      FROM anon;
REVOKE ALL PRIVILEGES ON public.coinbase_buy_treatment FROM anon;
REVOKE ALL PRIVILEGES ON public.qbo_je_snapshots       FROM anon;

REVOKE ALL PRIVILEGES ON public.crypto_assets          FROM authenticated;
REVOKE ALL PRIVILEGES ON public.qbo_account_map        FROM authenticated;
REVOKE ALL PRIVILEGES ON public.coinbase_transactions  FROM authenticated;
REVOKE ALL PRIVILEGES ON public.coinbase_balances      FROM authenticated;
REVOKE ALL PRIVILEGES ON public.coinbase_buy_treatment FROM authenticated;
REVOKE ALL PRIVILEGES ON public.qbo_je_snapshots       FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crypto_assets          TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.qbo_account_map        TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.coinbase_transactions  TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.coinbase_balances      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coinbase_buy_treatment TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qbo_je_snapshots       TO authenticated;

COMMIT;
