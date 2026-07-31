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
  | 'under_review'
  | 'failed';

export const TX_STATUSES: readonly TxStatus[] = [
  'completed',
  'frozen',
  'sending',
  'refunded',
  'expired',
  'under_review',
  'failed',
];

// Orthogonal to financial/ctr: settled outcome vs. still awaiting resolution.
// This field and `manualTarget` are consumed only by the app-side Pending
// Resolution tracker — no edge function reads either. Mirrored here anyway so
// the STATUS_RULES block stays diffable against src/lib/transaction-status.ts
// line for line.
export type Resolution = 'pending' | 'final';

export interface StatusRule {
  financial: boolean;
  ctr: boolean;
  resolution: Resolution;
  manualTarget: boolean;
}

// THE ONE PLACE TO EDIT (mirror of src/lib/transaction-status.ts).
export const STATUS_RULES: Record<TxStatus, StatusRule> = {
  completed: { financial: true, ctr: true, resolution: 'final', manualTarget: true },
  frozen: { financial: false, ctr: true, resolution: 'pending', manualTarget: false },
  sending: { financial: false, ctr: true, resolution: 'pending', manualTarget: false },
  refunded: { financial: false, ctr: false, resolution: 'final', manualTarget: true },
  expired: { financial: false, ctr: false, resolution: 'final', manualTarget: false },
  under_review: { financial: false, ctr: true, resolution: 'pending', manualTarget: false },
  failed: { financial: false, ctr: false, resolution: 'final', manualTarget: false },
};

export const FINANCIAL_STATUSES: TxStatus[] = TX_STATUSES.filter(
  (s) => STATUS_RULES[s].financial,
);
export const CTR_STATUSES: TxStatus[] = TX_STATUSES.filter((s) => STATUS_RULES[s].ctr);
