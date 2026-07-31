import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { PENDING_STATUSES } from '@/lib/transaction-status';

// The sidebar badge needs to reflect a resolution written on the Pending
// Resolution page, but the two live in different subtrees with no shared
// provider. A window event is the smallest thing that works — no context, no
// store, no prop drilling through Layout.
const PENDING_COUNT_CHANGED = 'pending-resolution:count-changed';

export const notifyPendingCountChanged = () =>
  window.dispatchEvent(new Event(PENDING_COUNT_CHANGED));

// Count of ACTIONABLE rows (PENDING_STATUSES only — terminal refunded/expired
// rows are informational and must not inflate the badge). Refetches on mount,
// on navigation, and whenever a resolution is written.
export function usePendingCount(): number | null {
  const [count, setCount] = useState<number | null>(null);
  const { pathname } = useLocation();

  useEffect(() => {
    let cancelled = false;

    const fetchCount = async () => {
      const { count: n, error } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .in('status', PENDING_STATUSES);

      // A failed count must not render as "0 pending" — that reads as "all
      // clear" when the truth is "unknown". null hides the badge entirely.
      if (!cancelled) setCount(error ? null : (n ?? null));
    };

    fetchCount();
    window.addEventListener(PENDING_COUNT_CHANGED, fetchCount);
    return () => {
      cancelled = true;
      window.removeEventListener(PENDING_COUNT_CHANGED, fetchCount);
    };
  }, [pathname]);

  return count;
}
