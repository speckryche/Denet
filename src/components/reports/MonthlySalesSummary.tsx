import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileSpreadsheet } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import * as XLSX from 'xlsx-js-style';
import { KpiCard } from '@/components/dashboard/MetricsGrid';

interface PlatformMonthlyData {
  platform: string;
  monthlyTotals: { [key: string]: number }; // key is "YYYY-MM"
  yearTotal: number;
}

export default function MonthlySalesSummary() {
  const [data, setData] = useState<PlatformMonthlyData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  useEffect(() => {
    fetchAvailableYears();
  }, []);

  useEffect(() => {
    if (availableYears.length > 0) {
      fetchMonthlySales();
    }
  }, [selectedYear, availableYears]);

  const fetchAvailableYears = async () => {
    try {
      // Get total count (completed only — status rules in transaction-status.ts).
      const { count } = await supabase
        .from('financial_transactions')
        .select('*', { count: 'exact', head: true });

      // Fetch in batches to get ALL transaction dates
      const batchSize = 1000;
      const batches = Math.ceil((count || 0) / batchSize);
      let allTransactions: any[] = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;

        const { data, error } = await supabase
          .from('financial_transactions')
          .select('date')
          .range(from, to);

        if (error) throw error;
        if (data) {
          allTransactions = allTransactions.concat(data);
        }
      }

      const years = new Set<number>();
      allTransactions.forEach(tx => {
        if (tx.date) {
          const year = new Date(tx.date).getFullYear();
          if (!isNaN(year)) {
            years.add(year);
          }
        }
      });

      const sortedYears = Array.from(years).sort((a, b) => b - a);
      setAvailableYears(sortedYears);

      if (sortedYears.length > 0 && !sortedYears.includes(selectedYear)) {
        setSelectedYear(sortedYears[0]);
      }
    } catch (error) {
      console.error('Error fetching years:', error);
    }
  };

  const fetchMonthlySales = async () => {
    setIsLoading(true);
    try {
      // First, get the count
      const { count } = await supabase
        .from('financial_transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', `${selectedYear}-01-01`)
        .lte('date', `${selectedYear}-12-31`);

      // Fetch in batches to get all transactions
      const batchSize = 1000;
      const batches = Math.ceil((count || 0) / batchSize);
      let allTransactions: any[] = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;

        const { data, error } = await supabase
          .from('financial_transactions')
          .select('date, sale, platform')
          .gte('date', `${selectedYear}-01-01`)
          .lte('date', `${selectedYear}-12-31`)
          .range(from, to);

        if (error) throw error;
        if (data) {
          allTransactions = allTransactions.concat(data);
        }
      }

      const transactions = allTransactions;

      // Group by platform and month
      const platformData = new Map<string, PlatformMonthlyData>();

      transactions?.forEach(tx => {
        const date = new Date(tx.date);
        const year = date.getFullYear();

        // Only include transactions from selected year
        if (year !== selectedYear) return;

        const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const platform = tx.platform;

        if (!platformData.has(platform)) {
          platformData.set(platform, {
            platform: platform,
            monthlyTotals: {},
            yearTotal: 0
          });
        }

        const entry = platformData.get(platform)!;
        if (!entry.monthlyTotals[monthKey]) {
          entry.monthlyTotals[monthKey] = 0;
        }

        entry.monthlyTotals[monthKey] += tx.sale || 0;
        entry.yearTotal += tx.sale || 0;
      });

      // Sort platforms: Bitstop first, then Denet
      const sortedData = Array.from(platformData.values()).sort((a, b) => {
        if (a.platform === 'bitstop') return -1;
        if (b.platform === 'bitstop') return 1;
        return a.platform.localeCompare(b.platform);
      });

      setData(sortedData);
    } catch (error) {
      console.error('Error fetching monthly sales:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCSV = () => {
    const headers = ['Platform', ...months, 'Totals'];
    const rows = data.map(row => {
      const monthValues = months.map((_, idx) => {
        const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
        return row.monthlyTotals[monthKey] || 0;
      });
      return [
        row.platform === 'bitstop' ? 'Bitstop Machines' : 'Denet Machines',
        ...monthValues.map(v => v.toFixed(0)),
        row.yearTotal.toFixed(0)
      ];
    });

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `monthly-sales-summary-${selectedYear}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    const excelData = [];

    // Add title row
    excelData.push([`Sales by Month - totals - ${selectedYear}`]);
    excelData.push([]); // Empty row

    // Add headers
    excelData.push(['Platform', ...months, 'Totals']);

    // Add data rows
    data.forEach(row => {
      const monthValues = months.map((_, idx) => {
        const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
        return Math.round(row.monthlyTotals[monthKey] || 0);
      });
      excelData.push([
        row.platform === 'bitstop' ? 'Bitstop Machines' : 'Denet Machines',
        ...monthValues,
        Math.round(row.yearTotal)
      ]);
    });

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths
    const colWidths = [{ wch: 20 }, ...months.map(() => ({ wch: 12 })), { wch: 15 }];
    ws['!cols'] = colWidths;

    // Style the title row (row 1)
    ws['A1'].s = {
      font: { bold: true, sz: 14, color: { rgb: "1F2937" } },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: "D1D5DB" } }
    };

    // Merge title cells
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 13 } }]; // 14 columns total

    // Style header row (row 3)
    const headerStyle = {
      font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1F2937" } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: "000000" } },
        bottom: { style: 'thin', color: { rgb: "000000" } },
        left: { style: 'thin', color: { rgb: "000000" } },
        right: { style: 'thin', color: { rgb: "000000" } }
      }
    };

    const headerCells = ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3', 'M3', 'N3'];
    headerCells.forEach(cell => {
      if (ws[cell]) {
        ws[cell].s = headerStyle;
      }
    });

    // Style data rows
    const dataStartRow = 4;
    const dataEndRow = dataStartRow + data.length - 1;

    for (let i = dataStartRow; i <= dataEndRow; i++) {
      // Platform column (A)
      const platformCell = `A${i}`;
      if (ws[platformCell]) {
        ws[platformCell].s = {
          font: { sz: 12 },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: "000000" } },
            bottom: { style: 'thin', color: { rgb: "000000" } },
            left: { style: 'thin', color: { rgb: "000000" } },
            right: { style: 'thin', color: { rgb: "000000" } }
          }
        };
      }

      // Month columns (B through M) and Total column (N) - currency format
      ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'].forEach(col => {
        const cell = `${col}${i}`;
        if (ws[cell]) {
          const cellValue = ws[cell].v;
          const isNegative = typeof cellValue === 'number' && cellValue < 0;

          ws[cell].s = {
            font: {
              sz: 12,
              color: isNegative ? { rgb: "DC2626" } : undefined,
              bold: col === 'N' // Bold for Totals column
            },
            alignment: { horizontal: 'center', vertical: 'center' },
            numFmt: '$#,##0',
            border: {
              top: { style: 'thin', color: { rgb: "000000" } },
              bottom: { style: 'thin', color: { rgb: "000000" } },
              left: { style: 'thin', color: { rgb: "000000" } },
              right: { style: 'thin', color: { rgb: "000000" } }
            }
          };
        }
      });
    }

    // Create workbook and download
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Monthly Sales');
    XLSX.writeFile(wb, `monthly-sales-summary-${selectedYear}.xlsx`);
  };

  // Display-only roll-ups of the rows already computed above (no extra fetch).
  const platformLabel = (platform: string) =>
    platform === 'bitstop' ? 'Bitstop Machines' : 'Denet Machines';
  const allPlatformsTotal = data.reduce((sum, row) => sum + row.yearTotal, 0);
  const monthKeyFor = (monthIdx: number) =>
    `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}`;
  const allPlatformsMonth = (monthIdx: number) => {
    const key = monthKeyFor(monthIdx);
    const rows = data.filter((row) => row.monthlyTotals[key] !== undefined);
    return rows.length === 0 ? undefined : rows.reduce((sum, row) => sum + row.monthlyTotals[key], 0);
  };
  const formatUsd = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`;
  const sharePercent = (value: number) =>
    allPlatformsTotal > 0 ? `${((value / allPlatformsTotal) * 100).toFixed(1)}% of ${selectedYear} sales` : undefined;

  const headCell = "h-auto py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-dim";
  const numCell = "px-1 py-[9px] text-right text-[12.5px] tabular-nums truncate";
  const firstCol = "pl-4 pr-[7px] py-[9px] text-[12.5px]";
  const lastCol = "pl-[7px] pr-4 py-[9px] text-right text-[12.5px] font-semibold tabular-nums truncate";

  return (
    <div className="space-y-[18px]">
      {!isLoading && data.length > 0 && (
        <section className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
          <KpiCard label={`${selectedYear} sales`} value={formatUsd(allPlatformsTotal)} sub="All platforms" />
          {data.map((row) => (
            <KpiCard
              key={row.platform}
              label={platformLabel(row.platform)}
              value={formatUsd(row.yearTotal)}
              sub={sharePercent(row.yearTotal)}
            />
          ))}
        </section>
      )}

      <Card className="min-w-0 overflow-hidden rounded-[14px]">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 border-b border-border px-[18px] py-3.5">
          <div>
            <CardTitle className="text-[15px] tracking-tight">Sales by month — totals</CardTitle>
            <CardDescription className="mt-0.5 text-xs text-dim">
              Monthly sales by platform for {selectedYear}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={selectedYear.toString()} onValueChange={(val) => setSelectedYear(parseInt(val))}>
              <SelectTrigger className="h-[34px] w-[120px] dark:bg-card" aria-label="Year">
                <SelectValue placeholder="Select Year" />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map(year => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-[34px] bg-card" onClick={handleExportCSV}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Button size="sm" className="h-[34px]" onClick={handleExportExcel}>
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Export Excel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={`${headCell} w-[9%] pl-4 pr-[7px]`}>Platform</TableHead>
                {months.map(month => (
                  <TableHead key={month} className={`${headCell} w-[6.75%] px-1 text-right`}>{month}</TableHead>
                ))}
                <TableHead className={`${headCell} w-[10%] pl-[7px] pr-4 text-right`}>Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={14} className="h-20 text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={14} className="h-20 text-center text-muted-foreground">
                    No data available for {selectedYear}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {data.map((row, idx) => (
                    <TableRow key={idx} className="hover:bg-surface-2">
                      <TableCell className={firstCol}>
                        {platformLabel(row.platform)}
                      </TableCell>
                      {months.map((_, monthIdx) => {
                        const value = row.monthlyTotals[monthKeyFor(monthIdx)];
                        return (
                          <TableCell key={monthIdx} className={numCell} title={value === undefined ? undefined : formatUsd(value)}>
                            {value === undefined ? <span className="text-dim">—</span> : formatUsd(value)}
                          </TableCell>
                        );
                      })}
                      <TableCell className={lastCol} title={formatUsd(row.yearTotal)}>
                        {formatUsd(row.yearTotal)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.length > 1 && (
                    <TableRow className="bg-surface-2/60 font-semibold hover:bg-surface-2">
                      <TableCell className={firstCol}>All platforms</TableCell>
                      {months.map((_, monthIdx) => {
                        const value = allPlatformsMonth(monthIdx);
                        return (
                          <TableCell key={monthIdx} className={numCell} title={value === undefined ? undefined : formatUsd(value)}>
                            {value === undefined ? <span className="text-dim">—</span> : formatUsd(value)}
                          </TableCell>
                        );
                      })}
                      <TableCell className={lastCol} title={formatUsd(allPlatformsTotal)}>{formatUsd(allPlatformsTotal)}</TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
