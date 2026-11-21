// Collapsible group bar + card for grouped tables (by year or by month).
// Used by Commission Records, Bitstop Commissions, Cash Management month
// tables, and Investments. Default TableHeader now uses the same Option B
// light treatment; these constants keep grouped-page padding consistent.
//
// Owns the bar — chevron, label ("2026" or "Nov 2026"), "N months" count, and
// the right-hand stats (uppercase label over a value) — plus the card around
// the table. The table itself is the caller's; use GROUP_THEAD / GROUP_TH /
// GROUP_TD on its cells so headers, padding and row height match across pages.
//
// Light mode is option B (minimal / underline): no fill, a slim divider, and
// readable dark-muted column labels. Dark mode keeps the previous slate bar
// and header strip.

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TABLE_THEAD, TABLE_TFOOT } from '@/components/ui/table-styles';

/** Column header: small uppercase, tracked, semibold. Labels may wrap to two lines. */
export const GROUP_TH =
  'px-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#4B5563] dark:text-table-header-fg leading-tight whitespace-normal';

/** Same Option B header as the default TableHeader. */
export const GROUP_THEAD = TABLE_THEAD;

/** Body cell: compact horizontal padding and a 48px row, the height of a row of form inputs. */
export const GROUP_TD = 'px-1.5 h-12';

/** Holdings totals row: same as the default TableFooter. */
export const GROUP_TFOOT = TABLE_TFOOT;

export interface GroupStat {
  label: string;
  value: React.ReactNode;
  /** Small primary-color dot before the label (Bitstop uses it on Comm %). */
  dot?: boolean;
}

interface TableGroupProps {
  /** Bar title: a year (2026) or a text label ("Nov 2026"). */
  label: React.ReactNode;
  /** e.g. 10 with unit "month" → "10 months". */
  count: number;
  unit: string;
  expanded: boolean;
  onToggle: () => void;
  stats?: GroupStat[];
  className?: string;
  children?: React.ReactNode;
}

export function TableGroup({
  label, count, unit, expanded, onToggle, stats = [], className, children,
}: TableGroupProps) {
  return (
    <div className={cn('rounded-[14px] border border-border bg-card shadow-sm', className)}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
        }}
        className={cn(
          'flex flex-wrap items-center justify-between gap-4 px-[18px] cursor-pointer transition-colors',
          // Light (option B): slim divider, no fill, compact padding.
          'rounded-t-[14px] bg-transparent text-foreground py-2 hover:bg-muted/40',
          // Dark: previous slate bar (py-3.5, surface-2, muted hover).
          'dark:bg-surface-2 dark:text-table-header-fg dark:py-3.5 dark:hover:bg-muted/80',
          expanded
            ? 'border-b-2 border-foreground dark:border-b dark:border-border'
            : 'rounded-b-[14px] border-b border-border dark:border-b-0 dark:border-transparent',
        )}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-foreground dark:text-dim" />
          ) : (
            <ChevronRight className="w-4 h-4 text-foreground dark:text-dim" />
          )}
          <span className="text-lg font-semibold tracking-tight text-foreground tabular-nums">
            {label}
          </span>
          <span className="text-[13px] text-[#4B5563] dark:text-muted-foreground">
            {count} {unit}{count !== 1 ? 's' : ''}
          </span>
        </div>
        {stats.length > 0 && (
          <div className="flex items-center gap-8">
            {stats.map((s) => (
              <div key={s.label} className="text-right">
                <div className="flex items-center justify-end gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-[#4B5563] dark:text-dim">
                  {s.dot && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
                  {s.label}
                </div>
                <div className="text-base font-semibold text-foreground tabular-nums">
                  {s.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {expanded && children}
    </div>
  );
}
