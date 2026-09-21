// Parser for Bitstop's monthly affiliate commission .xlsx.
//
// Pure: takes a 2-D cell array (what XLSX.utils.sheet_to_json(ws, {header:1})
// gives you) and returns line items plus the report's own TOTAL row. No I/O,
// no xlsx import — the caller reads the workbook, so this stays testable in
// the harness without a file.
//
// Three things about the real format drive the design:
//
// 1. COLUMNS MOVE. The format changes occasionally, so every column is found
//    by header name with aliases, never by position.
// 2. created_at IS AN EXCEL SERIAL, not a string: 46241.07710648148. Converted
//    naive-UTC as (serial - 25569) * 86400s, which reproduces
//    transactions.date to the second (verified across the Aug 2026 report).
//    Applying a local-timezone offset here would break exact-timestamp
//    matching, so we deliberately do not.
// 3. THE NAME `fee` IS A TRAP. The report's `commission` column is OUR revenue
//    and matches transactions.fee. The report's `fee` column is the
//    CUSTOMER-paid fee and matches nothing we store (Aug 2026: commission
//    35,277.17 vs fee 62,994.95). We parse `fee` for reference only; nothing
//    downstream compares it.
//
// Totals arrive with float noise (35277.17199999999, 1400.0000000000002), so
// every money value is rounded to cents on the way in via round2.

import { round2 } from '@/lib/qbo/money';

export type CanonicalField =
  | 'atm_id' | 'created_at' | 'fiat' | 'commission'
  | 'tx_id' | 'coin_type' | 'is_stable' | 'location_name' | 'fee'
  | 'location_id' | 'street_address' | 'city' | 'state' | 'zip'
  | 'atm_name' | 'tx_count';

export const REQUIRED_FIELDS: CanonicalField[] = ['atm_id', 'created_at', 'fiat', 'commission'];

// Header aliases, lowercased and stripped of non-alphanumerics before lookup,
// so "ATM ID", "atm_id" and "Atm.Id" all resolve the same way.
const ALIASES: Record<CanonicalField, string[]> = {
  atm_id:         ['atmid', 'atm', 'machineid', 'terminalid'],
  created_at:     ['createdat', 'created', 'date', 'transactiondate', 'txdate', 'datetime'],
  fiat:           ['fiat', 'fiatamount', 'amount', 'sale', 'saleamount', 'inserted', 'cash'],
  commission:     ['commission', 'commissionamount', 'commissionusd', 'payout', 'affiliatecommission'],
  tx_id:          ['txid', 'transactionid', 'tid'],
  coin_type:      ['cointype', 'coin', 'asset', 'currency'],
  is_stable:      ['isstable', 'stable', 'stablecoin'],
  location_name:  ['locationname', 'location', 'site', 'storename'],
  fee:            ['fee', 'feeamount', 'customerfee'],
  location_id:    ['locationid', 'locid'],
  street_address: ['streetaddress', 'address', 'street'],
  city:           ['city'],
  state:          ['state', 'st'],
  zip:            ['zip', 'zipcode', 'postalcode'],
  atm_name:       ['atmname', 'machinename', 'terminalname'],
  tx_count:       ['txcount', 'transactioncount', 'count'],
};

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface ReportLine {
  rowIndex: number;          // 0-based index into the original sheet rows
  atm_id: string;
  created_at: string;        // 'YYYY-MM-DD HH:MM:SS', naive UTC
  fiat: number;
  commission: number;
  tx_id: string | null;
  coin_type: string | null;
  is_stable: string | null;
  location_name: string | null;
  fee: number | null;        // customer-paid fee — reference only, never compared
  location_id: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  atm_name: string | null;
  tx_count: number | null;
  raw: unknown[];
}

export interface ReportTotal {
  tx_count: number | null;
  fiat: number | null;
  fee: number | null;
  commission: number | null;
}

export interface ParsedReport {
  lines: ReportLine[];
  total: ReportTotal | null;
  subtotalRowCount: number;
  headers: string[];
  headerFingerprint: string;
  mapping: Partial<Record<CanonicalField, number>>;
  /** Required fields that could not be resolved — non-empty means show the mapping dialog. */
  unresolved: CanonicalField[];
  /** Line items vs the report's own TOTAL. `ok:false` must BLOCK the import. */
  blockCheck: {
    ok: boolean;
    fiatSum: number; fiatTotal: number | null; fiatDiff: number;
    commissionSum: number; commissionTotal: number | null; commissionDiff: number;
    lineCount: number; totalCount: number | null;
    reason: string | null;
  };
}

export class BitstopReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BitstopReportError';
  }
}

/** Stable identity for a header layout, so a saved mapping can be reused. */
export const fingerprintHeaders = (headers: string[]): string =>
  headers.map(norm).filter(Boolean).join('|');

/**
 * Excel serial date → 'YYYY-MM-DD HH:MM:SS', naive UTC.
 * 25569 = days between the Excel epoch (1899-12-30) and the Unix epoch.
 * Rounded to the nearest second: serials carry float noise that would
 * otherwise land a timestamp a millisecond off and break exact matching.
 */
export const excelSerialToTimestamp = (serial: number): string => {
  if (!Number.isFinite(serial)) throw new BitstopReportError(`Not a date serial: ${serial}`);
  const ms = Math.round((serial - 25569) * 86400) * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new BitstopReportError(`Unparseable date serial: ${serial}`);
  return d.toISOString().replace('T', ' ').slice(0, 19);
};

/** Accepts the Excel serial we actually see, plus ISO/US strings as a fallback. */
export const toTimestamp = (raw: unknown): string | null => {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return excelSerialToTimestamp(raw);
  if (raw instanceof Date) return raw.toISOString().replace('T', ' ').slice(0, 19);
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToTimestamp(Number(s));
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:${iso[6]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})[ ,]+(\d{1,2}):(\d{2}):(\d{2})/);
  if (us) {
    const yyyy = us[3].length === 2 ? `20${us[3]}` : us[3];
    const p = (n: string) => n.padStart(2, '0');
    return `${yyyy}-${p(us[1])}-${p(us[2])} ${p(us[4])}:${us[5]}:${us[6]}`;
  }
  return null;
};

const toNumber = (raw: unknown): number | null => {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? round2(raw) : null;
  const cleaned = String(raw).replace(/[$,\s]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? round2(n) : null;
};

const toText = (raw: unknown): string | null => {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
};

/** Resolve each canonical field to a column index, preferring an exact alias hit. */
export const resolveColumns = (
  headers: string[],
  saved?: Partial<Record<CanonicalField, string>>,
): Partial<Record<CanonicalField, number>> => {
  const normed = headers.map(norm);
  const mapping: Partial<Record<CanonicalField, number>> = {};

  // A saved mapping (from the one-time dialog) wins over alias guessing.
  if (saved) {
    for (const [field, header] of Object.entries(saved)) {
      const idx = normed.indexOf(norm(header));
      if (idx >= 0) mapping[field as CanonicalField] = idx;
    }
  }

  for (const field of Object.keys(ALIASES) as CanonicalField[]) {
    if (mapping[field] != null) continue;
    for (const alias of ALIASES[field]) {
      const idx = normed.indexOf(alias);
      if (idx >= 0) { mapping[field] = idx; break; }
    }
  }
  return mapping;
};

// A row is a SUBTOTAL/TOTAL marker if any cell is exactly that word. Bitstop
// puts SUBTOTAL in the tx_id column and TOTAL in location_id, but that has
// moved before, so we scan the whole row rather than a fixed cell.
const rowHasMarker = (row: unknown[], marker: string): boolean =>
  row.some((c) => typeof c === 'string' && c.trim().toUpperCase() === marker);

export const isSubtotalRow = (row: unknown[]): boolean => rowHasMarker(row, 'SUBTOTAL');
export const isTotalRow = (row: unknown[]): boolean => rowHasMarker(row, 'TOTAL');

/**
 * Parse a sheet given as rows[0] = headers, rows[1..] = body.
 * Throws BitstopReportError only for a structurally unusable sheet; a missing
 * required column is reported via `unresolved` so the UI can ask, and a failed
 * sum is reported via `blockCheck` so the UI can block.
 */
export function parseBitstopReport(
  rows: unknown[][],
  saved?: Partial<Record<CanonicalField, string>>,
): ParsedReport {
  if (!rows || rows.length < 2) throw new BitstopReportError('Sheet has no data rows.');

  const headers = (rows[0] || []).map((h) => String(h ?? '').trim());
  if (headers.filter(Boolean).length === 0) throw new BitstopReportError('Sheet has no header row.');

  const mapping = resolveColumns(headers, saved);
  const unresolved = REQUIRED_FIELDS.filter((f) => mapping[f] == null);

  const body = rows.slice(1).filter((r) => Array.isArray(r) && r.some((c) => c != null && c !== ''));
  const totalRow = body.find(isTotalRow) ?? null;
  const subtotalRowCount = body.filter(isSubtotalRow).length;
  const itemRows = body.filter((r) => !isSubtotalRow(r) && !isTotalRow(r));

  const at = (row: unknown[], f: CanonicalField): unknown => {
    const i = mapping[f];
    return i == null ? null : row[i];
  };

  // With a required column unresolved we cannot build lines; return early so
  // the caller shows the mapping dialog instead of a misleading empty result.
  if (unresolved.length > 0) {
    return {
      lines: [], total: null, subtotalRowCount, headers,
      headerFingerprint: fingerprintHeaders(headers), mapping, unresolved,
      blockCheck: {
        ok: false, fiatSum: 0, fiatTotal: null, fiatDiff: 0,
        commissionSum: 0, commissionTotal: null, commissionDiff: 0,
        lineCount: 0, totalCount: null,
        reason: `Could not identify required column(s): ${unresolved.join(', ')}.`,
      },
    };
  }

  const lines: ReportLine[] = [];
  itemRows.forEach((row) => {
    const rowIndex = rows.indexOf(row);
    const atmId = toText(at(row, 'atm_id'));
    const ts = toTimestamp(at(row, 'created_at'));
    const fiat = toNumber(at(row, 'fiat'));
    const commission = toNumber(at(row, 'commission'));

    // Rows missing an identity or an amount are not line items (stray notes,
    // spacer rows). Dropping them silently is safe because blockCheck below
    // re-derives the sum and will fail loudly if anything real was lost.
    if (!atmId || !ts || fiat == null || commission == null) return;

    lines.push({
      rowIndex, atm_id: atmId, created_at: ts, fiat, commission,
      tx_id: toText(at(row, 'tx_id')),
      coin_type: toText(at(row, 'coin_type')),
      is_stable: toText(at(row, 'is_stable')),
      location_name: toText(at(row, 'location_name')),
      fee: toNumber(at(row, 'fee')),
      location_id: toText(at(row, 'location_id')),
      street_address: toText(at(row, 'street_address')),
      city: toText(at(row, 'city')),
      state: toText(at(row, 'state')),
      zip: toText(at(row, 'zip')),
      atm_name: toText(at(row, 'atm_name')),
      tx_count: (() => { const n = toNumber(at(row, 'tx_count')); return n == null ? null : Math.round(n); })(),
      raw: row,
    });
  });

  const total: ReportTotal | null = totalRow
    ? {
        tx_count: (() => { const n = toNumber(at(totalRow, 'tx_count')); return n == null ? null : Math.round(n); })(),
        fiat: toNumber(at(totalRow, 'fiat')),
        fee: toNumber(at(totalRow, 'fee')),
        commission: toNumber(at(totalRow, 'commission')),
      }
    : null;

  const fiatSum = round2(lines.reduce((s, l) => s + l.fiat, 0));
  const commissionSum = round2(lines.reduce((s, l) => s + l.commission, 0));
  const fiatDiff = round2(fiatSum - (total?.fiat ?? 0));
  const commissionDiff = round2(commissionSum - (total?.commission ?? 0));

  let reason: string | null = null;
  if (!total) reason = 'No TOTAL row found — cannot verify the report sums.';
  else if (total.fiat == null || total.commission == null) reason = 'TOTAL row is missing fiat or commission.';
  else if (Math.abs(fiatDiff) > 0.01) reason = `Line items sum to ${fiatSum} fiat but TOTAL says ${total.fiat} (off by ${fiatDiff}).`;
  else if (Math.abs(commissionDiff) > 0.01) reason = `Line items sum to ${commissionSum} commission but TOTAL says ${total.commission} (off by ${commissionDiff}).`;

  return {
    lines, total, subtotalRowCount, headers,
    headerFingerprint: fingerprintHeaders(headers), mapping, unresolved,
    blockCheck: {
      ok: reason == null,
      fiatSum, fiatTotal: total?.fiat ?? null, fiatDiff,
      commissionSum, commissionTotal: total?.commission ?? null, commissionDiff,
      lineCount: lines.length, totalCount: total?.tx_count ?? null,
      reason,
    },
  };
}
