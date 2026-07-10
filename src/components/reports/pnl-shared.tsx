// Shared presentation helpers for the monthly P&L reports (Fleet and
// Per-Machine). Formatting, partial-month footnote, and the two-state
// commission-not-calculated banners/footnotes live here so both reports render
// identical markers and warnings. Qualification logic itself lives in the
// engine (src/lib/pnl.ts: classifyCommissionMonths).

import { AlertTriangle, Info } from 'lucide-react';
import type { Platform } from '@/lib/pnl';

export const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// 'YYYY-MM' -> "Jul 2026"
export const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} ${y}`;
};

// 'YYYY-MM' -> "Jul '26" (compact, for column headers)
export const monthLabelShort = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} '${String(y).slice(-2)}`;
};

export const isValidYM = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export const fmtCurrency = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

export const PARTIAL_FOOTNOTE =
  '◦ Partial month — data through the latest upload, not a full month.';

export const platformLabel = (p: Platform) =>
  p === 'both' ? 'All platforms' : p === 'bitstop' ? 'Bitstop platform' : 'Denet platform';

// Text for the commission-not-calculated caveat (footnotes + Excel note row).
export const commissionNote = (missingMonths: string[]): string =>
  missingMonths.length
    ? `Commission not calculated for ${missingMonths.map(monthLabel).join(', ')} — Net may be overstated.`
    : '';

// Two-state commission banners: an amber WARNING for closed months with no
// commission (Net may be overstated) and a neutral INFO note for current/partial
// months where commission simply hasn't run yet.
export function CommissionBanners({
  missingMonths,
  pendingMonths,
}: {
  missingMonths: string[];
  pendingMonths: string[];
}) {
  return (
    <>
      {missingMonths.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-400/30 bg-amber-500/[0.08]">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold text-amber-300">Commission not calculated</div>
            <div className="text-muted-foreground">
              No commission calculation exists for{' '}
              <span className="text-foreground font-medium">{missingMonths.map(monthLabel).join(', ')}</span>. Net
              P&amp;L for {missingMonths.length > 1 ? 'these months' : 'this month'} may be overstated.
            </div>
          </div>
        </div>
      )}
      {pendingMonths.length > 0 && (
        <div className="flex items-start gap-3 p-3 rounded-lg border border-white/10 bg-white/[0.02]">
          <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            Commission for{' '}
            <span className="text-foreground font-medium">{pendingMonths.map(monthLabel).join(', ')}</span> has not
            been calculated yet — commission runs after month close.
          </div>
        </div>
      )}
    </>
  );
}

// Partial-month + commission-not-calculated footnotes below a report table.
export function ReportFootnotes({
  hasPartial,
  missingMonths,
}: {
  hasPartial: boolean;
  missingMonths: string[];
}) {
  if (!hasPartial && missingMonths.length === 0) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {hasPartial && <div>{PARTIAL_FOOTNOTE}</div>}
      {missingMonths.length > 0 && <div>⚠ {commissionNote(missingMonths)}</div>}
    </div>
  );
}
