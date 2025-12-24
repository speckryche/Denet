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

interface ATMMonthlyData {
  active: boolean | null;
  installed_date: string | null;
  removed_date: string | null;
  atm_id: string;
  atm_name: string;
  platform: string;
  monthlyTotals: { [key: string]: number }; // key is "YYYY-MM"
  yearTotal: number;
}

export default function ATMMonthlySales() {
  const [data, setData] = useState<ATMMonthlyData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedPlatform, setSelectedPlatform] = useState<string>('both');
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];

  useEffect(() => {
    fetchAvailableYears();
  }, []);

  useEffect(() => {
    if (availableYears.length > 0) {
      fetchMonthlySales();
    }
  }, [selectedYear, selectedPlatform, availableYears]);

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
      let countQuery = supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', `${selectedYear}-01-01`)
        .lte('date', `${selectedYear}-12-31`);

      // Apply platform filter if not 'both'
      if (selectedPlatform !== 'both') {
        countQuery = countQuery.eq('platform', selectedPlatform);
      }

      const { count } = await countQuery;

      // Fetch in batches to get all transactions
      const batchSize = 1000;
      const batches = Math.ceil((count || 0) / batchSize);
      let allTransactions: any[] = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;

        let query = supabase
          .from('transactions')
          .select('date, sale, platform, atm_id')
          .gte('date', `${selectedYear}-01-01`)
          .lte('date', `${selectedYear}-12-31`)
          .range(from, to);

        // Apply platform filter if not 'both'
        if (selectedPlatform !== 'both') {
          query = query.eq('platform', selectedPlatform);
        }

        const { data, error } = await query;

        if (error) throw error;
        if (data) {
          allTransactions = allTransactions.concat(data);
        }
      }

      // Fetch ATM profiles for names, active status, and date fields
      const { data: atmProfiles, error: atmError } = await supabase
        .from('atm_profiles')
        .select('atm_id, location_name, active, platform, installed_date, removed_date');

      if (atmError) throw atmError;

      // Create a map of ATM profiles
      const atmMap = new Map<string, any>();
      atmProfiles?.forEach(atm => {
        atmMap.set(atm.atm_id, atm);
      });

      // Helper function: Determine if ATM should be included in report
      const shouldIncludeATM = (profile: any): boolean => {
        // Skip if platform filter doesn't match
        if (selectedPlatform !== 'both' && profile.platform !== selectedPlatform) {
          return false;
        }

        const yearStart = new Date(selectedYear, 0, 1);
        const yearEnd = new Date(selectedYear, 11, 31);

        // Parse install date
        let installDate = null;
        if (profile.installed_date) {
          const [iYear, iMonth, iDay] = profile.installed_date.split('-').map(Number);
          installDate = new Date(iYear, iMonth - 1, iDay);
        }

        // Parse removal date
        let removalDate = null;
        if (profile.removed_date) {
          const [rYear, rMonth, rDay] = profile.removed_date.split('-').map(Number);
          removalDate = new Date(rYear, rMonth - 1, rDay);
        }

        // Case b: Currently Active AND installed before/during the selected year
        if (profile.active === true && installDate && installDate <= yearEnd) {
          return true;
        }

        // Case c: Currently Inactive BUT was Active at some point during the selected year
        if (profile.active === false) {
          // If no install date, we can't determine if it was active during the year
          if (!installDate) return false;

          // If installed after the year, it wasn't active during the year
          if (installDate > yearEnd) return false;

          // If removed before the year started, it wasn't active during the year
          if (removalDate && removalDate < yearStart) return false;

          // Otherwise, it was active at some point during the year
          return true;
        }

        return false;
      };

      // Group by ATM and month
      const atmData = new Map<string, ATMMonthlyData>();

      // Process transactions (Case a: ATMs with transactions in selected year)
      allTransactions?.forEach(tx => {
        if (!tx.atm_id) return;

        const date = new Date(tx.date);
        const year = date.getFullYear();

        // Only include transactions from selected year
        if (year !== selectedYear) return;

        const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const atmProfile = atmMap.get(tx.atm_id);
        const atmName = atmProfile?.location_name || tx.atm_id;

        if (!atmData.has(tx.atm_id)) {
          atmData.set(tx.atm_id, {
            active: atmProfile?.active ?? null,
            installed_date: atmProfile?.installed_date ?? null,
            removed_date: atmProfile?.removed_date ?? null,
            atm_id: tx.atm_id,
            atm_name: atmName,
            platform: atmProfile?.platform || tx.platform,
            monthlyTotals: {},
            yearTotal: 0
          });
        }

        const entry = atmData.get(tx.atm_id)!;
        if (!entry.monthlyTotals[monthKey]) {
          entry.monthlyTotals[monthKey] = 0;
        }

        entry.monthlyTotals[monthKey] += tx.sale || 0;
        entry.yearTotal += tx.sale || 0;
      });

      // Add ATMs without transactions but that should be included (Cases b & c)
      atmProfiles?.forEach(profile => {
        // Skip if already added from transactions
        if (atmData.has(profile.atm_id)) return;

        // Check if this ATM should be included
        if (shouldIncludeATM(profile)) {
          atmData.set(profile.atm_id, {
            active: profile.active ?? null,
            installed_date: profile.installed_date ?? null,
            removed_date: profile.removed_date ?? null,
            atm_id: profile.atm_id,
            atm_name: profile.location_name || profile.atm_id,
            platform: profile.platform,
            monthlyTotals: {},
            yearTotal: 0
          });
        }
      });

      // Sort by Totals (descending) as default
      const sortedData = Array.from(atmData.values()).sort((a, b) =>
        b.yearTotal - a.yearTotal
      );

      setData(sortedData);
    } catch (error) {
      console.error('Error fetching monthly sales:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Format date helper function
  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '-';
    const [year, month, day] = dateStr.split('-');
    return `${month}/${day}/${year.slice(2)}`;
  };

  const handleExportCSV = () => {
    const headers = ['Status', 'Install', 'Removed', 'ATM ID', 'ATM Name', 'Platform', ...months, 'Totals'];
    const rows = data.map(row => {
      const monthValues = months.map((_, idx) => {
        const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
        return row.monthlyTotals[monthKey] || 0;
      });
      return [
        row.active === false ? 'Inactive' : 'Active',
        formatDate(row.installed_date),
        formatDate(row.removed_date),
        row.atm_id,
        row.atm_name,
        row.platform === 'bitstop' ? 'Bitstop' : 'Denet',
        ...monthValues.map(v => v.toFixed(0)),
        row.yearTotal.toFixed(0)
      ];
    });

    // Add totals row
    const totals = data.reduce((acc, row) => {
      months.forEach((_, idx) => {
        const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
        if (!acc.monthlyTotals[monthKey]) {
          acc.monthlyTotals[monthKey] = 0;
        }
        acc.monthlyTotals[monthKey] += row.monthlyTotals[monthKey] || 0;
      });
      acc.yearTotal += row.yearTotal;
      return acc;
    }, { monthlyTotals: {} as { [key: string]: number }, yearTotal: 0 });

    const monthTotals = months.map((_, idx) => {
      const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
      return totals.monthlyTotals[monthKey] || 0;
    });

    rows.push([
      '',
      '',
      '',
      'TOTAL',
      '',
      '',
      ...monthTotals.map(v => v.toFixed(0)),
      totals.yearTotal.toFixed(0)
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    const platformSuffix = selectedPlatform === 'both'
      ? 'Both'
      : selectedPlatform === 'bitstop'
        ? 'Bitstop'
        : 'Denet';

    link.download = `atm-monthly-sales-${selectedYear}-${platformSuffix}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    const excelData = [];

    // Add title row with platform filter
    const platformText = selectedPlatform === 'both'
      ? 'Both platforms'
      : selectedPlatform === 'bitstop'
        ? 'Bitstop platform'
        : 'Denet platform';

    excelData.push([`Sales by Month - by ATM - ${selectedYear} (${platformText})`]);
    excelData.push([]); // Empty row

    // Add headers
    excelData.push(['Status', 'Install', 'Removed', 'ATM ID', 'ATM Name', 'Platform', ...months, 'Totals']);

    // Add data rows (sorted by Year Total descending)
    const sortedExcelData = [...data].sort((a, b) => b.yearTotal - a.yearTotal);

    sortedExcelData.forEach(row => {
      const monthValues = months.map((_, idx) => {
        const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
        return Math.round(row.monthlyTotals[monthKey] || 0);
      });
      excelData.push([
        row.active === false ? 'Inactive' : 'Active',
        formatDate(row.installed_date),
        formatDate(row.removed_date),
        row.atm_id,
        row.atm_name,
        row.platform === 'bitstop' ? 'Bitstop' : 'Denet',
        ...monthValues,
        Math.round(row.yearTotal)
      ]);
    });

    // Add totals row
    const totals = data.reduce((acc, row) => {
      months.forEach((_, idx) => {
        const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
        if (!acc.monthlyTotals[monthKey]) {
          acc.monthlyTotals[monthKey] = 0;
        }
        acc.monthlyTotals[monthKey] += row.monthlyTotals[monthKey] || 0;
      });
      acc.yearTotal += row.yearTotal;
      return acc;
    }, { monthlyTotals: {} as { [key: string]: number }, yearTotal: 0 });

    const monthTotals = months.map((_, idx) => {
      const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
      return Math.round(totals.monthlyTotals[monthKey] || 0);
    });

    excelData.push([
      '',
      '',
      '',
      'TOTAL',
      '',
      '',
      ...monthTotals,
      Math.round(totals.yearTotal)
    ]);

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths
    const colWidths = [
      { wch: 10 },  // Status
      { wch: 12 },  // Install
      { wch: 12 },  // Removed
      { wch: 10 },  // ATM ID
      { wch: 30 },  // ATM Name
      { wch: 12 },  // Platform
      ...months.map(() => ({ wch: 12 })), // Month columns
      { wch: 15 }   // Totals
    ];
    ws['!cols'] = colWidths;

    // Style the title row (row 1)
    ws['A1'].s = {
      font: { bold: true, sz: 14, color: { rgb: "1F2937" } },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: "D1D5DB" } }
    };

    // Merge title cells (19 columns total: Status, Install, Removed, ATM ID, Name, Platform + 12 months + Totals)
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 18 } }];

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

    const headerCells = ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3', 'J3', 'K3', 'L3', 'M3', 'N3', 'O3', 'P3', 'Q3', 'R3', 'S3'];
    headerCells.forEach(cell => {
      if (ws[cell]) {
        ws[cell].s = headerStyle;
      }
    });

    // Style data rows and totals row
    const dataStartRow = 4;
    const totalRow = dataStartRow + sortedExcelData.length;

    for (let i = dataStartRow; i <= totalRow; i++) {
      const isTotal = i === totalRow;

      // Status column (A) - with red/green color
      const statusCell = `A${i}`;
      if (ws[statusCell]) {
        const statusValue = ws[statusCell].v;
        const isInactive = statusValue === 'Inactive';
        ws[statusCell].s = {
          font: {
            bold: isTotal,
            sz: 12,
            color: isTotal ? undefined : (isInactive ? { rgb: "EF4444" } : { rgb: "22C55E" }) // red-500 or green-500
          },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: "000000" } },
            bottom: { style: 'thin', color: { rgb: "000000" } },
            left: { style: 'thin', color: { rgb: "000000" } },
            right: { style: 'thin', color: { rgb: "000000" } }
          },
          fill: isTotal ? { fgColor: { rgb: "D1D5DB" } } : undefined
        };
      }

      // Install, Removed, ATM ID, Name, and Platform columns (B, C, D, E, F)
      ['B', 'C', 'D', 'E', 'F'].forEach(col => {
        const cell = `${col}${i}`;
        if (ws[cell]) {
          ws[cell].s = {
            font: { bold: isTotal, sz: 12 },
            alignment: { horizontal: 'left', vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: "000000" } },
              bottom: { style: 'thin', color: { rgb: "000000" } },
              left: { style: 'thin', color: { rgb: "000000" } },
              right: { style: 'thin', color: { rgb: "000000" } }
            },
            fill: isTotal ? { fgColor: { rgb: "D1D5DB" } } : undefined
          };
        }
      });

      // Month columns (G through R) and Total column (S) - currency format
      ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'].forEach((col, colIdx) => {
        const cell = `${col}${i}`;
        if (ws[cell]) {
          const cellValue = ws[cell].v;
          const isNegative = typeof cellValue === 'number' && cellValue < 0;

          // Determine if this is the install or removal month for this ATM
          let isInstallMonth = false;
          let isRemovalMonth = false;
          if (!isTotal && colIdx < 12) { // Only for month columns, not Totals column
            const rowData = sortedExcelData[i - dataStartRow];

            // Check install month
            if (rowData?.installed_date) {
              const [iYear, iMonth] = rowData.installed_date.split('-').map(Number);
              if (iYear === selectedYear && iMonth === colIdx + 1) {
                isInstallMonth = true;
              }
            }

            // Check removal month
            if (rowData?.removed_date) {
              const [rYear, rMonth] = rowData.removed_date.split('-').map(Number);
              if (rYear === selectedYear && rMonth === colIdx + 1) {
                isRemovalMonth = true;
              }
            }
          }

          ws[cell].s = {
            font: {
              sz: 12,
              color: isNegative ? { rgb: "DC2626" } : undefined,
              bold: col === 'S' || isTotal // Bold for Totals column or totals row
            },
            alignment: { horizontal: 'center', vertical: 'center' },
            numFmt: '$#,##0',
            border: {
              top: { style: 'thin', color: { rgb: "000000" } },
              bottom: { style: 'thin', color: { rgb: "000000" } },
              left: { style: 'thin', color: { rgb: "000000" } },
              right: { style: 'thin', color: { rgb: "000000" } }
            },
            fill: isTotal
              ? { fgColor: { rgb: "D1D5DB" } }
              : isRemovalMonth
                ? { fgColor: { rgb: "FECACA" } } // Light red for removal month
                : isInstallMonth
                  ? { fgColor: { rgb: "FEF3C7" } } // Light yellow for install month
                  : undefined
          };
        }
      });
    }

    // Create workbook and download
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ATM Monthly Sales');

    const platformSuffix = selectedPlatform === 'both'
      ? 'Both'
      : selectedPlatform === 'bitstop'
        ? 'Bitstop'
        : 'Denet';

    XLSX.writeFile(wb, `atm-monthly-sales-${selectedYear}-${platformSuffix}.xlsx`);
  };

  // Calculate totals for the table footer
  const totals = data.reduce((acc, row) => {
    months.forEach((_, idx) => {
      const monthKey = `${selectedYear}-${String(idx + 1).padStart(2, '0')}`;
      if (!acc.monthlyTotals[monthKey]) {
        acc.monthlyTotals[monthKey] = 0;
      }
      acc.monthlyTotals[monthKey] += row.monthlyTotals[monthKey] || 0;
    });
    acc.yearTotal += row.yearTotal;
    return acc;
  }, { monthlyTotals: {} as { [key: string]: number }, yearTotal: 0 });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Sales by Month - by ATM</CardTitle>
            <CardDescription>
              Monthly sales breakdown by ATM for {selectedYear}
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
        {/* Filters */}
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

          <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="both">Both</SelectItem>
              <SelectItem value="denet">Denet</SelectItem>
              <SelectItem value="bitstop">Bitstop</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-md border border-white/10 overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/5">
              <TableRow className="border-white/10">
                <TableHead className="font-bold">Status</TableHead>
                <TableHead className="font-bold">Install</TableHead>
                <TableHead className="font-bold">Removed</TableHead>
                <TableHead className="font-bold">ATM ID</TableHead>
                <TableHead className="font-bold">ATM Name</TableHead>
                <TableHead className="font-bold">Platform</TableHead>
                {months.map(month => (
                  <TableHead key={month} className="text-center font-bold">{month}</TableHead>
                ))}
                <TableHead className="text-center font-bold">Totals</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={19} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={19} className="text-center text-muted-foreground">
                    No data available for {selectedYear}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {data.map((row, idx) => (
                    <TableRow key={idx} className="border-white/5">
                      <TableCell className={`font-semibold ${row.active === false ? 'text-red-500' : 'text-green-500'}`}>
                        {row.active === false ? 'Inactive' : 'Active'}
                      </TableCell>
                      <TableCell>{formatDate(row.installed_date)}</TableCell>
                      <TableCell>{formatDate(row.removed_date)}</TableCell>
                      <TableCell className="font-medium">{row.atm_id}</TableCell>
                      <TableCell>{row.atm_name}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs ${
                          row.platform === 'bitstop'
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-green-500/20 text-green-300'
                        }`}>
                          {row.platform === 'bitstop' ? 'Bitstop' : 'Denet'}
                        </span>
                      </TableCell>
                      {months.map((_, monthIdx) => {
                        const monthKey = `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}`;
                        const value = row.monthlyTotals[monthKey] || 0;

                        // Check if this is the install month for this ATM
                        let isInstallMonth = false;
                        if (row.installed_date) {
                          const [iYear, iMonth] = row.installed_date.split('-').map(Number);
                          if (iYear === selectedYear && iMonth === monthIdx + 1) {
                            isInstallMonth = true;
                          }
                        }

                        // Check if this is the removal month for this ATM
                        let isRemovalMonth = false;
                        if (row.removed_date) {
                          const [rYear, rMonth] = row.removed_date.split('-').map(Number);
                          if (rYear === selectedYear && rMonth === monthIdx + 1) {
                            isRemovalMonth = true;
                          }
                        }

                        return (
                          <TableCell
                            key={monthIdx}
                            className={`text-center font-mono ${
                              isRemovalMonth ? 'bg-red-200/30' : isInstallMonth ? 'bg-yellow-200/30' : ''
                            }`}
                          >
                            ${Math.round(value).toLocaleString('en-US')}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center font-mono font-semibold">
                        ${Math.round(row.yearTotal).toLocaleString('en-US')}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="border-white/10 bg-white/5 font-bold">
                    <TableCell colSpan={6}>TOTAL</TableCell>
                    {months.map((_, monthIdx) => {
                      const monthKey = `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}`;
                      const value = totals.monthlyTotals[monthKey] || 0;
                      return (
                        <TableCell key={monthIdx} className="text-center font-mono">
                          ${Math.round(value).toLocaleString('en-US')}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center font-mono">
                      ${Math.round(totals.yearTotal).toLocaleString('en-US')}
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
