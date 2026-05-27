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
import { RotateCcw } from 'lucide-react';
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

// Currency-formatted input: shows the raw editable string while focused
// (easy to type/paste digits), reformats to "$1,234,567" on blur.
// Internal state stays a raw number string; only the display value flips.
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
        // Strip everything except digits, minus, and decimal point.
        const raw = e.target.value.replace(/[^0-9.\-]/g, '');
        onChange(raw);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="h-8 font-mono tabular-nums text-right text-sm w-full"
    />
  );
}

export default function PlatformComparisonScenario({
  feePctActualDefault,
  feePctProjectedDefault,
  bitstopFeesPctDefault,
}: Props) {
  // Controlled string inputs (parsed on use). Defaults for the three %
  // fields come from the parent's current report values; everything else
  // starts at 0 for the user to fill in.
  const [totalSalesInput, setTotalSalesInput] = useState('0');
  const [feePctActualInput, setFeePctActualInput] = useState(
    feePctActualDefault.toFixed(2),
  );
  const [feePctProjectedInput, setFeePctProjectedInput] = useState(
    feePctProjectedDefault.toFixed(2),
  );
  const [bitstopFeesPctInput, setBitstopFeesPctInput] = useState(
    bitstopFeesPctDefault.toFixed(2),
  );
  const [rentActualInput, setRentActualInput] = useState('0');
  const [rentProjectedInput, setRentProjectedInput] = useState('0');
  const [mgmtRpsActualInput, setMgmtRpsActualInput] = useState('0');
  const [mgmtRpsProjectedInput, setMgmtRpsProjectedInput] = useState('0');
  const [mgmtRepActualInput, setMgmtRepActualInput] = useState('0');
  const [mgmtRepProjectedInput, setMgmtRepProjectedInput] = useState('0');
  const [commissionsActualInput, setCommissionsActualInput] = useState('0');
  const [commissionsProjectedInput, setCommissionsProjectedInput] = useState('0');

  // Per-field dirty flags for the three %s that auto-sync from props.
  // Any keystroke flips the flag; the resync effect skips dirty fields.
  const [isFeePctActualDirty, setIsFeePctActualDirty] = useState(false);
  const [isFeePctProjectedDirty, setIsFeePctProjectedDirty] = useState(false);
  const [isBitstopFeesPctDirty, setIsBitstopFeesPctDirty] = useState(false);

  // Resync from parent unless user has touched the field. Effects depend
  // only on the prop value — dirty flag is read from closure.
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

  const handleReset = () => {
    setTotalSalesInput('0');
    setFeePctActualInput(feePctActualDefault.toFixed(2));
    setFeePctProjectedInput(feePctProjectedDefault.toFixed(2));
    setBitstopFeesPctInput(bitstopFeesPctDefault.toFixed(2));
    setRentActualInput('0');
    setRentProjectedInput('0');
    setMgmtRpsActualInput('0');
    setMgmtRpsProjectedInput('0');
    setMgmtRepActualInput('0');
    setMgmtRepProjectedInput('0');
    setCommissionsActualInput('0');
    setCommissionsProjectedInput('0');
    setIsFeePctActualDirty(false);
    setIsFeePctProjectedDirty(false);
    setIsBitstopFeesPctDirty(false);
  };

  // ── Parse inputs once per render ──
  const totalSales = parseFloat(totalSalesInput) || 0;
  const feePctActual = parseFloat(feePctActualInput) || 0;
  const feePctProjected = parseFloat(feePctProjectedInput) || 0;
  const bitstopFeesPct = parseFloat(bitstopFeesPctInput) || 0;
  const rentActual = parseFloat(rentActualInput) || 0;
  const rentProjected = parseFloat(rentProjectedInput) || 0;
  const mgmtRpsActual = parseFloat(mgmtRpsActualInput) || 0;
  const mgmtRpsProjected = parseFloat(mgmtRpsProjectedInput) || 0;
  const mgmtRepActual = parseFloat(mgmtRepActualInput) || 0;
  const mgmtRepProjected = parseFloat(mgmtRepProjectedInput) || 0;
  const commissionsActual = parseFloat(commissionsActualInput) || 0;
  const commissionsProjected = parseFloat(commissionsProjectedInput) || 0;

  // ── Derived values ──
  const revenueActual = totalSales * (feePctActual / 100);
  const revenueProjected = totalSales * (feePctProjected / 100);
  const bitstopFeesActual = totalSales * (bitstopFeesPct / 100);
  const bitstopFeesProjected = 0; // affiliate model: no per-tx Bitstop fee
  const profitActual =
    revenueActual -
    bitstopFeesActual -
    rentActual -
    mgmtRpsActual -
    mgmtRepActual -
    commissionsActual;
  const profitProjected =
    revenueProjected -
    bitstopFeesProjected -
    rentProjected -
    mgmtRpsProjected -
    mgmtRepProjected -
    commissionsProjected;

  const revenueDelta = revenueProjected - revenueActual;
  const feePctDelta = feePctProjected - feePctActual;
  const bitstopFeesDelta = bitstopFeesProjected - bitstopFeesActual;
  const rentDelta = rentProjected - rentActual;
  const mgmtRpsDelta = mgmtRpsProjected - mgmtRpsActual;
  const mgmtRepDelta = mgmtRepProjected - mgmtRepActual;
  const commissionsDelta = commissionsProjected - commissionsActual;
  const profitDelta = profitProjected - profitActual;

  // ── Render helpers ──
  const numInput = (
    value: string,
    onChange: (v: string) => void,
    step: string = '1',
  ) => (
    <Input
      type="number"
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 font-mono tabular-nums text-right text-sm w-full"
    />
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
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Reset to defaults
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <colgroup>
              <col style={{ width: '200px' }} />
              <col style={{ width: '180px' }} />
              <col style={{ width: '180px' }} />
              <col style={{ width: '160px' }} />
            </colgroup>
            <thead>
              <tr className="border-b-2 border-white/10">
                <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  &nbsp;
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
              {/* Total Sales — input in Actuals, mirrored read-only in Projected */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium">Total Sales</td>
                <td className="px-4 py-3">
                  <CurrencyInput value={totalSalesInput} onChange={setTotalSalesInput} />
                </td>
                <td className="px-4 py-3 text-right font-mono text-base tabular-nums">
                  {formatCurrency(totalSales)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-muted-foreground">
                  {formatCurrency(0)}
                </td>
              </tr>

              {/* Fee % of Sales — both columns editable, default-synced */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium">Fee % of Sales</td>
                <td className="px-4 py-3">
                  {numInput(
                    feePctActualInput,
                    (v) => {
                      setFeePctActualInput(v);
                      setIsFeePctActualDirty(true);
                    },
                    '0.01',
                  )}
                </td>
                <td className="px-4 py-3">
                  {numInput(
                    feePctProjectedInput,
                    (v) => {
                      setFeePctProjectedInput(v);
                      setIsFeePctProjectedDirty(true);
                    },
                    '0.01',
                  )}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums',
                    deltaColor(feePctDelta),
                  )}
                >
                  {feePctDelta >= 0 ? '+' : ''}
                  {feePctDelta.toFixed(2)}%
                </td>
              </tr>

              {/* Revenue — calculated */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium">Revenue</td>
                <td className="px-4 py-3 text-right font-mono text-base tabular-nums">
                  {formatCurrency(revenueActual)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-base tabular-nums">
                  {formatCurrency(revenueProjected)}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums',
                    deltaColor(revenueDelta),
                  )}
                >
                  {formatCurrency(revenueDelta)}
                </td>
              </tr>

              {/* Bitstop Fees % — Actuals input only */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium">Bitstop Fees %</td>
                <td className="px-4 py-3">
                  {numInput(
                    bitstopFeesPctInput,
                    (v) => {
                      setBitstopFeesPctInput(v);
                      setIsBitstopFeesPctDirty(true);
                    },
                    '0.01',
                  )}
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-muted-foreground/40">
                  —
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-muted-foreground/40">
                  —
                </td>
              </tr>

              {/* Bitstop Fees — calculated; projected always $0 */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium">Bitstop Fees</td>
                <td className="px-4 py-3 text-right font-mono text-base tabular-nums">
                  {formatCurrency(bitstopFeesActual)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-base tabular-nums">
                  {formatCurrency(0)}
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums',
                    deltaColor(bitstopFeesDelta),
                  )}
                >
                  {formatCurrency(bitstopFeesDelta)}
                </td>
              </tr>

              {/* Rent */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium">Rent</td>
                <td className="px-4 py-3">
                  <CurrencyInput value={rentActualInput} onChange={setRentActualInput} />
                </td>
                <td className="px-4 py-3">
                  <CurrencyInput value={rentProjectedInput} onChange={setRentProjectedInput} />
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums',
                    deltaColor(rentDelta),
                  )}
                >
                  {formatCurrency(rentDelta)}
                </td>
              </tr>

              {/* Mgmt RPS */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium">Mgmt RPS</td>
                <td className="px-4 py-3">
                  <CurrencyInput value={mgmtRpsActualInput} onChange={setMgmtRpsActualInput} />
                </td>
                <td className="px-4 py-3">
                  <CurrencyInput value={mgmtRpsProjectedInput} onChange={setMgmtRpsProjectedInput} />
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums',
                    deltaColor(mgmtRpsDelta),
                  )}
                >
                  {formatCurrency(mgmtRpsDelta)}
                </td>
              </tr>

              {/* Mgmt Rep */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium">Mgmt Rep</td>
                <td className="px-4 py-3">
                  <CurrencyInput value={mgmtRepActualInput} onChange={setMgmtRepActualInput} />
                </td>
                <td className="px-4 py-3">
                  <CurrencyInput value={mgmtRepProjectedInput} onChange={setMgmtRepProjectedInput} />
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums',
                    deltaColor(mgmtRepDelta),
                  )}
                >
                  {formatCurrency(mgmtRepDelta)}
                </td>
              </tr>

              {/* Commissions */}
              <tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="px-4 py-3 text-sm font-medium">Commissions</td>
                <td className="px-4 py-3">
                  <CurrencyInput
                    value={commissionsActualInput}
                    onChange={setCommissionsActualInput}
                  />
                </td>
                <td className="px-4 py-3">
                  <CurrencyInput
                    value={commissionsProjectedInput}
                    onChange={setCommissionsProjectedInput}
                  />
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-mono text-sm tabular-nums',
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
