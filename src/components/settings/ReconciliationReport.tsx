import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ShieldCheck, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import {
  reconcile,
  type ReconResult,
  type ReconFlag,
  type ReconTransaction,
  type ReconProfile,
  type OrphanReason,
} from '@/lib/reconciliation';

type FilterMode = 'actionable' | 'mismatch' | 'before_install' | 'all';

const PAGE_SIZE = 1000;
const MAX_ROWS = 1000; // cap rendered rows; the summary counts are always complete

const ORPHAN_LABEL: Record<OrphanReason, string> = {
  before_first_install: 'before first install',
  gap_or_after_window: 'gap / after window',
  no_profile_for_atm: 'no profile for ATM',
  profiles_have_null_install: 'no dated profile',
};

const fmtMoney = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReconciliationReport() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconResult | null>(null);
  const [filter, setFilter] = useState<FilterMode>('actionable');

  const fetchAllTransactions = async (): Promise<ReconTransaction[]> => {
    const all: ReconTransaction[] = [];
    let from = 0;
    // Paginate past the 1000-row PostgREST cap until a short page is returned.
    for (;;) {
      const { data, error: err } = await supabase
        .from('transactions')
        .select('id, atm_id, date, platform, sale')
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (err) throw err;
      if (!data || data.length === 0) break;
      all.push(...(data as ReconTransaction[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  };

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const { data: profiles, error: pErr } = await supabase
        .from('atm_profiles')
        .select('id, atm_id, installed_date, removed_date, platform, location_name');
      if (pErr) throw pErr;

      const transactions = await fetchAllTransactions();
      setResult(reconcile(transactions, (profiles || []) as ReconProfile[]));
    } catch (e) {
      console.error('Reconciliation failed:', e);
      setError(e instanceof Error ? e.message : 'Reconciliation failed.');
    } finally {
      setRunning(false);
    }
  };

  const visibleFlags = (flags: ReconFlag[]): ReconFlag[] => {
    switch (filter) {
      case 'mismatch':
        return flags.filter((f) => f.kind === 'mismatch');
      case 'before_install':
        return flags.filter((f) => f.orphanReason === 'before_first_install');
      case 'all':
        return flags;
      case 'actionable':
      default:
        return flags.filter(
          (f) => f.kind === 'mismatch' || f.orphanReason === 'gap_or_after_window' ||
            f.orphanReason === 'no_profile_for_atm' || f.orphanReason === 'profiles_have_null_install',
        );
    }
  };

  const c = result?.counts;
  const actionableTotal = c ? c.mismatch + c.orphan_gap_or_after + c.orphan_no_profile : 0;
  const shown = result ? visibleFlags(result.flags) : [];
  const truncated = shown.length > MAX_ROWS;

  return (
    <Card className="bg-card/30 border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Platform Attribution Reconciliation
            </CardTitle>
            <CardDescription>
              Flags transactions whose platform doesn't match the profile window they fall in,
              and transactions outside any profile window (orphans). Read-only safety check —
              run it after any conversion.
            </CardDescription>
          </div>
          <Button onClick={run} disabled={running}>
            {running ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {running ? 'Scanning…' : result ? 'Re-run' : 'Run reconciliation'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{error}</div>
          </div>
        )}

        {!result && !error && (
          <div className="text-center text-muted-foreground py-8">
            Run the reconciliation to scan all transactions against profile windows.
          </div>
        )}

        {result && c && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <Stat label="Scanned" value={result.totalScanned.toLocaleString()} tone="neutral" />
              <Stat label="Mismatches" value={c.mismatch.toLocaleString()} tone={c.mismatch > 0 ? 'bad' : 'good'} />
              <Stat
                label="Orphans · gap/after"
                value={c.orphan_gap_or_after.toLocaleString()}
                tone={c.orphan_gap_or_after > 0 ? 'bad' : 'good'}
              />
              <Stat
                label="Orphans · no profile"
                value={c.orphan_no_profile.toLocaleString()}
                tone={c.orphan_no_profile > 0 ? 'warn' : 'good'}
              />
              <Stat
                label="Orphans · pre-install"
                value={c.orphan_before_install.toLocaleString()}
                tone="muted"
              />
            </div>

            <div
              className={`mb-4 p-3 rounded-md text-sm border ${
                actionableTotal === 0
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-400'
              }`}
            >
              {actionableTotal === 0 ? (
                <>No actionable issues — every transaction is attributed to a matching-platform profile.
                  {c.orphan_before_install > 0 && (
                    <> ({c.orphan_before_install.toLocaleString()} pre-install orphans are pre-existing
                      legacy data, not a conversion problem.)</>
                  )}
                </>
              ) : (
                <>{actionableTotal.toLocaleString()} actionable issue(s) found — review the rows below.</>
              )}
            </div>

            {/* Filter */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm text-muted-foreground">Show:</span>
              <div className="w-64">
                <Select value={filter} onValueChange={(v) => setFilter(v as FilterMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="actionable">Actionable (mismatch + gap + no-profile)</SelectItem>
                    <SelectItem value="mismatch">Mismatches only</SelectItem>
                    <SelectItem value="before_install">Pre-install orphans (legacy)</SelectItem>
                    <SelectItem value="all">Everything</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <span className="text-sm text-muted-foreground">
                {shown.length.toLocaleString()} row{shown.length !== 1 ? 's' : ''}
                {truncated ? ` (showing first ${MAX_ROWS.toLocaleString()})` : ''}
              </span>
            </div>

            {shown.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No rows for this filter.
              </div>
            ) : (
              <div className="rounded-md border border-white/10 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ATM</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Tx Date</TableHead>
                      <TableHead>Tx Platform</TableHead>
                      <TableHead>Matched Profile</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.slice(0, MAX_ROWS).map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono">{f.atm_id}</TableCell>
                        <TableCell>{f.location || '—'}</TableCell>
                        <TableCell>{f.date}</TableCell>
                        <TableCell className="capitalize">{f.txPlatform || '—'}</TableCell>
                        <TableCell>
                          {f.kind === 'mismatch' ? (
                            <span className="text-red-400 capitalize">{f.profilePlatform}</span>
                          ) : (
                            <span className="text-muted-foreground">
                              no match{f.orphanReason ? ` · ${ORPHAN_LABEL[f.orphanReason]}` : ''}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">${fmtMoney(f.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'good' | 'bad' | 'warn' | 'muted' | 'neutral';
}) {
  const color =
    tone === 'bad'
      ? 'text-red-500'
      : tone === 'warn'
      ? 'text-yellow-500'
      : tone === 'good'
      ? 'text-green-500'
      : tone === 'muted'
      ? 'text-muted-foreground'
      : 'text-foreground';
  return (
    <div className="text-center p-3 rounded-lg bg-slate-700/30 border border-slate-600/20">
      <div className="text-xs font-semibold text-muted-foreground mb-1">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}
