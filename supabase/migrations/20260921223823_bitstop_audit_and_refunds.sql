-- Bitstop commission audit + refund overrides (part 1 of 2).
--
-- WHY
-- Two separate problems, one migration because they share the Bitstop month row.
--
-- 1. REFUND OVERRIDES. Bitstop sometimes refunds a customer after a sale
--    (fraud refunds, mostly Arizona), but Nonce still reports the transaction
--    as 'completed'. Because YTD CSV re-uploads upsert on transactions.id and
--    overwrite `status` unconditionally ("CSV always wins" —
--    src/lib/transaction-status.ts:174-177), the refund can never be recorded
--    in `transactions` itself: the next re-upload would wipe it. It has to live
--    in a side table that the upsert payload never touches.
--
-- 2. MONTHLY REPORT AUDIT. Bitstop sends a manual .xlsx commission report for
--    the affiliate machines each month. Today nothing checks it against our own
--    transactions, so a line Bitstop omits is commission we silently never
--    collect. The Aug 2026 report was short exactly two ATM 3920 sales
--    ($5,130 fiat / $718.20 commission).
--
-- WHY transaction_refunds HAS NO FOREIGN KEY TO transactions
-- Deliberate, and the most important decision in this file.
-- transactions.upload_id REFERENCES uploads(id) ON DELETE CASCADE, and the
-- UploadHistory delete button uses it. A FK from here to transactions would
-- therefore let an upload deletion cascade away (or block) a refund override —
-- the exact "a re-upload must never clear it" failure this table exists to
-- prevent. transaction_id is stored as plain TEXT and matched in the
-- application layer. The denormalized atm_id / tx_date / sale / fee / platform
-- columns are a forensic snapshot so an override stays interpretable even if
-- its transaction is momentarily absent between an upload delete and re-import.
--
-- TRANSACTION ID SHAPE (for reviewers)
-- transactions.id is the provider's own id, taken verbatim from the CSV, not a
-- hash we compute: Bitstop exports a 64-char hex id, Nonce a 7-digit numeric.
-- It is stable across YTD re-uploads, which is what makes it a safe key here.
--
-- NOT IN THIS FILE
-- The `financial_transactions` view (which applies these overrides centrally to
-- every report) is Stage 2, and ships as its own migration with
-- security_invoker = true so it enforces the caller's RLS rather than the
-- owner's.
--
-- RLS pattern follows 20260918002050 / 20260921200107: one
-- "Authenticated users full access" policy, anon revoked entirely, and
-- authenticated reset from the inherited GRANT ALL down to the privileges the
-- app actually uses. Admin-only access is enforced client-side via
-- user_metadata.role (AuthContext) — RLS does not distinguish admins.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. transaction_refunds — one row per refunded sale, either platform.
-- Presence of a row is the override; undo is a DELETE. UNIQUE(transaction_id)
-- makes re-marking an upsert rather than a duplicate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transaction_refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  TEXT NOT NULL,
  refund_date     DATE NOT NULL,
  source          TEXT,
  note            TEXT,
  -- Forensic snapshot of the transaction as it read when marked. Never used
  -- for totals — the live transaction is the source of truth — but it keeps
  -- the Refunds list readable if the row is temporarily missing.
  atm_id          TEXT,
  tx_date         TIMESTAMP,
  sale            NUMERIC(14,2),
  fee             NUMERIC(14,2),
  platform        TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_refunds_tx      ON transaction_refunds(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_refunds_tx_date ON transaction_refunds(tx_date);

ALTER TABLE transaction_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON transaction_refunds
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 2. bitstop_report_lines — the parsed line items of one month's .xlsx.
--
-- Columns mirror the report's own header names so a reviewer can diff a row
-- against the spreadsheet directly. Two naming traps are worth stating:
--   * report `commission` is OUR revenue and matches transactions.fee.
--   * report `fee`        is the CUSTOMER-paid fee and matches NOTHING we
--                         store. Mapping it to transactions.fee would silently
--                         corrupt the audit, so it is kept only for reference.
-- created_at arrives as an Excel serial (e.g. 46241.07710648148) and is
-- converted naive-UTC via (serial - 25569) * 86400s; verified to match
-- transactions.date to the second on the Aug 2026 report.
-- raw_row keeps the untouched cell array so a format change stays diagnosable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bitstop_report_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id   UUID NOT NULL REFERENCES bitstop_commissions(id) ON DELETE CASCADE,
  row_index       INTEGER NOT NULL,
  location_id     TEXT,
  location_name   TEXT,
  street_address  TEXT,
  city            TEXT,
  state           TEXT,
  zip             TEXT,
  atm_id          TEXT,
  atm_name        TEXT,
  tx_id           TEXT,
  created_at_tx   TIMESTAMP,
  coin_type       TEXT,
  is_stable       TEXT,
  tx_count        INTEGER,
  fiat            NUMERIC(14,2),
  fee             NUMERIC(14,2),
  commission      NUMERIC(14,2),
  raw_row         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (commission_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_bitstop_report_lines_cid ON bitstop_report_lines(commission_id);
CREATE INDEX IF NOT EXISTS idx_bitstop_report_lines_atm ON bitstop_report_lines(atm_id, created_at_tx);

ALTER TABLE bitstop_report_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON bitstop_report_lines
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 3. bitstop_audit_items — one row per discrepancy, carried forward until
-- resolved. Open items are the badge on the month row.
--
-- kind:
--   missing_from_report — in our transactions, absent from Bitstop's report.
--                         This is commission at stake.
--   not_in_app          — on the report, no matching transaction.
--   amount_diff         — matched, but fiat or commission differs by > $0.01.
--   late_correction     — a report line dated in an earlier month; auto-matched
--                         against that month's open items to resolve them.
-- Either side may be null: missing_from_report has no report_line_id,
-- not_in_app has no transaction_id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bitstop_audit_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id      UUID NOT NULL REFERENCES bitstop_commissions(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN (
                       'missing_from_report', 'not_in_app', 'amount_diff', 'late_correction')),
  transaction_id     TEXT,
  report_line_id     UUID REFERENCES bitstop_report_lines(id) ON DELETE SET NULL,
  atm_id             TEXT,
  tx_date            TIMESTAMP,
  app_fiat           NUMERIC(14,2),
  app_commission     NUMERIC(14,2),
  report_fiat        NUMERIC(14,2),
  report_commission  NUMERIC(14,2),
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
                       'open', 'disputed', 'resolved', 'accepted_refund', 'accepted_other')),
  note               TEXT,
  resolved_date      DATE,
  -- Set when a later month's late_correction item resolves this one.
  resolved_by_item_id UUID REFERENCES bitstop_audit_items(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bitstop_audit_items_cid    ON bitstop_audit_items(commission_id);
CREATE INDEX IF NOT EXISTS idx_bitstop_audit_items_status ON bitstop_audit_items(status);
CREATE INDEX IF NOT EXISTS idx_bitstop_audit_items_atm    ON bitstop_audit_items(atm_id, tx_date);

ALTER TABLE bitstop_audit_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON bitstop_audit_items
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 4. bitstop_column_mappings — remembered header→field mapping.
--
-- The report's shape changes occasionally, so the parser resolves columns by
-- header name with aliases and never by position. When a required column
-- cannot be identified the UI asks once, and the answer is saved here keyed by
-- a fingerprint of the header row, so the same layout is never asked twice.
-- mapping is { canonical_field: source_header }.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bitstop_column_mappings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_fingerprint   TEXT NOT NULL,
  headers              JSONB NOT NULL,
  mapping              JSONB NOT NULL,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (header_fingerprint)
);

ALTER TABLE bitstop_column_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON bitstop_column_mappings
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 5. bitstop_commissions.amount_received — what Bitstop actually deposited,
-- next to paid/date_paid. Part 2 subtracts expected clawbacks from the
-- expected amount; for now the UI shows report total vs received and flags any
-- difference.
-- ---------------------------------------------------------------------------
ALTER TABLE bitstop_commissions
  ADD COLUMN IF NOT EXISTS amount_received NUMERIC(14,2);

-- ---------------------------------------------------------------------------
-- 6. Grants. anon gets nothing; authenticated gets only what the app uses.
-- The REVOKE from authenticated is mandatory, not cosmetic: it resets the
-- inherited blanket GRANT ALL (which carries TRUNCATE, and RLS IS NOT ENFORCED
-- FOR TRUNCATE) down to this explicit set. Grants are the backstop; policies
-- are the filter. service_role is untouched and keeps full access.
--
-- DELETE is granted on all four: refund overrides are undoable, and a report
-- re-upload replaces that month's lines and regenerates its audit items.
-- ---------------------------------------------------------------------------
REVOKE ALL PRIVILEGES ON public.transaction_refunds      FROM anon;
REVOKE ALL PRIVILEGES ON public.bitstop_report_lines     FROM anon;
REVOKE ALL PRIVILEGES ON public.bitstop_audit_items      FROM anon;
REVOKE ALL PRIVILEGES ON public.bitstop_column_mappings  FROM anon;

REVOKE ALL PRIVILEGES ON public.transaction_refunds      FROM authenticated;
REVOKE ALL PRIVILEGES ON public.bitstop_report_lines     FROM authenticated;
REVOKE ALL PRIVILEGES ON public.bitstop_audit_items      FROM authenticated;
REVOKE ALL PRIVILEGES ON public.bitstop_column_mappings  FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_refunds      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bitstop_report_lines     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bitstop_audit_items      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bitstop_column_mappings  TO authenticated;

COMMIT;
