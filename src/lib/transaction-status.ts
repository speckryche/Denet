// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH for transaction status → calculation-surface rules.
//
// Every calculation surface (P&L, ATM P&L, pnl.ts, sales, fees, commissions,
// cash mgmt, reconciliation, liquidity, dashboards, CTR) MUST decide which
// transactions to count by reading from this file — never by hardcoding a
// status list. Change a status's behavior HERE, in one line, and every surface
// follows. No migration, no re-import, no code hunting.
//
// The five raw statuses are stored distinctly on transactions.status (see the
// CHECK constraint in migration 20240522000038). This config maps each to
// whether it counts toward each surface.
// ─────────────────────────────────────────────────────────────────────────────

export type TxStatus =
  | 'completed'
  | 'frozen'
  | 'sending'
  | 'refunded'
  | 'expired'
  | 'under_review';

// Canonical ordered list of every stored status. The CSV parser uses this to
// recognize/normalize incoming values; keep it in sync with the DB CHECK
// constraint (migrations 20240522000038 + 20240522000039).
export const TX_STATUSES: readonly TxStatus[] = [
  'completed',
  'frozen',
  'sending',
  'refunded',
  'expired',
  'under_review',
];

// The calculation surfaces a status can count toward.
//  - financial: everything money-related — P&L, sales, fees, commissions, cash
//    management, reconciliation, liquidity, dashboards. Counts COMPLETED ONLY.
//  - ctr: the CTR threshold report. Counts completed + frozen + sending;
//    EXCLUDES refunded (money returned) and, interim, expired.
export interface StatusRule {
  financial: boolean;
  ctr: boolean;
}

// ── THE ONE PLACE TO EDIT ──
// Each row is a status; each flag is "does this status count toward that
// surface?". To change how a status behaves everywhere, flip its flag(s) here.
export const STATUS_RULES: Record<TxStatus, StatusRule> = {
  completed: { financial: true, ctr: true },
  frozen: { financial: false, ctr: true },
  // 'sending' is treated identically to 'frozen' (stored distinctly, same rule).
  sending: { financial: false, ctr: true },
  refunded: { financial: false, ctr: false },
  // INTERIM (pending Nonce's confirmation of what 'expired' means): excluded
  // from EVERYTHING, exactly like refunded. Safest default — worst case is a
  // small visible understatement, never silent revenue inflation. When the rule
  // is confirmed, change ONLY this line.
  expired: { financial: false, ctr: false },
  // INTERIM (awaiting Nonce confirmation — likely a manual hold): treated
  // identically to frozen/sending — counts toward CTR, excluded from revenue.
  // When the rule is confirmed, change ONLY this line.
  under_review: { financial: false, ctr: true },
};

// Derived status lists for building queries/filters. Import these into any
// surface instead of writing a literal array.
export const FINANCIAL_STATUSES: TxStatus[] = TX_STATUSES.filter(
  (s) => STATUS_RULES[s].financial,
);
export const CTR_STATUSES: TxStatus[] = TX_STATUSES.filter((s) => STATUS_RULES[s].ctr);

// Predicate helpers for in-memory filtering of already-fetched rows. An
// unrecognized/missing status counts toward nothing (defensive — should not
// occur, since the column is NOT NULL DEFAULT 'completed').
export const countsFinancial = (status: string | null | undefined): boolean =>
  !!status && STATUS_RULES[status as TxStatus]?.financial === true;

export const countsCtr = (status: string | null | undefined): boolean =>
  !!status && STATUS_RULES[status as TxStatus]?.ctr === true;
