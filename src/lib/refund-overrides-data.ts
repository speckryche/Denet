// Supabase I/O for refund overrides. Split from refund-overrides.ts on purpose,
// matching the src/lib/qbo/ convention: the pure module stays importable from
// Node (the harness bundles it with esbuild), while anything touching
// `@/lib/supabase` — which reads Vite's import.meta.env and is undefined under
// Node — lives here.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { RefundOverride } from '@/lib/refund-overrides';

// ---------------------------------------------------------------------------
// I/O. Kept here rather than in a data module because every caller wants the
// same one thing: the set of ids to exclude. The table is tiny (one row per
// refunded sale), so a full fetch is cheaper than any filtered variant.
// ---------------------------------------------------------------------------


export async function fetchRefundOverrides(): Promise<RefundOverride[]> {
  const { data, error } = await supabase
    .from('transaction_refunds')
    .select('id, transaction_id, refund_date, source, note, atm_id, tx_date, sale, fee, platform')
    .order('refund_date', { ascending: false });
  if (error) throw error;
  return (data || []) as RefundOverride[];
}

/**
 * Just the exclusion set, for list views that compute totals in memory.
 *
 * Reports that query `financial_transactions` do NOT need this — the view
 * already applies the rule. This exists for the handful of screens that
 * deliberately fetch every status (so a refunded or frozen row is still
 * visible, greyed out) and then decide per row what counts.
 */
export async function fetchRefundedIds(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('transaction_refunds')
    .select('transaction_id');
  if (error) throw error;
  return new Set((data || []).map((r: any) => r.transaction_id).filter(Boolean));
}
/**
 * Refunded-id set for list views, fetched once on mount.
 *
 * Returns an empty set while loading and on error: a transient fetch failure
 * must not silently hide rows or change a visible total. The consequence of
 * the empty default is that a refunded row briefly counts, which is the same
 * thing the screen showed before this feature existed — safe in the direction
 * that matters.
 */
export function useRefundedIds(refreshKey: unknown = 0): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    fetchRefundedIds()
      .then((s) => { if (!cancelled) setIds(s); })
      .catch((e) => console.error('[refund-overrides] failed to load refunded ids', e));
    return () => { cancelled = true; };
  }, [refreshKey]);
  return ids;
}
