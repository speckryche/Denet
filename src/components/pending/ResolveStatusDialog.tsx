import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatStatusLabel, statusBadgeClass, type TxStatus } from '@/lib/transaction-status';
import { formatDateOnly } from '@/lib/utils';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { PendingRow } from './types';

export interface ResolveIntent {
  row: PendingRow;
  target: TxStatus;
}

interface ResolveStatusDialogProps {
  intent: ResolveIntent | null;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

// Confirmation gate for a MONEY-AFFECTING write: marking a transaction
// 'completed' moves its sale into every financial total (P&L, commissions,
// reconciliation). Never fire the update straight off a button click.
export function ResolveStatusDialog({
  intent,
  submitting,
  onCancel,
  onConfirm,
}: ResolveStatusDialogProps) {
  const row = intent?.row;
  const target = intent?.target;

  return (
    <AlertDialog open={!!intent} onOpenChange={(open) => !open && !submitting && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Mark as {target ? formatStatusLabel(target) : ''}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p>This updates the transaction record immediately.</p>

              {row && (
                <div className="rounded-md border border-white/10 bg-secondary/10 p-3 space-y-1.5 text-sm">
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">ATM</span>
                    <span className="text-right">
                      {row.atm_id} — {row.atm_name || '—'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Date</span>
                    <span>{formatDateOnly(row.date)}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-mono">
                      ${Math.round(row.sale ?? 0).toLocaleString('en-US')}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Transaction</span>
                    <span className="font-mono text-xs break-all text-right">
                      {row.id.length > 20 ? `${row.id.slice(0, 20)}…` : row.id}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 pt-1">
                    <span className="text-muted-foreground">Status</span>
                    <span className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${statusBadgeClass(row.status)}`}>
                        {formatStatusLabel(row.status)}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className={`px-2 py-0.5 rounded text-xs ${statusBadgeClass(target)}`}>
                        {formatStatusLabel(target)}
                      </span>
                    </span>
                  </div>
                </div>
              )}

              <p className="text-xs">
                The CSV remains the source of truth — a later re-upload covering this
                transaction will overwrite this choice with whatever Nonce reports.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              // Keep the dialog mounted while the write is in flight so the
              // spinner is visible and a double-click can't fire it twice.
              e.preventDefault();
              onConfirm();
            }}
            disabled={submitting}
          >
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Mark as {target ? formatStatusLabel(target) : ''}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
