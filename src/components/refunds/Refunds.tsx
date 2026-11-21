// Refunds — every refund override, with the orphan check surfaced.
//
// Admin-only. The important column is the orphan warning: transaction_refunds
// has no FK to transactions (migration 20260921223823, so an upload deletion
// can never cascade an override away), which means an override CAN end up
// pointing at a transaction that no longer resolves. When that happens it
// silently stops excluding anything and the totals quietly drift back up. This
// page is where that becomes visible.

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Undo2, AlertCircle } from 'lucide-react';
import { fetchRefundOverrides } from '@/lib/refund-overrides-data';
import { auditRefundOverrides, type RefundOverride, type RefundAudit } from '@/lib/refund-overrides';
import { formatCurrency, formatDisplayDate } from '@/lib/format';

const money = (v: number | null | undefined) => formatCurrency(v, 2);

export default function Refunds() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';

  const [overrides, setOverrides] = useState<RefundOverride[]>([]);
  const [audit, setAudit] = useState<RefundAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const rows = await fetchRefundOverrides();
      setOverrides(rows);

      // Resolve each override against its transaction. Chunked by id so the
      // GET stays under the ~8 KB request-line limit that bit the CSV importer
      // (see CsvUploads.tsx) — ids here are 64-char hashes too.
      const ids = rows.map((r) => r.transaction_id).filter(Boolean);
      const found = new Set<string>();
      const CHUNK = 100;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data, error: err } = await supabase
          .from('transactions')
          .select('id')
          .in('id', slice);
        if (err) throw err;
        (data || []).forEach((t: any) => found.add(t.id));
      }

      // Candidate lookup only matters for orphans, and only within the same ATM.
      const orphanAtms = rows
        .filter((r) => !found.has(r.transaction_id))
        .map((r) => r.atm_id)
        .filter(Boolean) as string[];
      let candidatePool: any[] = [];
      if (orphanAtms.length > 0) {
        const { data } = await supabase
          .from('transactions')
          .select('id, atm_id, date, sale, fee')
          .in('atm_id', Array.from(new Set(orphanAtms)));
        candidatePool = data || [];
      }

      setAudit(auditRefundOverrides(rows, found, candidatePool));
    } catch (e) {
      console.error('[refunds] load failed', e);
      setError(e instanceof Error ? e.message : 'Failed to load refunds');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
    else setLoading(false);
  }, [isAdmin]);

  const undo = async (o: RefundOverride) => {
    if (!window.confirm(
      `Remove the refund override for ATM ${o.atm_id} on ${o.tx_date}?\n\n` +
      `The sale (${money(o.sale)}) will start counting in all totals again.`,
    )) return;
    setUndoing(o.id);
    try {
      const { data, error: err } = await supabase
        .from('transaction_refunds')
        .delete()
        .eq('id', o.id)
        .select('id');
      if (err) throw err;
      if (!data || data.length === 0) {
        throw new Error('Nothing was deleted — RLS denied the write, or the row was already gone.');
      }
      await load();
    } catch (e) {
      console.error('[refunds] undo failed', e);
      setError(e instanceof Error ? e.message : 'Failed to remove the override');
    } finally {
      setUndoing(null);
    }
  };

  const totals = useMemo(() => ({
    sale: overrides.reduce((s, o) => s + Number(o.sale ?? 0), 0),
    fee: overrides.reduce((s, o) => s + Number(o.fee ?? 0), 0),
  }), [overrides]);

  const orphanIds = useMemo(
    () => new Set((audit?.orphans ?? []).map((x) => x.override.id)),
    [audit],
  );

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PageHeader title="Refunds" />
        <div className="w-full min-w-0 px-4 py-5 xl:px-6 xl:py-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            Admin access required.
          </CardContent></Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader title="Refunds" />
      <div className="w-full min-w-0 px-4 py-5 xl:px-6 xl:py-6 space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {audit && audit.orphans.length > 0 && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {audit.orphans.length} refund{audit.orphans.length === 1 ? '' : 's'} no longer
              {audit.orphans.length === 1 ? ' matches a' : ' match any'} transaction
            </AlertTitle>
            <AlertDescription>
              {money(audit.orphanedSale)} of sales ({money(audit.orphanedFee)} in fees) has quietly
              started counting again, because these overrides point at a transaction that no longer
              resolves — usually its upload was deleted and not re-imported, or the provider reissued
              the row under a new id. Re-import the CSV, or remove the override and re-mark the
              replacement sale.
            </AlertDescription>
          </Alert>
        )}

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Refund overrides</CardTitle>
            <CardDescription>
              {overrides.length} sale{overrides.length === 1 ? '' : 's'} excluded from all totals —
              {' '}{money(totals.sale)} in sales, {money(totals.fee)} in fees.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground py-6 text-center">Loading…</p>
            ) : overrides.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center">
                No refunds recorded. Mark one from any transactions table.
              </p>
            ) : (
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[14%]">ATM</TableHead>
                    <TableHead className="w-[9%]">Sale date</TableHead>
                    <TableHead className="w-[9%] text-right">Sale</TableHead>
                    <TableHead className="w-[8%] text-right">Fee</TableHead>
                    <TableHead className="w-[9%]">Refunded</TableHead>
                    <TableHead className="w-[15%]">Source</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="w-[13%]">By</TableHead>
                    <TableHead className="w-16">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overrides.map((o) => {
                    const orphan = orphanIds.has(o.id);
                    return (
                      <TableRow key={o.id} className={orphan ? 'bg-amber-500/5' : undefined}>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate" title={o.atm_id ?? undefined}>{o.atm_id ?? '—'}</span>
                            {orphan && (
                              <Badge className="shrink-0 bg-amber-500/15 text-amber-400 border-amber-500/30">
                                orphaned
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{o.tx_date ? formatDisplayDate(o.tx_date) : '—'}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{money(o.sale)}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{money(o.fee)}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDisplayDate(o.refund_date)}</TableCell>
                        <TableCell className="truncate" title={o.source ?? undefined}>{o.source ?? '—'}</TableCell>
                        <TableCell className="truncate" title={o.note ?? undefined}>{o.note ?? '—'}</TableCell>
                        <TableCell className="truncate" title={(o as any).created_by ?? undefined}>{(o as any).created_by ?? '—'}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => undo(o)}
                            disabled={undoing === o.id}
                            title="Remove this override"
                          >
                            <Undo2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
