import { useState, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link as LinkIcon, Unlink, RotateCcw, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { cn } from '@/lib/utils';

interface Props {
  feePctActualDefault: number;
  feePctProjectedDefault: number;
  bitstopFeesPctDefault: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const deltaColor = (n: number) =>
  n > 0 ? 'text-green-400' : n < 0 ? 'text-red-400' : 'text-muted-foreground';

// Underline-only input treatment shared across the Scenario Builder.
// Inputs read as inline text with a subtle bottom border as the only
// "this is editable" signal. On hover the underline darkens; on focus
// it picks up the primary accent and the text brightens.
const underlineInputBase =
  'bg-transparent border-0 border-b border-white/20 rounded-none shadow-none px-1 ' +
  'text-foreground/80 font-mono tabular-nums text-right ' +
  'hover:border-white/40 ' +
  'focus:border-primary focus:text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0';

// All in-table inputs share this compact size + the underline treatment.
const compactInputClass = `${underlineInputBase} h-7 text-xs w-full`;

// Number of Machines control above the table — slightly larger, narrower.
const numMachinesInputClass = `${underlineInputBase} h-8 text-sm w-24`;

// Currency-formatted input: raw digits while focused, "$1,234,567" on blur.
function CurrencyInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const num = parseFloat(value) || 0;
  const display = focused ? value : formatCurrency(num);
  return (
    <Input
      type="text"
      inputMode="numeric"
      value={display}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.\-]/g, '');
        onChange(raw);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={compactInputClass}
    />
  );
}

// Link/unlink toggle for splittable rows. Tooltips describe the action,
// not just the current state.
function SplitToggle({
  split,
  onToggle,
}: {
  split: boolean;
  onToggle: () => void;
}) {
  const title = split
    ? 'Independent rates per column. Click to use a single shared rate.'
    : 'Same per-machine rate for both columns. Click to enter different rates per column.';
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex items-center justify-center h-5 w-5 rounded-sm ml-1.5 align-middle hover:bg-white/5',
        split ? 'text-amber-400' : 'text-muted-foreground',
      )}
    >
      {split ? <Unlink className="h-3 w-3" /> : <LinkIcon className="h-3 w-3" />}
    </button>
  );
}

export default function PlatformComparisonScenario({
  feePctActualDefault,
  feePctProjectedDefault,
  bitstopFeesPctDefault,
}: Props) {
  // ── Fleet size ──
  const [numMachinesInput, setNumMachinesInput] = useState('1');

  // ── Per-machine sales (always shared) ──
  const [avgSalesPerMachineInput, setAvgSalesPerMachineInput] = useState('0');

  // ── % inputs (default-synced from parent) ──
  const [feePctActualInput, setFeePctActualInput] = useState(
    feePctActualDefault.toFixed(2),
  );
  const [feePctProjectedInput, setFeePctProjectedInput] = useState(
    feePctProjectedDefault.toFixed(2),
  );
  const [bitstopFeesPctInput, setBitstopFeesPctInput] = useState(
    bitstopFeesPctDefault.toFixed(2),
  );

  // ── Per-machine cost inputs + split flags ──
  const [rentActualPMInput, setRentActualPMInput] = useState('0');
  const [rentProjectedPMInput, setRentProjectedPMInput] = useState('0');
  const [rentSplit, setRentSplit] = useState(false);

  const [mgmtRpsActualPMInput, setMgmtRpsActualPMInput] = useState('0');
  const [mgmtRpsProjectedPMInput, setMgmtRpsProjectedPMInput] = useState('0');
  const [mgmtRpsSplit, setMgmtRpsSplit] = useState(false);

  const [mgmtRepActualPMInput, setMgmtRepActualPMInput] = useState('0');
  const [mgmtRepProjectedPMInput, setMgmtRepProjectedPMInput] = useState('0');
  const [mgmtRepSplit, setMgmtRepSplit] = useState(false);

  // ── Commission %, optional split ──
  const [commissionActualPctInput, setCommissionActualPctInput] = useState('0');
  const [commissionProjectedPctInput, setCommissionProjectedPctInput] = useState('0');
  const [commissionSplit, setCommissionSplit] = useState(false);

  // ── Dirty flags for default-synced % inputs ──
  const [isFeePctActualDirty, setIsFeePctActualDirty] = useState(false);
  const [isFeePctProjectedDirty, setIsFeePctProjectedDirty] = useState(false);
  const [isBitstopFeesPctDirty, setIsBitstopFeesPctDirty] = useState(false);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!isFeePctActualDirty) setFeePctActualInput(feePctActualDefault.toFixed(2));
  }, [feePctActualDefault]);
  useEffect(() => {
    if (!isFeePctProjectedDirty) setFeePctProjectedInput(feePctProjectedDefault.toFixed(2));
  }, [feePctProjectedDefault]);
  useEffect(() => {
    if (!isBitstopFeesPctDirty) setBitstopFeesPctInput(bitstopFeesPctDefault.toFixed(2));
  }, [bitstopFeesPctDefault]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Going shared→split copies Actual to Projected so the user starts from
  // a sensible value. Split→shared leaves both states alone; in shared mode
  // the calc uses Actual for both columns, so the Per Machine column shows
  // whatever the user last typed in the Actuals split-mode cell.
  const toggleRentSplit = () => {
    if (!rentSplit) setRentProjectedPMInput(rentActualPMInput);
    setRentSplit((s) => !s);
  };
  const toggleMgmtRpsSplit = () => {
    if (!mgmtRpsSplit) setMgmtRpsProjectedPMInput(mgmtRpsActualPMInput);
    setMgmtRpsSplit((s) => !s);
  };
  const toggleMgmtRepSplit = () => {
    if (!mgmtRepSplit) setMgmtRepProjectedPMInput(mgmtRepActualPMInput);
    setMgmtRepSplit((s) => !s);
  };
  const toggleCommissionSplit = () => {
    if (!commissionSplit) setCommissionProjectedPctInput(commissionActualPctInput);
    setCommissionSplit((s) => !s);
  };

  // Live, formula-driven Excel export. Inputs are real Excel cells the
  // recipient edits; outputs are =FORMULA cells referencing them, so Excel
  // recalculates on every edit. The defaults written here are the spec's
  // canonical starting values, not the current Scenario Builder state —
  // this is a model template, not a snapshot.
  const handleExportExcel = () => {
    // Currency format with parentheses on negatives (accounting convention).
    const CURR = '$#,##0;($#,##0)';
    const PCT = '0.00%';

    const headerFont = { font: { bold: true } };
    const titleFont = { font: { bold: true, sz: 14 } };
    const subtitleFont = { font: { italic: true, color: { rgb: '6B7280' } } };
    const mutedItalic = { font: { italic: true, color: { rgb: '6B7280' } } };
    const inputFill = { fill: { fgColor: { rgb: 'FFF8E1' } } };
    const thinBlackBorder = { style: 'thin', color: { rgb: '000000' } } as const;
    const profitTopBorder = { border: { top: thinBlackBorder } };

    // Today, local-tz.
    const now = new Date();
    const titleDate = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
    const filenameDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // ── Canonical default inputs (decimals for percent cells) ──
    const D_numMachines = 28;
    const D_salesPerMachine = 4380;
    const D_feePctActual = 0.2485;
    const D_feePctProjected = 0.1372;
    const D_bitstopFeesPct = 0.042;
    const D_commPctActual = 0;
    const D_commPctProjected = 0;
    const D_rentActual = 187.5;
    const D_rentProjected = 187.5;
    const D_rpsActual = 200;
    const D_rpsProjected = 200;
    const D_repActual = 0;
    const D_repProjected = 50;

    // ── Cached formula values (computed identically to the Excel formulas,
    //    using JS doubles — same precision as Excel). No pre-rounding;
    //    Excel's number format does the display rounding. ──
    const c_totalSalesA = D_salesPerMachine * D_numMachines;
    const c_totalSalesP = D_salesPerMachine * D_numMachines;
    const c_revenueA = c_totalSalesA * D_feePctActual;
    const c_revenueP = c_totalSalesP * D_feePctProjected;
    const c_bitstopFeesA = c_totalSalesA * D_bitstopFeesPct;
    const c_bitstopFeesP = 0;
    const c_rentA = D_rentActual * D_numMachines;
    const c_rentP = D_rentProjected * D_numMachines;
    const c_rpsA = D_rpsActual * D_numMachines;
    const c_rpsP = D_rpsProjected * D_numMachines;
    const c_repA = D_repActual * D_numMachines;
    const c_repP = D_repProjected * D_numMachines;
    const c_preCommA = c_revenueA - c_bitstopFeesA - c_rentA - c_rpsA - c_repA;
    const c_preCommP = c_revenueP - c_bitstopFeesP - c_rentP - c_rpsP - c_repP;
    const c_commA = Math.max(0, c_preCommA) * D_commPctActual;
    const c_commP = Math.max(0, c_preCommP) * D_commPctProjected;
    const c_profitA = c_preCommA - c_commA;
    const c_profitP = c_preCommP - c_commP;

    const ws: XLSX.WorkSheet = {};

    // Title strip (rows 1-2).
    ws['A1'] = { v: 'Denet — Scenario Model', t: 's', s: titleFont };
    ws['A2'] = { v: `Monthly basis · generated ${titleDate}`, t: 's', s: subtitleFont };

    // ── ASSUMPTIONS ──
    ws['A3'] = { v: 'ASSUMPTIONS — edit these', t: 's', s: headerFont };

    ws['A4'] = { v: 'Number of machines', t: 's' };
    ws['B4'] = { v: D_numMachines, t: 'n', s: { ...inputFill } };

    ws['A5'] = { v: 'Avg sales / machine (monthly)', t: 's' };
    ws['B5'] = { v: D_salesPerMachine, t: 'n', s: { ...inputFill, numFmt: CURR } };

    // Rates (row 7 header, rows 8-10 inputs)
    ws['A7'] = { v: 'Rates', t: 's' };
    ws['B7'] = { v: 'Denet', t: 's', s: headerFont };
    ws['C7'] = { v: 'Bitstop', t: 's', s: headerFont };

    ws['A8'] = { v: 'Fee % of sales', t: 's' };
    ws['B8'] = { v: D_feePctActual, t: 'n', s: { ...inputFill, numFmt: PCT } };
    ws['C8'] = { v: D_feePctProjected, t: 'n', s: { ...inputFill, numFmt: PCT } };

    ws['A9'] = { v: 'Bitstop fees %', t: 's' };
    ws['B9'] = { v: D_bitstopFeesPct, t: 'n', s: { ...inputFill, numFmt: PCT } };
    ws['C9'] = {
      v: 'n/a',
      t: 's',
      s: { font: { color: { rgb: '9CA3AF' } }, alignment: { horizontal: 'right' } },
    };

    ws['A10'] = { v: 'Commission %', t: 's' };
    ws['B10'] = { v: D_commPctActual, t: 'n', s: { ...inputFill, numFmt: PCT } };
    ws['C10'] = { v: D_commPctProjected, t: 'n', s: { ...inputFill, numFmt: PCT } };

    // Per-machine costs (row 12 header, rows 13-15 inputs)
    ws['A12'] = { v: 'Per-machine costs (monthly)', t: 's' };
    ws['B12'] = { v: 'Denet', t: 's', s: headerFont };
    ws['C12'] = { v: 'Bitstop', t: 's', s: headerFont };

    ws['A13'] = { v: 'Rent / machine', t: 's' };
    ws['B13'] = { v: D_rentActual, t: 'n', s: { ...inputFill, numFmt: CURR } };
    ws['C13'] = { v: D_rentProjected, t: 'n', s: { ...inputFill, numFmt: CURR } };

    ws['A14'] = { v: 'Mgmt RPS / machine', t: 's' };
    ws['B14'] = { v: D_rpsActual, t: 'n', s: { ...inputFill, numFmt: CURR } };
    ws['C14'] = { v: D_rpsProjected, t: 'n', s: { ...inputFill, numFmt: CURR } };

    ws['A15'] = { v: 'Mgmt Rep / machine', t: 's' };
    ws['B15'] = { v: D_repActual, t: 'n', s: { ...inputFill, numFmt: CURR } };
    ws['C15'] = { v: D_repProjected, t: 'n', s: { ...inputFill, numFmt: CURR } };

    // ── RESULTS ──
    ws['A17'] = { v: 'RESULTS', t: 's', s: headerFont };
    ws['B17'] = { v: 'Denet', t: 's', s: headerFont };
    ws['C17'] = { v: 'Bitstop', t: 's', s: headerFont };
    ws['D17'] = { v: 'Delta', t: 's', s: headerFont };

    const formulaCell = (formula: string, cached: number) => ({
      f: formula,
      v: cached,
      t: 'n' as const,
      s: { numFmt: CURR },
    });

    // Total Sales (row 18)
    ws['A18'] = { v: 'Total Sales', t: 's' };
    ws['B18'] = formulaCell('B5*B4', c_totalSalesA);
    ws['C18'] = formulaCell('B5*B4', c_totalSalesP);
    ws['D18'] = formulaCell('C18-B18', 0);

    // Revenue (row 19)
    ws['A19'] = { v: 'Revenue', t: 's' };
    ws['B19'] = formulaCell('B18*B8', c_revenueA);
    ws['C19'] = formulaCell('C18*C8', c_revenueP);
    ws['D19'] = formulaCell('C19-B19', c_revenueP - c_revenueA);

    // Bitstop Fees (row 20) — C20 is a literal 0, NOT a formula
    ws['A20'] = { v: 'Bitstop Fees', t: 's' };
    ws['B20'] = formulaCell('B18*B9', c_bitstopFeesA);
    ws['C20'] = { v: 0, t: 'n', s: { numFmt: CURR } };
    ws['D20'] = formulaCell('C20-B20', c_bitstopFeesP - c_bitstopFeesA);

    // Rent / Mgmt RPS / Mgmt Rep (rows 21-23) — both columns multiply
    // their per-machine cost by B4 (the single shared machine count).
    ws['A21'] = { v: 'Rent', t: 's' };
    ws['B21'] = formulaCell('B13*B4', c_rentA);
    ws['C21'] = formulaCell('C13*B4', c_rentP);
    ws['D21'] = formulaCell('C21-B21', c_rentP - c_rentA);

    ws['A22'] = { v: 'Mgmt RPS', t: 's' };
    ws['B22'] = formulaCell('B14*B4', c_rpsA);
    ws['C22'] = formulaCell('C14*B4', c_rpsP);
    ws['D22'] = formulaCell('C22-B22', c_rpsP - c_rpsA);

    ws['A23'] = { v: 'Mgmt Rep', t: 's' };
    ws['B23'] = formulaCell('B15*B4', c_repA);
    ws['C23'] = formulaCell('C15*B4', c_repP);
    ws['D23'] = formulaCell('C23-B23', c_repP - c_repA);

    // Pre-commission profit (row 24, helper row, italic + muted, no delta)
    ws['A24'] = { v: 'Pre-commission profit', t: 's', s: mutedItalic };
    ws['B24'] = { f: 'B19-B20-B21-B22-B23', v: c_preCommA, t: 'n', s: { ...mutedItalic, numFmt: CURR } };
    ws['C24'] = { f: 'C19-C20-C21-C22-C23', v: c_preCommP, t: 'n', s: { ...mutedItalic, numFmt: CURR } };

    // Commission (row 25) — MAX(0, preComm) clamp baked into the formula
    ws['A25'] = { v: 'Commission', t: 's' };
    ws['B25'] = formulaCell('MAX(0,B24)*B10', c_commA);
    ws['C25'] = formulaCell('MAX(0,C24)*C10', c_commP);
    ws['D25'] = formulaCell('C25-B25', c_commP - c_commA);

    // Profit / Loss (row 26) — bold, top border across all four cells
    const profitStyle = { font: { bold: true }, numFmt: CURR, ...profitTopBorder };
    ws['A26'] = { v: 'Profit / Loss', t: 's', s: { font: { bold: true }, ...profitTopBorder } };
    ws['B26'] = { f: 'B24-B25', v: c_profitA, t: 'n', s: profitStyle };
    ws['C26'] = { f: 'C24-C25', v: c_profitP, t: 'n', s: profitStyle };
    ws['D26'] = { f: 'C26-B26', v: c_profitP - c_profitA, t: 'n', s: profitStyle };

    // Sheet bounds (A1:D26) and column widths
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 25, c: 3 } });
    ws['!cols'] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scenario Model');
    XLSX.writeFile(wb, `Denet_Scenario_Model_${filenameDate}.xlsx`);
  };

  const handleReset = () => {
    setNumMachinesInput('1');
    setAvgSalesPerMachineInput('0');
    setFeePctActualInput(feePctActualDefault.toFixed(2));
    setFeePctProjectedInput(feePctProjectedDefault.toFixed(2));
    setBitstopFeesPctInput(bitstopFeesPctDefault.toFixed(2));
    setRentActualPMInput('0');
    setRentProjectedPMInput('0');
    setRentSplit(false);
    setMgmtRpsActualPMInput('0');
    setMgmtRpsProjectedPMInput('0');
    setMgmtRpsSplit(false);
    setMgmtRepActualPMInput('0');
    setMgmtRepProjectedPMInput('0');
    setMgmtRepSplit(false);
    setCommissionActualPctInput('0');
    setCommissionProjectedPctInput('0');
    setCommissionSplit(false);
    setIsFeePctActualDirty(false);
    setIsFeePctProjectedDirty(false);
    setIsBitstopFeesPctDirty(false);
  };

  // ── Parse + derive ──
  const numMachines = Math.max(0, parseInt(numMachinesInput) || 0);
  const avgSalesPerMachine = parseFloat(avgSalesPerMachineInput) || 0;
  const totalSales = avgSalesPerMachine * numMachines;

  const feePctActual = parseFloat(feePctActualInput) || 0;
  const feePctProjected = parseFloat(feePctProjectedInput) || 0;
  const bitstopFeesPct = parseFloat(bitstopFeesPctInput) || 0;

  const revenueActual = totalSales * (feePctActual / 100);
  const revenueProjected = totalSales * (feePctProjected / 100);
  const bitstopFeesActual = totalSales * (bitstopFeesPct / 100);
  const bitstopFeesProjected = 0;

  const rentActualPM = parseFloat(rentActualPMInput) || 0;
  const rentProjectedPM = rentSplit
    ? parseFloat(rentProjectedPMInput) || 0
    : rentActualPM;
  const rentActual = rentActualPM * numMachines;
  const rentProjected = rentProjectedPM * numMachines;

  const mgmtRpsActualPM = parseFloat(mgmtRpsActualPMInput) || 0;
  const mgmtRpsProjectedPM = mgmtRpsSplit
    ? parseFloat(mgmtRpsProjectedPMInput) || 0
    : mgmtRpsActualPM;
  const mgmtRpsActual = mgmtRpsActualPM * numMachines;
  const mgmtRpsProjected = mgmtRpsProjectedPM * numMachines;

  const mgmtRepActualPM = parseFloat(mgmtRepActualPMInput) || 0;
  const mgmtRepProjectedPM = mgmtRepSplit
    ? parseFloat(mgmtRepProjectedPMInput) || 0
    : mgmtRepActualPM;
  const mgmtRepActual = mgmtRepActualPM * numMachines;
  const mgmtRepProjected = mgmtRepProjectedPM * numMachines;

  const profitPreCommActual =
    revenueActual - bitstopFeesActual - rentActual - mgmtRpsActual - mgmtRepActual;
  const profitPreCommProjected =
    revenueProjected -
    bitstopFeesProjected -
    rentProjected -
    mgmtRpsProjected -
    mgmtRepProjected;

  const commissionActualPct = parseFloat(commissionActualPctInput) || 0;
  const commissionProjectedPct = commissionSplit
    ? parseFloat(commissionProjectedPctInput) || 0
    : commissionActualPct;

  const commissionsActual =
    Math.max(0, profitPreCommActual) * (commissionActualPct / 100);
  const commissionsProjected =
    Math.max(0, profitPreCommProjected) * (commissionProjectedPct / 100);

  const profitActual = profitPreCommActual - commissionsActual;
  const profitProjected = profitPreCommProjected - commissionsProjected;

  // Deltas
  const revenueDelta = revenueProjected - revenueActual;
  const feePctDelta = feePctProjected - feePctActual;
  const bitstopFeesDelta = bitstopFeesProjected - bitstopFeesActual;
  const rentDelta = rentProjected - rentActual;
  const mgmtRpsDelta = mgmtRpsProjected - mgmtRpsActual;
  const mgmtRepDelta = mgmtRepProjected - mgmtRepActual;
  const commissionsDelta = commissionsProjected - commissionsActual;
  const profitDelta = profitProjected - profitActual;

  // ── Render helpers ──
  const pctInput = (value: string, onChange: (v: string) => void) => (
    <Input
      type="number"
      step="0.01"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={compactInputClass}
    />
  );

  // Right-aligned muted dash for non-applicable cells (Per Machine column
  // on rows that have no per-machine rate; Projected of Bitstop Fees %).
  const dashCell = (extraClass = '') => (
    <td
      className={cn(
        'px-3 py-3 text-right font-mono text-xs tabular-nums text-muted-foreground/40 align-top',
        extraClass,
      )}
    >
      —
    </td>
  );

  // Prominent display cell — primary visual focus in Actuals/Projected.
  const totalCell = (value: number, extraClass = '') => (
    <td
      className={cn(
        'px-4 py-3 text-right font-mono text-base tabular-nums align-top',
        extraClass,
      )}
    >
      {formatCurrency(value)}
    </td>
  );

  // In-cell input + total stacked vertically (split-mode currency cells).
  const splitCurrencyCell = (
    value: string,
    onChange: (v: string) => void,
    total: number,
  ) => (
    <td className="px-4 py-3 align-top">
      <div className="space-y-1">
        <CurrencyInput value={value} onChange={onChange} />
        <div className="text-right font-mono text-base tabular-nums">
          {formatCurrency(total)}
        </div>
      </div>
    </td>
  );

  // In-cell % input + commission-$ stacked vertically (split-mode commission).
  const splitCommissionCell = (
    value: string,
    onChange: (v: string) => void,
    commissionAmount: number,
  ) => (
    <td className="px-4 py-3 align-top">
      <div className="space-y-1">
        {pctInput(value, onChange)}
        <div className="text-right font-mono text-base tabular-nums">
          {formatCurrency(commissionAmount)}
        </div>
      </div>
    </td>
  );

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Scenario Builder</CardTitle>
            <CardDescription>
              Model hypothetical single-machine or fleet scenarios. Defaults pull
              from the report above; override any value freely.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportExcel}>
              <FileSpreadsheet className="w-4 h-4 mr-1.5" />
              Export to Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Reset to defaults
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Fleet size */}
        <div className="flex items-center gap-3 mb-4 text-sm">
          <Label htmlFor="num-machines" className="text-xs text-muted-foreground">
            Number of Machines
          </Label>
          <Input
            id="num-machines"
            type="number"
            min={0}
            step={1}
            value={numMachinesInput}
            onChange={(e) => setNumMachinesInput(e.target.value)}
            className={numMachinesInputClass}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col style={{ width: '200px' }} />
              <col style={{ width: '130px' }} />
              <col style={{ width: '180px' }} />
              <col style={{ width: '180px' }} />
              <col style={{ width: '160px' }} />
            </colgroup>
            <thead>
              <tr className="border-b-2 border-white/10">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  &nbsp;
                </th>
                <th className="px-3 py-3 text-right text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Per Machine
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-widest text-primary">
                  Actuals (Denet)
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-widest text-amber-400">
                  Projected (Bitstop)
                </th>
                <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Delta
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Total Sales — avg-per-machine input, always shared */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium align-top">
                  Total Sales
                </td>
                <td className="px-3 py-3 align-top">
                  <CurrencyInput
                    value={avgSalesPerMachineInput}
                    onChange={setAvgSalesPerMachineInput}
                  />
                </td>
                {totalCell(totalSales)}
                {totalCell(totalSales)}
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-muted-foreground align-top">
                  {formatCurrency(0)}
                </td>
              </tr>

              {/* Fee % of Sales — two independent % inputs (no per-machine) */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium align-top">
                  Fee % of Sales
                </td>
                {dashCell()}
                <td className="px-4 py-3 align-top">
                  {pctInput(feePctActualInput, (v) => {
                    setFeePctActualInput(v);
                    setIsFeePctActualDirty(true);
                  })}
                </td>
                <td className="px-4 py-3 align-top">
                  {pctInput(feePctProjectedInput, (v) => {
                    setFeePctProjectedInput(v);
                    setIsFeePctProjectedDirty(true);
                  })}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums align-top',
                    deltaColor(feePctDelta),
                  )}
                >
                  {feePctDelta >= 0 ? '+' : ''}
                  {feePctDelta.toFixed(2)}%
                </td>
              </tr>

              {/* Revenue — calculated */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium align-top">Revenue</td>
                {dashCell()}
                {totalCell(revenueActual)}
                {totalCell(revenueProjected)}
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums align-top',
                    deltaColor(revenueDelta),
                  )}
                >
                  {formatCurrency(revenueDelta)}
                </td>
              </tr>

              {/* Bitstop Fees % — Actuals input only */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium align-top">
                  Bitstop Fees %
                </td>
                {dashCell()}
                <td className="px-4 py-3 align-top">
                  {pctInput(bitstopFeesPctInput, (v) => {
                    setBitstopFeesPctInput(v);
                    setIsBitstopFeesPctDirty(true);
                  })}
                </td>
                {dashCell('px-4')}
                {dashCell('px-4')}
              </tr>

              {/* Bitstop Fees — calculated; projected always $0 */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium align-top">
                  Bitstop Fees
                </td>
                {dashCell()}
                {totalCell(bitstopFeesActual)}
                {totalCell(0)}
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums align-top',
                    deltaColor(bitstopFeesDelta),
                  )}
                >
                  {formatCurrency(bitstopFeesDelta)}
                </td>
              </tr>

              {/* Rent — per-machine, splittable */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium align-top">
                  Rent
                  <SplitToggle split={rentSplit} onToggle={toggleRentSplit} />
                </td>
                {rentSplit ? (
                  dashCell()
                ) : (
                  <td className="px-3 py-3 align-top">
                    <CurrencyInput
                      value={rentActualPMInput}
                      onChange={setRentActualPMInput}
                    />
                  </td>
                )}
                {rentSplit
                  ? splitCurrencyCell(rentActualPMInput, setRentActualPMInput, rentActual)
                  : totalCell(rentActual)}
                {rentSplit
                  ? splitCurrencyCell(
                      rentProjectedPMInput,
                      setRentProjectedPMInput,
                      rentProjected,
                    )
                  : totalCell(rentProjected)}
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums align-top',
                    deltaColor(rentDelta),
                  )}
                >
                  {formatCurrency(rentDelta)}
                </td>
              </tr>

              {/* Mgmt RPS — per-machine, splittable */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium align-top">
                  Mgmt RPS
                  <SplitToggle split={mgmtRpsSplit} onToggle={toggleMgmtRpsSplit} />
                </td>
                {mgmtRpsSplit ? (
                  dashCell()
                ) : (
                  <td className="px-3 py-3 align-top">
                    <CurrencyInput
                      value={mgmtRpsActualPMInput}
                      onChange={setMgmtRpsActualPMInput}
                    />
                  </td>
                )}
                {mgmtRpsSplit
                  ? splitCurrencyCell(
                      mgmtRpsActualPMInput,
                      setMgmtRpsActualPMInput,
                      mgmtRpsActual,
                    )
                  : totalCell(mgmtRpsActual)}
                {mgmtRpsSplit
                  ? splitCurrencyCell(
                      mgmtRpsProjectedPMInput,
                      setMgmtRpsProjectedPMInput,
                      mgmtRpsProjected,
                    )
                  : totalCell(mgmtRpsProjected)}
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums align-top',
                    deltaColor(mgmtRpsDelta),
                  )}
                >
                  {formatCurrency(mgmtRpsDelta)}
                </td>
              </tr>

              {/* Mgmt Rep — per-machine, splittable */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium align-top">
                  Mgmt Rep
                  <SplitToggle split={mgmtRepSplit} onToggle={toggleMgmtRepSplit} />
                </td>
                {mgmtRepSplit ? (
                  dashCell()
                ) : (
                  <td className="px-3 py-3 align-top">
                    <CurrencyInput
                      value={mgmtRepActualPMInput}
                      onChange={setMgmtRepActualPMInput}
                    />
                  </td>
                )}
                {mgmtRepSplit
                  ? splitCurrencyCell(
                      mgmtRepActualPMInput,
                      setMgmtRepActualPMInput,
                      mgmtRepActual,
                    )
                  : totalCell(mgmtRepActual)}
                {mgmtRepSplit
                  ? splitCurrencyCell(
                      mgmtRepProjectedPMInput,
                      setMgmtRepProjectedPMInput,
                      mgmtRepProjected,
                    )
                  : totalCell(mgmtRepProjected)}
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums align-top',
                    deltaColor(mgmtRepDelta),
                  )}
                >
                  {formatCurrency(mgmtRepDelta)}
                </td>
              </tr>

              {/* Commission — % input, splittable; $ derived per column */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium align-top">
                  Commission
                  <SplitToggle
                    split={commissionSplit}
                    onToggle={toggleCommissionSplit}
                  />
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    % of pre-commission profit
                  </div>
                </td>
                {commissionSplit ? (
                  dashCell()
                ) : (
                  <td className="px-3 py-3 align-top">
                    {pctInput(commissionActualPctInput, setCommissionActualPctInput)}
                  </td>
                )}
                {commissionSplit
                  ? splitCommissionCell(
                      commissionActualPctInput,
                      setCommissionActualPctInput,
                      commissionsActual,
                    )
                  : totalCell(commissionsActual)}
                {commissionSplit
                  ? splitCommissionCell(
                      commissionProjectedPctInput,
                      setCommissionProjectedPctInput,
                      commissionsProjected,
                    )
                  : totalCell(commissionsProjected)}
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums align-top',
                    deltaColor(commissionsDelta),
                  )}
                >
                  {formatCurrency(commissionsDelta)}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-primary/30 bg-white/[0.03]">
                <td className="px-4 py-3 text-sm font-bold">Profit / Loss</td>
                {dashCell()}
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-lg font-bold tabular-nums',
                    profitActual >= 0 ? 'text-green-400' : 'text-red-400',
                  )}
                >
                  {formatCurrency(profitActual)}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-lg font-bold tabular-nums',
                    profitProjected >= 0 ? 'text-green-400' : 'text-red-400',
                  )}
                >
                  {formatCurrency(profitProjected)}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm font-bold tabular-nums',
                    deltaColor(profitDelta),
                  )}
                >
                  {formatCurrency(profitDelta)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
