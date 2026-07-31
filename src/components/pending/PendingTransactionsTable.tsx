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
    <div className="rounded-md border border-white/10 overflow-x-auto">
      <Table>
        <TableHeader className="bg-white/5">
          <TableRow className="border-white/10">
            {/* The transaction's own id, abbreviated. Several rows can share an
                ATM, a date and an amount — this is the only field that never
                collides, so it is what you cross-check against the confirm
                dialog before approving a write. */}
            <TableHead className="font-bold">ID</TableHead>
            <TableHead className="font-bold">Status</TableHead>
            <TableHead className="font-bold">Transaction Date</TableHead>
            <TableHead className="font-bold">First Seen</TableHead>
            <TableHead className="text-right font-bold">Age</TableHead>
            <TableHead className="font-bold">ATM</TableHead>
            <TableHead className="font-bold">Platform</TableHead>
            <TableHead className="text-right font-bold">Amount</TableHead>
            {showActions && <TableHead className="text-right font-bold">Resolve</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-center text-muted-foreground">
                Loading...
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-8">
                {emptyMessage}
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
                    className="font-mono text-xs text-muted-foreground"
                    title={row.id}
                  >
                    {row.id.slice(0, 8)}
                  </TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(row.status)}`}>
                      {formatStatusLabel(row.status)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{formatDateOnly(row.date)}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
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
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{row.atm_id}</span>
                      <span className="text-xs text-muted-foreground">{row.atm_name || '—'}</span>
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
                  <TableCell className="text-right font-mono">
                    ${Math.round(row.sale ?? 0).toLocaleString('en-US')}
                  </TableCell>
                  {showActions && (
                    <TableCell>
                      <div className="flex gap-2 justify-end">
                        {/* Buttons come from the config, never a literal list —
                            add one by flipping manualTarget in STATUS_RULES. */}
                        {MANUAL_RESOLUTION_TARGETS.filter((t) => t !== row.status).map((target) => (
                          <Button
                            key={target}
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs whitespace-nowrap"
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
