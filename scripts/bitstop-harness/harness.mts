// Harness for the Bitstop monthly report audit (parse + match).
//
// Runs the real Aug 2026 report against the real Bitstop transaction export
// and asserts the oracle. Neither file is committed — both hold business data —
// so point at your own copies:
//
//   npm run bitstop:harness
//   BITSTOP_XLSX="~/Downloads/Bitstop Commissions - Aug 2026.xlsx" \
//   BITSTOP_CSV="~/Downloads/Bitstop-Sales-Report-2026-01-01-to-2026-09-21.csv" \
//     npm run bitstop:harness
//
// WHY THE CSV AND NOT THE DATABASE
// The app's transactions for Bitstop-platform machines are imported from this
// exact CSV, and deriving them here reproduces the stored rows precisely:
// 106 Aug-2026 completed rows, sale 278,969.00, fee 35,995.37 — identical to
// what the database holds. Going through the CSV keeps the harness offline and
// keeps business data out of the repo. (It also could not use the anon key
// anyway: migration 20260918002050 revoked anon's access to transactions.)
//
// Fee derivation mirrors CsvUploads.tsx's Bitstop branch exactly:
//   spread = Inserted - Sent;  fee = spread * bitstop_commission_rate (0.56)
// The report's own `fee` column IS that spread, and its `commission` column is
// spread * 0.56 — i.e. our fee. That relationship is asserted below, because
// mistaking report.fee for transactions.fee is the easiest way to corrupt this
// audit.

import fs from 'fs';
import Papa from 'papaparse';
import * as XLSX from 'xlsx-js-style';
import { parseBitstopReport, excelSerialToTimestamp, isSubtotalRow, isTotalRow, resolveColumns } from '@/lib/bitstop-report/parse';
import { matchReportToTransactions, normalizeTs, type AppTransaction } from '@/lib/bitstop-report/match';
import { auditRefundOverrides, type RefundOverride } from '@/lib/refund-overrides';
import { reconcileAuditItems, auditIdentity, CLEARED_BY_REUPLOAD_NOTE, type StoredAuditItem } from '@/lib/bitstop-report/reconcile';
import { round2, fmtAmount } from '@/lib/qbo/money';

const expand = (p: string) => p.replace(/^~/, process.env.HOME || '~');
const XLSX_PATH = expand(process.env.BITSTOP_XLSX || `${process.env.HOME}/Downloads/Bitstop Commissions - Aug 2026.xlsx`);
const CSV_PATH  = expand(process.env.BITSTOP_CSV  || `${process.env.HOME}/Downloads/Bitstop-Sales-Report-2026-01-01-to-2026-09-21.csv`);
const MONTH = process.env.BITSTOP_MONTH || '2026-08';
const RATE = Number(process.env.BITSTOP_RATE || 0.56);

for (const [label, p] of [['report .xlsx', XLSX_PATH], ['transactions .csv', CSV_PATH]] as const) {
  if (!fs.existsSync(p)) {
    console.error(`No ${label} at ${p}. Set BITSTOP_XLSX / BITSTOP_CSV and re-run.`);
    process.exit(2);
  }
}

let failures = 0;
const ok = (label: string, cond: boolean, extra = '') => {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`);
};

// ---------------------------------------------------------------------------
console.log('=== 1. Parse the real report ===');
const wb = XLSX.readFile(XLSX_PATH);
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
console.log(`sheet "${wb.SheetNames[0]}", ${rows.length} rows`);

const parsed = parseBitstopReport(rows);
console.log(`headers: ${parsed.headers.join(', ')}`);
ok('all required columns resolved', parsed.unresolved.length === 0, parsed.unresolved.join(',') || 'none missing');
ok('104 line items', parsed.lines.length === 104, `${parsed.lines.length}`);
ok('22 SUBTOTAL rows skipped', parsed.subtotalRowCount === 22, `${parsed.subtotalRowCount}`);
ok('TOTAL row found', parsed.total != null);
ok('report fiat 273,839', parsed.total?.fiat === 273839, fmtAmount(parsed.total?.fiat ?? 0));
ok('report commission 35,277.17', parsed.total?.commission === 35277.17, fmtAmount(parsed.total?.commission ?? 0));

console.log('\n=== 2. Block check: line items must sum to TOTAL ===');
console.log(`  fiat       sum ${fmtAmount(parsed.blockCheck.fiatSum)}  vs TOTAL ${fmtAmount(parsed.blockCheck.fiatTotal ?? 0)}  diff ${fmtAmount(parsed.blockCheck.fiatDiff)}`);
console.log(`  commission sum ${fmtAmount(parsed.blockCheck.commissionSum)}  vs TOTAL ${fmtAmount(parsed.blockCheck.commissionTotal ?? 0)}  diff ${fmtAmount(parsed.blockCheck.commissionDiff)}`);
ok('block check passes', parsed.blockCheck.ok, parsed.blockCheck.reason ?? '');
ok('TOTAL tx_count is 104', parsed.blockCheck.totalCount === 104, `${parsed.blockCheck.totalCount}`);

console.log('\n=== 3. Excel serial → timestamp ===');
ok('46241.07710648148 → 2026-08-07 01:51:02', excelSerialToTimestamp(46241.07710648148) === '2026-08-07 01:51:02', excelSerialToTimestamp(46241.07710648148));
ok('every line timestamp is YYYY-MM-DD HH:MM:SS', parsed.lines.every(l => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(l.created_at)));
ok('every line falls in 2026-08', parsed.lines.every(l => l.created_at.startsWith('2026-08')));

console.log('\n=== 4. Marker rows and column aliasing ===');
ok('SUBTOTAL row detected', isSubtotalRow([null, 'x', 'SUBTOTAL', 1]));
ok('TOTAL row detected', isTotalRow(['TOTAL', null, 1]));
ok('a plain row is neither', !isSubtotalRow([1, 'Food Mart', 2]) && !isTotalRow([1, 'Food Mart', 2]));
const aliased = resolveColumns(['ATM ID', 'Created At', 'Fiat Amount', 'Commission USD']);
ok('aliases resolve renamed headers', aliased.atm_id === 0 && aliased.created_at === 1 && aliased.fiat === 2 && aliased.commission === 3);
const missing = parseBitstopReport([['atm_id', 'created_at', 'fiat'], ['1', 46241, 100]]);
ok('missing required column is reported, not thrown', missing.unresolved.includes('commission') && !missing.blockCheck.ok);

console.log('\n=== 5. The `fee` trap ===');
// report.fee is the customer-paid spread; report.commission is our revenue.
const sampleFeeSum = round2(parsed.lines.reduce((s, l) => s + (l.fee ?? 0), 0));
ok('report fee total is NOT our commission', sampleFeeSum !== parsed.blockCheck.commissionSum, `${fmtAmount(sampleFeeSum)} vs ${fmtAmount(parsed.blockCheck.commissionSum)}`);
ok('commission ≈ fee * 0.56 across the report', Math.abs(round2(sampleFeeSum * RATE) - parsed.blockCheck.commissionSum) <= 0.05,
   `${fmtAmount(round2(sampleFeeSum * RATE))} vs ${fmtAmount(parsed.blockCheck.commissionSum)}`);

// ---------------------------------------------------------------------------
console.log('\n=== 6. Build transactions from the Bitstop CSV ===');
const csv = Papa.parse<Record<string, string>>(fs.readFileSync(CSV_PATH, 'utf8'), { header: true, skipEmptyLines: true });
const toTs = (raw: string): string | null => {
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const p = (n: string) => n.padStart(2, '0');
  return `${m[3]}-${p(m[1])}-${p(m[2])} ${p(m[4])}:${m[5]}:${m[6]}`;
};
const txs: AppTransaction[] = [];
for (const r of csv.data) {
  const stage = String(r['Stage'] ?? r['DisplayStage'] ?? '').trim().toLowerCase();
  if (stage !== 'completed') continue;
  const ts = toTs(r['CreatedAt']);
  if (!ts || !ts.startsWith(MONTH)) continue;
  const inserted = Number(String(r['Inserted'] ?? '').replace(/[$,]/g, '')) || 0;
  const sent = Number(String(r['Sent'] ?? '').replace(/[$,]/g, '')) || 0;
  txs.push({
    id: r['Id'], atm_id: String(r['AtmId'] ?? '').trim(), date: ts,
    sale: inserted, fee: round2((inserted - sent) * RATE), status: 'completed',
  });
}
const txSale = round2(txs.reduce((s, t) => s + (t.sale ?? 0), 0));
const txFee = round2(txs.reduce((s, t) => s + (t.fee ?? 0), 0));
console.log(`  ${txs.length} completed ${MONTH} transactions, sale ${fmtAmount(txSale)}, fee ${fmtAmount(txFee)}`);
ok('106 app transactions', txs.length === 106, `${txs.length}`);
ok('app sale total 278,969.00', txSale === 278969, fmtAmount(txSale));
ok('app fee total 35,995.37', txFee === 35995.37, fmtAmount(txFee));

// ---------------------------------------------------------------------------
console.log('\n=== 7. Match against the oracle ===');
const result = matchReportToTransactions(parsed.lines, txs, { month: MONTH });
const s = result.stats;
console.log(`  matched ${s.matchedCount}/${s.reportLines} report lines against ${s.appTransactions} transactions`);
console.log(`  missing_from_report ${s.missingFromReport} | not_in_app ${s.notInApp} | amount_diff ${s.amountDiffs} | late_correction ${s.lateCorrections}`);
ok('104 of 104 report lines matched', s.matchedCount === 104 && s.reportLines === 104, `${s.matchedCount}/${s.reportLines}`);
ok('no report line unmatched (not_in_app = 0)', s.notInApp === 0, `${s.notInApp}`);
ok('no amount differences', s.amountDiffs === 0, `${s.amountDiffs}`);
ok('no late corrections in this report', s.lateCorrections === 0, `${s.lateCorrections}`);

console.log('\n=== 8. The two known omissions ===');
const missingItems = result.items.filter(i => i.kind === 'missing_from_report');
for (const m of missingItems) {
  console.log(`  ATM ${m.atm_id}  ${m.tx_date}  fiat ${fmtAmount(m.app_fiat ?? 0)}  commission ${fmtAmount(m.app_commission ?? 0)}`);
}
ok('exactly 2 missing-from-report items', missingItems.length === 2, `${missingItems.length}`);
const hasOmission = (d: string, fiat: number, comm: number) =>
  missingItems.some(m => m.atm_id === '3920' && m.tx_date === d && m.app_fiat === fiat && m.app_commission === comm);
ok('ATM 3920 2026-08-03 20:43:00 = 3,642.00 / 509.88', hasOmission('2026-08-03 20:43:00', 3642, 509.88));
ok('ATM 3920 2026-08-03 21:28:19 = 1,488.00 / 208.32', hasOmission('2026-08-03 21:28:19', 1488, 208.32));
const omittedFiat = round2(missingItems.reduce((a, m) => a + (m.app_fiat ?? 0), 0));
const omittedComm = round2(missingItems.reduce((a, m) => a + (m.app_commission ?? 0), 0));
ok('omitted totals 5,130.00 / 718.20', omittedFiat === 5130 && omittedComm === 718.2, `${fmtAmount(omittedFiat)} / ${fmtAmount(omittedComm)}`);
ok('nothing else flagged', result.items.length === 2, `${result.items.length} items total`);

console.log('\n=== 9. Reconciliation identity ===');
// app = report + omissions, on both measures. This is the whole audit in one line.
ok('app fiat = report fiat + omitted', round2(s.reportFiat + omittedFiat) === s.appFiat,
   `${fmtAmount(s.reportFiat)} + ${fmtAmount(omittedFiat)} = ${fmtAmount(s.appFiat)}`);
ok('app commission = report commission + omitted', round2(s.reportCommission + omittedComm) === s.appCommission,
   `${fmtAmount(s.reportCommission)} + ${fmtAmount(omittedComm)} = ${fmtAmount(s.appCommission)}`);

console.log('\n=== 10. Refund overrides remove a sale from the expected set ===');
const victim = txs.find(t => t.atm_id === '1063' && t.date === '2026-08-07 01:51:02')!;
const withRefund = matchReportToTransactions(parsed.lines, txs, { month: MONTH, refundedIds: new Set([victim.id]) });
ok('refunded tx drops out of the app side', withRefund.stats.appTransactions === 105, `${withRefund.stats.appTransactions}`);
ok('its report line now reads as not_in_app', withRefund.stats.notInApp === 1, `${withRefund.stats.notInApp}`);
ok('candidates suggested for the orphaned line',
   (withRefund.items.find(i => i.kind === 'not_in_app')?.candidates?.length ?? 0) === 0,
   'none — the only same-amount row was the refunded one');

console.log('\n=== 11. Orphaned refund overrides ===');
// transaction_refunds has no FK (see migration 20260921223823), so an override
// can outlive its transaction. That must surface, not silently stop excluding.
const liveIds = new Set(txs.map(t => t.id));
const ov = (id: string, extra: Partial<RefundOverride> = {}): RefundOverride => ({
  id: `ov-${id}`, transaction_id: id, refund_date: '2026-09-01', source: 'Bitstop notice',
  note: null, atm_id: null, tx_date: null, sale: null, fee: null, platform: 'bitstop', ...extra,
});
const liveOverride = ov(victim.id, { atm_id: victim.atm_id, tx_date: victim.date, sale: victim.sale, fee: victim.fee });
const deadOverride = ov('id-that-no-longer-exists', { atm_id: victim.atm_id, tx_date: victim.date, sale: victim.sale, fee: victim.fee });

const audit = auditRefundOverrides([liveOverride, deadOverride], liveIds, txs);
ok('live override lands in the exclusion set', audit.activeIds.has(victim.id) && audit.activeIds.size === 1, `${audit.activeIds.size}`);
ok('dead override flagged as orphan', audit.orphans.length === 1, `${audit.orphans.length}`);
ok('orphan reports the value no longer excluded', audit.orphanedSale === 2000 && audit.orphanedFee === 280,
   `${fmtAmount(audit.orphanedSale)} / ${fmtAmount(audit.orphanedFee)}`);
ok('orphan suggests the reissued row from its snapshot',
   audit.orphans[0].candidates.some(c => c.id === victim.id), `${audit.orphans[0].candidates.length} candidate(s)`);
const skipped = auditRefundOverrides([deadOverride], null, txs);
ok('null id-set skips orphan detection (no false positives on a partial slice)',
   skipped.orphans.length === 0 && skipped.activeIds.size === 1);

console.log('\n=== 12. Re-upload preserves human work ===');
// The audit items a first upload would create for Aug 2026.
const firstRun = result.items;
const stored: StoredAuditItem[] = firstRun.map((i, n) => ({
  id: `item-${n}`, kind: i.kind, transaction_id: i.transaction_id,
  atm_id: i.atm_id, tx_date: i.tx_date,
  app_fiat: i.app_fiat, app_commission: i.app_commission,
  report_fiat: i.report_fiat, report_commission: i.report_commission,
  status: 'open', note: null, resolved_date: null,
}));
// A human triages one of them.
stored[0] = { ...stored[0], status: 'disputed', note: 'emailed Bitstop 9/18', resolved_date: null };

// Re-upload of the SAME report: nothing should be added or cleared.
const same = reconcileAuditItems(stored, firstRun, { today: '2026-09-21' });
ok('identical re-upload adds nothing', same.stats.added === 0, `${same.stats.added}`);
ok('identical re-upload clears nothing', same.stats.cleared === 0, `${same.stats.cleared}`);
ok('both items kept', same.stats.kept === 2, `${same.stats.kept}`);
ok('no patch touches status/note/resolved_date',
   same.toUpdate.every(u => !('status' in u.patch) && !('note' in u.patch) && !('resolved_date' in u.patch)));

// Identity survives even though report_line_id would have changed.
ok('identity is stable across uploads',
   auditIdentity(firstRun[0]) === auditIdentity({ ...firstRun[0], reportRowIndex: 999 } as any));

// Bitstop reissues the report WITH the two previously-omitted sales, so those
// discrepancies are gone, and a different line now disagrees on amount.
const corrected = [
  { ...firstRun[0], kind: 'amount_diff' as const, transaction_id: 'tx-new', app_fiat: 100, app_commission: 14, report_fiat: 90, report_commission: 12.6 },
];
const plan = reconcileAuditItems(stored, corrected, { today: '2026-09-21' });
ok('new discrepancy added', plan.stats.added === 1, `${plan.stats.added}`);
ok('vanished discrepancies cleared, not deleted', plan.stats.cleared === 1, `${plan.stats.cleared}`);
ok('cleared item is resolved with the required note',
   plan.toClear[0].patch.status === 'resolved' && String(plan.toClear[0].patch.note).includes(CLEARED_BY_REUPLOAD_NOTE),
   String(plan.toClear[0].patch.note));
ok('cleared item gets a resolved_date', plan.toClear[0].patch.resolved_date === '2026-09-21');

// The human-triaged item vanished too — but it was NOT open, so it is left alone.
const triagedGone = reconcileAuditItems(
  [{ ...stored[0], status: 'accepted_refund', note: 'refunded, accepted', resolved_date: '2026-09-19' }],
  [], { today: '2026-09-21' });
ok('an already-closed item is never re-stamped', triagedGone.stats.cleared === 0 && triagedGone.stats.alreadyClosed === 1);

console.log('\n=== 13. Timestamp normalization ===');
ok('ISO T-form normalizes', normalizeTs('2026-08-07T01:51:02.000Z') === '2026-08-07 01:51:02');
ok('space form passes through', normalizeTs('2026-08-07 01:51:02') === '2026-08-07 01:51:02');
ok('garbage yields null', normalizeTs('not a date') === null);

console.log(failures ? `\n${failures} FAILURES` : '\nAll harness checks passed.');
process.exit(failures ? 1 : 0);
