import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowRightLeft, Loader2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';

interface DenetMachine {
  profile_id: string;
  atm_id: string;
  location_name: string | null;
  installed_date: string | null;
  monthly_rent: number;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  last_denet_tx: string | null; // YYYY-MM-DD
}

interface ConvResult {
  atm_id: string;
  location: string | null;
  ok: boolean;
  message?: string;
}

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isoMinusOneDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const fmtMoney = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BulkPlatformConversion() {
  const [machines, setMachines] = useState<DenetMachine[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cutover, setCutover] = useState<string>(todayIso());
  const [step, setStep] = useState<'select' | 'preview'>('select');

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ConvResult[] | null>(null);

  useEffect(() => {
    fetchMachines();
  }, []);

  const fetchMachines = async () => {
    setLoading(true);
    setLoadError(null);
    setResults(null);
    setSelected(new Set());
    setStep('select');
    try {
      const { data: profiles, error } = await supabase
        .from('atm_profiles')
        .select('id, atm_id, location_name, installed_date, monthly_rent, street_address, city, state, zip_code')
        .eq('active', true)
        .eq('platform', 'denet')
        .order('location_name');
      if (error) throw error;

      // Last Denet tx per machine — one tiny query each, run in parallel.
      const rows = profiles || [];
      const lastDates = await Promise.all(
        rows.map(async (p: any) => {
          if (!p.atm_id) return null;
          const { data } = await supabase
            .from('transactions')
            .select('date')
            .eq('atm_id', p.atm_id)
            .eq('platform', 'denet')
            .order('date', { ascending: false })
            .limit(1);
          const raw = data?.[0]?.date as string | undefined;
          return raw ? String(raw).split('T')[0] : null;
        }),
      );

      setMachines(
        rows.map((p: any, i: number) => ({
          profile_id: p.id,
          atm_id: p.atm_id,
          location_name: p.location_name,
          installed_date: p.installed_date,
          monthly_rent: Number(p.monthly_rent ?? 0) || 0,
          street_address: p.street_address,
          city: p.city,
          state: p.state,
          zip_code: p.zip_code,
          last_denet_tx: lastDates[i],
        })),
      );
    } catch (e) {
      console.error('Failed to load Denet machines:', e);
      setLoadError(e instanceof Error ? e.message : 'Failed to load machines.');
    } finally {
      setLoading(false);
    }
  };

  const toggle = (atmId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(atmId)) next.delete(atmId);
      else next.add(atmId);
      return next;
    });
  };

  const cutoverValid = /^\d{4}-\d{2}-\d{2}$/.test(cutover);
  const selectedMachines = useMemo(
    () => machines.filter((m) => selected.has(m.atm_id)),
    [machines, selected],
  );

  const handleConfirm = async () => {
    setRunning(true);
    setResults(null);
    const out: ConvResult[] = [];
    for (const m of selectedMachines) {
      const { error } = await supabase.rpc('update_atm_state', {
        p_atm_id: m.atm_id,
        p_effective_date: cutover,
        p_action: 'convert',
        p_platform: 'bitstop',
      });
      out.push(
        error
          ? { atm_id: m.atm_id, location: m.location_name, ok: false, message: error.message }
          : { atm_id: m.atm_id, location: m.location_name, ok: true },
      );
    }
    setRunning(false);
    // Refresh the list so converted machines drop off (active Denet only), then
    // restore the results banner (fetchMachines clears it) so the summary stays.
    await fetchMachines();
    setResults(out);
  };

  const failures = results?.filter((r) => !r.ok) ?? [];
  const successes = results?.filter((r) => r.ok) ?? [];

  return (
    <Card className="bg-card/30 border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-primary" />
              Bulk Platform Conversion (Denet → Bitstop)
            </CardTitle>
            <CardDescription>
              Convert active Denet machines to Bitstop on a single cutover date, without waiting
              for a CSV sale. Each machine is converted via the update_atm_state RPC — atomic,
              with rent and address carried forward.
            </CardDescription>
          </div>
          <Button variant="outline" onClick={fetchMachines} disabled={loading || running}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loadError && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm text-red-400">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{loadError}</div>
          </div>
        )}

        {/* Results banner (after a run) */}
        {results && (
          <div
            className={`mb-4 p-3 rounded-md text-sm border ${
              failures.length === 0
                ? 'border-green-500/30 bg-green-500/10 text-green-400'
                : 'border-red-500/30 bg-red-500/10 text-red-400'
            }`}
          >
            {failures.length === 0 ? (
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  Converted {successes.length} machine(s). <strong>Next step:</strong> run the
                  Platform Attribution Reconciliation report below and confirm 0 mismatches /
                  0 gap orphans.
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  {failures.length} of {results.length} conversion(s) failed. Succeeded machines
                  are converted; failed ones are untouched (RPC is atomic per machine). Detail:
                  <ul className="list-disc ml-5 mt-1">
                    {failures.map((f) => (
                      <li key={f.atm_id}>
                        {f.location || f.atm_id} ({f.atm_id}): {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-center text-muted-foreground py-8">Loading active Denet machines…</div>
        ) : step === 'select' ? (
          <>
            {/* Cutover date */}
            <div className="flex items-end gap-4 mb-4">
              <div className="w-56">
                <Label htmlFor="cutover">Batch cutover date</Label>
                <Input
                  id="cutover"
                  type="date"
                  value={cutover}
                  onChange={(e) => setCutover(e.target.value)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  New Bitstop profiles installed on this date; old Denet profiles closed the day before.
                </p>
              </div>
              <Button
                onClick={() => setStep('preview')}
                disabled={selected.size === 0 || !cutoverValid}
              >
                Preview {selected.size} selected →
              </Button>
            </div>

            {machines.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No active Denet machines.
              </div>
            ) : (
              <div className="rounded-md border border-white/10 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10"></TableHead>
                      <TableHead>ATM</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Last Denet tx</TableHead>
                      <TableHead className="text-right">Rent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {machines.map((m) => (
                      <TableRow key={m.atm_id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selected.has(m.atm_id)}
                            onChange={() => toggle(m.atm_id)}
                          />
                        </TableCell>
                        <TableCell className="font-mono">{m.atm_id}</TableCell>
                        <TableCell>{m.location_name || '—'}</TableCell>
                        <TableCell
                          className={
                            m.last_denet_tx && cutoverValid && m.last_denet_tx >= cutover
                              ? 'text-yellow-500'
                              : ''
                          }
                        >
                          {m.last_denet_tx || '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono">${fmtMoney(m.monthly_rent)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        ) : (
          /* Preview step */
          <>
            <div className="mb-4 text-sm">
              Converting <strong>{selectedMachines.length}</strong> machine(s) to{' '}
              <span className="capitalize">Bitstop</span> with cutover{' '}
              <span className="font-mono">{cutover}</span>. Each old Denet profile closes on{' '}
              <span className="font-mono">{isoMinusOneDay(cutover)}</span>; each new Bitstop profile
              installs on <span className="font-mono">{cutover}</span>. Rent and address carry forward.
            </div>

            <div className="rounded-md border border-white/10 overflow-hidden mb-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ATM</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Denet close</TableHead>
                    <TableHead>Bitstop install</TableHead>
                    <TableHead className="text-right">Rent (carry)</TableHead>
                    <TableHead>Address (carry)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedMachines.map((m) => {
                    const warn = !!m.last_denet_tx && m.last_denet_tx >= cutover;
                    return (
                      <TableRow key={m.atm_id}>
                        <TableCell className="font-mono">{m.atm_id}</TableCell>
                        <TableCell>
                          {m.location_name || '—'}
                          {warn && (
                            <span className="ml-2 text-xs text-yellow-500">
                              ⚠ Denet tx on/after cutover ({m.last_denet_tx})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono">{isoMinusOneDay(cutover)}</TableCell>
                        <TableCell className="font-mono">{cutover}</TableCell>
                        <TableCell className="text-right font-mono">${fmtMoney(m.monthly_rent)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {[m.street_address, m.city, m.state, m.zip_code].filter(Boolean).join(', ') || '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep('select')} disabled={running}>
                ← Back
              </Button>
              <Button onClick={handleConfirm} disabled={running}>
                {running && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Confirm & convert {selectedMachines.length}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
