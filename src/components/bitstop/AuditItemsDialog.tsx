// One month's audit discrepancies, with triage.
//
// Status is a durable decision, not a display state: a re-upload preserves it
// (see reconcile.ts), so what a person records here survives Bitstop reissuing
// the report.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { fetchAuditItems, updateAuditItem, type BitstopMonthRow } from '@/lib/bitstop-report/data';
import type { StoredAuditItem, AuditStatus } from '@/lib/bitstop-report/reconcile';

const money = (v: number | null | undefined) =>
  v == null ? '—' : `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KIND_LABEL: Record<string, string> = {
  missing_from_report: 'Missing from report',
  not_in_app: 'Not in app',
  amount_diff: 'Amount differs',
  late_correction: 'Late correction',
};

const KIND_CLASS: Record<string, string> = {
  missing_from_report: 'bg-red-500/15 text-red-400 border-red-500/30',
  not_in_app: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  amount_diff: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  late_correction: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

const STATUSES: AuditStatus[] = ['open', 'disputed', 'resolved', 'accepted_refund', 'accepted_other'];
const STATUS_LABEL: Record<AuditStatus, string> = {
  open: 'Open',
  disputed: 'Disputed',
  resolved: 'Resolved',
  accepted_refund: 'Accepted – refund',
  accepted_other: 'Accepted – other',
};

interface Props {
  monthRow: BitstopMonthRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export default function AuditItemsDialog({ monthRow, open, onOpenChange, onChanged }: Props) {
  const [items, setItems] = useState<StoredAuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    if (!monthRow) return;
    setLoading(true); setError(null);
    try {
      setItems(await fetchAuditItems(monthRow.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open && monthRow) load(); }, [open, monthRow?.id]);

  const patch = async (item: StoredAuditItem, next: Partial<StoredAuditItem>) => {
    setSavingId(item.id); setError(null);
    try {
      // Choosing a terminal status stamps the date if the user hasn't set one,
      // so "when was this settled" is never left blank by accident.
      const body: any = { ...next };
      if (next.status && next.status !== 'open' && !item.resolved_date && !next.resolved_date) {
        body.resolved_date = new Date().toISOString().slice(0, 10);
      }
      if (next.status === 'open') body.resolved_date = null;
      await updateAuditItem(item.id, body);
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, ...body } : i)));
      onChanged();
    } catch (e) {
      console.error('[bitstop-audit] update failed', e);
      setError(e instanceof Error ? e.message : 'Failed to save');
      await load();
    } finally {
      setSavingId(null);
    }
  };

  const openCount = items.filter((i) => i.status === 'open').length;
  const atStake = items
    .filter((i) => i.status === 'open' && i.kind === 'missing_from_report')
    .reduce((s, i) => s + Number(i.app_commission ?? 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[1000px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Audit — {monthRow?.month} {monthRow?.year}
          </DialogTitle>
          <DialogDescription>
            {openCount} open of {items.length}.
            {atStake > 0 && ` ${money(atStake)} of commission at stake in unreported sales.`}
            {' '}Decisions here survive a re-upload.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <p className="text-muted-foreground py-8 text-center">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">
            No discrepancies — every report line matched.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>ATM</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">App</TableHead>
                <TableHead className="text-right">Report</TableHead>
                <TableHead className="w-[170px]">Status</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Resolved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id} className={i.status === 'open' ? undefined : 'opacity-60'}>
                  <TableCell>
                    <Badge className={KIND_CLASS[i.kind] || ''}>{KIND_LABEL[i.kind] || i.kind}</Badge>
                  </TableCell>
                  <TableCell>{i.atm_id ?? '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{i.tx_date ?? '—'}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {money(i.app_fiat)}<span className="text-muted-foreground"> / {money(i.app_commission)}</span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {money(i.report_fiat)}<span className="text-muted-foreground"> / {money(i.report_commission)}</span>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={i.status}
                      onValueChange={(v) => patch(i, { status: v as AuditStatus })}
                      disabled={savingId === i.id}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={i.note ?? ''}
                      placeholder="Add a note…"
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== (i.note ?? null)) patch(i, { note: v });
                      }}
                      disabled={savingId === i.id}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{i.resolved_date ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
