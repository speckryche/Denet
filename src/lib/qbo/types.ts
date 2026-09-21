// Shared types for the QBO Entries module (Stage 1).
//
// Everything here is plain data: the compute modules (sales-je, coinbase-je,
// checks) are pure functions over these shapes so they can be exercised from a
// Node harness without a browser, a Supabase client, or React.

export type JeType = 'sales' | 'coinbase';

export type Treatment = 'inventory' | 'investment';

// One line of a QuickBooks journal entry. Exactly one of debit/credit is
// non-zero; both are rounded to 2 decimals before they reach this shape.
export interface JeLine {
  account: string;
  debit: number;
  credit: number;
  description: string;
}

export interface Je {
  type: JeType;
  month: string; // 'YYYY-MM'
  date: string; // 'YYYY-MM-DD', always the last day of the month
  monthText: string; // e.g. "August 2026" — the description month text
  lines: JeLine[];
  totalDebits: number;
  totalCredits: number;
}

// A BLOCK disables "Mark as entered in QBO". WARN and INFO are advisory.
export type CheckSeverity = 'BLOCK' | 'WARN' | 'INFO';

export interface Check {
  id: string;
  severity: CheckSeverity;
  message: string;
  // Populated for tie-out style checks so the UI can show the arithmetic.
  detail?: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

// The subset of `transactions` the sales JE needs. Field names are the DB
// column names: `sale` is the CSV's "fiat", `sent` is "enviando", and
// `bitstop_fee` is "operator_fee_usd" (renamed in migrations 5 and 6).
export interface SalesTxLike {
  id: string;
  atm_id: string | null;
  date: string | null;
  ticker: string | null;
  status: string | null;
  sale: number | null;
  fee: number | null;
  sent: number | null;
  bitstop_fee: number | null;
}

// atm_profiles row, as needed for date-window platform attribution.
export interface SalesProfileLike {
  id: string;
  atm_id: string | null;
  platform: string | null;
  installed_date: string | null;
  removed_date: string | null;
}

export interface CryptoAsset {
  symbol: string;
  name: string;
  default_treatment: Treatment;
  inventory_account_name: string;
  investment_account_name: string;
  active: boolean;
}

export type AccountKey =
  | 'machine_cash'
  | 'transaction_fees'
  | 'bitstop_fees'
  | 'exchange_account'
  | 'exchange_fees';

export type AccountMap = Record<AccountKey, string>;

// One parsed row of detail_*.csv.
export interface CoinbaseDetailRow {
  rowHash: string;
  periodStart: string; // 'YYYY-MM-DD'
  periodEnd: string;
  dateCompleted: string; // ISO 8601, UTC
  activityId: string;
  activityType: string;
  activityDescription: string;
  asset: string;
  status: string;
  amount: number;
  fee: number;
  totalBalanceImpact: number;
  wallet: string;
  walletType: string;
  walletId: string;
  portfolio: string;
  portfolioId: string;
  entity: string;
  sourceFilename: string;
}

// One parsed row of asset_balances_*.csv.
export interface CoinbaseBalanceRow {
  periodStart: string;
  periodEnd: string;
  asset: string;
  portfolio: string;
  portfolioId: string;
  startingBalance: number;
  endingBalance: number;
  startingBalanceUsd: number | null;
  endingBalanceUsd: number | null;
  sourceFilename: string;
}

export interface CoinbaseStatement {
  periodStart: string;
  periodEnd: string;
  month: string; // 'YYYY-MM' derived from periodStart (UTC)
  detail: CoinbaseDetailRow[];
  balances: CoinbaseBalanceRow[];
  detailFilename: string;
  balancesFilename: string;
}

// A USD-side buy row, paired with the coin parsed from its description.
export interface CoinbaseBuy {
  activityId: string;
  coin: string; // e.g. 'BTC', from "BUY BTC/USD - LIMIT"
  dateCompleted: string;
  amount: number; // USD spent
  fee: number; // USD fee
  totalBalanceImpact: number; // negative
  status: string;
  treatment: Treatment;
  treatmentIsOverride: boolean;
}

// Per-trade treatment override, keyed by (activityId, coin).
export interface BuyTreatmentOverride {
  activity_id: string;
  asset_symbol: string;
  treatment: Treatment;
}
