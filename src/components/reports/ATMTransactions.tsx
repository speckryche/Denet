import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, FileSpreadsheet } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import * as XLSX from 'xlsx-js-style';
import TransactionsTable, {
  TransactionRow,
  TransactionsSortField,
  sortTransactionRows,
  formatTransactionDate,
} from './TransactionsTable';

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDateRangeText(fromDate: string, toDate: string): string {
  const [fy, fm] = fromDate.split('-').map(Number);
  const [ty, tm] = toDate.split('-').map(Number);
  if (fy === ty && fm === tm) return `${MONTH_LABELS[fm - 1]} ${fy}`;
  if (fy === ty) return `${MONTH_LABELS[fm - 1]} thru ${MONTH_LABELS[tm - 1]} ${fy}`;
  return `${MONTH_LABELS[fm - 1]} ${fy} thru ${MONTH_LABELS[tm - 1]} ${ty}`;
}

// Guard for date-picker state. `<input type="date">` can emit '' or partial
// values during edit; we must not let those reach Supabase or Date().
const isValidYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default function ATMTransactions() {
  // Default: previous complete month (Apr 2026 if today is May 2026)
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const defaultYear = currentMonth === 1 ? today.getFullYear() - 1 : today.getFullYear();
  const defaultMonthStr = String(previousMonth).padStart(2, '0');
  const defaultLastDay = new Date(defaultYear, previousMonth, 0).getDate();
  const defaultFromDate = `${defaultYear}-${defaultMonthStr}-01`;
  const defaultToDate = `${defaultYear}-${defaultMonthStr}-${String(defaultLastDay).padStart(2, '0')}`;

  const [data, setData] = useState<TransactionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fromDate, setFromDate] = useState<string>(defaultFromDate);
  const [toDate, setToDate] = useState<string>(defaultToDate);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('both');
  const [selectedATM, setSelectedATM] = useState<string>('all');
  const [atmList, setAtmList] = useState<{ atm_id: string; location_name: string }[]>([]);
  const [sortField, setSortField] = useState<TransactionsSortField>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [feeOverrides, setFeeOverrides] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    fetchATMList();
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fromDate, toDate, selectedPlatform, selectedATM]);

  const fetchATMList = async () => {
    try {
      // active=true is unique per atm_id under the migration-20240522000034
      // invariant, so this returns one row per ATM (the current one).
      const { data, error } = await supabase
        .from('atm_profiles')
        .select('atm_id, location_name')
        .eq('active', true)
        .order('location_name');

      if (error) throw error;
      if (data) {
        setAtmList(data.filter(a => a.atm_id) as { atm_id: string; location_name: string }[]);
      }
    } catch (error) {
      console.error('Error fetching ATM list:', error);
    }
  };

  const fetchTransactions = async () => {
    if (!isValidYMD(fromDate) || !isValidYMD(toDate)) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const startDate = fromDate;
      const endDate = `${toDate}T23:59:59`;

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

      // Fetch bitstop fee overrides for the selected period (cross-year safe)
      const [startYear, startMonthNum] = fromDate.split('-').map(Number);
      const [endYear, endMonthNum] = toDate.split('-').map(Number);
      const overrideMonths: string[] = [];
      for (let y = startYear; y <= endYear; y++) {
        const mStart = y === startYear ? startMonthNum : 1;
        const mEnd = y === endYear ? endMonthNum : 12;
        for (let m = mStart; m <= mEnd; m++) {
          overrideMonths.push(`${y}-${String(m).padStart(2, '0')}`);
        }
      }

      const { data: overrideData } = await supabase
        .from('bitstop_fee_overrides')
        .select('atm_id, year_month, actual_fees')
        .in('year_month', overrideMonths);

      const overrideMap = new Map<string, number>();
      overrideData?.forEach(o => {
        overrideMap.set(`${o.atm_id}:${o.year_month}`, Number(o.actual_fees));
      });
      setFeeOverrides(overrideMap);

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

  const handleSort = (field: TransactionsSortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedData = useMemo(
    () => sortTransactionRows(data, sortField, sortDirection),
    [data, sortField, sortDirection],
  );

  const totals = data.reduce((acc, row) => ({
    sale: acc.sale + row.sale,
    fee: acc.fee + row.fee,
    bitstop_fee: acc.bitstop_fee + row.bitstop_fee,
  }), { sale: 0, fee: 0, bitstop_fee: 0 });

  const dateRangeText = formatDateRangeText(fromDate, toDate);

  const handleExportCSV = () => {
    const headers = ['Date', 'ATM ID', 'ATM Name', 'Platform', 'Customer', 'Ticker', 'Sale', 'Fee', 'Bitstop Fee'];

    const rows = sortedData.map(row => [
      formatTransactionDate(row.date),
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
        formatTransactionDate(row.date),
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
              {!isLoading && ` • ${data.length.toLocaleString('en-US')} transactions`}
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
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-[160px] h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-[160px] h-9"
            />
          </div>

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

        <TransactionsTable
          rows={sortedData}
          sortField={sortField}
          sortDirection={sortDirection}
          onSortChange={handleSort}
          isLoading={isLoading}
          emptyMessage="No transactions found for selected filters"
          feeOverrides={feeOverrides}
          overrideMonthRange={{
            startYear: parseInt(fromDate.slice(0, 4)),
            startMonth: fromDate.slice(5, 7),
            endYear: parseInt(toDate.slice(0, 4)),
            endMonth: toDate.slice(5, 7),
          }}
        />
      </CardContent>
    </Card>
  );
}
