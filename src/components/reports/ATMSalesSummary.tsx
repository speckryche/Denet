import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileSpreadsheet, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
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

interface ATMSalesData {
  atm_id: string;
  atm_name: string;
  platform: string;
  transaction_count: number;
  total_sales: number;
  total_fees: number;
  avg_transaction: number;
}

export default function ATMSalesSummary() {
  // Get previous complete month as default
  const today = new Date();
  const currentMonth = today.getMonth() + 1; // 1-12
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const defaultYear = currentMonth === 1 ? today.getFullYear() - 1 : today.getFullYear();
  const defaultMonthStr = String(previousMonth).padStart(2, '0');

  const [data, setData] = useState<ATMSalesData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [selectedStartMonth, setSelectedStartMonth] = useState<string>(defaultMonthStr);
  const [selectedEndMonth, setSelectedEndMonth] = useState<string>(defaultMonthStr);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('both');
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [sortField, setSortField] = useState<keyof ATMSalesData>('total_sales');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  useEffect(() => {
    fetchAvailableYears();
  }, []);

  useEffect(() => {
    if (availableYears.length > 0) {
      fetchATMSales();
    }
  }, [selectedYear, selectedStartMonth, selectedEndMonth, selectedPlatform, availableYears]);

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

  const fetchATMSales = async () => {
    setIsLoading(true);
    try {
      // Build date range
      const startDate = `${selectedYear}-${selectedStartMonth}-01`;
      const endMonth = parseInt(selectedEndMonth);
      const lastDay = new Date(selectedYear, endMonth, 0).getDate();
      const endDate = `${selectedYear}-${selectedEndMonth}-${lastDay}`;

      // Get count first
      let countQuery = supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', startDate)
        .lte('date', endDate);

      // Apply platform filter if not 'both'
      if (selectedPlatform !== 'both') {
        countQuery = countQuery.eq('platform', selectedPlatform);
      }

      const { count } = await countQuery;

      // Fetch in batches
      const batchSize = 1000;
      const batches = Math.ceil((count || 0) / batchSize);
      let allTransactions: any[] = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;

        let query = supabase
          .from('transactions')
          .select('atm_id, sale, fee, platform')
          .gte('date', startDate)
          .lte('date', endDate)
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

      // Fetch ATM profiles for names
      const { data: atmProfiles, error: atmError } = await supabase
        .from('atm_profiles')
        .select('atm_id, location_name');

      if (atmError) throw atmError;

      // Create a map of ATM profiles
      const atmMap = new Map<string, any>();
      atmProfiles?.forEach(atm => {
        atmMap.set(atm.atm_id, atm);
      });

      // Aggregate by ATM
      const atmAggregation = new Map<string, ATMSalesData>();

      allTransactions.forEach(tx => {
        if (!tx.atm_id) return;

        const atmProfile = atmMap.get(tx.atm_id);
        const atmName = atmProfile?.location_name || tx.atm_id;

        if (!atmAggregation.has(tx.atm_id)) {
          atmAggregation.set(tx.atm_id, {
            atm_id: tx.atm_id,
            atm_name: atmName,
            platform: tx.platform,
            transaction_count: 0,
            total_sales: 0,
            total_fees: 0,
            avg_transaction: 0,
          });
        }

        const entry = atmAggregation.get(tx.atm_id)!;
        entry.transaction_count += 1;
        entry.total_sales += tx.sale || 0;
        entry.total_fees += tx.fee || 0;
      });

      // Calculate average transaction for each ATM
      atmAggregation.forEach((entry) => {
        entry.avg_transaction = entry.transaction_count > 0
          ? entry.total_sales / entry.transaction_count
          : 0;
      });

      // Sort by ATM ID
      const sortedData = Array.from(atmAggregation.values()).sort((a, b) =>
        a.atm_id.localeCompare(b.atm_id)
      );

      setData(sortedData);
    } catch (error) {
      console.error('Error fetching ATM sales:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSort = (field: keyof ATMSalesData) => {
    if (sortField === field) {
      // Toggle direction if clicking same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Sort data based on current sort field and direction
  const sortedData = [...data].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];

    // Handle string comparison (atm_id, atm_name, platform)
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    // Handle number comparison
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    }

    return 0;
  });

  const handleExportCSV = () => {
    const headers = [
      'ATM ID',
      'ATM Name',
      'Platform',
      'Transactions',
      'Total Sales',
      'Total Fees',
      'Avg Transaction'
    ];

    const rows = sortedData.map(row => [
      row.atm_id,
      row.atm_name,
      row.platform === 'bitstop' ? 'Bitstop' : 'Denet',
      row.transaction_count,
      Math.round(row.total_sales),
      Math.round(row.total_fees),
      Math.round(row.avg_transaction)
    ]);

    // Add totals row
    const totals = data.reduce((acc, row) => ({
      transaction_count: acc.transaction_count + row.transaction_count,
      total_sales: acc.total_sales + row.total_sales,
      total_fees: acc.total_fees + row.total_fees,
    }), {
      transaction_count: 0,
      total_sales: 0,
      total_fees: 0,
    });

    const avgTransaction = totals.transaction_count > 0
      ? totals.total_sales / totals.transaction_count
      : 0;

    rows.push([
      'TOTAL',
      '',
      '',
      totals.transaction_count,
      Math.round(totals.total_sales),
      Math.round(totals.total_fees),
      Math.round(avgTransaction)
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateRange = selectedStartMonth === selectedEndMonth
      ? `${months.find(m => m.value === selectedStartMonth)?.label}-${selectedYear}`
      : `${months.find(m => m.value === selectedStartMonth)?.label}-${months.find(m => m.value === selectedEndMonth)?.label}-${selectedYear}`;
    link.download = `atm-sales-summary-${dateRange}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    const excelData = [];

    // Add title row with platform filter
    const dateRangeText = selectedStartMonth === selectedEndMonth
      ? `${months.find(m => m.value === selectedStartMonth)?.label} ${selectedYear}`
      : `${months.find(m => m.value === selectedStartMonth)?.label} thru ${months.find(m => m.value === selectedEndMonth)?.label} ${selectedYear}`;

    const platformText = selectedPlatform === 'both'
      ? 'Both platforms'
      : selectedPlatform === 'bitstop'
        ? 'Bitstop platform'
        : 'Denet platform';

    excelData.push([`ATM Sales Summary - ${dateRangeText} (${platformText})`]);
    excelData.push([]); // Empty row

    // Add headers
    excelData.push([
      'ATM ID',
      'ATM Name',
      'Platform',
      'Transactions',
      'Total Sales',
      'Total Fees',
      'Avg Transaction'
    ]);

    // Sort data by Total Sales (descending)
    const sortedExcelData = [...data].sort((a, b) => b.total_sales - a.total_sales);

    // Add data rows
    sortedExcelData.forEach(row => {
      excelData.push([
        row.atm_id,
        row.atm_name,
        row.platform === 'bitstop' ? 'Bitstop' : 'Denet',
        row.transaction_count,
        Math.round(row.total_sales),
        Math.round(row.total_fees),
        Math.round(row.avg_transaction)
      ]);
    });

    // Add totals row
    const totalsCalc = data.reduce((acc, row) => ({
      transaction_count: acc.transaction_count + row.transaction_count,
      total_sales: acc.total_sales + row.total_sales,
      total_fees: acc.total_fees + row.total_fees,
    }), {
      transaction_count: 0,
      total_sales: 0,
      total_fees: 0,
    });

    const avgTransactionCalc = totalsCalc.transaction_count > 0
      ? totalsCalc.total_sales / totalsCalc.transaction_count
      : 0;

    excelData.push([
      'TOTAL',
      '',
      '',
      totalsCalc.transaction_count,
      Math.round(totalsCalc.total_sales),
      Math.round(totalsCalc.total_fees),
      Math.round(avgTransactionCalc)
    ]);

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths
    ws['!cols'] = [
      { wch: 10 },  // ATM ID
      { wch: 30 },  // ATM Name
      { wch: 12 },  // Platform
      { wch: 15 },  // Transactions
      { wch: 15 },  // Total Sales
      { wch: 15 },  // Total Fees
      { wch: 15 }   // Avg Transaction
    ];

    // Style the title row (row 1)
    ws['A1'].s = {
      font: { bold: true, sz: 14, color: { rgb: "1F2937" } },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: "D1D5DB" } }
    };

    // Merge title cells
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];

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

    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3'].forEach(cell => {
      if (ws[cell]) {
        ws[cell].s = headerStyle;
      }
    });

    // Style data rows and totals row
    const dataStartRow = 4;
    const totalRow = dataStartRow + sortedExcelData.length;

    for (let i = dataStartRow; i <= totalRow; i++) {
      const isTotal = i === totalRow;

      // ATM ID, Name, and Platform (columns A, B, and C)
      ['A', 'B', 'C'].forEach(col => {
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

      // Numeric columns (D, E, F, G) - currency format for E, F, G
      ['D', 'E', 'F', 'G'].forEach(col => {
        const cell = `${col}${i}`;
        if (ws[cell]) {
          const cellValue = ws[cell].v;
          const isNegative = typeof cellValue === 'number' && cellValue < 0;
          const isCurrency = col !== 'D'; // D is Transactions (count), others are currency

          ws[cell].s = {
            font: {
              bold: isTotal,
              sz: 12,
              color: isNegative ? { rgb: "DC2626" } : undefined
            },
            alignment: { horizontal: 'right', vertical: 'center' },
            numFmt: isCurrency ? '$#,##0' : '#,##0',
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
    }

    // Create workbook and download
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ATM Sales Summary');

    // Add platform to filename
    const platformSuffix = selectedPlatform === 'both'
      ? 'Both'
      : selectedPlatform === 'bitstop'
        ? 'Bitstop'
        : 'Denet';

    XLSX.writeFile(wb, `atm-sales-summary-${dateRangeText.replace(/ /g, '-')}-${platformSuffix}.xlsx`);
  };

  // Calculate totals
  const totals = data.reduce((acc, row) => ({
    transaction_count: acc.transaction_count + row.transaction_count,
    total_sales: acc.total_sales + row.total_sales,
    total_fees: acc.total_fees + row.total_fees,
  }), {
    transaction_count: 0,
    total_sales: 0,
    total_fees: 0,
  });

  const avgTransaction = totals.transaction_count > 0
    ? totals.total_sales / totals.transaction_count
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>ATM Sales Summary</CardTitle>
            <CardDescription>
              Sales summary by ATM
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

          <Select value={selectedStartMonth} onValueChange={setSelectedStartMonth}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Start Month" />
            </SelectTrigger>
            <SelectContent>
              {months.map(month => (
                <SelectItem key={month.value} value={month.value}>
                  {month.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedEndMonth} onValueChange={setSelectedEndMonth}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="End Month" />
            </SelectTrigger>
            <SelectContent>
              {months.map(month => (
                <SelectItem key={month.value} value={month.value}>
                  {month.label}
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
                <TableHead className="font-bold">
                  <button
                    onClick={() => handleSort('atm_id')}
                    className="flex items-center gap-1 hover:text-foreground/80"
                  >
                    ATM ID
                    {sortField === 'atm_id' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="font-bold">
                  <button
                    onClick={() => handleSort('atm_name')}
                    className="flex items-center gap-1 hover:text-foreground/80"
                  >
                    ATM Name
                    {sortField === 'atm_name' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="font-bold">
                  <button
                    onClick={() => handleSort('platform')}
                    className="flex items-center gap-1 hover:text-foreground/80"
                  >
                    Platform
                    {sortField === 'platform' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <button
                    onClick={() => handleSort('transaction_count')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Transactions
                    {sortField === 'transaction_count' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <button
                    onClick={() => handleSort('total_sales')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Total Sales
                    {sortField === 'total_sales' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <button
                    onClick={() => handleSort('total_fees')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Total Fees
                    {sortField === 'total_fees' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <button
                    onClick={() => handleSort('avg_transaction')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Avg Transaction
                    {sortField === 'avg_transaction' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No data available for selected period
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {sortedData.map((row, idx) => (
                    <TableRow key={idx} className="border-white/5">
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
                      <TableCell className="text-right font-mono">
                        {row.transaction_count.toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.total_sales).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.total_fees).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.avg_transaction).toLocaleString('en-US')}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="border-white/10 bg-white/5 font-bold">
                    <TableCell colSpan={3}>TOTAL</TableCell>
                    <TableCell className="text-right font-mono">
                      {totals.transaction_count.toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.total_sales).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.total_fees).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(avgTransaction).toLocaleString('en-US')}
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
