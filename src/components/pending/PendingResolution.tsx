import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useToast } from '@/components/ui/use-toast';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { cn, ageInDays } from '@/lib/utils';
import {
  RESOLVED_UNCOUNTED_STATUSES,
  TRACKED_STATUSES,
  isPending,
  formatStatusLabel,
  type TxStatus,
} from '@/lib/transaction-status';
import {
  resolveTransactionStatus,
  type ResolveClient,
  type ResolveResult,
} from './resolve-transaction';
import { PendingTransactionsTable } from './PendingTransactionsTable';
import { ResolveStatusDialog, type ResolveIntent } from './ResolveStatusDialog';
import { RecheckPanel } from './RecheckPanel';
import { notifyPendingCountChanged } from './pending-count';
import { STALE_AFTER_DAYS, type PendingRow } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// PENDING RESOLUTION TRACKER
//
// Why this page exists: CSV pulls are forward-only. A transaction imported at a
// non-final status (frozen / sending / under_review) is never re-included by a
// later pull, so it sits at that status forever and its sale silently stays out
// of every financial total. Found by hand on ATM 3997 (June 2026, under_review,
// 43 days stale). This page is the systematic catch.
//
// Grouping reads the `resolution` axis in transaction-status.ts and nothing
// else — see the comment there on why it must not key off financial/ctr.
// ─────────────────────────────────────────────────────────────────────────────

export default function PendingResolution() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [intent, setIntent] = useState<ResolveIntent | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const { toast } = useToast();

  const fetchRows = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      // Volume is single digits, so one unpaginated query across both platforms
      // is right. TRACKED_STATUSES is derived from the config — never a literal
      // status list, and never `.neq('status','completed')`, so a status added
      // later cannot silently escape the tracker.
      const { data, error } = await supabase
        .from('transactions')
        .select('id, date, created_at, status, platform, atm_id, atm_name, sale')
        .in('status', TRACKED_STATUSES)
        .order('date', { ascending: true });

      if (error) throw error;
      setRows((data ?? []) as PendingRow[]);
    } catch (err) {
      console.error('Error fetching pending transactions:', err);
      setLoadError(err instanceof Error ? err.message : 'Failed to load pending transactions.');
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  // Oldest first — the most stale row is the one that needs chasing first.
  // Rows with an unparseable date sort last rather than being dropped.
  const sortByDateAsc = (a: PendingRow, b: PendingRow) =>
    String(a.date ?? '9999').localeCompare(String(b.date ?? '9999'));

  const actionableRows = useMemo(
    () => rows.filter((r) => isPending(r.status)).sort(sortByDateAsc),
    [rows],
  );
  // Terminal = settled AND uncounted (refunded / expired). NOT `isFinal`, which
  // also matches 'completed' — a row just marked Completed would otherwise
  // reappear under "Already Resolved" instead of leaving the page.
  const terminalRows = useMemo(
    () =>
      rows
        .filter((r) => RESOLVED_UNCOUNTED_STATUSES.includes(r.status as TxStatus))
        .sort(sortByDateAsc),
    [rows],
  );

  const staleCount = actionableRows.filter((r) => {
    const age = ageInDays(r.date);
    return age !== null && age >= STALE_AFTER_DAYS;
  }).length;

  const pendingTotal = actionableRows.reduce((sum, r) => sum + (r.sale ?? 0), 0);

  const handleResolve = async () => {
    if (!intent) return;
    const { row, target } = intent;

    setSubmitting(true);
    setWriteError(null);

    // Diagnostic: the exact row this write targets, logged before the request
    // leaves the browser. Pair it with the [capture] line logged at click time —
    // the two ids must match, and both must match the row you clicked.
    console.info('[pending-resolution] write →', {
      id: row.id,
      from: row.status,
      to: target,
      atm: row.atm_id,
      date: row.date,
      sale: row.sale,
    });

    // The supabase client satisfies ResolveClient structurally, but its builder
    // types are generic over the schema; cast at the boundary so the helper
    // keeps a narrow, testable surface.
    const result: ResolveResult = await resolveTransactionStatus(
      supabase as unknown as ResolveClient,
      row,
      target,
    );

    setSubmitting(false);
    setIntent(null);

    if (!result.ok) {
      console.error('[pending-resolution] write FAILED', result.kind, result.message);
      setWriteError(result.message);
      toast({
        variant: 'destructive',
        title:
          result.kind === 'identity-mismatch'
            ? 'Targeting error — verify data'
            : result.kind === 'no-match'
              ? 'Update did not apply'
              : 'Update failed',
        description:
          result.kind === 'no-match'
            ? 'The write affected zero rows — nothing changed. See the page for details.'
            : result.message,
      });
      return;
    }

    const applied = result.applied!;
    console.info('[pending-resolution] write OK ←', applied);

    // Re-sync from the database rather than patching local state: what you see
    // is then what the DB actually holds, and a row that reached a counted
    // status drops off the page entirely.
    await fetchRows();
    notifyPendingCountChanged();
    toast({
      title: `Marked ${formatStatusLabel(applied.status)}`,
      description: `${row.atm_id} — $${Math.round(row.sale ?? 0).toLocaleString('en-US')} on ${
        row.date?.slice(0, 10) ?? 'unknown date'
      }.`,
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader title="Pending Resolution" />

      <div className="max-w-[95%] mx-auto px-6 py-8 space-y-6">
        {/* Load failure — never render an empty list as "all clear". */}
        {loadError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {loadError}
          </div>
        )}

        {/* Write failure, including the zero-rows-affected case. Sticks around
            until the next attempt — a failed money write should not vanish
            with a toast. */}
        {writeError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">{writeError}</div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs shrink-0"
              onClick={() => setWriteError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-card/30 border-white/10">
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">Awaiting resolution</div>
              <div className="text-2xl font-bold">{actionableRows.length}</div>
            </CardContent>
          </Card>
          <Card className={cn('bg-card/30 border-white/10', staleCount > 0 && 'border-red-500/30')}>
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">
                Stale (&ge; {STALE_AFTER_DAYS} days)
              </div>
              <div className={cn('text-2xl font-bold', staleCount > 0 && 'text-red-400')}>
                {staleCount}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card/30 border-white/10">
            <CardContent className="pt-6">
              <div className="text-xs text-muted-foreground mb-1">
                Cash held up (not in totals)
              </div>
              <div className="text-2xl font-bold font-mono">
                ${Math.round(pendingTotal).toLocaleString('en-US')}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── ACTIONABLE ── */}
        <Card className="bg-card/30 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock className="w-4 h-4 text-primary" />
              Awaiting Resolution
              <span className="text-sm font-normal text-muted-foreground">
                ({actionableRows.length})
              </span>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={fetchRows} disabled={isLoading}>
              <RefreshCw className={cn('w-4 h-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {!isLoading && actionableRows.length === 0 && !loadError ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400/70 mb-3" />
                <p className="font-medium">No transactions pending resolution</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Every transaction has reached a final status. Nothing to chase.
                </p>
              </div>
            ) : (
              <PendingTransactionsTable
                rows={actionableRows}
                showActions
                onResolve={(row, target: TxStatus) => {
                  // Diagnostic: which row this click captured, before any write.
                  // Cancelling the dialog still leaves this line in the console,
                  // so the binding can be checked without touching data.
                  console.info('[pending-resolution] capture ←', {
                    id: row.id,
                    status: row.status,
                    atm: row.atm_id,
                    date: row.date,
                    sale: row.sale,
                    target,
                  });
                  setWriteError(null);
                  setIntent({ row, target });
                }}
                emptyMessage="No transactions pending resolution"
                isLoading={isLoading}
              />
            )}
          </CardContent>
        </Card>

        {/* ── AUTO PATH ── */}
        <RecheckPanel actionableRows={actionableRows} />

        {/* ── TERMINAL (informational) ── */}
        <Collapsible open={terminalOpen} onOpenChange={setTerminalOpen}>
          <Card className="bg-card/20 border-white/10">
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer hover:bg-white/[0.02] transition-colors">
                <CardTitle className="flex items-center gap-2 text-base text-muted-foreground font-normal">
                  <ChevronDown
                    className={cn(
                      'w-4 h-4 transition-transform',
                      !terminalOpen && '-rotate-90',
                    )}
                  />
                  Already Resolved
                  <span className="text-sm">({terminalRows.length})</span>
                  <span className="text-xs ml-2">
                    refunded / expired — informational, no action needed
                  </span>
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <PendingTransactionsTable
                  rows={terminalRows}
                  showActions={false}
                  emptyMessage="No resolved-but-uncounted transactions"
                  isLoading={isLoading}
                />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </div>

      <ResolveStatusDialog
        intent={intent}
        submitting={submitting}
        onCancel={() => setIntent(null)}
        onConfirm={handleResolve}
      />
    </div>
  );
}
