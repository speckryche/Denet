import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { AlertCircle, Loader2 } from 'lucide-react';

interface PersonContext {
  id: string;
  name: string;
  currentBalance: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  person: PersonContext | null;
}

const todayLocalISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatMoney = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AdjustBalanceModal({ open, onOpenChange, onSuccess, person }: Props) {
  const { toast } = useToast();

  const [targetTotal, setTargetTotal] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>(todayLocalISO());
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTargetTotal('');
      setReason('');
      setEffectiveDate(todayLocalISO());
      setSubmitting(false);
      setErrorMsg(null);
    }
  }, [open, person?.id]);

  const parsedTarget = useMemo(() => {
    if (targetTotal.trim() === '') return null;
    const n = parseFloat(targetTotal);
    return Number.isFinite(n) ? n : null;
  }, [targetTotal]);

  const delta = useMemo(() => {
    if (parsedTarget === null || !person) return null;
    return Math.round((parsedTarget - person.currentBalance) * 100) / 100;
  }, [parsedTarget, person]);

  const canSubmit =
    !!person &&
    parsedTarget !== null &&
    reason.trim().length > 0 &&
    effectiveDate.length > 0 &&
    delta !== null &&
    Math.abs(delta) >= 0.005 &&
    !submitting;

  const handleSubmit = async () => {
    if (!person || parsedTarget === null) return;
    setSubmitting(true);
    setErrorMsg(null);

    const { error } = await supabase.rpc('apply_target_adjustment', {
      p_person_id: person.id,
      p_target_total: parsedTarget,
      p_reason: reason.trim(),
      p_effective_date: effectiveDate,
    });

    if (error) {
      setErrorMsg(error.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onOpenChange(false);
    toast({
      title: 'Balance adjusted',
      description: `${person.name} — new target $${formatMoney(parsedTarget)}.`,
    });
    onSuccess();
  };

  if (!person) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Adjust Balance — {person.name}</DialogTitle>
          <DialogDescription>
            Record a manual correction when tracked cash on hand diverges from physical cash.
            An audit history row is written automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current balance context */}
          <div className="rounded-md border border-white/10 bg-secondary/10 p-3">
            <div className="text-xs text-muted-foreground">Current tracked balance</div>
            <div className="text-2xl font-bold font-mono">
              ${formatMoney(person.currentBalance)}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="target_total">New target total</Label>
              <Input
                id="target_total"
                type="number"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={targetTotal}
                onChange={(e) => setTargetTotal(e.target.value)}
                className="font-mono"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="effective_date">Effective date</Label>
              <Input
                id="effective_date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
              />
            </div>
          </div>

          {/* Live delta preview */}
          {delta !== null && (
            <div
              className={`rounded-md border p-3 text-sm ${
                Math.abs(delta) < 0.005
                  ? 'border-white/10 bg-secondary/10 text-muted-foreground'
                  : delta > 0
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
              }`}
            >
              {Math.abs(delta) < 0.005 ? (
                <>Target equals current balance — no adjustment will be recorded.</>
              ) : (
                <>
                  This records a{' '}
                  <span className="font-mono font-bold">
                    {delta > 0 ? '+' : '−'}${formatMoney(Math.abs(delta))}
                  </span>{' '}
                  adjustment.
                </>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Physical count short by $50 — investigated, attributed to ATM XYZ."
              rows={3}
            />
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>{errorMsg}</div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Apply Adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
