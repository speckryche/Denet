// Coinbase journal entry — crypto purchased on Coinbase Prime in one month.
//
// Pure: no I/O. The caller supplies parsed statement rows, the saved per-buy
// treatment overrides, the asset table and the account map.
//
// A trade appears in the statement as two rows sharing one "ID": a USD-side row
// (Amount = USD spent, Fee = USD fee, Asset = USD) and a coin-side row (Amount =
// coin received). Every JE amount comes from the USD side; the coin is read from
// the Activity Description ("BUY BTC/USD - LIMIT" -> BTC).
//
// Lines:
//   CR  Exchange Account - Coinbase        total of the debits below
//   DR  Inventory - {coin}                 Σ Amount, inventory-treated, per coin
//   DR  Long-term Investments:{coin}       Σ Amount, investment-treated, per coin
//   DR  Exchange Fees                      Σ Fee, all buys
//
// Zero-amount lines are omitted.

import { round2 } from './money';
import { monthEndDate, monthOfUtcIso, monthText } from './period';
import type {
  AccountMap,
  BuyTreatmentOverride,
  CoinbaseBalanceRow,
  CoinbaseBuy,
  CoinbaseDetailRow,
  CryptoAsset,
  Je,
  JeLine,
  Treatment,
} from './types';

const isOrder = (r: CoinbaseDetailRow) => r.activityType.toLowerCase() === 'order';
const isUsdSide = (r: CoinbaseDetailRow) => r.asset.toUpperCase() === 'USD';

export const isBuyRow = (r: CoinbaseDetailRow): boolean =>
  isOrder(r) && /^buy\b/i.test(r.activityDescription.trim());

export const isSellRow = (r: CoinbaseDetailRow): boolean =>
  isOrder(r) && /^sell\b/i.test(r.activityDescription.trim());

// "BUY BTC/USD - LIMIT" -> "BTC"
export const coinFromDescription = (description: string): string | null => {
  const m = description.trim().match(/^(?:BUY|SELL)\s+([A-Z0-9]+)\s*\/\s*([A-Z0-9]+)/i);
  return m ? m[1].toUpperCase() : null;
};

// USD-side buy rows, each resolved to a coin and a treatment.
export function extractBuys(
  rows: CoinbaseDetailRow[],
  overrides: BuyTreatmentOverride[],
  assets: CryptoAsset[],
): { buys: CoinbaseBuy[]; undescribed: CoinbaseDetailRow[] } {
  const defaultBySymbol = new Map(
    assets.map((a) => [a.symbol.toUpperCase(), a.default_treatment]),
  );
  const overrideByKey = new Map(
    overrides.map((o) => [`${o.activity_id}|${o.asset_symbol.toUpperCase()}`, o.treatment]),
  );

  const buys: CoinbaseBuy[] = [];
  const undescribed: CoinbaseDetailRow[] = [];

  for (const r of rows) {
    if (!isBuyRow(r) || !isUsdSide(r)) continue;
    const coin = coinFromDescription(r.activityDescription);
    if (!coin) {
      undescribed.push(r);
      continue;
    }
    const override = overrideByKey.get(`${r.activityId}|${coin}`);
    const fallback: Treatment = defaultBySymbol.get(coin) ?? 'inventory';
    buys.push({
      activityId: r.activityId,
      coin,
      dateCompleted: r.dateCompleted,
      amount: r.amount,
      fee: r.fee,
      totalBalanceImpact: r.totalBalanceImpact,
      status: r.status,
      treatment: override ?? fallback,
      treatmentIsOverride: override != null,
    });
  }

  buys.sort((a, b) => a.dateCompleted.localeCompare(b.dateCompleted));
  return { buys, undescribed };
}

export interface CoinbaseJeResult {
  je: Je;
  buys: CoinbaseBuy[];
  // Buys of a coin with no active crypto_assets row — each blocks the entry.
  unknownSymbols: string[];
  sellRows: CoinbaseDetailRow[];
  nonFilledBuys: CoinbaseBuy[];
  outOfMonthRows: CoinbaseDetailRow[];
  undescribedBuyRows: CoinbaseDetailRow[];
  totals: { debits: number; credits: number; fees: number };
  // JE credit vs −Σ Total Balance Impact of the buy rows.
  impactTieOut: { jeCredit: number; negatedImpact: number; difference: number };
  // starting USD + Σ impact of every USD row vs ending USD (asset_balances).
  usdTieOut: {
    available: boolean;
    startingBalance: number;
    impactSum: number;
    expectedEnding: number;
    actualEnding: number;
    difference: number;
  };
}

export function computeCoinbaseJe(input: {
  month: string;
  rows: CoinbaseDetailRow[];
  balances: CoinbaseBalanceRow[];
  overrides: BuyTreatmentOverride[];
  assets: CryptoAsset[];
  accounts: AccountMap;
}): CoinbaseJeResult {
  const { month, rows, balances, overrides, assets, accounts } = input;

  const assetBySymbol = new Map(
    assets.filter((a) => a.active).map((a) => [a.symbol.toUpperCase(), a]),
  );

  // Scope to THIS month's statement before anything else.
  //
  // `rows` is every Coinbase row loaded for the whole backlog, not one upload:
  // fetchCoinbaseRowsForMonths pulls a date range spanning every month in view.
  // Each detail row carries the period_start/period_end of the statement it was
  // imported from, and that is the only thing that distinguishes one upload
  // from another.
  //
  // Without this filter `outOfMonthRows` below took every row in the range that
  // was not in the selected month — i.e. the entire contents of every OTHER
  // statement — and blocked the entry with them. With Feb and Aug both
  // uploaded, February reported August's 11 rows as "dated outside the selected
  // month" and August reported February's 9, even though each statement was
  // internally clean. The two blocked each other purely by coexisting.
  //
  // period_start/period_end are NOT NULL (migration 20260921200107), so every
  // row is attributable to exactly one statement.
  const statementRows = rows.filter((r) => r.periodStart.slice(0, 7) === month);

  const inMonth = statementRows.filter((r) => monthOfUtcIso(r.dateCompleted) === month);
  // A genuine out-of-month row: inside this month's own statement, but with a
  // UTC completion date outside the month. That is the real "the upload covers
  // a different period than the month selected" signal.
  const outOfMonthRows = statementRows.filter((r) => monthOfUtcIso(r.dateCompleted) !== month);

  const { buys, undescribed } = extractBuys(inMonth, overrides, assets);
  const sellRows = inMonth.filter(isSellRow);
  const nonFilledBuys = buys.filter((b) => b.status.toUpperCase() !== 'FILLED');

  // Per coin and treatment.
  const byCoin = new Map<string, { inventory: number; investment: number }>();
  let feeTotal = 0;
  const unknownSymbols = new Set<string>();

  for (const b of buys) {
    if (!assetBySymbol.has(b.coin)) unknownSymbols.add(b.coin);
    let entry = byCoin.get(b.coin);
    if (!entry) {
      entry = { inventory: 0, investment: 0 };
      byCoin.set(b.coin, entry);
    }
    entry[b.treatment] += b.amount;
    feeTotal += b.fee;
  }

  const coins = [...byCoin.keys()].sort();
  const text = monthText(month);
  const debitLines: JeLine[] = [];

  const accountFor = (coin: string, treatment: Treatment): string => {
    const asset = assetBySymbol.get(coin);
    if (asset) {
      return treatment === 'inventory' ? asset.inventory_account_name : asset.investment_account_name;
    }
    // Unknown coin — a BLOCK check fires; this label only keeps the preview readable.
    return treatment === 'inventory'
      ? `Inventory - ${coin}`
      : `Long-term Investments:${coin}`;
  };

  for (const coin of coins) {
    const { inventory } = byCoin.get(coin)!;
    const amount = round2(inventory);
    if (amount !== 0) {
      debitLines.push({
        account: accountFor(coin, 'inventory'),
        debit: amount,
        credit: 0,
        description: `${coin} purchased for inventory — ${text}`,
      });
    }
  }

  for (const coin of coins) {
    const { investment } = byCoin.get(coin)!;
    const amount = round2(investment);
    if (amount !== 0) {
      debitLines.push({
        account: accountFor(coin, 'investment'),
        debit: amount,
        credit: 0,
        description: `${coin} purchased as long-term investment — ${text}`,
      });
    }
  }

  const feeAmount = round2(feeTotal);
  if (feeAmount !== 0) {
    debitLines.push({
      account: accounts.exchange_fees,
      debit: feeAmount,
      credit: 0,
      description: `Coinbase trading fees — ${text}`,
    });
  }

  const debitTotal = round2(debitLines.reduce((s, l) => s + l.debit, 0));
  const lines: JeLine[] = [];
  if (debitTotal !== 0) {
    lines.push({
      account: accounts.exchange_account,
      debit: 0,
      credit: debitTotal,
      description: `Coinbase Prime purchases — ${text}`,
    });
  }
  lines.push(...debitLines);

  const je: Je = {
    type: 'coinbase',
    month,
    date: monthEndDate(month),
    monthText: text,
    lines,
    totalDebits: round2(lines.reduce((s, l) => s + l.debit, 0)),
    totalCredits: round2(lines.reduce((s, l) => s + l.credit, 0)),
  };

  // Tie-out 1: the credit must equal the cash actually leaving the USD balance.
  const negatedImpact = round2(-buys.reduce((s, b) => s + b.totalBalanceImpact, 0));
  const impactTieOut = {
    jeCredit: debitTotal,
    negatedImpact,
    difference: round2(debitTotal - negatedImpact),
  };

  // Tie-out 2: every USD movement in the statement, against the reported
  // starting/ending USD balance. Uses in-month rows so it matches the window.
  const usdBalance = balances.find((b) => b.asset.toUpperCase() === 'USD');
  const usdImpactSum = inMonth
    .filter((r) => r.asset.toUpperCase() === 'USD')
    .reduce((s, r) => s + r.totalBalanceImpact, 0);
  const usdTieOut = usdBalance
    ? {
        available: true,
        startingBalance: usdBalance.startingBalance,
        impactSum: usdImpactSum,
        expectedEnding: usdBalance.startingBalance + usdImpactSum,
        actualEnding: usdBalance.endingBalance,
        difference: usdBalance.startingBalance + usdImpactSum - usdBalance.endingBalance,
      }
    : {
        available: false,
        startingBalance: 0,
        impactSum: usdImpactSum,
        expectedEnding: 0,
        actualEnding: 0,
        difference: 0,
      };

  return {
    je,
    buys,
    unknownSymbols: [...unknownSymbols],
    sellRows,
    nonFilledBuys,
    outOfMonthRows,
    undescribedBuyRows: undescribed,
    totals: { debits: je.totalDebits, credits: je.totalCredits, fees: feeAmount },
    impactTieOut,
    usdTieOut,
  };
}
