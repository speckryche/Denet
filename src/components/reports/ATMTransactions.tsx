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

interface TransactionRow {
  id: string;
  date: string;
  atm_id: string;
  atm_name: string;
  platform: string;
  customer_first_name: string;
  customer_last_name: string;
  ticker: string;
  sale: number;
  fee: number;
  bitstop_fee: number;
}

type SortField = keyof TransactionRow;

export default function ATMTransactions() {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const defaultYear = currentMonth === 1 ? today.getFullYear() - 1 : today.getFullYear();
  const defaultMonthStr = String(previousMonth).padStart(2, '0');

  const [data, setData] = useState<TransactionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [selectedStartMonth, setSelectedStartMonth] = useState<string>(defaultMonthStr);
  const [selectedEndMonth, setSelectedEndMonth] = useState<string>(defaultMonthStr);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('both');
  const [selectedATM, setSelectedATM] = useState<string>('all');
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [atmList, setAtmList] = useState<{ atm_id: string; location_name: string }[]>([]);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

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
    fetchATMList();
  }, []);

  useEffect(() => {
    if (availableYears.length > 0) {
      fetchTransactions();
    }
  }, [selectedYear, selectedStartMonth, selectedEndMonth, selectedPlatform, selectedATM, availableYears]);

  const fetchAvailableYears = async () => {
    try {
      const { count } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true });

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
          if (!isNaN(year)) years.add(year);
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

  const fetchATMList = async () => {
    try {
      const { data, error } = await supabase
        .from('atm_profiles')
        .select('atm_id, location_name')
        .order('location_name');

      if (error) throw error;
      if (data) {
        setAtmList(data.filter(a => a.atm_id));
      }
    } catch (error) {
      console.error('Error fetching ATM list:', error);
    }
  };

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      const startDate = `${selectedYear}-${selectedStartMonth}-01`;
      const endMonth = parseInt(selectedEndMonth);
      const lastDay = new Date(selectedYear, endMonth, 0).getDate();
      const endDate = `${selectedYear}-${selectedEndMonth}-${lastDay}`;

      // Get count with filters
      let countQuery = supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', startDate)
        .lte('date', endDate);

      if (selectedPlatform !== 'both') {
        countQuery = countQuery.eq('platform', selectedPlatform);
      }
      if (selectedATM !== 'all') {
        countQuery = countQuery.eq('atm_id', selectedATM);
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
          .select('id, date, atm_id, atm_name, platform, customer_first_name, customer_last_name, ticker, sale, fee, bitstop_fee')
          .gte('date', startDate)
          .lte('date', endDate)
          .range(from, to);

        if (selectedPlatform !== 'both') {
          query = query.eq('platform', selectedPlatform);
        }
        if (selectedATM !== 'all') {
          query = query.eq('atm_id', selectedATM);
        }

        const { data, error } = await query;
        if (error) throw error;
        if (data) {
          allTransactions = allTransactions.concat(data);
        }
      }

      setData(allTransactions.map(tx => ({
        id: tx.id || '',
        date: tx.date || '',
        atm_id: tx.atm_id || '',
        atm_name: tx.atm_name || '',
        platform: tx.platform || '',
        customer_first_name: tx.customer_first_name || '',
        customer_last_name: tx.customer_last_name || '',
        ticker: tx.ticker || '',
        sale: tx.sale || 0,
        fee: tx.fee || 0,
        bitstop_fee: tx.bitstop_fee || 0,
      })));
    } catch (error) {
      console.error('Error fetching transactions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedData = [...data].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    }

    return 0;
  });

  const SortButton = ({ field, label, align }: { field: SortField; label: string; align?: 'right' }) => (
    <button
      onClick={() => handleSort(field)}
      className={`flex items-center gap-1 hover:text-foreground/80 ${align === 'right' ? 'ml-auto' : ''}`}
    >
      {label}
      {sortField === field ? (
        sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
      ) : (
        <ArrowUpDown className="w-4 h-4 opacity-50" />
      )}
    </button>
  );

  // Calculate totals
  const totals = data.reduce((acc, row) => ({
    sale: acc.sale + row.sale,
    fee: acc.fee + row.fee,
    bitstop_fee: acc.bitstop_fee + row.bitstop_fee,
  }), { sale: 0, fee: 0, bitstop_fee: 0 });

  const dateRangeText = selectedStartMonth === selectedEndMonth
    ? `${months.find(m => m.value === selectedStartMonth)?.label} ${selectedYear}`
    : `${months.find(m => m.value === selectedStartMonth)?.label} thru ${months.find(m => m.value === selectedEndMonth)?.label} ${selectedYear}`;

  const handleExportCSV = () => {
    const headers = ['Date', 'ATM ID', 'ATM Name', 'Platform', 'Customer', 'Ticker', 'Sale', 'Fee', 'Bitstop Fee'];

    const rows = sortedData.map(row => [
      formatDate(row.date),
      row.atm_id,
      row.atm_name,
      row.platform === 'bitstop' ? 'Bitstop' : 'Denet',
      `${row.customer_first_name} ${row.customer_last_name}`.trim(),
      row.ticker,
      Math.round(row.sale),
      Math.round(row.fee),
      Math.round(row.bitstop_fee),
    ]);

    rows.push([
      'TOTAL', '', '', '', '', '',
      Math.round(totals.sale),
      Math.round(totals.fee),
      Math.round(totals.bitstop_fee),
    ]);

    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const atmSuffix = selectedATM === 'all' ? 'All-ATMs' : selectedATM;
    link.download = `atm-transactions-${atmSuffix}-${dateRangeText.replace(/ /g, '-')}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    const excelData: any[][] = [];

    const platformText = selectedPlatform === 'both' ? 'Both platforms'
      : selectedPlatform === 'bitstop' ? 'Bitstop platform' : 'Denet platform';
    const atmText = selectedATM === 'all' ? 'All ATMs'
      : atmList.find(a => a.atm_id === selectedATM)?.location_name || selectedATM;

    excelData.push([`ATM Transactions - ${atmText} - ${dateRangeText} (${platformText})`]);
    excelData.push([]);

    const headers = ['Date', 'ATM ID', 'ATM Name', 'Platform', 'Customer', 'Ticker', 'Sale', 'Fee', 'Bitstop Fee'];
    excelData.push(headers);

    sortedData.forEach(row => {
      excelData.push([
        formatDate(row.date),
        row.atm_id,
        row.atm_name,
        row.platform === 'bitstop' ? 'Bitstop' : 'Denet',
        `${row.customer_first_name} ${row.customer_last_name}`.trim(),
        row.ticker,
        Math.round(row.sale),
        Math.round(row.fee),
        Math.round(row.bitstop_fee),
      ]);
    });

    excelData.push([
      'TOTAL', '', '', '', '', '',
      Math.round(totals.sale),
      Math.round(totals.fee),
      Math.round(totals.bitstop_fee),
    ]);

    const ws = XLSX.utils.aoa_to_sheet(excelData);

    ws['!cols'] = [
      { wch: 12 },  // Date
      { wch: 10 },  // ATM ID
      { wch: 30 },  // ATM Name
      { wch: 12 },  // Platform
      { wch: 25 },  // Customer
      { wch: 8 },   // Ticker
      { wch: 12 },  // Sale
      { wch: 12 },  // Fee
      { wch: 12 },  // Bitstop Fee
    ];

    // Style title row
    ws['A1'].s = {
      font: { bold: true, sz: 14, color: { rgb: "1F2937" } },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: "D1D5DB" } }
    };
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }];

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

    ['A3', 'B3', 'C3', 'D3', 'E3', 'F3', 'G3', 'H3', 'I3'].forEach(cell => {
      if (ws[cell]) ws[cell].s = headerStyle;
    });

    // Style data + totals rows
    const dataStartRow = 4;
    const totalRow = dataStartRow + sortedData.length;

    for (let i = dataStartRow; i <= totalRow; i++) {
      const isTotal = i === totalRow;

      // Text columns (A-F)
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach(col => {
        const cell = `${col}${i}`;
        if (ws[cell]) {
          const cellValue = ws[cell].v;
          const isBitstop = col === 'D' && cellValue === 'Bitstop';
          const isDenet = col === 'D' && cellValue === 'Denet';

          ws[cell].s = {
            font: {
              bold: isTotal,
              sz: 12,
              color: col === 'D' && !isTotal
                ? (isBitstop ? { rgb: "3B82F6" } : isDenet ? { rgb: "22C55E" } : undefined)
                : undefined
            },
            alignment: { horizontal: 'left', vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: "000000" } },
              bottom: { style: 'thin', color: { rgb: "000000" } },
              left: { style: 'thin', color: { rgb: "000000" } },
              right: { style: 'thin', color: { rgb: "000000" } }
            },
            fill: isTotal
              ? { fgColor: { rgb: "D1D5DB" } }
              : col === 'D' && !isTotal
                ? (isBitstop ? { fgColor: { rgb: "DBEAFE" } } : isDenet ? { fgColor: { rgb: "D1FAE5" } } : undefined)
                : undefined
          };
        }
      });

      // Currency columns (G, H, I)
      ['G', 'H', 'I'].forEach(col => {
        const cell = `${col}${i}`;
        if (ws[cell]) {
          ws[cell].s = {
            font: { bold: isTotal, sz: 12 },
            alignment: { horizontal: 'right', vertical: 'center' },
            numFmt: '$#,##0',
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

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ATM Transactions');

    const atmSuffix = selectedATM === 'all' ? 'All-ATMs' : selectedATM;
    XLSX.writeFile(wb, `atm-transactions-${atmSuffix}-${dateRangeText.replace(/ /g, '-')}.xlsx`);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>ATM Transactions</CardTitle>
            <CardDescription>
              Individual transaction details by ATM
              {!isLoading && ` \u2022 ${data.length.toLocaleString('en-US')} transactions`}
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
        <div className="flex gap-4 flex-wrap">
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

          <Select value={selectedATM} onValueChange={setSelectedATM}>
            <SelectTrigger className="w-[280px]">
              <SelectValue placeholder="Select ATM" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ATMs</SelectItem>
              {atmList.map(atm => (
                <SelectItem key={atm.atm_id} value={atm.atm_id}>
                  {atm.location_name} ({atm.atm_id})
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
                <TableHead className="font-bold">
                  <SortButton field="date" label="Date" />
                </TableHead>
                <TableHead className="font-bold">
                  <SortButton field="atm_id" label="ATM ID" />
                </TableHead>
                <TableHead className="font-bold">
                  <SortButton field="atm_name" label="ATM Name" />
                </TableHead>
                <TableHead className="font-bold">
                  <SortButton field="platform" label="Platform" />
                </TableHead>
                <TableHead className="font-bold">
                  <SortButton field="customer_last_name" label="Customer" />
                </TableHead>
                <TableHead className="font-bold">
                  <SortButton field="ticker" label="Ticker" />
                </TableHead>
                <TableHead className="text-right font-bold">
                  <SortButton field="sale" label="Sale" align="right" />
                </TableHead>
                <TableHead className="text-right font-bold">
                  <SortButton field="fee" label="Fee" align="right" />
                </TableHead>
                <TableHead className="text-right font-bold">
                  <SortButton field="bitstop_fee" label="Bitstop Fee" align="right" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No transactions found for selected filters
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {sortedData.map((row, idx) => (
                    <TableRow key={idx} className="border-white/5">
                      <TableCell>{formatDate(row.date)}</TableCell>
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
                      <TableCell>{row.customer_first_name} {row.customer_last_name}</TableCell>
                      <TableCell>{row.ticker}</TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.sale).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.fee).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.bitstop_fee).toLocaleString('en-US')}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="border-white/10 bg-white/5 font-bold">
                    <TableCell colSpan={6}>
                      TOTAL ({data.length.toLocaleString('en-US')} transactions)
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.sale).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.fee).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.bitstop_fee).toLocaleString('en-US')}
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
