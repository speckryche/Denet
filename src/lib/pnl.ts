// Shared monthly P&L engine. Reproduces ATMProfitLoss.tsx's per-profile
// calculation EXACTLY, but bucketed per (profile, month) instead of summed over
// the whole range. Summing an engine profile's monthly cells back over the
// range reproduces the existing report's row for that profile — see
// pnl-reference.ts + the reconciliation harness.
//
// Reuses the same shared helpers the existing report uses (profilesForWindow,
// txsByProfile, calculateExpenseMonths) so attribution is identical.

import { supabase } from './supabase';
import {
  profilesForWindow,
  txsByProfile as groupTxsByProfile,
  calculateExpenseMonths,
} from './atm-profile';

export type Platform = 'both' | 'denet' | 'bitstop';

export interface PnLProfile {
  id: string;
  atm_id: string | null;
  location_name: string | null;
  state: string | null;
  platform: string | null;
  monthly_rent: number | null;
  cash_management_rps: number | null;
  cash_management_rep: number | null;
  sales_rep_id: string | null;
  installed_date: string | null;
  removed_date: string | null;
  active: boolean | null;
}

export interface PnLTransaction {
  id: string;
  atm_id: string | null;
  atm_name: string | null;
  sale: number | null;
  fee: number | null;
  bitstop_fee: number | null;
  platform: string | null;
  date: string | null;
}

export interface CommissionDetail {
  month_ym: string; // 'YYYY-MM'
  amount: number;
}

// Everything the engine (and the reference parity port) need — fetched once so
// both compute against an identical snapshot.
export interface PnLInputs {
  relevantProfiles: PnLProfile[];
  txsByProfileId: Map<string, PnLTransaction[]>;
  commissionDetailsByATM: Map<string, CommissionDetail[]>;
  overrideMap: Map<string, number>; // 'atm_id:YYYY-MM' -> actual_fees
  months: string[]; // 'YYYY-MM', ordered, inclusive
  reportStartDate: Date;
  reportEndDate: Date;
  maxTxYM: string | null; // month of the latest tx in the loaded data
}

export interface PnLLineItems {
  total_sales: number;
  total_fees: number;
  bitstop_fees: number;
  rent: number;
  mgmt_rps: number;
  mgmt_rep: number;
  commissions: number;
  net_profit: number;
  has_override: boolean;
}

export interface MonthlyPnLCell extends PnLLineItems {
  atm_id: string;
  profile_id: string;
  atm_name: string;
  platform: string; // 'denet' | 'bitstop'
  month: string; // 'YYYY-MM'
}

export interface MonthlyPnLResult {
  months: string[];
  cells: MonthlyPnLCell[];
  partialMonth: string | null;
  byMonthTotals: Record<string, PnLLineItems>;
  byMachineMonthNet: Record<string, Record<string, number>>; // atm_id -> YYYY-MM -> net
  machineMeta: Record<string, { atm_name: string; state: string }>;
}

const emptyLineItems = (): PnLLineItems => ({
  total_sales: 0,
  total_fees: 0,
  bitstop_fees: 0,
  rent: 0,
  mgmt_rps: 0,
  mgmt_rep: 0,
  commissions: 0,
  net_profit: 0,
  has_override: false,
});

// Enumerate 'YYYY-MM' from fromMonth..toMonth inclusive.
export function monthRange(fromMonth: string, toMonth: string): string[] {
  const [fy, fm] = fromMonth.split('-').map(Number);
  const [ty, tm] = toMonth.split('-').map(Number);
  const out: string[] = [];
  for (let y = fy; y <= ty; y++) {
    const mStart = y === fy ? fm : 1;
    const mEnd = y === ty ? tm : 12;
    for (let m = mStart; m <= mEnd; m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

// Single-month expense flag (0 or 1) — reuses calculateExpenseMonths with a
// one-month window, so it partitions the range total exactly.
function monthExpenseFlag(profile: PnLProfile, ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0); // last day of month
  return calculateExpenseMonths(profile, start, end);
}

type WindowProfile = { id: string; atm_id: string | null; installed_date: string | null; removed_date: string | null };

// Whether `profile` owns month `ym` for commission attribution — i.e. this is
// the ONE profile whose window contains the month. Window is install-inclusive
// through removal-inclusive; the only ambiguity is a same-calendar-month
// conversion (old profile removed in month M, new profile installed in month M,
// both matching M). There the OLD profile keeps M and the new profile yields
// its install month, so a month's commission never lands on two profiles.
// Applied identically on the tx path and the zero-tx fallback path.
export function ownsCommissionMonth(
  profile: WindowProfile,
  ym: string,
  siblings: WindowProfile[],
): boolean {
  const firstYM = profile.installed_date ? profile.installed_date.slice(0, 7) : '0000-00';
  const lastYM = profile.removed_date ? profile.removed_date.slice(0, 7) : '9999-12';
  if (ym < firstYM || ym > lastYM) return false;
  if (ym === firstYM) {
    const yieldedToSibling = siblings.some(
      (q) =>
        q.id !== profile.id &&
        q.atm_id === profile.atm_id &&
        !!q.removed_date &&
        q.removed_date.slice(0, 7) === ym,
    );
    if (yieldedToSibling) return false;
  }
  return true;
}

// Pure assembly of PnLInputs from raw rows. Separated from fetch so the same
// logic can run against injected fixtures (e.g. the headless harness, where
// anon RLS blocks reading atm_profiles / commission_details directly).
export function assemblePnLInputs(raw: {
  atmProfiles: PnLProfile[];
  allTransactions: PnLTransaction[];
  commissionDetails: Array<{ atm_id: string; commission_amount: number | null; month_year: string | null }>;
  feeOverrides: Array<{ atm_id: string; year_month: string; actual_fees: number | string }>;
  fromMonth: string;
  toMonth: string;
}): PnLInputs {
  const { atmProfiles, allTransactions, commissionDetails, feeOverrides, fromMonth, toMonth } = raw;
  const months = monthRange(fromMonth, toMonth);
  const [startYear, startMonthNum] = fromMonth.split('-').map(Number);
  const [endYear, endMonthNum] = toMonth.split('-').map(Number);
  const endDay = new Date(endYear, endMonthNum, 0).getDate();

  const reportStartDate = new Date(startYear, startMonthNum - 1, 1);
  const reportEndDate = new Date(endYear, endMonthNum - 1, endDay);
  const rangeStart = new Date(startYear, startMonthNum - 1, 1);
  const rangeEnd = new Date(endYear, endMonthNum, 0);

  const relevantProfiles = (profilesForWindow(atmProfiles, rangeStart, rangeEnd) as PnLProfile[]).filter(
    (p) => !!p.atm_id,
  );
  const txsByProfileId = groupTxsByProfile(allTransactions, relevantProfiles) as Map<string, PnLTransaction[]>;

  const commissionDetailsByATM = new Map<string, CommissionDetail[]>();
  commissionDetails.forEach((d) => {
    if (!d.month_year) return;
    const arr = commissionDetailsByATM.get(d.atm_id) || [];
    arr.push({ month_ym: d.month_year.slice(0, 7), amount: d.commission_amount || 0 });
    commissionDetailsByATM.set(d.atm_id, arr);
  });

  const overrideMap = new Map<string, number>();
  feeOverrides.forEach((o) => overrideMap.set(`${o.atm_id}:${o.year_month}`, Number(o.actual_fees)));

  let maxTxYM: string | null = null;
  for (const tx of allTransactions) {
    if (!tx.date) continue;
    const ym = String(tx.date).slice(0, 7);
    if (maxTxYM === null || ym > maxTxYM) maxTxYM = ym;
  }

  return {
    relevantProfiles,
    txsByProfileId,
    commissionDetailsByATM,
    overrideMap,
    months,
    reportStartDate,
    reportEndDate,
    maxTxYM,
  };
}

// Batched transaction fetch over the range (anon-readable table).
export async function fetchTransactionsInRange(fromMonth: string, toMonth: string): Promise<PnLTransaction[]> {
  const [endYear, endMonthNum] = toMonth.split('-').map(Number);
  const endDay = new Date(endYear, endMonthNum, 0).getDate();
  const startDate = `${fromMonth}-01`;
  const endDate = `${toMonth}-${String(endDay).padStart(2, '0')}T23:59:59`;

  let all: PnLTransaction[] = [];
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .gte('date', startDate)
    .lte('date', endDate);
  const batchSize = 1000;
  const batches = Math.ceil((count || 0) / batchSize);
  for (let i = 0; i < batches; i++) {
    const from = i * batchSize;
    const { data, error } = await supabase
      .from('transactions')
      .select('id, atm_id, atm_name, sale, fee, bitstop_fee, platform, date')
      .gte('date', startDate)
      .lte('date', endDate)
      .range(from, from + batchSize - 1);
    if (error) throw error;
    if (data) all = all.concat(data as PnLTransaction[]);
  }
  return all;
}

// Fetch the shared snapshot. Mirrors ATMProfitLoss.tsx's queries exactly.
export async function fetchPnLInputs(fromMonth: string, toMonth: string): Promise<PnLInputs> {
  const months = monthRange(fromMonth, toMonth);

  const { data: atmProfiles, error: atmError } = await supabase
    .from('atm_profiles')
    .select(
      'id, atm_id, location_name, state, platform, monthly_rent, cash_management_rps, cash_management_rep, sales_rep_id, installed_date, removed_date, active',
    );
  if (atmError) throw atmError;

  const allTransactions = await fetchTransactionsInRange(fromMonth, toMonth);

  const { data: commissionRaw, error: commError } = await supabase
    .from('commission_details')
    .select('atm_id, commission_amount, commissions!inner(month_year)')
    .in('commissions.month_year', months.map((ym) => `${ym}-01`));
  if (commError) console.error('P&L: error fetching commissions:', commError);
  const commissionDetails = (commissionRaw || []).map((d: any) => {
    const c = d.commissions;
    const my = Array.isArray(c) ? c[0]?.month_year : c?.month_year;
    return { atm_id: d.atm_id, commission_amount: d.commission_amount, month_year: my ?? null };
  });

  const { data: feeOverrides, error: overrideError } = await supabase
    .from('bitstop_fee_overrides')
    .select('atm_id, year_month, actual_fees')
    .in('year_month', months);
  if (overrideError) console.error('P&L: error fetching fee overrides:', overrideError);

  return assemblePnLInputs({
    atmProfiles: (atmProfiles || []) as PnLProfile[],
    allTransactions,
    commissionDetails,
    feeOverrides: (feeOverrides || []) as any[],
    fromMonth,
    toMonth,
  });
}

// PURE per-(profile, month) computation. No I/O. This is the reconciliation
// target: sum a profile's cells over the range == the existing report's row.
export function computeMonthlyPnLFromInputs(
  inputs: PnLInputs,
  opts: { platform: Platform },
): MonthlyPnLResult {
  const {
    relevantProfiles,
    txsByProfileId,
    commissionDetailsByATM,
    overrideMap,
    months,
    reportStartDate,
    reportEndDate,
    maxTxYM,
  } = inputs;
  const platform = opts.platform;

  const cells: MonthlyPnLCell[] = [];
  const machineMeta: Record<string, { atm_name: string; state: string }> = {};

  for (const profile of relevantProfiles) {
    const atmId = profile.atm_id as string;
    const atmTx = txsByProfileId.get(profile.id) || [];
    const totalExpenseMonths = calculateExpenseMonths(profile, reportStartDate, reportEndDate);

    // Skip: no expense months AND no txs (ATMProfitLoss line 277).
    if (totalExpenseMonths === 0 && atmTx.length === 0) continue;

    const monthlyRent = profile.monthly_rent || 0;
    const monthlyRps = profile.cash_management_rps || 0;
    const monthlyRep = profile.cash_management_rep || 0;
    const atmComm = commissionDetailsByATM.get(atmId) || [];
    const atmName = profile.location_name || atmId;

    if (atmTx.length === 0) {
      // Zero-tx fallback (line 291). Skip when all rates are zero (line 292).
      if (monthlyRent === 0 && monthlyRps === 0 && monthlyRep === 0) continue;
      const plat = (profile.platform || '').toLowerCase() || 'denet';
      if (platform !== 'both' && plat !== platform) continue;
      machineMeta[atmId] = { atm_name: atmName, state: profile.state || '' };

      for (const ym of months) {
        const flag = monthExpenseFlag(profile, ym);
        const rent = monthlyRent * flag;
        const mgmt_rps = monthlyRps * flag;
        const mgmt_rep = monthlyRep * flag;
        // Window-owned commission (one profile per month) — same rule as tx path.
        const commissions = ownsCommissionMonth(profile, ym, relevantProfiles)
          ? atmComm.filter((d) => d.month_ym === ym).reduce((s, d) => s + d.amount, 0)
          : 0;
        if (rent === 0 && mgmt_rps === 0 && mgmt_rep === 0 && commissions === 0) continue;
        const net_profit = -rent - mgmt_rps - mgmt_rep - commissions;
        cells.push({
          atm_id: atmId,
          profile_id: profile.id,
          atm_name: atmName,
          platform: plat,
          month: ym,
          total_sales: 0,
          total_fees: 0,
          bitstop_fees: 0,
          rent,
          mgmt_rps,
          mgmt_rep,
          commissions,
          net_profit,
          has_override: false,
        });
      }
      continue;
    }

    // Tx path (line 324).
    const plat = (profile.platform || '').toLowerCase();
    if (platform !== 'both' && plat !== platform) continue;
    machineMeta[atmId] = { atm_name: atmName, state: profile.state || '' };

    const firstYM = profile.installed_date ? profile.installed_date.slice(0, 7) : '0000-00';
    const lastYM = profile.removed_date ? profile.removed_date.slice(0, 7) : '9999-12';

    const salesByM = new Map<string, number>();
    const rawFeeByM = new Map<string, number>();
    const bfeeByM = new Map<string, number>();
    for (const tx of atmTx) {
      const ym = String(tx.date).slice(0, 7);
      salesByM.set(ym, (salesByM.get(ym) || 0) + (tx.sale || 0));
      rawFeeByM.set(ym, (rawFeeByM.get(ym) || 0) + (tx.fee || 0));
      bfeeByM.set(ym, (bfeeByM.get(ym) || 0) + (tx.bitstop_fee || 0));
    }

    for (const ym of months) {
      const total_sales = salesByM.get(ym) || 0;
      const rawFee = rawFeeByM.get(ym) || 0;
      const bitstop_fees = bfeeByM.get(ym) || 0;

      // Bitstop override REPLACES the month's fee (line 357-390). In-window only.
      let total_fees = rawFee;
      let has_override = false;
      if (plat === 'bitstop' && ym >= firstYM && ym <= lastYM) {
        const key = `${atmId}:${ym}`;
        if (overrideMap.has(key)) {
          total_fees = overrideMap.get(key)!;
          has_override = true;
        }
      }

      const flag = monthExpenseFlag(profile, ym);
      const rent = monthlyRent * flag;
      const mgmt_rps = monthlyRps * flag;
      const mgmt_rep = monthlyRep * flag;
      // Window-owned commission — exactly one profile owns each month.
      const commissions = ownsCommissionMonth(profile, ym, relevantProfiles)
        ? atmComm.filter((d) => d.month_ym === ym).reduce((s, d) => s + d.amount, 0)
        : 0;

      if (
        total_sales === 0 &&
        total_fees === 0 &&
        bitstop_fees === 0 &&
        rent === 0 &&
        mgmt_rps === 0 &&
        mgmt_rep === 0 &&
        commissions === 0
      ) {
        continue;
      }

      const net_profit = total_fees - bitstop_fees - rent - mgmt_rps - mgmt_rep - commissions;
      cells.push({
        atm_id: atmId,
        profile_id: profile.id,
        atm_name: atmName,
        platform: plat,
        month: ym,
        total_sales,
        total_fees,
        bitstop_fees,
        rent,
        mgmt_rps,
        mgmt_rep,
        commissions,
        net_profit,
        has_override,
      });
    }
  }

  // Rollups.
  const byMonthTotals: Record<string, PnLLineItems> = {};
  for (const ym of months) byMonthTotals[ym] = emptyLineItems();
  const byMachineMonthNet: Record<string, Record<string, number>> = {};

  for (const c of cells) {
    const t = byMonthTotals[c.month] || (byMonthTotals[c.month] = emptyLineItems());
    t.total_sales += c.total_sales;
    t.total_fees += c.total_fees;
    t.bitstop_fees += c.bitstop_fees;
    t.rent += c.rent;
    t.mgmt_rps += c.mgmt_rps;
    t.mgmt_rep += c.mgmt_rep;
    t.commissions += c.commissions;
    t.net_profit += c.net_profit;
    t.has_override = t.has_override || c.has_override;

    (byMachineMonthNet[c.atm_id] ||= {});
    byMachineMonthNet[c.atm_id][c.month] = (byMachineMonthNet[c.atm_id][c.month] || 0) + c.net_profit;
  }

  return {
    months,
    cells,
    partialMonth: maxTxYM,
    byMonthTotals,
    byMachineMonthNet,
    machineMeta,
  };
}

// Production entry point: fetch + compute.
export async function computeMonthlyPnL(opts: {
  fromMonth: string;
  toMonth: string;
  platform: Platform;
}): Promise<MonthlyPnLResult> {
  const inputs = await fetchPnLInputs(opts.fromMonth, opts.toMonth);
  return computeMonthlyPnLFromInputs(inputs, { platform: opts.platform });
}
