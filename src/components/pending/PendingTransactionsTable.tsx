import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn, ageInDays, formatDateOnly } from '@/lib/utils';
import {
  MANUAL_RESOLUTION_TARGETS,
  formatStatusLabel,
  statusBadgeClass,
  type TxStatus,
} from '@/lib/transaction-status';
import { STALE_AFTER_DAYS, type PendingRow } from './types';
import { formatCurrency } from '@/lib/format';
import { TableEmpty } from '@/components/ui/table-empty';

interface PendingTransactionsTableProps {
  rows: PendingRow[];
  // Terminal rows are informational: dimmed, no resolution controls.
  showActions: boolean;
  onResolve?: (row: PendingRow, target: TxStatus) => void;
  emptyMessage: string;
  isLoading?: boolean;
}

export function PendingTransactionsTable({
  rows,
  showActions,
  onResolve,
  emptyMessage,
  isLoading = false,
}: PendingTransactionsTableProps) {
  const colSpan = showActions ? 9 : 8;

  return (
    <div className="min-w-0 rounded-md border border-white/10">
      <Table className="table-fixed w-full">
        <TableHeader>
          <TableRow>
            {/* The transaction's own id, abbreviated. Several rows can share an
                ATM, a date and an amount — this is the only field that never
                collides, so it is what you cross-check against the confirm
                dialog before approving a write. */}
            <TableHead className="font-bold w-[88px]">ID</TableHead>
            <TableHead className="font-bold w-[128px]">Status</TableHead>
            <TableHead className="font-bold leading-tight w-[116px]">Transaction Date</TableHead>
            <TableHead className="font-bold w-[116px]">First Seen</TableHead>
            <TableHead className="text-right font-bold w-[48px]">Age</TableHead>
            <TableHead className="font-bold">ATM</TableHead>
            <TableHead className="font-bold w-[84px]">Platform</TableHead>
            <TableHead className="text-right font-bold w-[124px]">Amount</TableHead>
            {showActions && <TableHead className="text-right font-bold w-[210px]">Resolve</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colSpan} className="h-auto p-0">
                <TableEmpty>Loading...</TableEmpty>
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={colSpan} className="h-auto p-0">
                <TableEmpty>{emptyMessage}</TableEmpty>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => {
              const age = ageInDays(row.date);
              // Only actionable rows go red — a 90-day-old refund is not stale,
              // it is simply history.
              const stale = showActions && age !== null && age >= STALE_AFTER_DAYS;

              return (
                <TableRow
                  key={row.id}
                  className={cn(
                    'border-white/5',
                    !showActions && 'bg-white/[0.02] text-muted-foreground/70',
                    stale && 'bg-red-500/[0.07]',
                  )}
                >
                  <TableCell
                    className="font-mono text-xs text-muted-foreground whitespace-nowrap overflow-hidden"
                    title={row.id}
                  >
                    {row.id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="overflow-hidden">
                    <span className={`inline-flex whitespace-nowrap px-2 py-1 rounded text-xs ${statusBadgeClass(row.status)}`}>
                      {formatStatusLabel(row.status)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm whitespace-nowrap">{formatDateOnly(row.date)}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground whitespace-nowrap">
                    {formatDateOnly(row.created_at)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-mono text-sm',
                      stale && 'text-red-400 font-semibold',
                    )}
                  >
                    {age === null ? '—' : `${age}d`}
                  </TableCell>
                  <TableCell className="min-w-0 overflow-hidden">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium" title={row.atm_id}>{row.atm_id}</span>
                      <span className="truncate text-xs text-muted-foreground" title={row.atm_name || undefined}>{row.atm_name || '—'}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        row.platform === 'bitstop'
                          ? 'bg-blue-500/20 text-blue-300'
                          : 'bg-green-500/20 text-green-300'
                      }`}
                    >
                      {row.platform === 'bitstop' ? 'Bitstop' : 'Denet'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                    {formatCurrency(row.sale ?? 0, 2)}
                  </TableCell>
                  {showActions && (
                    <TableCell>
                      <div className="flex flex-nowrap gap-1.5 justify-end">
                        {/* Buttons come from the config, never a literal list —
                            add one by flipping manualTarget in STATUS_RULES. */}
                        {MANUAL_RESOLUTION_TARGETS.filter((t) => t !== row.status).map((target) => (
                          <Button
                            key={target}
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs whitespace-nowrap"
                            onClick={() => onResolve?.(row, target)}
                          >
                            Mark {formatStatusLabel(target)}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
