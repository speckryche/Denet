// Matches Bitstop's monthly report lines against our own Bitstop-platform
// transactions, and classifies every difference into an audit item.
//
// Pure: takes already-fetched rows, returns a result. No I/O.
//
// MATCH KEY: atm_id + exact timestamp.
// The report's created_at equals transactions.date to the second — verified
// 104/104 on the Aug 2026 report. The report DOES carry a tx_id (e.g.
// 1089004), but it matches nothing we store: transactions.id for a
// Bitstop-platform row is the 64-char hex id from Bitstop's own CSV export,
// and the report's tx_id appears in neither that export nor the Nonce one
// (zero overlap, checked across all four id columns). So tx_id cannot be used
// for matching today; it is carried on the line for forensics only.
//
// AMOUNT MAPPING (the trap):
//   report.fiat       ↔ transactions.sale
//   report.commission ↔ transactions.fee     ← our revenue
//   report.fee        ↔ nothing              ← CUSTOMER-paid fee, never compared
//
// Refund-overridden transactions are excluded before matching: a sale we have
// refunded is not commission we expect Bitstop to pay.

import { round2 } from '@/lib/qbo/money';
import type { ReportLine } from './parse';

/** Amount difference above which a matched pair becomes an audit item. */
export const AMOUNT_TOLERANCE = 0.01;

export interface AppTransaction {
  id: string;
  atm_id: string | null;
  date: string | null;     // 'YYYY-MM-DD HH:MM:SS' (or ISO — normalized below)
  sale: number | null;
  fee: number | null;
  status?: string | null;
}

export type AuditKind = 'missing_from_report' | 'not_in_app' | 'amount_diff' | 'late_correction';

export interface AuditItem {
  kind: AuditKind;
  atm_id: string | null;
  tx_date: string | null;
  transaction_id: string | null;
  reportRowIndex: number | null;
  app_fiat: number | null;
  app_commission: number | null;
  report_fiat: number | null;
  report_commission: number | null;
  /** Populated for not_in_app: plausible same-ATM, same-amount, nearby-time rows. */
  candidates?: MatchCandidate[];
}

export interface MatchCandidate {
  transaction_id: string;
  date: string;
  sale: number;
  fee: number;
  secondsApart: number;
}

export interface MatchResult {
  matched: Array<{ line: ReportLine; tx: AppTransaction }>;
  items: AuditItem[];
  /** Report lines dated outside the audited month — candidate late corrections. */
  lateCorrections: ReportLine[];
  stats: {
    reportLines: number;
    appTransactions: number;
    matchedCount: number;
    missingFromReport: number;
    notInApp: number;
    amountDiffs: number;
    lateCorrections: number;
    reportFiat: number;
    reportCommission: number;
    appFiat: number;
    appCommission: number;
  };
}

/** Normalize a timestamp to 'YYYY-MM-DD HH:MM:SS' so both sides key identically. */
export const normalizeTs = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : null;
};

const keyOf = (atmId: string | null, ts: string | null): string | null =>
  atmId && ts ? `${String(atmId).trim()}|${ts}` : null;

const secondsBetween = (a: string, b: string): number =>
  Math.abs((Date.parse(`${a}Z`) - Date.parse(`${b}Z`)) / 1000);

export interface MatchOptions {
  /** 'YYYY-MM' of the month being audited; lines outside it are late corrections. */
  month: string;
  /** transaction_ids with a refund override — excluded from the expected set. */
  refundedIds?: Set<string>;
  /** Window for suggesting candidates for an unmatched report line. */
  candidateWindowSeconds?: number;
}

export function matchReportToTransactions(
  lines: ReportLine[],
  transactions: AppTransaction[],
  opts: MatchOptions,
): MatchResult {
  const refunded = opts.refundedIds ?? new Set<string>();
  const windowSec = opts.candidateWindowSeconds ?? 900; // ±15 min

  // Expected set: completed, this platform, not refund-overridden.
  const appRows = transactions.filter(
    (t) => t.id && !refunded.has(t.id) && (t.status == null || t.status === 'completed'),
  );

  // Index app rows by atm|timestamp. Duplicates at the identical key are kept
  // as a queue so two genuine same-second sales both stay matchable.
  const appByKey = new Map<string, AppTransaction[]>();
  for (const t of appRows) {
    const k = keyOf(t.atm_id, normalizeTs(t.date));
    if (!k) continue;
    const bucket = appByKey.get(k);
    if (bucket) bucket.push(t); else appByKey.set(k, [t]);
  }

  const matched: Array<{ line: ReportLine; tx: AppTransaction }> = [];
  const items: AuditItem[] = [];
  const lateCorrections: ReportLine[] = [];
  const consumed = new Set<string>();

  for (const line of lines) {
    // A line dated outside the audited month is a possible late correction for
    // an earlier month, not a discrepancy in this one.
    if (!line.created_at.startsWith(opts.month)) {
      lateCorrections.push(line);
      items.push({
        kind: 'late_correction',
        atm_id: line.atm_id, tx_date: line.created_at,
        transaction_id: null, reportRowIndex: line.rowIndex,
        app_fiat: null, app_commission: null,
        report_fiat: line.fiat, report_commission: line.commission,
      });
      continue;
    }

    const k = keyOf(line.atm_id, line.created_at);
    const bucket = k ? appByKey.get(k) : undefined;
    const tx = bucket?.find((t) => !consumed.has(t.id));

    if (!tx) {
      // On the report, nothing in the app. Offer same-ATM, same-amount,
      // nearby-time rows so a human can confirm a clock-skew match.
      const candidates: MatchCandidate[] = appRows
        .filter((t) => String(t.atm_id).trim() === line.atm_id && normalizeTs(t.date))
        .map((t) => ({
          transaction_id: t.id,
          date: normalizeTs(t.date) as string,
          sale: round2(t.sale ?? 0),
          fee: round2(t.fee ?? 0),
          secondsApart: secondsBetween(normalizeTs(t.date) as string, line.created_at),
        }))
        .filter((c) => c.secondsApart <= windowSec && Math.abs(c.sale - line.fiat) <= AMOUNT_TOLERANCE)
        .sort((a, b) => a.secondsApart - b.secondsApart)
        .slice(0, 5);

      items.push({
        kind: 'not_in_app',
        atm_id: line.atm_id, tx_date: line.created_at,
        transaction_id: null, reportRowIndex: line.rowIndex,
        app_fiat: null, app_commission: null,
        report_fiat: line.fiat, report_commission: line.commission,
        candidates,
      });
      continue;
    }

    consumed.add(tx.id);
    matched.push({ line, tx });

    const appFiat = round2(tx.sale ?? 0);
    const appComm = round2(tx.fee ?? 0);
    if (
      Math.abs(appFiat - line.fiat) > AMOUNT_TOLERANCE ||
      Math.abs(appComm - line.commission) > AMOUNT_TOLERANCE
    ) {
      items.push({
        kind: 'amount_diff',
        atm_id: line.atm_id, tx_date: line.created_at,
        transaction_id: tx.id, reportRowIndex: line.rowIndex,
        app_fiat: appFiat, app_commission: appComm,
        report_fiat: line.fiat, report_commission: line.commission,
      });
    }
  }

  // In the app, absent from the report — commission at stake. Restricted to the
  // audited month so earlier-dated rows don't masquerade as omissions.
  for (const t of appRows) {
    if (consumed.has(t.id)) continue;
    const ts = normalizeTs(t.date);
    if (!ts || !ts.startsWith(opts.month)) continue;
    items.push({
      kind: 'missing_from_report',
      atm_id: t.atm_id, tx_date: ts,
      transaction_id: t.id, reportRowIndex: null,
      app_fiat: round2(t.sale ?? 0), app_commission: round2(t.fee ?? 0),
      report_fiat: null, report_commission: null,
    });
  }

  items.sort((a, b) => (a.tx_date ?? '').localeCompare(b.tx_date ?? ''));

  const inMonthLines = lines.filter((l) => l.created_at.startsWith(opts.month));
  const inMonthApp = appRows.filter((t) => {
    const ts = normalizeTs(t.date);
    return ts != null && ts.startsWith(opts.month);
  });

  return {
    matched, items, lateCorrections,
    stats: {
      reportLines: lines.length,
      appTransactions: inMonthApp.length,
      matchedCount: matched.length,
      missingFromReport: items.filter((i) => i.kind === 'missing_from_report').length,
      notInApp: items.filter((i) => i.kind === 'not_in_app').length,
      amountDiffs: items.filter((i) => i.kind === 'amount_diff').length,
      lateCorrections: lateCorrections.length,
      reportFiat: round2(inMonthLines.reduce((s, l) => s + l.fiat, 0)),
      reportCommission: round2(inMonthLines.reduce((s, l) => s + l.commission, 0)),
      appFiat: round2(inMonthApp.reduce((s, t) => s + (t.sale ?? 0), 0)),
      appCommission: round2(inMonthApp.reduce((s, t) => s + (t.fee ?? 0), 0)),
    },
  };
}

/**
 * Auto-match a later month's late-correction lines against earlier open items.
 * A correction resolves an item when the ATM, timestamp and both amounts agree.
 */
export function resolveLateCorrections(
  corrections: ReportLine[],
  openItems: Array<{ id: string; atm_id: string | null; tx_date: string | null; app_fiat: number | null; app_commission: number | null }>,
): Array<{ correction: ReportLine; itemId: string }> {
  const out: Array<{ correction: ReportLine; itemId: string }> = [];
  const used = new Set<string>();
  for (const c of corrections) {
    const hit = openItems.find(
      (i) =>
        !used.has(i.id) &&
        String(i.atm_id ?? '').trim() === c.atm_id &&
        normalizeTs(i.tx_date) === c.created_at &&
        Math.abs((i.app_fiat ?? 0) - c.fiat) <= AMOUNT_TOLERANCE &&
        Math.abs((i.app_commission ?? 0) - c.commission) <= AMOUNT_TOLERANCE,
    );
    if (hit) { used.add(hit.id); out.push({ correction: c, itemId: hit.id }); }
  }
  return out;
}
