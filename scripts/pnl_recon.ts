// Headless reconciliation: runs the real pnl.ts engine + the parity reference
// against production for several (range, platform) cases and prints PASS/FAIL
// with per-line-item diffs. Bundled via esbuild (import.meta.env injected) and
// run with node. Temporary — part of the Stage-1 harness.

import { readFileSync } from 'node:fs';
import {
  assemblePnLInputs,
  fetchTransactionsInRange,
  computeMonthlyPnLFromInputs,
  type Platform,
} from '../src/lib/pnl';
import { computeReferenceRows } from '../src/lib/pnl-reference';

// atm_profiles + commission_details are authenticated-only (anon RLS blocks
// them headlessly), so inject them from a fixture dumped via privileged access.
// transactions are anon-readable and fetched live. The reconciliation compares
// engine vs reference on the SAME inputs, so it's valid regardless of fixture
// vs production drift.
const FIX = JSON.parse(readFileSync('/tmp/pnl_fixtures.json', 'utf8'));

// Range-scope commissions/overrides exactly like the real fetch (which queries
// only the range's months). extraCommissions lets the double-count probe inject
// a synthetic commission.
async function inputsFor(
  fromMonth: string,
  toMonth: string,
  extraCommissions: Array<{ atm_id: string; commission_amount: number; month_year: string }> = [],
) {
  const allTransactions = await fetchTransactionsInRange(fromMonth, toMonth);
  const inRange = (ym: string) => ym >= fromMonth && ym <= toMonth;
  const commissionDetails = [...FIX.commissionDetails, ...extraCommissions].filter((d: any) =>
    inRange(String(d.month_year).slice(0, 7)),
  );
  const feeOverrides = FIX.feeOverrides.filter((o: any) => inRange(o.year_month));
  return assemblePnLInputs({
    atmProfiles: FIX.atmProfiles,
    allTransactions,
    commissionDetails,
    feeOverrides,
    fromMonth,
    toMonth,
  });
}

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

type Case = { label: string; fromMonth: string; toMonth: string; platform: Platform };

const CASES: Case[] = [
  { label: '2026-01..2026-06 · both', fromMonth: '2026-01', toMonth: '2026-06', platform: 'both' },
  { label: '2026-01..2026-06 · denet', fromMonth: '2026-01', toMonth: '2026-06', platform: 'denet' },
  { label: '2026-01..2026-06 · bitstop', fromMonth: '2026-01', toMonth: '2026-06', platform: 'bitstop' },
  { label: '2026-01..2026-07 · both (spans conversion month)', fromMonth: '2026-01', toMonth: '2026-07', platform: 'both' },
  { label: '2025-10..2025-12 · both (NON-ZERO commissions)', fromMonth: '2025-10', toMonth: '2025-12', platform: 'both' },
  { label: '2025-10..2025-12 · bitstop (NON-ZERO commissions)', fromMonth: '2025-10', toMonth: '2025-12', platform: 'bitstop' },
];

function sumEngineByProfile(cells: ReturnType<typeof computeMonthlyPnLFromInputs>['cells']) {
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

async function main() {
  let anyFail = false;

  for (const c of CASES) {
    const inputs = await inputsFor(c.fromMonth, c.toMonth);
    const engine = computeMonthlyPnLFromInputs(inputs, { platform: c.platform });
    const refRows = computeReferenceRows(inputs, { platform: c.platform });

    const engineByProfile = sumEngineByProfile(engine.cells);
    const refByProfile = new Map(refRows.map((r) => [r.profile_id, r]));

    const allIds = new Set<string>([...engineByProfile.keys(), ...refByProfile.keys()]);
    const mismatches: string[] = [];

    for (const id of allIds) {
      const e = engineByProfile.get(id);
      const r = refByProfile.get(id);
      if (!e) {
        mismatches.push(`  profile ${id} (${r.atm_id}): in REFERENCE but engine produced NO cells`);
        continue;
      }
      if (!r) {
        mismatches.push(`  profile ${id} (${e.atm_id}): engine produced cells but NOT in reference`);
        continue;
      }
      const diffs: string[] = [];
      for (const k of LINE_ITEMS) {
        const d = e[k] - (r as any)[k];
        if (Math.abs(d) > TOL) diffs.push(`${k}: engine=${e[k].toFixed(2)} ref=${(r as any)[k].toFixed(2)} Δ=${d.toFixed(2)}`);
      }
      if (diffs.length) mismatches.push(`  profile ${id} (${e.atm_id}, ${e.platform}): ${diffs.join(' | ')}`);
    }

    // Fleet-level check.
    const fleetE: any = {};
    const fleetR: any = {};
    for (const k of LINE_ITEMS) {
      fleetE[k] = engine.cells.reduce((s, c2) => s + (c2 as any)[k], 0);
      fleetR[k] = refRows.reduce((s, r2) => s + (r2 as any)[k], 0);
    }
    const fleetDiffs = LINE_ITEMS.filter((k) => Math.abs(fleetE[k] - fleetR[k]) > TOL);

    const pass = mismatches.length === 0 && fleetDiffs.length === 0;
    if (!pass) anyFail = true;

    console.log(`\n=== ${c.label} ===`);
    console.log(`profiles: engine=${engineByProfile.size} reference=${refByProfile.size} | cells=${engine.cells.length} | months=${engine.months.length} | partialMonth=${engine.partialMonth}`);
    console.log(
      `fleet net: engine=$${Math.round(fleetE.net_profit).toLocaleString()} reference=$${Math.round(fleetR.net_profit).toLocaleString()} | sales=$${Math.round(fleetE.total_sales).toLocaleString()} fees=$${Math.round(fleetE.total_fees).toLocaleString()} | commissions: engine=$${fleetE.commissions.toFixed(2)} reference=$${fleetR.commissions.toFixed(2)}`,
    );
    if (pass) {
      console.log('RESULT: PASS ✓ (all profiles + fleet reconcile within $0.005)');
    } else {
      console.log(`RESULT: FAIL ✗ — ${mismatches.length} profile mismatch(es)${fleetDiffs.length ? `, fleet diffs: ${fleetDiffs.join(', ')}` : ''}`);
      mismatches.slice(0, 30).forEach((m) => console.log(m));
    }
  }

  // Conversion-month proof: show one migrated machine's cells by month/platform.
  console.log('\n=== conversion-split spot check (2026-01..2026-07, both) ===');
  const inputs = await inputsFor("2026-01", "2026-07");
  const engine = computeMonthlyPnLFromInputs(inputs, { platform: 'both' });
  for (const atm of ['1094', '1048', '3909']) {
    const cs = engine.cells.filter((c) => c.atm_id === atm).sort((a, b) => a.month.localeCompare(b.month));
    if (!cs.length) continue;
    console.log(`ATM ${atm}:`);
    for (const c of cs) {
      console.log(`  ${c.month} ${c.platform.padEnd(7)} sales=$${Math.round(c.total_sales)} fees=$${Math.round(c.total_fees)} rent=$${c.rent} comm=$${Math.round(c.commissions)} net=$${Math.round(c.net_profit)}`);
    }
  }

  // ── Double-count probe ────────────────────────────────────────────────────
  // 1048 converts within June 2026 (denet removed 06-23, bitstop installed
  // 06-24 → BOTH profiles' month-windows contain 2026-06). Inject a synthetic
  // $500 June commission and observe whether the reference attributes it to
  // BOTH the denet row and the bitstop row.
  console.log('\n=== double-count probe: 1048, synthetic $500 commission in 2026-06 (conversion month) ===');
  const SYNTH = 500;
  const probeInputs = await inputsFor('2026-01', '2026-07', [
    { atm_id: '1048', commission_amount: SYNTH, month_year: '2026-06-01' },
  ]);
  const probeRef = computeReferenceRows(probeInputs, { platform: 'both' });
  const probeEngine = computeMonthlyPnLFromInputs(probeInputs, { platform: 'both' });

  const ref1048 = probeRef.filter((r) => r.atm_id === '1048');
  console.log(`reference rows for 1048: ${ref1048.length}`);
  for (const r of ref1048) {
    console.log(`  ${r.platform.padEnd(7)} commission=$${r.commissions.toFixed(2)} net=$${Math.round(r.net_profit)}`);
  }
  const refCommTotal = ref1048.reduce((s, r) => s + r.commissions, 0);
  console.log(`  reference total commission attributed to 1048 across rows = $${refCommTotal.toFixed(2)} (true value = $${SYNTH.toFixed(2)})`);
  console.log(`  >>> DOUBLE-COUNT = $${(refCommTotal - SYNTH).toFixed(2)}`);

  // Engine faithfully reproduces (each profile's cells sum to its reference row).
  const engineByProfile = sumEngineByProfile(probeEngine.cells);
  let probeReconciles = true;
  for (const r of ref1048) {
    const e = engineByProfile.get(r.profile_id);
    const d = (e?.commissions ?? 0) - r.commissions;
    if (Math.abs(d) > TOL) probeReconciles = false;
    console.log(`  engine ${r.platform.padEnd(7)} summed commission=$${(e?.commissions ?? 0).toFixed(2)} (Δ vs ref ${d.toFixed(2)})`);
  }
  const machineJuneNet = probeEngine.byMachineMonthNet['1048']?.['2026-06'];
  console.log(`  engine byMachineMonthNet[1048][2026-06] = $${Math.round(machineJuneNet ?? 0)} (1048's total June net; the $${SYNTH} is now counted once, on the profile that owns June)`);
  console.log(`  engine reproduces reference: ${probeReconciles ? 'YES ✓ (reconciles)' : 'NO ✗'}`);

  // ── Real-data checks over 2026-01..07 (now has real June commission) ───────
  console.log('\n=== real June-2026 commission ($449.40 net, Steven Kraft) ===');
  const realInputs = await inputsFor('2026-01', '2026-07');
  const realEngine = computeMonthlyPnLFromInputs(realInputs, { platform: 'both' });
  const realRef = computeReferenceRows(realInputs, { platform: 'both' });

  const juneEngineComm = realEngine.byMonthTotals['2026-06']?.commissions ?? 0;
  const engineTotalComm = realEngine.cells.reduce((s, c) => s + c.commissions, 0);
  const refTotalComm = realRef.reduce((s, r) => s + r.commissions, 0);
  console.log(`engine June-2026 commission (byMonthTotals) = $${juneEngineComm.toFixed(2)}`);
  console.log(`range total commission: engine=$${engineTotalComm.toFixed(2)} reference=$${refTotalComm.toFixed(2)} (Δ ${(engineTotalComm - refTotalComm).toFixed(2)})`);
  // Per-profile spot check on the largest one (3998, $356.19).
  const eng3998 = sumEngineByProfile(realEngine.cells).get(
    realRef.find((r) => r.atm_id === '3998')?.profile_id ?? '',
  );
  const ref3998 = realRef.find((r) => r.atm_id === '3998');
  console.log(`profile 3998: engine commission=$${(eng3998?.commissions ?? 0).toFixed(2)} reference=$${(ref3998?.commissions ?? 0).toFixed(2)}`);

  // Real-data double-count scan: any (atm_id, month) where 2+ distinct profiles
  // BOTH carry a non-zero commission (the same-month-conversion signature).
  const commByAtmMonth = new Map<string, Set<string>>();
  for (const c of realEngine.cells) {
    if (c.commissions === 0) continue;
    const key = `${c.atm_id}|${c.month}`;
    (commByAtmMonth.get(key) ?? commByAtmMonth.set(key, new Set()).get(key)!).add(c.profile_id);
  }
  const realDoubleCounts = [...commByAtmMonth.entries()].filter(([, profs]) => profs.size > 1);
  console.log(`real-data same-month double-counts (atm,month with commission on 2+ profiles): ${realDoubleCounts.length}`);
  realDoubleCounts.forEach(([k, profs]) => console.log(`  ${k}: ${profs.size} profiles`));

  // Mechanism dump for 2202.
  console.log('  --- 2202 detail ---');
  for (const r of realRef.filter((r) => r.atm_id === '2202')) {
    const pf = realInputs.relevantProfiles.find((p) => p.id === r.profile_id)!;
    const txCount = (realInputs.txsByProfileId.get(r.profile_id) || []).length;
    console.log(`  ref row: platform=${r.platform} installed=${pf.installed_date} removed=${pf.removed_date} txs=${txCount} commission=$${r.commissions.toFixed(2)}`);
  }
  for (const c of realEngine.cells.filter((c) => c.atm_id === '2202' && c.commissions !== 0)) {
    console.log(`  cell: ${c.month} profile=${c.profile_id.slice(0, 8)} commission=$${c.commissions.toFixed(2)}`);
  }

  // Per-(atm,month) commission totals across both commission ranges — the
  // blast-radius baseline (run before AND after the fix, then diff).
  console.log('\n=== BLAST-RADIUS: per-(atm,month) commission totals (summed across profiles) ===');
  for (const [from, to] of [['2025-10', '2025-12'], ['2026-01', '2026-07']] as const) {
    const inp = await inputsFor(from, to);
    const eng = computeMonthlyPnLFromInputs(inp, { platform: 'both' });
    const map = new Map<string, number>();
    for (const c of eng.cells) {
      if (c.commissions === 0) continue;
      map.set(`${c.atm_id}|${c.month}`, (map.get(`${c.atm_id}|${c.month}`) || 0) + c.commissions);
    }
    [...map.entries()].sort().forEach(([k, v]) => console.log(`  ${k} = ${v.toFixed(2)}`));
  }

  console.log(`\n${anyFail ? 'OVERALL: FAIL ✗' : 'OVERALL: PASS ✓ — all cases reconcile'}`);
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error('Reconciliation harness error:', e);
  process.exit(2);
});
