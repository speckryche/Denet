// Shown when a month was marked as entered in QBO but recomputing now gives a
// different entry — most often because a transaction's status changed in a
// later YTD re-upload. Lists the per-line differences so the QBO entry can be
// corrected by hand.

import { AlertTriangle } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { fmtAmount } from '@/lib/qbo/money';
import type { DriftResult } from '@/lib/qbo/snapshot';

const KIND_LABEL: Record<string, string> = {
  changed: 'Changed',
  added: 'New line',
  removed: 'Line gone',
};

export function DriftBanner({
  drift,
  jeLabel,
  enteredAt,
}: {
  drift: DriftResult;
  jeLabel: string;
  enteredAt?: string | null;
}) {
  if (!drift.drifted) return null;

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-3">
      <div className="flex items-start gap-2 text-amber-400">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
        <div>
          <div className="text-sm font-semibold">
            {jeLabel} has drifted since it was entered in QBO
            {enteredAt ? ` on ${enteredAt.slice(0, 10)}` : ''}.
          </div>
          <div className="text-xs opacity-80">
            The recomputed entry no longer matches the snapshot. Update QBO with the differences
            below, then mark the month as entered again to re-baseline.
          </div>
        </div>
      </div>

      <div className="rounded-md border border-amber-500/20 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-amber-500/20 hover:bg-transparent">
              <TableHead className="text-amber-300">Change</TableHead>
              <TableHead className="text-amber-300">Account</TableHead>
              <TableHead className="text-amber-300 text-right">Debit was → now</TableHead>
              <TableHead className="text-amber-300 text-right">Credit was → now</TableHead>
              <TableHead className="text-amber-300 text-right">Difference</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drift.diffs.map((d, idx) => (
              <TableRow key={`${d.account}-${idx}`} className="border-amber-500/10">
                <TableCell className="text-xs">{KIND_LABEL[d.kind] || d.kind}</TableCell>
                <TableCell>
                  <div className="font-medium">{d.account}</div>
                  <div className="text-xs text-muted-foreground">{d.description}</div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {fmtAmount(d.snapshotDebit)} → {fmtAmount(d.currentDebit)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {fmtAmount(d.snapshotCredit)} → {fmtAmount(d.currentCredit)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold">
                  {d.debitDelta !== 0 ? `DR ${fmtAmount(d.debitDelta)}` : ''}
                  {d.debitDelta !== 0 && d.creditDelta !== 0 ? ' / ' : ''}
                  {d.creditDelta !== 0 ? `CR ${fmtAmount(d.creditDelta)}` : ''}
                </TableCell>
              </TableRow>
            ))}
            {drift.diffs.length === 0 && drift.totalsChanged && (
              <TableRow>
                <TableCell colSpan={5} className="text-sm">
                  Totals changed: debits {fmtAmount(drift.snapshotTotals.debits)} →{' '}
                  {fmtAmount(drift.currentTotals.debits)}, credits{' '}
                  {fmtAmount(drift.snapshotTotals.credits)} → {fmtAmount(drift.currentTotals.credits)}.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
