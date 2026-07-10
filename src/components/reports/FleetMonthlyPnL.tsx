import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  computeMonthlyPnL,
  monthRange,
  addMonthsYM,
  classifyCommissionMonths,
  type Platform,
  type MonthlyPnLResult,
  type PnLLineItems,
} from '@/lib/pnl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { FileSpreadsheet, LineChart, EyeOff, AlertTriangle, Info } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';

const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// 'YYYY-MM' -> "Jul 2026"
const monthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} ${y}`;
};
// 'YYYY-MM' -> "Jul '26" (compact, for column headers)
const monthLabelShort = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_ABBR[m - 1]} '${String(y).slice(-2)}`;
};

const isValidYM = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

const fmtCurrency = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

const PARTIAL_FOOTNOTE =
  '◦ Partial month — data through the latest upload, not a full month.';

// The six display rows, derived from the engine's PnLLineItems. `informational`
// rows (Total Sales) are volume, not part of Net. `emphasis` is the Net row.
type RowDef = {
  key: string;
  label: string;
  value: (li: PnLLineItems) => number;
  informational?: boolean;
  emphasis?: boolean;
};

const ROWS: RowDef[] = [
  { key: 'total_sales', label: 'Total Sales', value: (li) => li.total_sales, informational: true },
  { key: 'revenue', label: 'Revenue', value: (li) => li.total_fees },
  { key: 'processing', label: 'Processing costs', value: (li) => li.bitstop_fees },
  { key: 'operating', label: 'Operating costs', value: (li) => li.rent + li.mgmt_rps + li.mgmt_rep },
  { key: 'commissions', label: 'Commissions', value: (li) => li.commissions },
  { key: 'net', label: 'Net P&L', value: (li) => li.net_profit, emphasis: true },
];

const emptyLineItems = (): PnLLineItems => ({
  total_sales: 0,
  total_fees: 0,
  bitstop_fees: 0,
  rent: 0,
  mgmt_rps: 0,
  mgmt_rep: 0,
  commissions: 0,
  net_profit: 0,
  has_override: false,
});

// Sum line items across a set of months into a single Total column value.
const sumMonths = (result: MonthlyPnLResult): PnLLineItems => {
  const acc = emptyLineItems();
  for (const ym of result.months) {
    const li = result.byMonthTotals[ym] || emptyLineItems();
    acc.total_sales += li.total_sales;
    acc.total_fees += li.total_fees;
    acc.bitstop_fees += li.bitstop_fees;
    acc.rent += li.rent;
    acc.mgmt_rps += li.mgmt_rps;
    acc.mgmt_rep += li.mgmt_rep;
    acc.commissions += li.commissions;
    acc.net_profit += li.net_profit;
  }
  return acc;
};

const platformLabel = (p: Platform) =>
  p === 'both' ? 'All platforms' : p === 'bitstop' ? 'Bitstop platform' : 'Denet platform';

// ---------------------------------------------------------------------------
// Self-contained inline-SVG net-P&L line chart. This project has no charting
// library (no recharts/d3), so the trend line is drawn directly. The segment
// leading into the partial month is dashed and its marker is a hollow amber
// ring to signal incomplete data.
// ---------------------------------------------------------------------------
function NetPnLChart({
  months,
  nets,
  partialMonth,
}: {
  months: string[];
  nets: number[];
  partialMonth: string | null;
}) {
  const W = 900;
  const H = 260;
  const padL = 64;
  const padR = 24;
  const padT = 20;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = months.length;
  const maxVal = Math.max(0, ...nets);
  const minVal = Math.min(0, ...nets);
  const span = maxVal - minVal || 1;

  const x = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i * plotW) / (n - 1));
  const y = (v: number) => padT + ((maxVal - v) / span) * plotH;

  const partialIndex = partialMonth ? months.indexOf(partialMonth) : -1;
  // Solid line covers all fully-complete points; the last segment into the
  // partial month (if it is the trailing point) is drawn separately as dashed.
  const dashesTrailing = partialIndex === n - 1 && n >= 2;
  const solidPts = dashesTrailing ? nets.slice(0, n - 1) : nets;
  const solidPath = solidPts.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  const zeroY = y(0);
  const fmtAxis = (v: number) => {
    const abs = Math.abs(v);
    const s = abs >= 1000 ? `${Math.round(abs / 1000)}k` : `${Math.round(abs)}`;
    return `${v < 0 ? '-' : ''}$${s}`;
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-[260px]"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Net profit and loss trend across the selected months"
    >
      {/* Zero baseline */}
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="currentColor" className="text-white/15" strokeWidth={1} />
      <text x={padL - 8} y={zeroY} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">$0</text>
      {/* Max / min axis labels */}
      <text x={padL - 8} y={y(maxVal)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">{fmtAxis(maxVal)}</text>
      {minVal < 0 && (
        <text x={padL - 8} y={y(minVal)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">{fmtAxis(minVal)}</text>
      )}

      {/* Solid trend */}
      {solidPts.length >= 2 && (
        <polyline points={solidPath} fill="none" stroke="#34d399" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {/* Dashed segment into the partial month */}
      {dashesTrailing && (
        <line
          x1={x(n - 2)}
          y1={y(nets[n - 2])}
          x2={x(n - 1)}
          y2={y(nets[n - 1])}
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
      )}

      {/* Markers + x labels */}
      {months.map((ym, i) => {
        const isPartial = i === partialIndex;
        return (
          <g key={ym}>
            {isPartial ? (
              <circle cx={x(i)} cy={y(nets[i])} r={4.5} fill="hsl(var(--background))" stroke="#f59e0b" strokeWidth={2}>
                <title>{`${monthLabel(ym)} (partial): ${fmtCurrency(nets[i])}`}</title>
              </circle>
            ) : (
              <circle cx={x(i)} cy={y(nets[i])} r={3.5} fill="#34d399">
                <title>{`${monthLabel(ym)}: ${fmtCurrency(nets[i])}`}</title>
              </circle>
            )}
            <text
              x={x(i)}
              y={H - padB + 18}
              textAnchor="middle"
              className={cn('text-[10px]', isPartial ? 'fill-amber-400' : 'fill-muted-foreground')}
            >
              {monthLabelShort(ym)}
              {isPartial ? ' ◦' : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function FleetMonthlyPnL() {
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [platform, setPlatform] = useState<Platform>('both');
  const [showChart, setShowChart] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const [result, setResult] = useState<MonthlyPnLResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Current calendar month, used to decide whether a missing commission is
  // expected (current/partial) or a real gap (closed month).
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Establish a sensible default range: last 6 months through the latest data month.
  useEffect(() => {
    const initRange = async () => {
      let latestYM = currentMonth;
      try {
        const { data } = await supabase
          .from('transactions')
          .select('date')
          .order('date', { ascending: false })
          .limit(1);
        const d = data?.[0]?.date;
        if (d) latestYM = String(d).slice(0, 7);
      } catch (err) {
        console.error('Fleet P&L: error finding latest data month:', err);
      }
      setToMonth(latestYM);
      setFromMonth(addMonthsYM(latestYM, -5));
      setInitialized(true);
    };
    initRange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialized) return;
    if (!isValidYM(fromMonth) || !isValidYM(toMonth)) return;
    if (fromMonth > toMonth) {
      setError('The "from" month must be on or before the "to" month.');
      setResult(null);
      setIsLoading(false);
      return;
    }
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await computeMonthlyPnL({ fromMonth, toMonth, platform });
        setResult(res);
      } catch (err) {
        console.error('Fleet P&L: error computing report:', err);
        setError('Failed to compute the Fleet Monthly P&L. See console for details.');
        setResult(null);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [initialized, fromMonth, toMonth, platform]);

  const months = result?.months ?? monthRange(fromMonth || currentMonth, toMonth || currentMonth);
  const totalCol = result ? sumMonths(result) : emptyLineItems();

  // Commission-calculation status per month → banner + header markers.
  const commStatus = result
    ? classifyCommissionMonths({
        months: result.months,
        commissionMonths: result.commissionMonths,
        partialMonth: result.partialMonth,
        currentMonth,
      })
    : {};
  const missingMonths = result ? result.months.filter((ym) => commStatus[ym] === 'missing') : [];
  const pendingMonths = result ? result.months.filter((ym) => commStatus[ym] === 'pending') : [];
  const partialMonth = result?.partialMonth ?? null;
  const hasPartialInRange = !!partialMonth && months.includes(partialMonth);

  const commissionNote = missingMonths.length
    ? `Commission not calculated for ${missingMonths.map(monthLabel).join(', ')} — Net may be overstated.`
    : '';

  const handleExportExcel = () => {
    if (!result) return;
    const excelData: (string | number)[][] = [];
    const rangeText =
      fromMonth === toMonth ? monthLabel(fromMonth) : `${monthLabel(fromMonth)} thru ${monthLabel(toMonth)}`;

    // Title (merged)
    excelData.push([`Fleet Monthly P&L — ${rangeText} (${platformLabel(platform)})`]);
    excelData.push([]);

    // Header: Line Item | months... | Total
    const headerRowVals: (string | number)[] = ['Line Item'];
    result.months.forEach((ym) => {
      headerRowVals.push(ym === partialMonth ? `${monthLabel(ym)} ◦` : monthLabel(ym));
    });
    headerRowVals.push('Total');
    excelData.push(headerRowVals);

    // Line-item rows
    ROWS.forEach((r) => {
      const row: (string | number)[] = [r.label];
      result.months.forEach((ym) => {
        row.push(Math.round(r.value(result.byMonthTotals[ym] || emptyLineItems())));
      });
      row.push(Math.round(r.value(totalCol)));
      excelData.push(row);
    });

    // Caveat rows so Tom sees them in the file
    excelData.push([]);
    if (hasPartialInRange) excelData.push([PARTIAL_FOOTNOTE]);
    if (commissionNote) excelData.push([`⚠ ${commissionNote}`]);

    const ws = XLSX.utils.aoa_to_sheet(excelData);

    const nCols = result.months.length + 2; // Line Item + months + Total
    const lastColIdx = nCols - 1;
    ws['!cols'] = [{ wch: 18 }, ...result.months.map(() => ({ wch: 14 })), { wch: 15 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastColIdx } }];

    const colLetter = (idx: number) => XLSX.utils.encode_col(idx);

    // Title style
    if (ws['A1']) {
      ws['A1'].s = {
        font: { bold: true, sz: 14, color: { rgb: '1F2937' } },
        alignment: { horizontal: 'left', vertical: 'center' },
        fill: { fgColor: { rgb: 'D1D5DB' } },
      };
    }

    const border = {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } },
    };

    // Header row (row index 2 → Excel row 3)
    const headerExcelRow = 3;
    for (let c = 0; c < nCols; c++) {
      const cell = `${colLetter(c)}${headerExcelRow}`;
      if (ws[cell]) {
        ws[cell].s = {
          font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '1F2937' } },
          alignment: { horizontal: c === 0 ? 'left' : 'center', vertical: 'center' },
          border,
        };
      }
    }

    // Data rows: first data row is Excel row 4
    const dataStart = 4;
    ROWS.forEach((r, ri) => {
      const excelRow = dataStart + ri;
      const isNet = r.emphasis;
      const isInfo = r.informational;
      // Label cell (col A)
      const labelCell = `A${excelRow}`;
      if (ws[labelCell]) {
        ws[labelCell].s = {
          font: { bold: isNet, sz: 12, italic: isInfo, color: isInfo ? { rgb: '6B7280' } : undefined },
          alignment: { horizontal: 'left', vertical: 'center' },
          border,
        };
      }
      // Value cells (months + Total)
      for (let c = 1; c < nCols; c++) {
        const cell = `${colLetter(c)}${excelRow}`;
        if (!ws[cell]) continue;
        const val = ws[cell].v;
        const isNegative = typeof val === 'number' && val < 0;
        const isTotalCol = c === lastColIdx;
        ws[cell].s = {
          font: {
            sz: 12,
            bold: isNet || isTotalCol,
            italic: isInfo,
            color: isNegative ? { rgb: 'DC2626' } : isInfo ? { rgb: '6B7280' } : undefined,
          },
          alignment: { horizontal: 'right', vertical: 'center' },
          numFmt: '$#,##0',
          border,
          fill: isNet ? { fgColor: { rgb: 'F3F4F6' } } : undefined,
        };
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fleet P&L');
    XLSX.writeFile(wb, `fleet-monthly-pnl-${fromMonth}-to-${toMonth}-${platform}.xlsx`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Fleet Monthly P&amp;L</CardTitle>
            <CardDescription>Fleet-wide profit &amp; loss by month</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowChart((s) => !s)}>
              {showChart ? <EyeOff className="w-4 h-4 mr-2" /> : <LineChart className="w-4 h-4 mr-2" />}
              {showChart ? 'Hide chart' : 'Show chart'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!result}>
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Excel
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From month</Label>
            <Input
              type="month"
              value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value)}
              className="w-[160px] h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To month</Label>
            <Input
              type="month"
              value={toMonth}
              onChange={(e) => setToMonth(e.target.value)}
              className="w-[160px] h-9"
            />
          </div>
          <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">All</SelectItem>
              <SelectItem value="denet">Denet</SelectItem>
              <SelectItem value="bitstop">Bitstop</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-md">
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Commission-not-calculated WARNING banner (closed months only) */}
        {missingMonths.length > 0 && (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-amber-400/30 bg-amber-500/[0.08]">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-semibold text-amber-300">Commission not calculated</div>
              <div className="text-muted-foreground">
                No commission calculation exists for{' '}
                <span className="text-foreground font-medium">{missingMonths.map(monthLabel).join(', ')}</span>. Net
                P&amp;L for {missingMonths.length > 1 ? 'these months' : 'this month'} may be overstated.
              </div>
            </div>
          </div>
        )}

        {/* Pending-commission INFO banner (current/partial months — expected) */}
        {pendingMonths.length > 0 && (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-white/10 bg-white/[0.02]">
            <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground">
              Commission for{' '}
              <span className="text-foreground font-medium">{pendingMonths.map(monthLabel).join(', ')}</span> has not
              been calculated yet — commission runs after month close.
            </div>
          </div>
        )}

        {/* Trend chart */}
        {showChart && result && (
          <div className="rounded-md border border-white/10 p-4 text-emerald-400">
            <div className="text-xs font-medium text-muted-foreground mb-1">Net P&amp;L trend</div>
            <NetPnLChart
              months={result.months}
              nets={result.months.map((ym) => (result.byMonthTotals[ym] || emptyLineItems()).net_profit)}
              partialMonth={result.partialMonth}
            />
          </div>
        )}

        {/* Table */}
        <div className="rounded-md border border-white/10 overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/5">
              <TableRow className="border-white/10">
                <TableHead className="font-bold sticky left-0 bg-background z-10">Line Item</TableHead>
                {months.map((ym) => {
                  const isPartial = ym === partialMonth;
                  const isMissing = commStatus[ym] === 'missing';
                  return (
                    <TableHead
                      key={ym}
                      className={cn(
                        'text-right font-bold whitespace-nowrap',
                        (isPartial || isMissing) && 'text-amber-400',
                      )}
                      title={
                        [
                          isPartial ? 'Partial month — incomplete data' : '',
                          isMissing ? 'Commission not calculated' : '',
                        ]
                          .filter(Boolean)
                          .join(' · ') || undefined
                      }
                    >
                      {monthLabelShort(ym)}
                      {isMissing && ' ⚠'}
                      {isPartial && ' ◦'}
                    </TableHead>
                  );
                })}
                <TableHead className="text-right font-bold whitespace-nowrap">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={months.length + 2} className="text-center text-muted-foreground py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !result ? (
                <TableRow>
                  <TableCell colSpan={months.length + 2} className="text-center text-muted-foreground py-8">
                    No data available for selected range
                  </TableCell>
                </TableRow>
              ) : (
                ROWS.map((r) => (
                  <TableRow
                    key={r.key}
                    className={cn(
                      'border-white/5',
                      r.informational && 'text-muted-foreground italic border-b-2 border-b-white/10',
                      r.emphasis && 'border-t-2 border-t-white/20 bg-white/5 font-bold',
                    )}
                  >
                    <TableCell
                      className={cn(
                        'sticky left-0 bg-background z-10',
                        r.emphasis ? 'font-bold' : 'font-medium',
                        r.informational && 'font-normal',
                      )}
                    >
                      {r.label}
                    </TableCell>
                    {months.map((ym) => {
                      const v = r.value(result.byMonthTotals[ym] || emptyLineItems());
                      return (
                        <TableCell
                          key={ym}
                          className={cn(
                            'text-right font-mono',
                            r.emphasis && (v < 0 ? 'text-red-400' : v > 0 ? 'text-green-400' : ''),
                          )}
                        >
                          {fmtCurrency(v)}
                        </TableCell>
                      );
                    })}
                    {(() => {
                      const v = r.value(totalCol);
                      return (
                        <TableCell
                          className={cn(
                            'text-right font-mono font-semibold',
                            r.emphasis && (v < 0 ? 'text-red-400' : v > 0 ? 'text-green-400' : ''),
                          )}
                        >
                          {fmtCurrency(v)}
                        </TableCell>
                      );
                    })()}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footnotes */}
        {result && (hasPartialInRange || missingMonths.length > 0) && (
          <div className="space-y-1 text-xs text-muted-foreground">
            {hasPartialInRange && <div>{PARTIAL_FOOTNOTE}</div>}
            {missingMonths.length > 0 && <div>⚠ {commissionNote}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
