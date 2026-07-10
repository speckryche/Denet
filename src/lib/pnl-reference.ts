// PARITY PORT — reconciliation only, delete with the harness.
//
// A verbatim transcription of ATMProfitLoss.tsx's per-profile P&L math
// (fetchATMProfitLoss, lines ~268-433), refactored to consume the shared
// PnLInputs snapshot and RETURN rows instead of setting React state. It exists
// solely so the reconciliation harness can compare the monthly engine against
// the existing report's exact logic on an identical data snapshot. The real
// ATMProfitLoss.tsx component is left untouched as the reference.

import { calculateExpenseMonths } from './atm-profile';
import { ownsCommissionMonth } from './pnl';
import type { PnLInputs, PnLProfile } from './pnl';

export interface ReferenceRow {
  profile_id: string;
  atm_id: string;
  platform: string;
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

export function computeReferenceRows(
  inputs: PnLInputs,
  opts: { platform: 'both' | 'denet' | 'bitstop' },
): ReferenceRow[] {
  const {
    relevantProfiles,
    txsByProfileId,
    commissionDetailsByATM,
    overrideMap,
    months,
    reportStartDate,
    reportEndDate,
  } = inputs;
  const selectedPlatform = opts.platform;

  const [startYear, startMonthNum] = months[0].split('-').map(Number);
  const [endYear, endMonthNum] = months[months.length - 1].split('-').map(Number);

  const rows: ReferenceRow[] = [];

  relevantProfiles.forEach((profile: PnLProfile) => {
    const atmTransactions = txsByProfileId.get(profile.id) || [];
    const totalExpenseMonths = calculateExpenseMonths(profile, reportStartDate, reportEndDate);

    if (totalExpenseMonths === 0 && atmTransactions.length === 0) return;

    const monthlyRent = profile.monthly_rent || 0;
    const monthlyMgmtRps = profile.cash_management_rps || 0;
    const monthlyMgmtRep = profile.cash_management_rep || 0;
    const atmCommDetails = commissionDetailsByATM.get(profile.atm_id as string) || [];
    // Window-owned commission: exactly one profile owns each month (fixes the
    // fallback-unfiltered and same-month-conversion double-counts). Same rule on
    // both paths now.
    const ownedCommissions = atmCommDetails
      .filter((d) => ownsCommissionMonth(profile, d.month_ym, relevantProfiles))
      .reduce((s, d) => s + d.amount, 0);

    if (atmTransactions.length === 0) {
      if (monthlyRent === 0 && monthlyMgmtRps === 0 && monthlyMgmtRep === 0) return;

      const fallbackPlatform = (profile.platform || '').toLowerCase() || 'denet';
      if (selectedPlatform !== 'both' && fallbackPlatform !== selectedPlatform) return;

      const rent = monthlyRent * totalExpenseMonths;
      const mgmt_rps = monthlyMgmtRps * totalExpenseMonths;
      const mgmt_rep = monthlyMgmtRep * totalExpenseMonths;
      const net_profit = -rent - mgmt_rps - mgmt_rep - ownedCommissions;

      rows.push({
        profile_id: profile.id,
        atm_id: profile.atm_id as string,
        platform: fallbackPlatform,
        total_sales: 0,
        total_fees: 0,
        bitstop_fees: 0,
        rent,
        mgmt_rps,
        mgmt_rep,
        commissions: ownedCommissions,
        net_profit,
        has_override: false,
      });
      return;
    }

    const profilePlatform = (profile.platform || '').toLowerCase();
    if (selectedPlatform !== 'both' && profilePlatform !== selectedPlatform) {
      return;
    }

    let total_sales = 0;
    let total_fees = 0;
    let bitstop_fees = 0;
    atmTransactions.forEach((tx) => {
      total_sales += tx.sale || 0;
      total_fees += tx.fee || 0;
      bitstop_fees += tx.bitstop_fee || 0;
    });

    const profileFirstYM = profile.installed_date ? profile.installed_date.slice(0, 7) : '0000-00';
    const profileLastYM = profile.removed_date ? profile.removed_date.slice(0, 7) : '9999-12';
    // Same window-ownership rule as the fallback path (ownedCommissions above).

    let has_override = false;
    if (profilePlatform === 'bitstop') {
      const feesByMonth = new Map<string, number>();
      atmTransactions.forEach((tx) => {
        if (tx.date) {
          const ym = String(tx.date).slice(0, 7);
          feesByMonth.set(ym, (feesByMonth.get(ym) || 0) + (tx.fee || 0));
        }
      });

      let overriddenTotal = 0;
      for (let y = startYear; y <= endYear; y++) {
        const mStart = y === startYear ? startMonthNum : 1;
        const mEnd = y === endYear ? endMonthNum : 12;
        for (let m = mStart; m <= mEnd; m++) {
          const ym = `${y}-${String(m).padStart(2, '0')}`;
          if (ym < profileFirstYM || ym > profileLastYM) continue;
          const key = `${profile.atm_id}:${ym}`;
          if (overrideMap.has(key)) {
            overriddenTotal += overrideMap.get(key)!;
            has_override = true;
          } else {
            overriddenTotal += feesByMonth.get(ym) || 0;
          }
        }
      }
      if (has_override) {
        total_fees = overriddenTotal;
      }
    }

    const rent = monthlyRent * totalExpenseMonths;
    const mgmt_rps = monthlyMgmtRps * totalExpenseMonths;
    const mgmt_rep = monthlyMgmtRep * totalExpenseMonths;
    const net_profit = total_fees - bitstop_fees - rent - mgmt_rps - mgmt_rep - ownedCommissions;

    rows.push({
      profile_id: profile.id,
      atm_id: profile.atm_id as string,
      platform: profilePlatform,
      total_sales,
      total_fees,
      bitstop_fees,
      rent,
      mgmt_rps,
      mgmt_rep,
      commissions: ownedCommissions,
      net_profit,
      has_override,
    });
  });

  return rows;
}
