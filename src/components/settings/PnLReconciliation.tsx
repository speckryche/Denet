import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ShieldCheck, AlertTriangle, Loader2, RefreshCw, CheckCircle2 } from 'lucide-react';
import {
  fetchPnLInputs,
  computeMonthlyPnLFromInputs,
  type Platform,
  type MonthlyPnLCell,
} from '@/lib/pnl';
import { computeReferenceRows, type ReferenceRow } from '@/lib/pnl-reference';

const TOL = 0.005;
const LINE_ITEMS = [
  'total_sales',
  'total_fees',
  'bitstop_fees',
  'rent',
  'mgmt_rps',
  'mgmt_rep',
  'commissions',
  'net_profit',
] as const;
type LineItem = (typeof LINE_ITEMS)[number];

interface CaseDef {
  label: string;
  fromMonth: string;
  toMonth: string;
  platform: Platform;
}

const CASES: CaseDef[] = [
  { label: '2026-01..2026-06 · both', fromMonth: '2026-01', toMonth: '2026-06', platform: 'both' },
  { label: '2026-01..2026-06 · denet', fromMonth: '2026-01', toMonth: '2026-06', platform: 'denet' },
  { label: '2026-01..2026-06 · bitstop', fromMonth: '2026-01', toMonth: '2026-06', platform: 'bitstop' },
  { label: '2026-01..2026-07 · both (spans conversion month)', fromMonth: '2026-01', toMonth: '2026-07', platform: 'both' },
  { label: '2025-10..2025-12 · both (non-zero commissions)', fromMonth: '2025-10', toMonth: '2025-12', platform: 'both' },
  { label: '2025-10..2025-12 · bitstop (non-zero commissions)', fromMonth: '2025-10', toMonth: '2025-12', platform: 'bitstop' },
];

interface CaseResult {
  label: string;
  pass: boolean;
  engineProfiles: number;
  refProfiles: number;
  cells: number;
  fleetEngineNet: number;
  fleetRefNet: number;
  profileMismatches: string[];
  fleetDiffs: string[];
}

function sumEngineByProfile(cells: MonthlyPnLCell[]) {
  const m = new Map<string, any>();
  for (const c of cells) {
    let a = m.get(c.profile_id);
    if (!a) {
      a = { profile_id: c.profile_id, atm_id: c.atm_id, platform: c.platform };
      for (const k of LINE_ITEMS) a[k] = 0;
      m.set(c.profile_id, a);
    }
    for (const k of LINE_ITEMS) a[k] += (c as any)[k];
  }
  return m;
}

export function PnLReconciliation() {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CaseResult[] | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const out: CaseResult[] = [];
      for (const c of CASES) {
        const inputs = await fetchPnLInputs(c.fromMonth, c.toMonth);
        const engine = computeMonthlyPnLFromInputs(inputs, { platform: c.platform });
        const refRows = computeReferenceRows(inputs, { platform: c.platform });

        const engineByProfile = sumEngineByProfile(engine.cells);
        const refByProfile = new Map<string, ReferenceRow>(refRows.map((r) => [r.profile_id, r]));
        const allIds = new Set<string>([...engineByProfile.keys(), ...refByProfile.keys()]);

        const profileMismatches: string[] = [];
        for (const id of allIds) {
          const e = engineByProfile.get(id);
          const r = refByProfile.get(id);
          if (!e) {
            profileMismatches.push(`${(r as ReferenceRow).atm_id}: in reference, engine produced no cells`);
            continue;
          }
          if (!r) {
            profileMismatches.push(`${e.atm_id}: engine produced cells, not in reference`);
            continue;
          }
          const diffs: string[] = [];
          for (const k of LINE_ITEMS) {
            const d = e[k] - (r as any)[k];
            if (Math.abs(d) > TOL) diffs.push(`${k} Δ=${d.toFixed(2)} (engine ${e[k].toFixed(2)} / ref ${(r as any)[k].toFixed(2)})`);
          }
          if (diffs.length) profileMismatches.push(`${e.atm_id} (${e.platform}): ${diffs.join('; ')}`);
        }

        const fleetE: Record<LineItem, number> = {} as any;
        const fleetR: Record<LineItem, number> = {} as any;
        for (const k of LINE_ITEMS) {
          fleetE[k] = engine.cells.reduce((s, c2) => s + (c2 as any)[k], 0);
          fleetR[k] = refRows.reduce((s, r2) => s + (r2 as any)[k], 0);
        }
        const fleetDiffs = LINE_ITEMS.filter((k) => Math.abs(fleetE[k] - fleetR[k]) > TOL).map(
          (k) => `${k}: engine ${fleetE[k].toFixed(2)} / ref ${fleetR[k].toFixed(2)}`,
        );

        out.push({
          label: c.label,
          pass: profileMismatches.length === 0 && fleetDiffs.length === 0,
          engineProfiles: engineByProfile.size,
          refProfiles: refByProfile.size,
          cells: engine.cells.length,
          fleetEngineNet: fleetE.net_profit,
          fleetRefNet: fleetR.net_profit,
          profileMismatches,
          fleetDiffs,
        });
      }
      setResults(out);
    } catch (e) {
      console.error('P&L reconciliation error:', e);
      setError(e instanceof Error ? e.message : 'Reconciliation failed.');
    } finally {
      setRunning(false);
    }
  };

  const allPass = results !== null && results.every((r) => r.pass);

  return (
    <Card className="bg-card/30 border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" />
              Monthly P&amp;L Engine Reconciliation
            </CardTitle>
            <CardDescription>
              Verifies the shared monthly P&amp;L engine reproduces the existing ATM P&amp;L report
              exactly: each profile's monthly cells summed over the range must equal the reference
              row, per line item, within $0.005. Read-only. Temporary (Stage-1 harness).
            </CardDescription>
          </div>
          <Button onClick={run} disabled={running}>
            {running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {running ? 'Reconciling…' : results ? 'Re-run' : 'Run reconciliation'}
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

        {!results && !error && (
          <div className="text-center text-muted-foreground py-8">
            Run to compare the monthly engine against the existing ATM P&amp;L across 4 cases.
          </div>
        )}

        {results && (
          <>
            <div
              className={`mb-4 p-3 rounded-md text-sm border flex items-start gap-2 ${
                allPass
                  ? 'border-green-500/30 bg-green-500/10 text-green-400'
                  : 'border-red-500/30 bg-red-500/10 text-red-400'
              }`}
            >
              {allPass ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
              <div>
                {allPass
                  ? 'PASS — every profile and fleet total reconciles within $0.005 across all cases. Cleared to build the reports.'
                  : 'FAIL — mismatches found. Do not proceed to the report UI; fix the engine first.'}
              </div>
            </div>

            <div className="space-y-3">
              {results.map((r) => (
                <div key={r.label} className="rounded-md border border-white/10 overflow-hidden">
                  <div className="flex items-center justify-between p-3 bg-slate-700/40">
                    <div className="flex items-center gap-2">
                      {r.pass ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                      )}
                      <span className="font-medium">{r.label}</span>
                    </div>
                    <span className={`text-sm font-semibold ${r.pass ? 'text-green-400' : 'text-red-400'}`}>
                      {r.pass ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                  <div className="p-3 text-sm text-muted-foreground space-y-1">
                    <div>
                      profiles: engine {r.engineProfiles} / reference {r.refProfiles} · cells {r.cells} · fleet net:
                      engine ${Math.round(r.fleetEngineNet).toLocaleString()} / reference ${Math.round(r.fleetRefNet).toLocaleString()}
                    </div>
                    {!r.pass && (
                      <div className="mt-2 text-red-400 space-y-1">
                        {r.fleetDiffs.map((d, i) => (
                          <div key={`f${i}`}>fleet · {d}</div>
                        ))}
                        {r.profileMismatches.slice(0, 25).map((m, i) => (
                          <div key={`p${i}`}>profile · {m}</div>
                        ))}
                        {r.profileMismatches.length > 25 && (
                          <div>…and {r.profileMismatches.length - 25} more</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
