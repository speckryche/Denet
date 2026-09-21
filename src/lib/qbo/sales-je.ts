// Sales journal entry — Denet-platform machine sales for one month.
//
// Pure: no I/O, no Supabase, no React. The caller fetches transactions and
// atm_profiles and passes them in.
//
// Scope rules (all reuse existing app logic, none reinvented here):
//   - Completed only        — countsFinancial() from src/lib/transaction-status.ts
//   - Denet machines only   — the platform of the atm_profiles row whose date
//                             window contains the tx (findProfileForTx), NOT the
//                             `transactions.platform` column stamped at import.
//   - Month                 — the transaction's own recorded (local) date.
//
// Lines (sale = fee + sent is an identity in the source data, which is what
// makes the entry balance):
//   DR  BTC Machine Cash      Σ sale
//   CR  Transaction Fees      Σ fee
//   CR  Inventory - {coin}    Σ sent          per coin
//   DR  Bitstop Fees          Σ bitstop_fee
//   CR  Inventory - {coin}    Σ bitstop_fee   per coin
//
// The two inventory credits stay separate per coin (machine sales vs operator
// fee) to match the existing QBO template and keep the operator-fee portion
// visible.

import { findProfileForTx } from '@/lib/atm-profile';
import { countsFinancial } from '@/lib/transaction-status';
import { round2 } from './money';
import { monthEndDate, monthOfTxDate, monthText } from './period';
import type {
  AccountMap,
  CryptoAsset,
  Je,
  JeLine,
  SalesProfileLike,
  SalesTxLike,
} from './types';

export interface SalesCoinGroup {
  coin: string;
  inventoryAccount: string | null; // null when the coin has no crypto_assets row
  sale: number;
  fee: number;
  sent: number;
  operatorFee: number;
  txCount: number;
}

export interface SalesJeResult {
  je: Je;
  groups: SalesCoinGroup[];
  includedTxCount: number;
  // Non-completed rows in the month (any platform attribution) — the INFO check.
  excludedNonCompletedCount: number;
  // Completed Denet rows whose coin has no active crypto_assets row.
  unknownSymbols: string[];
  // Completed rows that matched no atm_profiles window, so they could not be
  // attributed to a platform at all. These are excluded from the JE.
  unattributedTxCount: number;
  totals: { sale: number; fee: number; sent: number; operatorFee: number };
}

const parseLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};

const num = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// Coin symbol for a transaction. `transactions.ticker` is the only per-tx asset
// field; it is uppercased here because the column has no CHECK constraint and
// is rewritten by the ticker-mapping settings screen.
const coinOf = (tx: SalesTxLike): string => (tx.ticker || '').trim().toUpperCase();

export function computeSalesJe(input: {
  month: string;
  transactions: SalesTxLike[];
  profiles: SalesProfileLike[];
  assets: CryptoAsset[];
  accounts: AccountMap;
}): SalesJeResult {
  const { month, transactions, profiles, assets, accounts } = input;

  const assetBySymbol = new Map(
    assets.filter((a) => a.active).map((a) => [a.symbol.toUpperCase(), a]),
  );

  const inMonth = transactions.filter((tx) => monthOfTxDate(tx.date) === month);

  const groups = new Map<string, SalesCoinGroup>();
  let includedTxCount = 0;
  let excludedNonCompletedCount = 0;
  let unattributedTxCount = 0;
  const unknownSymbols = new Set<string>();

  for (const tx of inMonth) {
    if (!countsFinancial(tx.status)) {
      excludedNonCompletedCount += 1;
      continue;
    }
    if (!tx.atm_id || !tx.date) {
      unattributedTxCount += 1;
      continue;
    }

    const profile = findProfileForTx(profiles, tx.atm_id, parseLocalDate(tx.date));
    if (!profile) {
      unattributedTxCount += 1;
      continue;
    }
    if ((profile.platform || '').toLowerCase() !== 'denet') continue; // Bitstop machine

    const coin = coinOf(tx);
    const asset = assetBySymbol.get(coin);
    if (!asset) unknownSymbols.add(coin || '(blank)');

    let group = groups.get(coin);
    if (!group) {
      group = {
        coin,
        inventoryAccount: asset ? asset.inventory_account_name : null,
        sale: 0, fee: 0, sent: 0, operatorFee: 0, txCount: 0,
      };
      groups.set(coin, group);
    }

    group.sale += num(tx.sale);
    group.fee += num(tx.fee);
    group.sent += num(tx.sent);
    group.operatorFee += num(tx.bitstop_fee);
    group.txCount += 1;
    includedTxCount += 1;
  }

  const ordered = [...groups.values()].sort((a, b) => a.coin.localeCompare(b.coin));
  const totals = ordered.reduce(
    (acc, g) => ({
      sale: acc.sale + g.sale,
      fee: acc.fee + g.fee,
      sent: acc.sent + g.sent,
      operatorFee: acc.operatorFee + g.operatorFee,
    }),
    { sale: 0, fee: 0, sent: 0, operatorFee: 0 },
  );

  const text = monthText(month);
  const lines: JeLine[] = [];
  const push = (account: string, debit: number, credit: number, description: string) => {
    const d = round2(debit);
    const c = round2(credit);
    if (d === 0 && c === 0) return; // zero-value lines are omitted
    lines.push({ account, debit: d, credit: c, description });
  };

  push(accounts.machine_cash, totals.sale, 0, `Machine sales — ${text}`);
  push(accounts.transaction_fees, 0, totals.fee, `Transaction fees — ${text}`);

  for (const g of ordered) {
    push(
      g.inventoryAccount ?? `Inventory - ${g.coin || 'UNKNOWN'}`,
      0,
      g.sent,
      `Crypto dispensed to customers (${g.coin || 'unknown'}) — ${text}`,
    );
  }

  push(accounts.bitstop_fees, totals.operatorFee, 0, `Operator fees — ${text}`);

  for (const g of ordered) {
    push(
      g.inventoryAccount ?? `Inventory - ${g.coin || 'UNKNOWN'}`,
      0,
      g.operatorFee,
      `Crypto paid as operator fee (${g.coin || 'unknown'}) — ${text}`,
    );
  }

  const je: Je = {
    type: 'sales',
    month,
    date: monthEndDate(month),
    monthText: text,
    lines,
    totalDebits: round2(lines.reduce((s, l) => s + l.debit, 0)),
    totalCredits: round2(lines.reduce((s, l) => s + l.credit, 0)),
  };

  return {
    je,
    groups: ordered,
    includedTxCount,
    excludedNonCompletedCount,
    unknownSymbols: [...unknownSymbols],
    unattributedTxCount,
    totals,
  };
}
