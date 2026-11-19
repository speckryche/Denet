// Collapsible group bar + card for grouped tables (by year or by month).
// Bitstop Commissions is the reference design; Commission Records and the
// Cash Management month tables follow it.
//
// Owns the bar — chevron, label ("2026" or "Nov 2026"), "N months" count, and
// the right-hand stats (uppercase label over a value) — plus the card around
// the table. The table itself is the caller's; use GROUP_TH / GROUP_TD on its
// cells so headers, padding and row height match across pages.

import * as React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Column header: small uppercase, tracked, semibold. Labels may wrap to two lines. */
export const GROUP_TH =
  'px-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-table-header-fg leading-tight whitespace-normal';

/** Body cell: compact horizontal padding and a 48px row, the height of a row of form inputs. */
export const GROUP_TD = 'px-1.5 h-12';

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
          'flex flex-wrap items-center justify-between gap-4 rounded-t-[14px] px-[18px] py-3.5',
          'bg-table-header-bg text-table-header-fg dark:bg-surface-2 cursor-pointer',
          'hover:bg-neutral-900 dark:hover:bg-muted/80 transition-colors',
          expanded ? 'border-b border-table-header-fg/20 dark:border-border' : 'rounded-b-[14px]',
        )}
      >
        <div className="flex items-center gap-3">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-table-header-fg dark:text-dim" />
          ) : (
            <ChevronRight className="w-4 h-4 text-table-header-fg dark:text-dim" />
          )}
          <span className="text-lg font-semibold tracking-tight text-table-header-fg dark:text-foreground tabular-nums">
            {label}
          </span>
          <span className="text-[13px] text-table-header-fg dark:text-muted-foreground">
            {count} {unit}{count !== 1 ? 's' : ''}
          </span>
        </div>
        {stats.length > 0 && (
          <div className="flex items-center gap-8">
            {stats.map((s) => (
              <div key={s.label} className="text-right">
                <div className="flex items-center justify-end gap-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-table-header-fg dark:text-dim">
                  {s.dot && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
                  {s.label}
                </div>
                <div className="text-base font-semibold text-table-header-fg dark:text-foreground tabular-nums">
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
