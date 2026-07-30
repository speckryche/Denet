// ─────────────────────────────────────────────────────────────────────────────
// DENO MIRROR of src/lib/transaction-status.ts.
//
// The Vite app and Deno edge functions cannot share a module (different runtimes,
// no shared build step), so this is a faithful copy of the SINGLE SOURCE OF TRUTH
// at src/lib/transaction-status.ts. The structure below is identical on purpose:
// to change status behavior, edit STATUS_RULES in BOTH files (they must stay in
// lockstep). A reviewer can diff the STATUS_RULES block here against src/lib to
// confirm parity.
//
// Keep this list/table byte-for-byte aligned with src/lib/transaction-status.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type TxStatus =
  | 'completed'
  | 'frozen'
  | 'sending'
  | 'refunded'
  | 'expired'
  | 'under_review';

export const TX_STATUSES: readonly TxStatus[] = [
  'completed',
  'frozen',
  'sending',
  'refunded',
  'expired',
  'under_review',
];

export interface StatusRule {
  financial: boolean;
  ctr: boolean;
}

// THE ONE PLACE TO EDIT (mirror of src/lib/transaction-status.ts).
export const STATUS_RULES: Record<TxStatus, StatusRule> = {
  completed: { financial: true, ctr: true },
  frozen: { financial: false, ctr: true },
  sending: { financial: false, ctr: true },
  refunded: { financial: false, ctr: false },
  expired: { financial: false, ctr: false },
  under_review: { financial: false, ctr: true },
};

export const FINANCIAL_STATUSES: TxStatus[] = TX_STATUSES.filter(
  (s) => STATUS_RULES[s].financial,
);
export const CTR_STATUSES: TxStatus[] = TX_STATUSES.filter((s) => STATUS_RULES[s].ctr);
