// Validation checks for one month's entries.
//
// Any BLOCK disables "Mark as entered in QBO". WARN and INFO are advisory and
// never gate the button. Pure: the caller supplies both computed JEs plus the
// freshness facts.

import { fmtAmount, nearlyEqual, TOL } from './money';
import type { Check } from './types';
import type { SalesJeResult } from './sales-je';
import type { CoinbaseJeResult } from './coinbase-je';
import { monthEndDate } from './period';

export interface FreshnessInput {
  // created_at of the most recent Denet upload, ISO, or null when none exists.
  latestDenetUploadAt: string | null;
}

// The sales data is re-uploaded as a year-to-date CSV; a status that changed
// after the last upload would silently understate the month. So the newest
// Denet upload must be at least as recent as the month's end date.
export function checkSalesFreshness(month: string, input: FreshnessInput): Check | null {
  const end = monthEndDate(month);
  if (!input.latestDenetUploadAt) {
    return {
      id: 'sales_freshness',
      severity: 'BLOCK',
      message: 'Upload a fresh YTD Denet CSV first.',
      detail: 'No Denet upload has been recorded yet.',
    };
  }
  const uploadedDate = input.latestDenetUploadAt.slice(0, 10);
  if (uploadedDate < end) {
    return {
      id: 'sales_freshness',
      severity: 'BLOCK',
      message: 'Upload a fresh YTD Denet CSV first.',
      detail: `Latest Denet upload is ${uploadedDate}, which is before the month end ${end}. Status changes after that date would be missing.`,
    };
  }
  return null;
}

export function salesChecks(result: SalesJeResult): Check[] {
  const checks: Check[] = [];
  const { je, totals, excludedNonCompletedCount, unknownSymbols, unattributedTxCount } = result;

  if (!nearlyEqual(je.totalDebits, je.totalCredits)) {
    checks.push({
      id: 'sales_balanced',
      severity: 'BLOCK',
      message: 'Sales JE does not balance.',
      detail: `Debits ${fmtAmount(je.totalDebits)} vs credits ${fmtAmount(je.totalCredits)} (difference ${fmtAmount(je.totalDebits - je.totalCredits)}).`,
    });
  }

  const feePlusSent = totals.fee + totals.sent;
  if (!nearlyEqual(totals.sale, feePlusSent)) {
    checks.push({
      id: 'sales_fiat_identity',
      severity: 'BLOCK',
      message: 'Sales do not reconcile: fiat ≠ fee + enviando.',
      detail: `Fiat ${fmtAmount(totals.sale)} vs fee ${fmtAmount(totals.fee)} + enviando ${fmtAmount(totals.sent)} = ${fmtAmount(feePlusSent)} (difference ${fmtAmount(totals.sale - feePlusSent)}).`,
    });
  }

  for (const symbol of unknownSymbols) {
    checks.push({
      id: `sales_unknown_asset_${symbol}`,
      severity: 'BLOCK',
      message: `Add ${symbol} in Settings.`,
      detail: `Machine sales in this month are recorded against ${symbol}, which has no active crypto_assets row, so no inventory account can be named.`,
    });
  }

  if (unattributedTxCount > 0) {
    checks.push({
      id: 'sales_unattributed',
      severity: 'BLOCK',
      message: `${unattributedTxCount} completed transaction${unattributedTxCount === 1 ? '' : 's'} matched no ATM profile window.`,
      detail: 'These rows cannot be attributed to a platform, so they are excluded from the entry. Fix the install/removal dates in BTM Details.',
    });
  }

  if (excludedNonCompletedCount > 0) {
    checks.push({
      id: 'sales_excluded_non_completed',
      severity: 'INFO',
      message: `${excludedNonCompletedCount} non-completed sales row${excludedNonCompletedCount === 1 ? '' : 's'} excluded.`,
      detail: 'Only completed transactions are included, matching every financial report in the app.',
    });
  }

  return checks;
}

export function coinbaseChecks(result: CoinbaseJeResult): Check[] {
  const checks: Check[] = [];
  const { je, sellRows, unknownSymbols, nonFilledBuys, outOfMonthRows, impactTieOut, usdTieOut, undescribedBuyRows } = result;

  if (!nearlyEqual(je.totalDebits, je.totalCredits)) {
    checks.push({
      id: 'coinbase_balanced',
      severity: 'BLOCK',
      message: 'Coinbase JE does not balance.',
      detail: `Debits ${fmtAmount(je.totalDebits)} vs credits ${fmtAmount(je.totalCredits)} (difference ${fmtAmount(je.totalDebits - je.totalCredits)}).`,
    });
  }

  if (sellRows.length > 0) {
    checks.push({
      id: 'coinbase_sells_present',
      severity: 'BLOCK',
      message: `${sellRows.length} Coinbase SELL row${sellRows.length === 1 ? '' : 's'} in this statement — not supported yet.`,
      detail: 'Only buys are handled in Stage 1. Record the sale manually and re-check.',
    });
  }

  for (const symbol of unknownSymbols) {
    checks.push({
      id: `coinbase_unknown_asset_${symbol}`,
      severity: 'BLOCK',
      message: `Add ${symbol} in Settings.`,
      detail: `A buy of ${symbol} is in this statement, but ${symbol} has no active crypto_assets row, so no account can be named.`,
    });
  }

  if (undescribedBuyRows.length > 0) {
    checks.push({
      id: 'coinbase_undescribed_buys',
      severity: 'BLOCK',
      message: `${undescribedBuyRows.length} buy row${undescribedBuyRows.length === 1 ? '' : 's'} with an unreadable coin.`,
      detail: `Could not read the coin from the Activity Description (e.g. "${undescribedBuyRows[0].activityDescription}").`,
    });
  }

  if (outOfMonthRows.length > 0) {
    checks.push({
      id: 'coinbase_out_of_month',
      severity: 'BLOCK',
      message: `${outOfMonthRows.length} Coinbase row${outOfMonthRows.length === 1 ? '' : 's'} dated outside the selected month.`,
      detail: 'The uploaded statement covers a different period than the month selected here.',
    });
  }

  if (!nearlyEqual(impactTieOut.difference, 0)) {
    checks.push({
      id: 'coinbase_impact_tie_out',
      severity: 'BLOCK',
      message: 'JE credit does not match the cash that left the USD balance.',
      detail: `Credit ${fmtAmount(impactTieOut.jeCredit)} vs −Σ Total Balance Impact ${fmtAmount(impactTieOut.negatedImpact)} (difference ${fmtAmount(impactTieOut.difference)}).`,
    });
  }

  if (!usdTieOut.available) {
    checks.push({
      id: 'coinbase_usd_tie_out',
      severity: 'BLOCK',
      message: 'No USD row in asset_balances — the USD tie-out cannot be checked.',
    });
  } else if (Math.abs(usdTieOut.difference) > TOL) {
    checks.push({
      id: 'coinbase_usd_tie_out',
      severity: 'BLOCK',
      message: 'USD balance does not tie out.',
      detail: `Starting ${fmtAmount(usdTieOut.startingBalance)} + movements ${fmtAmount(usdTieOut.impactSum)} = ${fmtAmount(usdTieOut.expectedEnding)}, but the statement's ending balance is ${fmtAmount(usdTieOut.actualEnding)} (difference ${fmtAmount(usdTieOut.difference)}).`,
    });
  }

  if (nonFilledBuys.length > 0) {
    const statuses = [...new Set(nonFilledBuys.map((b) => b.status))].join(', ');
    checks.push({
      id: 'coinbase_non_filled',
      severity: 'WARN',
      message: `${nonFilledBuys.length} buy row${nonFilledBuys.length === 1 ? '' : 's'} with a status other than FILLED (${statuses}).`,
      detail: 'They are included in the entry. Confirm they really settled.',
    });
  }

  return checks;
}

export const hasBlocker = (checks: Check[]): boolean =>
  checks.some((c) => c.severity === 'BLOCK');
