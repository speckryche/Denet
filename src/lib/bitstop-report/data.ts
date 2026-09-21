// Supabase I/O for the Bitstop report audit. Every computation lives in the
// pure modules beside this one (parse / match / reconcile); this file only
// reads and writes rows, following the src/lib/qbo/ split.

import { supabase } from '@/lib/supabase';
import { parseBitstopReport, type CanonicalField, type ParsedReport, type ReportLine } from './parse';
import { matchReportToTransactions, type AppTransaction, type MatchResult } from './match';
import { reconcileAuditItems, auditIdentity, type StoredAuditItem, type AuditStatus } from './reconcile';

export interface BitstopMonthRow {
  id: string;
  month: string;   // 'Aug'
  year: number;
  received_report: boolean | null;
  total_sales: number | null;
  commission_amount: number | null;
  commission_percent: number | null;
  amount_received: number | null;
  paid: boolean | null;
  date_paid: string | null;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** 'Aug' + 2026 -> '2026-08', the form the matcher and report timestamps use. */
export const toYearMonth = (month: string, year: number): string => {
  const idx = MONTH_ABBR.findIndex((m) => m.toLowerCase() === String(month).slice(0, 3).toLowerCase());
  if (idx < 0) throw new Error(`Unrecognized month abbreviation: ${month}`);
  return `${year}-${String(idx + 1).padStart(2, '0')}`;
};

export async function fetchSavedMapping(
  fingerprint: string,
): Promise<Partial<Record<CanonicalField, string>> | null> {
  const { data, error } = await supabase
    .from('bitstop_column_mappings')
    .select('mapping')
    .eq('header_fingerprint', fingerprint)
    .maybeSingle();
  if (error) throw error;
  return (data?.mapping as Partial<Record<CanonicalField, string>>) ?? null;
}

export async function saveMapping(
  fingerprint: string,
  headers: string[],
  mapping: Partial<Record<CanonicalField, string>>,
  createdBy: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('bitstop_column_mappings')
    .upsert(
      { header_fingerprint: fingerprint, headers, mapping, created_by: createdBy },
      { onConflict: 'header_fingerprint' },
    );
  if (error) throw error;
}

/**
 * Transactions for the month, already on the financial surface.
 *
 * Reads `financial_transactions`, so refund-overridden sales are excluded
 * before matching: a sale we have refunded is not commission we expect Bitstop
 * to pay, and flagging it as "missing from report" would be wrong.
 * Platform-filtered to bitstop — the affiliate report only covers those.
 */
export async function fetchMonthTransactions(yearMonth: string): Promise<AppTransaction[]> {
  const [y, m] = yearMonth.split('-').map(Number);
  const start = `${yearMonth}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const out: AppTransaction[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('financial_transactions')
      .select('id, atm_id, date, sale, fee, status')
      .eq('platform', 'bitstop')
      .gte('date', start)
      .lt('date', end)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data || []) as AppTransaction[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function fetchAuditItems(commissionId: string): Promise<StoredAuditItem[]> {
  const { data, error } = await supabase
    .from('bitstop_audit_items')
    .select('id, kind, transaction_id, atm_id, tx_date, app_fiat, app_commission, report_fiat, report_commission, status, note, resolved_date')
    .eq('commission_id', commissionId);
  if (error) throw error;
  return (data || []) as StoredAuditItem[];
}

export async function fetchReportLines(commissionId: string) {
  const { data, error } = await supabase
    .from('bitstop_report_lines')
    .select('*')
    .eq('commission_id', commissionId)
    .order('row_index');
  if (error) throw error;
  return data || [];
}

export async function updateAuditItem(
  id: string,
  patch: { status?: AuditStatus; note?: string | null; resolved_date?: string | null },
): Promise<void> {
  const { data, error } = await supabase
    .from('bitstop_audit_items')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  // PostgREST returns 200 [] for both "RLS denied" and "no row matched", so an
  // empty result must never read as success (same rule as resolve-transaction.ts).
  if (!data || data.length === 0) {
    throw new Error(`Audit item ${id} was not updated — no row matched, or RLS denied the write.`);
  }
}

export interface UploadOutcome {
  parsed: ParsedReport;
  match: MatchResult;
  kept: number;
  added: number;
  cleared: number;
  alreadyClosed: number;
}

/**
 * The whole upload: parse → block-check → replace lines → match → reconcile
 * audit items → auto-fill the month row.
 *
 * Throws before writing anything if the block check fails, so a report whose
 * line items disagree with its own TOTAL can never land half-imported.
 */
export async function importBitstopReport(args: {
  rows: unknown[][];
  monthRow: BitstopMonthRow;
  savedMapping?: Partial<Record<CanonicalField, string>>;
  today: string;
}): Promise<UploadOutcome> {
  const { rows, monthRow, savedMapping, today } = args;
  const yearMonth = toYearMonth(monthRow.month, monthRow.year);

  const parsed = parseBitstopReport(rows, savedMapping);
  if (parsed.unresolved.length > 0) {
    throw new Error(`Unmapped column(s): ${parsed.unresolved.join(', ')}`);
  }
  if (!parsed.blockCheck.ok) {
    throw new Error(parsed.blockCheck.reason || 'Report failed its own TOTAL check.');
  }

  // Replace this month's lines. Audit items reference them via ON DELETE SET
  // NULL, so clearing lines never cascades away a triaged item.
  const { error: delError } = await supabase
    .from('bitstop_report_lines')
    .delete()
    .eq('commission_id', monthRow.id);
  if (delError) throw delError;

  const lineRows = parsed.lines.map((l: ReportLine) => ({
    commission_id: monthRow.id,
    row_index: l.rowIndex,
    location_id: l.location_id,
    location_name: l.location_name,
    street_address: l.street_address,
    city: l.city,
    state: l.state,
    zip: l.zip,
    atm_id: l.atm_id,
    atm_name: l.atm_name,
    tx_id: l.tx_id,
    created_at_tx: l.created_at,
    coin_type: l.coin_type,
    is_stable: l.is_stable,
    tx_count: l.tx_count,
    fiat: l.fiat,
    fee: l.fee,
    commission: l.commission,
    raw_row: l.raw as any,
  }));

  const inserted: Array<{ id: string; atm_id: string | null; created_at_tx: string | null }> = [];
  for (let i = 0; i < lineRows.length; i += 500) {
    const { data, error } = await supabase
      .from('bitstop_report_lines')
      .insert(lineRows.slice(i, i + 500))
      .select('id, atm_id, created_at_tx');
    if (error) throw error;
    inserted.push(...((data || []) as any[]));
  }

  const transactions = await fetchMonthTransactions(yearMonth);
  const match = matchReportToTransactions(parsed.lines, transactions, { month: yearMonth });

  // Fresh line ids, keyed the same way audit identity is, so a reconciled item
  // can be re-pointed at this upload's line.
  const lineIdByIdentity = new Map<string, string>();
  for (const row of inserted) {
    const key = `atm:${String(row.atm_id ?? '').trim()}|${row.created_at_tx ?? ''}`;
    for (const kind of ['not_in_app', 'amount_diff', 'late_correction']) {
      lineIdByIdentity.set(`${kind}|${key}`, row.id);
    }
  }

  const existing = await fetchAuditItems(monthRow.id);
  const plan = reconcileAuditItems(existing, match.items, {
    today,
    reportLineIdByIdentity: lineIdByIdentity,
  });

  for (const u of plan.toUpdate) {
    const { error } = await supabase.from('bitstop_audit_items').update(u.patch).eq('id', u.id);
    if (error) throw error;
  }
  for (const c of plan.toClear) {
    const { error } = await supabase.from('bitstop_audit_items').update(c.patch).eq('id', c.id);
    if (error) throw error;
  }
  if (plan.toInsert.length > 0) {
    const newRows = plan.toInsert.map((i) => ({
      commission_id: monthRow.id,
      kind: i.kind,
      transaction_id: i.transaction_id,
      report_line_id: lineIdByIdentity.get(auditIdentity(i)) ?? null,
      atm_id: i.atm_id,
      tx_date: i.tx_date,
      app_fiat: i.app_fiat,
      app_commission: i.app_commission,
      report_fiat: i.report_fiat,
      report_commission: i.report_commission,
      status: 'open',
    }));
    const { error } = await supabase.from('bitstop_audit_items').insert(newRows);
    if (error) throw error;
  }

  // Auto-fill the month row from the report's own TOTAL. paid / date_paid /
  // amount_received are untouched: a settled month is never reopened.
  const total = parsed.total;
  const pct =
    total?.fiat && total.fiat !== 0 && total.commission != null
      ? Math.round((total.commission / total.fiat) * 10000) / 100
      : null;
  const { error: monthError } = await supabase
    .from('bitstop_commissions')
    .update({
      received_report: true,
      total_sales: total?.fiat ?? null,
      commission_amount: total?.commission ?? null,
      commission_percent: pct,
      updated_at: new Date().toISOString(),
    })
    .eq('id', monthRow.id);
  if (monthError) throw monthError;

  return { parsed, match, ...plan.stats };
}
