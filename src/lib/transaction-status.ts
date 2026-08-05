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
  | 'under_review'
  | 'failed'
  | 'partial';

// Canonical ordered list of every stored status. The CSV parser uses this to
// recognize/normalize incoming values; keep it in sync with the DB CHECK
// constraint (migrations 20240522000038 + 20240522000039 + 20240522000043).
export const TX_STATUSES: readonly TxStatus[] = [
  'completed',
  'frozen',
  'sending',
  'refunded',
  'expired',
  'under_review',
  'failed',
  'partial',
];

// Is this status a FINAL outcome, or is the transaction still in flight and
// awaiting resolution?
//
// This axis is ORTHOGONAL to financial/ctr and must stay that way. Those two
// answer "does this row count toward a total?"; this one answers "does a human
// still need to chase this row?". The Pending Resolution tracker groups on
// THIS axis alone — deliberately, so that when Nonce confirms what 'expired'
// and 'under_review' really mean and their financial/ctr flags change, the
// tracker's actionable-vs-terminal behavior does not silently shift with them.
//
// (Note for future editors: today `!financial && ctr` happens to select exactly
// the pending statuses, and `!financial && !ctr` exactly the final-but-uncounted
// ones. That is a COINCIDENCE of the current interim rules, not a rule. Never
// group on it — flip one ctr flag and it breaks. Group on `resolution`.)
export type Resolution = 'pending' | 'final';

// The calculation surfaces a status can count toward.
//  - financial: everything money-related — P&L, sales, fees, commissions, cash
//    management, reconciliation, liquidity, dashboards. Counts COMPLETED ONLY.
//  - ctr: the CTR threshold report. Counts completed + frozen + sending;
//    EXCLUDES refunded (money returned) and, interim, expired.
//  - resolution: settled outcome vs. still awaiting resolution (see above).
//  - manualTarget: may a human set this status by hand on the Pending
//    Resolution page? This is a CURATED judgement, not a derivation — 'expired'
//    is every bit as final as 'completed'/'refunded', but nobody resolves a
//    stuck transaction by declaring it expired, so it gets no button. Add a
//    button by flipping this flag; never by writing a status list in a
//    component.
export interface StatusRule {
  financial: boolean;
  ctr: boolean;
  resolution: Resolution;
  manualTarget: boolean;
}

// ── THE ONE PLACE TO EDIT ──
// Each row is a status; each flag is "does this status count toward that
// surface?". To change how a status behaves everywhere, flip its flag(s) here.
export const STATUS_RULES: Record<TxStatus, StatusRule> = {
  completed: { financial: true, ctr: true, resolution: 'final', manualTarget: true },
  frozen: { financial: false, ctr: true, resolution: 'pending', manualTarget: false },
  // 'sending' is treated identically to 'frozen' (stored distinctly, same rule).
  sending: { financial: false, ctr: true, resolution: 'pending', manualTarget: false },
  // Money returned to the customer — a settled outcome, nothing left to chase.
  refunded: { financial: false, ctr: false, resolution: 'final', manualTarget: true },
  // INTERIM (pending Nonce's confirmation of what 'expired' means): excluded
  // from EVERYTHING, exactly like refunded. Safest default — worst case is a
  // small visible understatement, never silent revenue inflation. When the rule
  // is confirmed, change ONLY this line.
  // `resolution: 'final'` is NOT interim: an expired transaction is over,
  // whatever its money treatment turns out to be. Leave it when the flags move.
  expired: { financial: false, ctr: false, resolution: 'final', manualTarget: false },
  // INTERIM (awaiting Nonce confirmation — likely a manual hold): treated
  // identically to frozen/sending — counts toward CTR, excluded from revenue.
  // When the rule is confirmed, change ONLY this line.
  // `resolution: 'pending'` is NOT interim: a held transaction is exactly the
  // kind of row the tracker exists to surface. Leave it when the flags move.
  under_review: { financial: false, ctr: true, resolution: 'pending', manualTarget: false },
  // INTERIM (awaiting Nonce confirmation — same footing as 'expired'): excluded
  // from EVERYTHING. A failed transaction never completed, so no money moved and
  // nothing is owed; counting it would inflate revenue. When the rule is
  // confirmed, change ONLY this line.
  // Appeared in real Denet CSV data 2026-07-31 and was caught by the importer's
  // unknown-status guard, which defaulted it to 'completed' with a warning —
  // the wrong home for it, hence this entry plus migration 20240522000042.
  // `resolution: 'final'` is NOT interim: a failed transaction is over. It is
  // terminal, not actionable — nothing to chase, so it gets no resolve buttons.
  failed: { financial: false, ctr: false, resolution: 'final', manualTarget: false },
  // INTERIM (awaiting Nonce confirmation): DisplayStage='Pending' — a not-yet-
  // final transaction. Treated identically to frozen/sending/under_review —
  // counts toward CTR, excluded from revenue, and PENDING (the tracker's
  // actionable group). When the rule is confirmed, change ONLY this line.
  // Appeared in real Bitstop CSV data and was caught by the importer's
  // unknown-status guard (defaulted to 'completed' with a warning) — the wrong
  // home for it, hence this entry plus migration 20240522000043.
  partial: { financial: false, ctr: true, resolution: 'pending', manualTarget: false },
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

// ─────────────────────────────────────────────────────────────────────────────
// Resolution-axis derivations — the Pending Resolution tracker's inputs.
//
// Why this exists: CSV pulls are forward-only, so a transaction left at a
// non-final status is never re-included by a later pull and stays stuck
// silently (found manually on ATM 3997, June 2026). These lists drive the page
// that catches those systematically.
// ─────────────────────────────────────────────────────────────────────────────

// Still in flight — the tracker's ACTIONABLE group. Today: frozen, sending,
// under_review.
export const PENDING_STATUSES: TxStatus[] = TX_STATUSES.filter(
  (s) => STATUS_RULES[s].resolution === 'pending',
);

// Settled, but excluded from the money totals — the tracker's TERMINAL group.
// Shown for visibility only; there is nothing left to act on. Today: refunded,
// expired.
export const RESOLVED_UNCOUNTED_STATUSES: TxStatus[] = TX_STATUSES.filter(
  (s) => STATUS_RULES[s].resolution === 'final' && !STATUS_RULES[s].financial,
);

// Everything the tracker fetches. A row needs no tracking only when it is BOTH
// settled AND counted as money — i.e. fully done, with its revenue already in
// the totals. Today that is 'completed' alone, so this resolves to "every
// status except completed", but it is derived rather than written as
// `!== 'completed'` so a future status can never silently escape the tracker.
export const TRACKED_STATUSES: TxStatus[] = TX_STATUSES.filter(
  (s) => !(STATUS_RULES[s].resolution === 'final' && STATUS_RULES[s].financial),
);

// Predicate helpers for grouping already-fetched rows. An unrecognized/missing
// status is treated as NOT pending (defensive: never invent work from bad data;
// the column is NOT NULL DEFAULT 'completed', so this should not occur).
export const isPending = (status: string | null | undefined): boolean =>
  !!status && STATUS_RULES[status as TxStatus]?.resolution === 'pending';

export const isFinal = (status: string | null | undefined): boolean =>
  !!status && STATUS_RULES[status as TxStatus]?.resolution === 'final';

// Statuses a human may set by hand on the Pending Resolution page — the source
// for that page's buttons, so the component never spells out a status list.
// Today: completed, refunded. CSV always wins: a manual choice carries no
// override flag and a later re-upload overwrites it freely (Nonce is the source
// of truth). See the manualTarget comment on StatusRule.
export const MANUAL_RESOLUTION_TARGETS: TxStatus[] = TX_STATUSES.filter(
  (s) => STATUS_RULES[s].manualTarget,
);

// ─────────────────────────────────────────────────────────────────────────────
// Presentation helpers for LIST views (ATM Transactions, Dashboard recent list).
// LIST views show EVERY transaction — including non-completed ones — greyed and
// tagged, while their money totals stay completed-only (use countsFinancial for
// the "counts toward totals?" check; never hardcode a status list in a
// component). These helpers exist so components render status badges without
// hardcoding status strings.
// ─────────────────────────────────────────────────────────────────────────────

// Human-readable label for a status badge/tag.
export const STATUS_LABELS: Record<TxStatus, string> = {
  completed: 'Completed',
  frozen: 'Frozen',
  sending: 'Sending',
  refunded: 'Refunded',
  expired: 'Expired',
  under_review: 'Under Review',
  failed: 'Failed',
  partial: 'Partial',
};

export const formatStatusLabel = (status: string | null | undefined): string => {
  if (!status) return '';
  return STATUS_LABELS[status as TxStatus] ?? status;
};

// Tailwind pill classes per status for list-view tags (subtle, dark-theme).
const STATUS_BADGE_CLASSES: Record<TxStatus, string> = {
  completed: 'bg-white/10 text-muted-foreground',
  frozen: 'bg-sky-500/15 text-sky-300',
  sending: 'bg-amber-500/15 text-amber-300',
  refunded: 'bg-rose-500/15 text-rose-300',
  expired: 'bg-zinc-500/15 text-zinc-300',
  under_review: 'bg-violet-500/15 text-violet-300',
  failed: 'bg-orange-500/15 text-orange-300',
  partial: 'bg-teal-500/15 text-teal-300',
};

export const statusBadgeClass = (status: string | null | undefined): string =>
  (status && STATUS_BADGE_CLASSES[status as TxStatus]) || 'bg-white/10 text-muted-foreground';
