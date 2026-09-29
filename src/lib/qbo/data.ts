// Supabase I/O for the QBO Entries module. Every computation lives in the pure
// modules beside this one; this file only reads and writes rows.

import { supabase } from '@/lib/supabase';
import { monthEndDate, monthStartDate } from './period';
import type {
  AccountKey,
  AccountMap,
  BuyTreatmentOverride,
  CoinbaseBalanceRow,
  CoinbaseDetailRow,
  CoinbaseStatement,
  CryptoAsset,
  Je,
  JeLine,
  JeType,
  SalesProfileLike,
  SalesTxLike,
  Treatment,
} from './types';

const PAGE = 1000;

export const ACCOUNT_KEYS: AccountKey[] = [
  'machine_cash',
  'transaction_fees',
  'bitstop_fees',
  'exchange_account',
  'exchange_fees',
];

export const ACCOUNT_LABELS: Record<AccountKey, string> = {
  machine_cash: 'Machine cash (debit, sales)',
  transaction_fees: 'Transaction fees (credit, sales)',
  bitstop_fees: 'Bitstop / operator fees (debit, sales)',
  exchange_account: 'Exchange account (credit, Coinbase)',
  exchange_fees: 'Exchange fees (debit, Coinbase)',
};

export interface AccountMapRow {
  key: string;
  account_name: string;
  qbo_account_id: string | null;
  qbo_realm_id?: string | null;
  /** Entity stamped on lines hitting this account (the Coinbase vendor). */
  qbo_entity_type?: 'Vendor' | 'Customer' | 'Employee' | null;
  qbo_entity_id?: string | null;
  qbo_entity_name?: string | null;
}

export interface CryptoAssetRow extends CryptoAsset {
  id: string;
  qbo_inventory_account_id: string | null;
  qbo_investment_account_id: string | null;
}

export async function fetchAccountRows(): Promise<AccountMapRow[]> {
  const { data, error } = await supabase
    .from('qbo_account_map')
    // The entity columns are part of this row's job: the Coinbase vendor is
    // stamped on whichever line hits the exchange account. Omitting them here
    // silently dropped the EntityRef from posted Coinbase entries — the post
    // still succeeded, just without the vendor, which nothing surfaced.
    .select('key, account_name, qbo_account_id, qbo_realm_id, qbo_entity_type, qbo_entity_id, qbo_entity_name');
  if (error) throw error;
  return (data || []) as AccountMapRow[];
}

// Missing keys fall back to their label-ish default so the JE still renders
// something readable rather than "undefined".
export function toAccountMap(rows: AccountMapRow[]): AccountMap {
  const byKey = new Map(rows.map((r) => [r.key, r.account_name]));
  return {
    machine_cash: byKey.get('machine_cash') || 'BTC Machine Cash',
    transaction_fees: byKey.get('transaction_fees') || 'Transaction Fees',
    bitstop_fees: byKey.get('bitstop_fees') || 'Bitstop Fees',
    exchange_account: byKey.get('exchange_account') || 'Exchange Account - Coinbase',
    exchange_fees: byKey.get('exchange_fees') || 'Exchange Fees',
  };
}

export async function fetchCryptoAssets(): Promise<CryptoAssetRow[]> {
  const { data, error } = await supabase
    .from('crypto_assets')
    .select('id, symbol, name, default_treatment, inventory_account_name, investment_account_name, qbo_inventory_account_id, qbo_investment_account_id, active')
    .order('symbol');
  if (error) throw error;
  return (data || []) as CryptoAssetRow[];
}

// Completed transactions for a date range, all platforms — the Denet filter is
// applied by the JE computation, which uses profile-window attribution.
export async function fetchTransactionsForRange(
  fromDate: string,
  toDate: string,
): Promise<SalesTxLike[]> {
  const all: SalesTxLike[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('financial_transactions')
      .select('id, atm_id, date, ticker, status, sale, fee, sent, bitstop_fee')
      .gte('date', fromDate)
      .lte('date', `${toDate} 23:59:59`)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    all.push(...((data || []) as SalesTxLike[]));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

// Rows excluded from the financial surface, counted (not listed) for the INFO
// check, so a count query is enough and keeps the payload small.
//
// Derived as (all rows in range) − (financial rows in range) rather than by
// inverting the status filter. Exclusion is no longer a property of `status`
// alone: a refund override removes a transaction that is still stored as
// 'completed'. Inverting the status list would count the non-completed rows and
// silently miss every refunded one, so the INFO check would under-report
// exactly the exclusions a human most needs to know about. Subtracting the view
// from the base table tracks whatever `financial_transactions` decides, for
// free, including any future rule.
export async function countNonCompletedInRange(
  fromDate: string,
  toDate: string,
): Promise<number> {
  const inRange = (q: any) =>
    q.gte('date', fromDate).lte('date', `${toDate} 23:59:59`);

  const { count: totalCount, error: totalError } = await inRange(
    supabase.from('transactions').select('id', { count: 'exact', head: true }),
  );
  if (totalError) throw totalError;

  const { count: financialCount, error: financialError } = await inRange(
    supabase.from('financial_transactions').select('id', { count: 'exact', head: true }),
  );
  if (financialError) throw financialError;

  return Math.max(0, (totalCount || 0) - (financialCount || 0));
}

export async function fetchProfiles(): Promise<SalesProfileLike[]> {
  const { data, error } = await supabase
    .from('atm_profiles')
    .select('id, atm_id, platform, installed_date, removed_date');
  if (error) throw error;
  return (data || []) as SalesProfileLike[];
}

// Freshness guard: the newest Denet CSV import. The sales data is re-uploaded
// year-to-date, so an upload older than the month end may be missing status
// changes. Note `uploads.record_count` counts inserts only, so it cannot be
// used as a freshness signal — created_at is what matters.
export async function fetchLatestDenetUploadAt(): Promise<string | null> {
  const { data, error } = await supabase
    .from('uploads')
    .select('created_at')
    .eq('platform', 'denet')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data && data.length > 0 ? (data[0].created_at as string) : null;
}

// ---------------------------------------------------------------------------
// Coinbase statements
// ---------------------------------------------------------------------------

const toDetailRow = (r: any): CoinbaseDetailRow => ({
  rowHash: r.row_hash,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  dateCompleted: new Date(r.date_completed).toISOString(),
  activityId: r.activity_id,
  activityType: r.activity_type,
  activityDescription: r.activity_description || '',
  asset: r.asset,
  status: r.status || '',
  amount: Number(r.amount),
  fee: Number(r.fee),
  totalBalanceImpact: Number(r.total_balance_impact),
  wallet: r.wallet || '',
  walletType: r.wallet_type || '',
  walletId: r.wallet_id || '',
  portfolio: r.portfolio || '',
  portfolioId: r.portfolio_id || '',
  entity: r.entity || '',
  sourceFilename: r.source_filename,
});

const toBalanceRow = (r: any): CoinbaseBalanceRow => ({
  periodStart: r.period_start,
  periodEnd: r.period_end,
  asset: r.asset,
  portfolio: r.portfolio || '',
  portfolioId: r.portfolio_id || '',
  startingBalance: Number(r.starting_balance),
  endingBalance: Number(r.ending_balance),
  startingBalanceUsd: r.starting_balance_usd == null ? null : Number(r.starting_balance_usd),
  endingBalanceUsd: r.ending_balance_usd == null ? null : Number(r.ending_balance_usd),
  sourceFilename: r.source_filename,
});

export async function fetchCoinbaseRowsForMonths(
  months: string[],
): Promise<{ detail: CoinbaseDetailRow[]; balances: CoinbaseBalanceRow[] }> {
  if (months.length === 0) return { detail: [], balances: [] };
  const sorted = [...months].sort();
  const from = monthStartDate(sorted[0]);
  const to = monthEndDate(sorted[sorted.length - 1]);

  const detail: CoinbaseDetailRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('coinbase_transactions')
      .select('*')
      .gte('date_completed', `${from}T00:00:00Z`)
      .lte('date_completed', `${to}T23:59:59.999Z`)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    detail.push(...(data || []).map(toDetailRow));
    if (!data || data.length < PAGE) break;
  }

  const { data: balanceData, error: balanceError } = await supabase
    .from('coinbase_balances')
    .select('*')
    .gte('period_start', from)
    .lte('period_end', to);
  if (balanceError) throw balanceError;

  return { detail, balances: (balanceData || []).map(toBalanceRow) };
}

// Idempotent: both upserts key on the statement's natural identity, so
// re-uploading the same ZIP rewrites the same rows instead of duplicating.
export async function saveStatement(statement: CoinbaseStatement): Promise<{
  detailRows: number;
  balanceRows: number;
}> {
  const detailPayload = statement.detail.map((r) => ({
    row_hash: r.rowHash,
    period_start: r.periodStart,
    period_end: r.periodEnd,
    date_completed: r.dateCompleted,
    activity_id: r.activityId,
    activity_type: r.activityType,
    activity_description: r.activityDescription,
    asset: r.asset,
    status: r.status,
    amount: r.amount,
    fee: r.fee,
    total_balance_impact: r.totalBalanceImpact,
    wallet: r.wallet,
    wallet_type: r.walletType,
    wallet_id: r.walletId,
    portfolio: r.portfolio,
    portfolio_id: r.portfolioId,
    entity: r.entity,
    source_filename: r.sourceFilename,
  }));

  for (let i = 0; i < detailPayload.length; i += 500) {
    const { error } = await supabase
      .from('coinbase_transactions')
      .upsert(detailPayload.slice(i, i + 500), { onConflict: 'row_hash' });
    if (error) throw error;
  }

  const balancePayload = statement.balances.map((b) => ({
    period_start: b.periodStart,
    period_end: b.periodEnd,
    asset: b.asset,
    portfolio: b.portfolio,
    portfolio_id: b.portfolioId,
    starting_balance: b.startingBalance,
    ending_balance: b.endingBalance,
    starting_balance_usd: b.startingBalanceUsd,
    ending_balance_usd: b.endingBalanceUsd,
    source_filename: b.sourceFilename,
  }));

  if (balancePayload.length > 0) {
    const { error } = await supabase
      .from('coinbase_balances')
      .upsert(balancePayload, { onConflict: 'period_start,period_end,portfolio_id,asset' });
    if (error) throw error;
  }

  return { detailRows: detailPayload.length, balanceRows: balancePayload.length };
}

export async function fetchBuyTreatments(): Promise<BuyTreatmentOverride[]> {
  const { data, error } = await supabase
    .from('coinbase_buy_treatment')
    .select('activity_id, asset_symbol, treatment');
  if (error) throw error;
  return (data || []) as BuyTreatmentOverride[];
}

export async function saveBuyTreatment(
  activityId: string,
  assetSymbol: string,
  treatment: Treatment,
  updatedBy: string | null,
): Promise<void> {
  const { error } = await supabase.from('coinbase_buy_treatment').upsert(
    {
      activity_id: activityId,
      asset_symbol: assetSymbol,
      treatment,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'activity_id,asset_symbol' },
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

export interface SnapshotRow {
  id: string;
  month: string;
  je_type: JeType;
  je_date: string;
  lines: JeLine[];
  total_debits: number;
  total_credits: number;
  entered_by: string | null;
  entered_at: string;
  qbo_txn_id: string | null;
  post_state?: string | null;
  post_error?: string | null;
  doc_number?: string | null;
}

export async function fetchSnapshots(): Promise<SnapshotRow[]> {
  const { data, error } = await supabase
    .from('qbo_je_snapshots')
    .select('id, month, je_type, je_date, lines, total_debits, total_credits, entered_by, entered_at, qbo_txn_id, post_state, post_error, doc_number')
    .order('month', { ascending: false });
  if (error) throw error;
  return (data || []).map((r: any) => ({
    ...r,
    lines: (r.lines || []) as JeLine[],
    total_debits: Number(r.total_debits),
    total_credits: Number(r.total_credits),
  })) as SnapshotRow[];
}

/**
 * "Mark as entered in QBO" — a human keyed this month in by hand.
 *
 * Routed through an RPC rather than a direct upsert so the row is stamped
 * post_state = 'manual'. That state is deliberately NOT claimable by the
 * posting flow: a hand-entered month already exists in QuickBooks, and it
 * carries whatever DocNumber the person typed, so a later "Post to QBO" could
 * neither be prevented by our DocNumber pre-flight check nor detected
 * afterwards — it would simply create a second journal entry for a month
 * already entered. The previous plain upsert left these rows at the default
 * 'idle', which the claim predicate accepted.
 *
 * The RPC also refuses to relabel a row that was posted through the API, so
 * re-marking a posted entry cannot make it claimable again.
 */
export async function saveSnapshot(je: Je, enteredBy: string | null): Promise<void> {
  const { error } = await supabase.rpc('qbo_mark_entered_manually', {
    p_month: je.month,
    p_je_type: je.type,
    p_je_date: je.date,
    p_lines: je.lines,
    p_total_debits: je.totalDebits,
    p_total_credits: je.totalCredits,
    p_entered_by: enteredBy,
  });
  if (error) throw error;
}

export async function deleteSnapshot(month: string, jeType: JeType): Promise<void> {
  const { error } = await supabase
    .from('qbo_je_snapshots')
    .delete()
    .eq('month', month)
    .eq('je_type', jeType);
  if (error) throw error;
}
