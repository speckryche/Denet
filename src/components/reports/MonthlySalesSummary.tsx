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
      // Get total count
      const { count } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true });

      // Fetch in batches to get ALL transaction dates
      const batchSize = 1000;
      const batches = Math.ceil((count || 0) / batchSize);
      let allTransactions: any[] = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;

        const { data, error } = await supabase
          .from('transactions')
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
        .from('transactions')
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
          .from('transactions')
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sales by Month - totals</CardTitle>
            <CardDescription>
              Monthly sales breakdown by platform for {selectedYear}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="w-4 h-4 mr-2" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportExcel}>
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Excel
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Year Filter */}
        <div className="flex gap-4">
          <Select value={selectedYear.toString()} onValueChange={(val) => setSelectedYear(parseInt(val))}>
            <SelectTrigger className="w-[180px]">
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
        </div>

        {/* Table */}
        <div className="rounded-md border border-white/10 overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/5">
              <TableRow className="border-white/10">
                <TableHead className="font-bold">Platform</TableHead>
                {months.map(month => (
                  <TableHead key={month} className="text-center font-bold w-[100px]">{month}</TableHead>
                ))}
                <TableHead className="text-center font-bold w-[100px]">Totals</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground">
                    No data available for {selectedYear}
                  </TableCell>
                </TableRow>
              ) : (
                data.map((row, idx) => (
                  <TableRow key={idx} className="border-white/5">
                    <TableCell className="font-medium">
                      {row.platform === 'bitstop' ? 'Bitstop Machines' : 'Denet Machines'}
                    </TableCell>
                    {months.map((_, monthIdx) => {
                      const monthKey = `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}`;
                      const value = row.monthlyTotals[monthKey] || 0;
                      return (
                        <TableCell key={monthIdx} className="text-center font-mono">
                          ${Math.round(value).toLocaleString('en-US')}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center font-mono font-semibold">
                      ${Math.round(row.yearTotal).toLocaleString('en-US')}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
