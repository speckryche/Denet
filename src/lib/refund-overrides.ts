import { countsFinancial } from '@/lib/transaction-status';

// Refund overrides: the set of transactions that have been refunded after the
// fact, and the orphan check that keeps that set trustworthy.
//
// WHY ORPHANS ARE POSSIBLE AT ALL
// transaction_refunds deliberately has NO foreign key to transactions. The
// reason is in migration 20260921223823: transactions.upload_id references
// uploads ON DELETE CASCADE, and the UploadHistory delete button uses it. An
// FK here would therefore let an upload deletion cascade away a refund
// override — exactly the "a re-upload must never clear it" failure the table
// exists to prevent.
//
// The cost of that choice is that nothing at the database level stops an
// override from pointing at a transaction_id that no longer resolves. That is
// not a bug to fix by adding the FK back; it is a condition to SURFACE. An
// orphaned override is money we believe was refunded but can no longer tie to
// a sale, so it silently stops excluding anything — the totals quietly drift
// back up. This module makes that visible.
//
// Two ways an orphan appears:
//   * the upload holding the transaction was deleted and not re-imported, or
//   * the provider reissued the row under a different id.
// Both are recoverable: the denormalized atm_id / tx_date / sale snapshot on
// the override is enough to find the replacement, which is why those columns
// exist.

export interface RefundOverride {
  id: string;
  transaction_id: string;
  refund_date: string;
  source: string | null;
  note: string | null;
  atm_id: string | null;
  tx_date: string | null;
  sale: number | null;
  fee: number | null;
  platform: string | null;
}

export interface OrphanedRefund {
  override: RefundOverride;
  /** Rows matching the override's snapshot that could be the reissued transaction. */
  candidates: Array<{ id: string; atm_id: string | null; date: string | null; sale: number | null; fee: number | null }>;
}

export interface RefundAudit {
  /** transaction_ids that resolve to a live transaction — the exclusion set. */
  activeIds: Set<string>;
  orphans: OrphanedRefund[];
  /** Sale value no longer being excluded because its override is orphaned. */
  orphanedSale: number;
  /** Fee value no longer being excluded because its override is orphaned. */
  orphanedFee: number;
}

export interface KnownTransaction {
  id: string;
  atm_id?: string | null;
  date?: string | null;
  sale?: number | null;
  fee?: number | null;
}

const AMOUNT_TOL = 0.01;

const sameTimestamp = (a: string | null | undefined, b: string | null | undefined): boolean => {
  if (!a || !b) return false;
  return String(a).slice(0, 19).replace('T', ' ') === String(b).slice(0, 19).replace('T', ' ');
};

/**
 * Split refund overrides into those that still resolve and those that don't.
 *
 * `knownIds` must be the id set of ALL transactions considered, not just the
 * ones in some filtered window — otherwise every override outside the window
 * reads as an orphan. Callers that only have a slice of transactions should
 * pass `null` to skip the orphan check rather than produce false positives.
 */
export function auditRefundOverrides(
  overrides: RefundOverride[],
  knownIds: Set<string> | null,
  transactionsForCandidates: KnownTransaction[] = [],
): RefundAudit {
  const activeIds = new Set<string>();
  const orphans: OrphanedRefund[] = [];

  for (const o of overrides) {
    if (!o.transaction_id) continue;

    // No id set supplied — trust every override and skip orphan detection.
    if (knownIds == null || knownIds.has(o.transaction_id)) {
      activeIds.add(o.transaction_id);
      continue;
    }

    // Orphan. Offer the reissued row, if one looks like it: same ATM, same
    // timestamp, same sale amount.
    const candidates = transactionsForCandidates
      .filter(
        (t) =>
          t.id !== o.transaction_id &&
          String(t.atm_id ?? '').trim() === String(o.atm_id ?? '').trim() &&
          sameTimestamp(t.date, o.tx_date) &&
          Math.abs((t.sale ?? 0) - (o.sale ?? 0)) <= AMOUNT_TOL,
      )
      .slice(0, 5)
      .map((t) => ({ id: t.id, atm_id: t.atm_id ?? null, date: t.date ?? null, sale: t.sale ?? null, fee: t.fee ?? null }));

    orphans.push({ override: o, candidates });
  }

  return {
    activeIds,
    orphans,
    orphanedSale: orphans.reduce((s, x) => s + (x.override.sale ?? 0), 0),
    orphanedFee: orphans.reduce((s, x) => s + (x.override.fee ?? 0), 0),
  };
}

/** Convenience for the common case: just the ids to exclude from totals. */
export const refundedIdSet = (overrides: RefundOverride[]): Set<string> =>
  new Set(overrides.map((o) => o.transaction_id).filter(Boolean));

/**
 * The full "does this row count financially" test for in-memory callers.
 *
 * Mirrors what `financial_transactions` does in SQL, so a screen that fetches
 * every status and filters client-side reaches the same answer as a report that
 * queries the view. Keep the two in step: this is the TS half of that rule.
 */
export const countsFinancialTx = (
  tx: { id?: string | null; status?: string | null },
  refundedIds: Set<string>,
): boolean => {
  if (tx.status != null && !countsFinancial(tx.status)) return false;
  return !(tx.id && refundedIds.has(tx.id));
};
