import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
  computeMonthlyPnL,
  monthRange,
  yearStartYM,
  classifyCommissionMonths,
  type Platform,
  type MonthlyPnLResult,
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
import { FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import {
  monthLabel,
  monthLabelShort,
  isValidYM,
  fmtCurrency,
  platformLabel,
  commissionNote,
  PARTIAL_FOOTNOTE,
  CommissionBanners,
  ReportFootnotes,
} from './pnl-shared';

// One machine's per-month net + range total, assembled from byMachineMonthNet.
interface MachineRow {
  atm_id: string;
  atm_name: string;
  // net by 'YYYY-MM'. A month absent from the map means no activity on the
  // selected platform that month (rendered as a dash, not $0).
  netByMonth: Record<string, number>;
  total: number;
}

export default function PerMachineMonthlyPnL() {
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [platform, setPlatform] = useState<Platform>('both');
  const [initialized, setInitialized] = useState(false);

  const [result, setResult] = useState<MonthlyPnLResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Default range: last 6 months through the latest data month (mirrors Fleet).
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
        console.error('Per-Machine P&L: error finding latest data month:', err);
      }
      // Year-to-date default: January of the latest-data year → latest-data month.
      setToMonth(latestYM);
      setFromMonth(yearStartYM(latestYM));
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
        // Platform param drives converted-machine show/hide: in denet/bitstop
        // mode the engine only emits cells for the matching-platform profile, so
        // byMachineMonthNet naturally contains only that platform's months.
        const res = await computeMonthlyPnL({ fromMonth, toMonth, platform });
        setResult(res);
      } catch (err) {
        console.error('Per-Machine P&L: error computing report:', err);
        setError('Failed to compute the Per-Machine Monthly P&L. See console for details.');
        setResult(null);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [initialized, fromMonth, toMonth, platform]);

  const months = result?.months ?? monthRange(fromMonth || currentMonth, toMonth || currentMonth);
  const partialMonth = result?.partialMonth ?? null;
  const hasPartialInRange = !!partialMonth && months.includes(partialMonth);

  // Commission-calculation status per month → banners + header markers (shared).
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

  // Build one row per machine. machineMeta is the authoritative set of machines
  // in this view (it includes zero-tx machines that still incur rent), so a
  // machine with expenses but no sales still shows a row. Sorted by range Total
  // descending — top performers first, loss-makers surface at the bottom.
  const rows: MachineRow[] = result
    ? Object.keys(result.machineMeta)
        .map((atmId) => {
          const netByMonth = result.byMachineMonthNet[atmId] || {};
          let total = 0;
          for (const ym of result.months) total += netByMonth[ym] || 0;
          return {
            atm_id: atmId,
            atm_name: result.machineMeta[atmId].atm_name,
            netByMonth,
            total,
          };
        })
        .sort((a, b) => b.total - a.total)
    : [];

  // Fleet net row: sum of every machine's net per month. Equals the Fleet
  // report's Net P&L row (both roll up the same cells).
  const fleetNetByMonth: Record<string, number> = {};
  let fleetTotal = 0;
  for (const ym of months) {
    let s = 0;
    for (const r of rows) s += r.netByMonth[ym] || 0;
    fleetNetByMonth[ym] = s;
    fleetTotal += s;
  }

  const netCellClass = (v: number | undefined) =>
    v === undefined ? '' : v < 0 ? 'text-red-400' : v > 0 ? 'text-green-400' : '';

  const handleExportExcel = () => {
    if (!result) return;
    const excelData: (string | number)[][] = [];
    const rangeText =
      fromMonth === toMonth ? monthLabel(fromMonth) : `${monthLabel(fromMonth)} thru ${monthLabel(toMonth)}`;

    // Title (merged)
    excelData.push([`Per-Machine Monthly P&L — ${rangeText} (${platformLabel(platform)})`]);
    excelData.push([]);

    // Header: Machine | months... | Total
    const headerRowVals: (string | number)[] = ['Machine'];
    result.months.forEach((ym) => {
      headerRowVals.push(ym === partialMonth ? `${monthLabel(ym)} ◦` : monthLabel(ym));
    });
    headerRowVals.push('Total');
    excelData.push(headerRowVals);

    // Machine rows (blank cell where no activity on the selected platform).
    rows.forEach((r) => {
      const row: (string | number)[] = [`${r.atm_name} (${r.atm_id})`];
      result.months.forEach((ym) => {
        const v = r.netByMonth[ym];
        row.push(v === undefined ? '' : Math.round(v));
      });
      row.push(Math.round(r.total));
      excelData.push(row);
    });

    // Fleet net row
    const fleetRow: (string | number)[] = ['Fleet net'];
    result.months.forEach((ym) => fleetRow.push(Math.round(fleetNetByMonth[ym] || 0)));
    fleetRow.push(Math.round(fleetTotal));
    excelData.push(fleetRow);

    // Caveat rows
    excelData.push([]);
    if (hasPartialInRange) excelData.push([PARTIAL_FOOTNOTE]);
    const note = commissionNote(missingMonths);
    if (note) excelData.push([`⚠ ${note}`]);

    const ws = XLSX.utils.aoa_to_sheet(excelData);

    const nCols = result.months.length + 2; // Machine + months + Total
    const lastColIdx = nCols - 1;
    ws['!cols'] = [{ wch: 34 }, ...result.months.map(() => ({ wch: 13 })), { wch: 14 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastColIdx } }];

    const colLetter = (idx: number) => XLSX.utils.encode_col(idx);

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

    // Header row (Excel row 3)
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

    // Data rows (machines) + Fleet net row
    const dataStart = 4;
    const totalRowExcel = dataStart + rows.length; // Fleet net row index
    for (let ri = 0; ri <= rows.length; ri++) {
      const excelRow = dataStart + ri;
      const isFleet = excelRow === totalRowExcel;
      // Label cell (col A)
      const labelCell = `A${excelRow}`;
      if (ws[labelCell]) {
        ws[labelCell].s = {
          font: { bold: isFleet, sz: 12 },
          alignment: { horizontal: 'left', vertical: 'center' },
          border,
          fill: isFleet ? { fgColor: { rgb: 'D1D5DB' } } : undefined,
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
            bold: isFleet || isTotalCol,
            color: isNegative ? { rgb: 'DC2626' } : undefined,
          },
          alignment: { horizontal: 'right', vertical: 'center' },
          numFmt: '$#,##0',
          border,
          fill: isFleet ? { fgColor: { rgb: 'D1D5DB' } } : undefined,
        };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Per-Machine P&L');
    XLSX.writeFile(wb, `per-machine-monthly-pnl-${fromMonth}-to-${toMonth}-${platform}.xlsx`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Per-Machine Monthly P&amp;L</CardTitle>
            <CardDescription>Net P&amp;L by machine, by month</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!result}>
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Excel
          </Button>
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

        {/* Two-state commission-not-calculated banners (shared with Fleet) */}
        <CommissionBanners missingMonths={missingMonths} pendingMonths={pendingMonths} />

        {/* Table */}
        <div className="rounded-md border border-white/10 overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/5">
              <TableRow className="border-white/10">
                <TableHead className="font-bold sticky left-0 bg-background z-10">Machine</TableHead>
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
              ) : !result || rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={months.length + 2} className="text-center text-muted-foreground py-8">
                    No data available for selected range
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {rows.map((r) => (
                    <TableRow key={r.atm_id} className="border-white/5">
                      <TableCell className="sticky left-0 bg-background z-10 font-medium whitespace-nowrap">
                        <span>{r.atm_name}</span>
                        <span className="text-muted-foreground text-xs ml-1.5 font-mono">{r.atm_id}</span>
                      </TableCell>
                      {months.map((ym) => {
                        const v = r.netByMonth[ym];
                        return (
                          <TableCell key={ym} className={cn('text-right font-mono', netCellClass(v))}>
                            {v === undefined ? '—' : fmtCurrency(v)}
                          </TableCell>
                        );
                      })}
                      <TableCell className={cn('text-right font-mono font-semibold', netCellClass(r.total))}>
                        {fmtCurrency(r.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Fleet net total row */}
                  <TableRow className="border-t-2 border-t-white/20 bg-white/5 font-bold">
                    <TableCell className="sticky left-0 bg-background z-10 font-bold">Fleet net</TableCell>
                    {months.map((ym) => {
                      const v = fleetNetByMonth[ym] || 0;
                      return (
                        <TableCell key={ym} className={cn('text-right font-mono', netCellClass(v))}>
                          {fmtCurrency(v)}
                        </TableCell>
                      );
                    })}
                    <TableCell className={cn('text-right font-mono', netCellClass(fleetTotal))}>
                      {fmtCurrency(fleetTotal)}
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>

        {/* Footnotes */}
        {result && <ReportFootnotes hasPartial={hasPartialInRange} missingMonths={missingMonths} />}
      </CardContent>
    </Card>
  );
}
