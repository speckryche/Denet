// FIFO cost basis for Denet's crypto investments (public.investment_transactions).
//
// Rules:
//   * Buy                  → new lot (qty, cost = usd_amount incl. fees).
//   * Adjustment, qty > 0  → new zero-cost lot.
//   * Sell                 → consumes the oldest lots first; realized gain = proceeds − consumed cost.
//   * Adjustment, qty < 0  → consumes the oldest lots first and removes that cost from basis.
//                            Not a realized gain or loss.
// Quantity is signed in the table (Sell < 0), so the helper uses Math.abs for consumption.
// Pure: no I/O, no React.

export type InvestmentCoin = 'BTC' | 'SOL';
export type InvestmentTxType = 'Buy' | 'Sell' | 'Adjustment';

export const INVESTMENT_COINS: InvestmentCoin[] = ['BTC', 'SOL'];

export interface InvestmentTransaction {
  id: string;
  tx_date: string; // YYYY-MM-DD
  coin: InvestmentCoin;
  tx_type: InvestmentTxType;
  quantity: number; // signed
  usd_amount: number; // >= 0
  venue: string | null;
  note: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface FifoResult {
  qty: number;
  costBasis: number;
  avgCost: number; // costBasis / qty, 0 when nothing is held
  realizedGain: number;
  /** Quantity a Sell / negative Adjustment tried to remove with no lot left. > 0 means the ledger is inconsistent. */
  oversold: number;
}

// Below this, a lot counts as fully consumed (float noise on 8-decimal quantities).
const QTY_EPS = 1e-10;

const byLedgerOrder = (a: InvestmentTransaction, b: InvestmentTransaction): number =>
  a.tx_date.localeCompare(b.tx_date) ||
  a.created_at.localeCompare(b.created_at) ||
  a.id.localeCompare(b.id); // stable tiebreak: the imported rows share one created_at

/** Ledger order: tx_date, then created_at (then id). Does not mutate the input. */
export const sortLedger = (txs: InvestmentTransaction[]): InvestmentTransaction[] =>
  [...txs].sort(byLedgerOrder);

/** FIFO over one coin's transactions. Rows for other coins are ignored if `coin` is given. */
export function computeFifo(txs: InvestmentTransaction[], coin?: InvestmentCoin): FifoResult {
  const rows = sortLedger(coin ? txs.filter((t) => t.coin === coin) : txs);
  const lots: { qty: number; cost: number }[] = []; // oldest first
  let realizedGain = 0;
  let oversold = 0;

  // Removes `qty` from the oldest lots; returns the cost removed.
  const consume = (qty: number): number => {
    let remaining = qty;
    let cost = 0;
    while (remaining > QTY_EPS && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(lot.qty, remaining);
      const takeCost = lot.qty > 0 ? lot.cost * (take / lot.qty) : 0;
      cost += takeCost;
      lot.qty -= take;
      lot.cost -= takeCost;
      remaining -= take;
      if (lot.qty <= QTY_EPS) lots.shift();
    }
    if (remaining > QTY_EPS) oversold += remaining;
    return cost;
  };

  for (const t of rows) {
    const qty = Number(t.quantity);
    const usd = Number(t.usd_amount);
    if (t.tx_type === 'Buy') {
      lots.push({ qty: Math.abs(qty), cost: usd });
    } else if (t.tx_type === 'Sell') {
      realizedGain += usd - consume(Math.abs(qty));
    } else if (qty > 0) {
      lots.push({ qty, cost: 0 });
    } else if (qty < 0) {
      consume(-qty); // cost leaves basis; nothing realized
    }
  }

  const qty = lots.reduce((s, l) => s + l.qty, 0);
  const costBasis = lots.reduce((s, l) => s + l.cost, 0);
  return {
    qty: roundQty(qty),
    costBasis,
    avgCost: qty > QTY_EPS ? costBasis / qty : 0,
    realizedGain,
    oversold: roundQty(oversold),
  };
}

/** Ledger quantity of `coin` held at end of `asOfDate` (sum of signed quantity where tx_date <= asOfDate). */
export function ledgerQtyAsOf(
  txs: Pick<InvestmentTransaction, 'coin' | 'tx_date' | 'quantity'>[],
  coin: InvestmentCoin,
  asOfDate: string,
): number {
  return roundQty(
    txs
      .filter((t) => t.coin === coin && t.tx_date <= asOfDate)
      .reduce((s, t) => s + Number(t.quantity), 0),
  );
}

/** Round to 8 decimals (sats) to drop float noise from summing. */
export const roundQty = (n: number): number => Math.round(n * 1e8) / 1e8;
