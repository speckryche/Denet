// Reconciling a fresh match result against the audit items already stored for
// that month — i.e. what a RE-UPLOAD does.
//
// THE RULE
// A re-upload must never wipe human work. Bitstop reissues a month's report for
// ordinary reasons (a late correction, a restated line), and the person who
// triaged 40 discrepancies last week must not lose those 40 decisions because a
// new file arrived. So:
//
//   * an item that still applies KEEPS its status, note and resolved_date, and
//     has only its amounts refreshed;
//   * genuinely new discrepancies are added as 'open';
//   * an item that no longer applies is NOT deleted — it is marked 'resolved'
//     with the note "cleared by re-upload", so the trail of what was once wrong
//     survives and an accidental clear is visible rather than silent.
//
// IDENTITY
// Matching an existing item to a fresh one is the whole problem, because
// report_line_id changes on every upload (lines are replaced) and cannot be
// part of it. The stable identity is:
//
//     kind + transaction_id           when we have a transaction (our side)
//     kind + atm_id + tx_date         when we don't (report-only rows)
//
// That is stable across re-uploads precisely because both halves come from the
// data rather than from the upload: transaction_id is the provider's own id,
// and atm_id + timestamp is the same key the matcher uses.
//
// Pure: no I/O. The caller persists whatever comes back.

import type { AuditItem, AuditKind } from './match';

export type AuditStatus = 'open' | 'disputed' | 'resolved' | 'accepted_refund' | 'accepted_other';

export const CLEARED_BY_REUPLOAD_NOTE = 'cleared by re-upload';

export interface StoredAuditItem {
  id: string;
  kind: AuditKind;
  transaction_id: string | null;
  atm_id: string | null;
  tx_date: string | null;
  app_fiat: number | null;
  app_commission: number | null;
  report_fiat: number | null;
  report_commission: number | null;
  status: AuditStatus;
  note: string | null;
  resolved_date: string | null;
}

export interface ReconcilePlan {
  /** Existing rows to update in place — identity preserved, amounts refreshed. */
  toUpdate: Array<{ id: string; patch: Partial<StoredAuditItem> }>;
  /** Discrepancies not previously seen this month. */
  toInsert: AuditItem[];
  /** Existing rows whose discrepancy is gone — resolved, never deleted. */
  toClear: Array<{ id: string; patch: Partial<StoredAuditItem> }>;
  stats: { kept: number; added: number; cleared: number; alreadyClosed: number };
}

/** Identity that survives a re-upload. See the header. */
export const auditIdentity = (
  item: { kind: AuditKind; transaction_id?: string | null; atm_id?: string | null; tx_date?: string | null },
): string =>
  item.transaction_id
    ? `${item.kind}|tx:${item.transaction_id}`
    : `${item.kind}|atm:${String(item.atm_id ?? '').trim()}|${item.tx_date ?? ''}`;

/** A status the user has already acted on — never silently reopened. */
const isClosed = (s: AuditStatus): boolean => s !== 'open';

export interface ReconcileOptions {
  /** ISO date stamped on items cleared by this re-upload. */
  today: string;
  /** Fresh report_line_id per fresh item, keyed by its identity, when known. */
  reportLineIdByIdentity?: Map<string, string>;
}

export function reconcileAuditItems(
  existing: StoredAuditItem[],
  fresh: AuditItem[],
  opts: ReconcileOptions,
): ReconcilePlan {
  const existingByIdentity = new Map<string, StoredAuditItem>();
  for (const e of existing) existingByIdentity.set(auditIdentity(e), e);

  const freshByIdentity = new Map<string, AuditItem>();
  for (const f of fresh) freshByIdentity.set(auditIdentity(f), f);

  const toUpdate: ReconcilePlan['toUpdate'] = [];
  const toInsert: AuditItem[] = [];
  const toClear: ReconcilePlan['toClear'] = [];
  let alreadyClosed = 0;

  // Still-applicable items: refresh the numbers, keep every human field.
  for (const [identity, f] of freshByIdentity) {
    const prior = existingByIdentity.get(identity);
    if (!prior) {
      toInsert.push(f);
      continue;
    }
    const lineId = opts.reportLineIdByIdentity?.get(identity);
    toUpdate.push({
      id: prior.id,
      patch: {
        // Amounts can legitimately move between reports — that IS the
        // correction. status / note / resolved_date are deliberately absent.
        app_fiat: f.app_fiat,
        app_commission: f.app_commission,
        report_fiat: f.report_fiat,
        report_commission: f.report_commission,
        ...(lineId ? ({ report_line_id: lineId } as Partial<StoredAuditItem>) : {}),
      },
    });
    if (isClosed(prior.status)) alreadyClosed++;
  }

  // Gone from the fresh result. Resolve rather than delete.
  for (const [identity, e] of existingByIdentity) {
    if (freshByIdentity.has(identity)) continue;
    if (isClosed(e.status)) {
      // Already settled by a human — leave it exactly as it is. Re-stamping it
      // would overwrite their note with ours and rewrite their resolved_date.
      alreadyClosed++;
      continue;
    }
    toClear.push({
      id: e.id,
      patch: {
        status: 'resolved',
        resolved_date: opts.today,
        note: e.note ? `${e.note}\n${CLEARED_BY_REUPLOAD_NOTE}` : CLEARED_BY_REUPLOAD_NOTE,
      },
    });
  }

  return {
    toUpdate,
    toInsert,
    toClear,
    stats: {
      kept: toUpdate.length,
      added: toInsert.length,
      cleared: toClear.length,
      alreadyClosed,
    },
  };
}
