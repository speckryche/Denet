// "Mark as refunded" — an admin-only, undoable override on a single sale.
//
// Never fires straight off a button click: marking a sale refunded removes it
// from every financial total in the app, so it goes through this confirmation
// with the amounts shown, following the ResolveStatusDialog precedent.

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';

export interface RefundTarget {
  id: string;
  atm_id: string | null;
  date: string | null;
  sale: number | null;
  fee: number | null;
  platform: string | null;
  atm_name?: string | null;
}

interface Props {
  target: RefundTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

const money = (v: number | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MarkRefundedDialog({ target, open, onOpenChange, onDone }: Props) {
  const { user } = useAuth();
  const [refundDate, setRefundDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      // The denormalized snapshot is what keeps an override readable if its
      // transaction ever stops resolving (there is no FK — see migration
      // 20260921223823). It is never used for totals.
      const { data, error: err } = await supabase
        .from('transaction_refunds')
        .upsert(
          {
            transaction_id: target.id,
            refund_date: refundDate,
            source: source.trim() || null,
            note: note.trim() || null,
            atm_id: target.atm_id,
            tx_date: target.date,
            sale: target.sale,
            fee: target.fee,
            platform: target.platform,
            created_by: user?.email ?? null,
          },
          { onConflict: 'transaction_id' },
        )
        .select('id');
      if (err) throw err;
      if (!data || data.length === 0) {
        throw new Error('No row was written — RLS denied the write, or the upsert matched nothing.');
      }
      onOpenChange(false);
      setSource('');
      setNote('');
      onDone();
    } catch (e) {
      console.error('[refunds] mark failed', e);
      setError(e instanceof Error ? e.message : 'Failed to mark as refunded');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>Mark sale as refunded</DialogTitle>
          <DialogDescription>
            This removes the sale from every sales, fee and commission total in the app.
            Already-paid periods are not reopened — the correction flows forward. Undo any time
            from the Refunds list.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="rounded-md border border-border p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">ATM</span>
              <span>{target.atm_id}{target.atm_name ? ` — ${target.atm_name}` : ''}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span>{target.date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sale</span>
              <span className="font-medium">{money(target.sale)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fee (our revenue)</span>
              <span className="font-medium">{money(target.fee)}</span>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="refund-date">Refund date</Label>
            <Input id="refund-date" type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="refund-source">Source</Label>
            <Input
              id="refund-source"
              placeholder="e.g. Bitstop notice 9/16"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="refund-note">Note</Label>
            <Textarea id="refund-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !refundDate}>
            {busy ? 'Marking…' : 'Mark as refunded'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
