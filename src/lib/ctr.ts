import { supabase } from './supabase';

export const CTR_THRESHOLD = 10001;

export type CTRGroup = {
  customer_id: string;
  customer_name: string;
  trigger_date: string;
  total_amount: number;
  transaction_count: number;
};

type QualifyableTransaction = {
  customer_id: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  sale: number | string | null;
  date: string;
};

// Pure grouping + threshold. Use when the caller already has the rows in hand.
export function qualifyCtrGroups(
  transactions: QualifyableTransaction[],
  threshold: number = CTR_THRESHOLD,
): CTRGroup[] {
  const grouped = new Map<string, CTRGroup>();

  for (const tx of transactions) {
    if (!tx.customer_id) continue;
    const dateOnly = tx.date?.split('T')[0] || tx.date;
    const key = `${tx.customer_id}|${dateOnly}`;
    const sale = parseFloat(tx.sale?.toString() || '0');
    const name =
      [tx.customer_first_name, tx.customer_last_name].filter(Boolean).join(' ') || 'Unknown';

    let group = grouped.get(key);
    if (!group) {
      group = {
        customer_id: tx.customer_id,
        customer_name: name,
        trigger_date: dateOnly,
        total_amount: 0,
        transaction_count: 0,
      };
      grouped.set(key, group);
    }
    group.total_amount += sale;
    group.transaction_count += 1;
  }

  const out: CTRGroup[] = [];
  for (const g of grouped.values()) {
    if (g.total_amount >= threshold) out.push(g);
  }
  return out;
}

// Canonical scan: Denet platform, customer_id present, summed per (customer_id, date), >= threshold.
export async function findCtrQualifyingGroups(opts: {
  fromDate: string;
  toDate?: string;
  threshold?: number;
}): Promise<CTRGroup[]> {
  let query = supabase
    .from('transactions')
    .select('customer_id, customer_first_name, customer_last_name, sale, date')
    .eq('platform', 'denet')
    .not('customer_id', 'is', null)
    .gte('date', opts.fromDate);

  if (opts.toDate) query = query.lte('date', opts.toDate);

  const { data, error } = await query;
  if (error) throw error;

  return qualifyCtrGroups(data || [], opts.threshold ?? CTR_THRESHOLD);
}
