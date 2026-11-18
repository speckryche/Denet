// Which month a Bitstop report covers, and whether that matches the month row
// it is being uploaded to.
//
// Uploading the Oct report to the Nov row would overwrite Nov's totals and
// audit Oct's lines against Nov's transactions — every line would read as a
// late correction and every Nov sale as missing. Nothing downstream catches
// that, so the dialog checks it before anything is written.
//
// Pure: works on parsed lines, which already exclude SUBTOTAL/TOTAL rows.

import type { ReportLine } from './parse';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Share of lines one month must hold to count as "the report's month". */
export const MONTH_MAJORITY = 0.8;

/** '2026-10' -> 'Oct 2026'. */
export const formatYearMonth = (ym: string): string => {
  const [y, m] = ym.split('-');
  return `${MONTH_ABBR[Number(m) - 1] ?? m} ${y}`;
};

export interface MonthShare {
  yearMonth: string;  // 'YYYY-MM'
  count: number;
  share: number;      // 0..1
}

export interface ReportMonthCheck {
  /** True only when one month holds a clear majority AND it is the target month. */
  ok: boolean;
  /** The most common month, or null when there are no lines. */
  dominant: MonthShare | null;
  /** Whether the dominant month reaches MONTH_MAJORITY. */
  clearMajority: boolean;
  /** Every month present, most lines first. */
  breakdown: MonthShare[];
  target: string;     // 'YYYY-MM'
}

export function checkReportMonth(
  lines: Pick<ReportLine, 'created_at'>[],
  target: string,
  majority: number = MONTH_MAJORITY,
): ReportMonthCheck {
  const counts = new Map<string, number>();
  for (const l of lines) {
    const ym = l.created_at?.slice(0, 7);
    if (ym && /^\d{4}-\d{2}$/.test(ym)) counts.set(ym, (counts.get(ym) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const breakdown: MonthShare[] = [...counts.entries()]
    .map(([yearMonth, count]) => ({ yearMonth, count, share: total ? count / total : 0 }))
    .sort((a, b) => b.count - a.count || a.yearMonth.localeCompare(b.yearMonth));

  const dominant = breakdown[0] ?? null;
  const clearMajority = dominant != null && dominant.share >= majority;
  return {
    ok: clearMajority && dominant!.yearMonth === target,
    dominant,
    clearMajority,
    breakdown,
    target,
  };
}
