import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { findProfileForTx } from '@/lib/atm-profile';
import { FINANCIAL_STATUSES } from '@/lib/transaction-status';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, FileSpreadsheet, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
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

type SortKey = 'atm_id' | 'atm_name' | 'total';
type SortDir = 'asc' | 'desc';

interface VisibleMonth {
  label: string;    // "Jan"
  monthNum: number; // 1-12
  key: string;      // "YYYY-MM"
}

type ExportCell = string | number | null;

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Status, Install, Removed, ATM ID, ATM Name, Platform — columns before the months
const FIXED_COL_COUNT = 6;

const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

// A value is "zero" if it would display as $0 — drives the dash, hidden
// months, and blank export cells so all three always agree.
const isZero = (value: number) => Math.round(value) === 0;

const formatMoney = (value: number) =>
  isZero(value) ? '–' : `$${Math.round(value).toLocaleString('en-US')}`;

const platformLabel = (platform: string) => (platform === 'bitstop' ? 'Bitstop' : 'Denet');

// Format date helper function
const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '-';
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}/${year.slice(2)}`;
};

const sortRows = (rows: ATMMonthlyData[], key: SortKey, dir: SortDir): ATMMonthlyData[] => {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = key === 'total'
      ? a.yearTotal - b.yearTotal
      : collator.compare(a[key] ?? '', b[key] ?? '');
    if (primary !== 0) return primary * sign;
    // Stable tie-breakers (always ascending) so equal rows don't shuffle
    return collator.compare(a.atm_id, b.atm_id)
      || a.platform.localeCompare(b.platform)
      || (a.installed_date ?? '').localeCompare(b.installed_date ?? '');
  });
};

const getVisibleMonths = (rows: ATMMonthlyData[], year: number): VisibleMonth[] =>
  MONTH_LABELS
    .map((label, idx) => ({
      label,
      monthNum: idx + 1,
      key: `${year}-${String(idx + 1).padStart(2, '0')}`,
    }))
    .filter(month => rows.some(row => !isZero(row.monthlyTotals[month.key] || 0)));

const computeTotals = (rows: ATMMonthlyData[], visibleMonths: VisibleMonth[]) =>
  rows.reduce((acc, row) => {
    visibleMonths.forEach(({ key }) => {
      acc.monthlyTotals[key] = (acc.monthlyTotals[key] || 0) + (row.monthlyTotals[key] || 0);
    });
    acc.yearTotal += row.yearTotal;
    return acc;
  }, { monthlyTotals: {} as { [key: string]: number }, yearTotal: 0 });

// Shared by CSV + Excel: same columns and row order as the on-screen table.
// Zero amounts become null (blank cell) so SUM works; others stay numeric.
const buildExportRows = (
  rows: ATMMonthlyData[],
  visibleMonths: VisibleMonth[],
  totals: ReturnType<typeof computeTotals>,
) => {
  const amount = (value: number): ExportCell => (isZero(value) ? null : Math.round(value));

  const headers: ExportCell[] = [
    'Status', 'Install', 'Removed', 'ATM ID', 'ATM Name', 'Platform',
    ...visibleMonths.map(m => m.label),
    'Totals',
  ];

  const body: ExportCell[][] = rows.map(row => [
    row.active === false ? 'Inactive' : 'Active',
    formatDate(row.installed_date),
    formatDate(row.removed_date),
    row.atm_id,
    row.atm_name,
    platformLabel(row.platform),
    ...visibleMonths.map(m => amount(row.monthlyTotals[m.key] || 0)),
    amount(row.yearTotal),
  ]);

  const totalRow: ExportCell[] = [
    '', '', '', 'TOTAL', '', '',
    ...visibleMonths.map(m => amount(totals.monthlyTotals[m.key] || 0)),
    amount(totals.yearTotal),
  ];

  return { headers, body, totalRow };
};

const toCsvField = (cell: ExportCell): string => {
  if (cell === null) return '';
  if (typeof cell === 'number') return String(cell);
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
};

// CSV amount cells (months, Totals column, TOTAL row): the builder gives
// rounded numbers or null for zero. Written as quoted whole-dollar text —
// "-" (plain hyphen, not en dash) for zero so Excel doesn't garble encoding.
const toCsvAmountField = (cell: ExportCell): string => {
  if (cell === null || cell === '') return '-';
  if (typeof cell !== 'number') return toCsvField(cell);
  const dollars = Math.abs(cell).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `"${cell < 0 ? '-' : ''}$${dollars}"`;
};

const exportFileSuffix = (platform: string) =>
  platform === 'both' ? 'Both' : platform === 'bitstop' ? 'Bitstop' : 'Denet';

// Table colors. The app's theme colors are fixed dark values (tailwind.config.js),
// so banding uses explicit opaque colors — sticky cells must be opaque to
// cover columns scrolling underneath them.
const ROW_BAND = ['bg-card', 'bg-[#262E38]'];
const TOTAL_COL_BAND = ['bg-slate-700', 'bg-slate-600'];
const ROW_HOVER = 'group-hover:bg-[#323C49]';
const TOTAL_COL_HOVER = 'group-hover:bg-slate-500';
const TOTAL_COL_EDGE = 'bg-slate-500 text-white font-bold border-l-2 border-slate-400';

export default function ATMMonthlySales() {
  const [rawData, setRawData] = useState<ATMMonthlyData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedPlatform, setSelectedPlatform] = useState<string>('both');
  const [availableYears, setAvailableYears] = useState<number[]>([]);

  const [sortKey, setSortKey] = useState<SortKey>('total');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

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
      // Get total count (completed only — the sales year list should reflect
      // years with real sales; status rules in transaction-status.ts).
      const { count } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .in('status', FINANCIAL_STATUSES);

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
          .in('status', FINANCIAL_STATUSES)
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
        .in('status', FINANCIAL_STATUSES)
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
          .in('status', FINANCIAL_STATUSES)
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

      // Fetch ATM profiles for names, active status, and date fields.
      // SELECT id so the shared findProfileForTx helper can key by profile.id.
      const { data: atmProfiles, error: atmError } = await supabase
        .from('atm_profiles')
        .select('id, atm_id, location_name, active, platform, installed_date, removed_date');

      if (atmError) throw atmError;
      // No atm-id-keyed Map here: multiple profile rows per atm_id are now
      // possible, so per-tx attribution uses findProfileForTx (date-window
      // match) instead of a last-write-wins lookup.

      // Helper function: Determine if ATM should be included in report
      const shouldIncludeATM = (profile: any): boolean => {
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

      // Bucket by profile.id — each profile row is one platform period in
      // the multi-row model, so a converted ATM naturally produces two
      // buckets (Denet profile + Bitstop profile) via its two profile rows.
      const atmData = new Map<string, ATMMonthlyData>();
      const seenProfileIds = new Set<string>();

      // Process transactions (Case a: profiles with transactions in selected year)
      allTransactions?.forEach(tx => {
        if (!tx.atm_id) return;

        const date = new Date(tx.date);
        const year = date.getFullYear();

        // Only include transactions from selected year
        if (year !== selectedYear) return;

        const monthKey = `${year}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const atmProfile = findProfileForTx(atmProfiles || [], tx.atm_id, date);
        if (!atmProfile) {
          console.warn(
            `ATMMonthlySales: no profile window contains tx for atm_id=${tx.atm_id}, date=${tx.date} — skipping`,
          );
          return;
        }
        const atmName = atmProfile.location_name || tx.atm_id;
        const profilePlatform = (atmProfile.platform || '').toLowerCase();

        seenProfileIds.add(atmProfile.id);

        if (!atmData.has(atmProfile.id)) {
          atmData.set(atmProfile.id, {
            active: atmProfile.active ?? null,
            installed_date: atmProfile.installed_date ?? null,
            removed_date: atmProfile.removed_date ?? null,
            atm_id: tx.atm_id,
            atm_name: atmName,
            platform: profilePlatform,
            monthlyTotals: {},
            yearTotal: 0
          });
        }

        const entry = atmData.get(atmProfile.id)!;
        if (!entry.monthlyTotals[monthKey]) {
          entry.monthlyTotals[monthKey] = 0;
        }

        entry.monthlyTotals[monthKey] += tx.sale || 0;
        entry.yearTotal += tx.sale || 0;
      });

      // Add profiles without transactions but that should be included
      // (Cases b & c). Keyed by profile.id so a multi-profile ATM doesn't
      // get an extra row when one of its profiles already produced one above.
      atmProfiles?.forEach(profile => {
        // Skip if this profile already produced a row from its transactions
        if (seenProfileIds.has(profile.id)) return;

        // Skip if doesn't match selected platform filter
        if (selectedPlatform !== 'both' && profile.platform !== selectedPlatform) return;

        if (shouldIncludeATM(profile)) {
          atmData.set(profile.id, {
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

      // Display order is derived below (sortedData), not here.
      setRawData(Array.from(atmData.values()));
    } catch (error) {
      console.error('Error fetching monthly sales:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Display pipeline: rawData → filteredData → sortedData → visibleMonths → table + exports
  // Filter step is a pass-through for now (search box plugs in here).
  const filteredData = useMemo(() => rawData, [rawData]);

  const sortedData = useMemo(
    () => sortRows(filteredData, sortKey, sortDir),
    [filteredData, sortKey, sortDir],
  );

  const visibleMonths = useMemo(
    () => getVisibleMonths(sortedData, selectedYear),
    [sortedData, selectedYear],
  );

  const totals = useMemo(
    () => computeTotals(sortedData, visibleMonths),
    [sortedData, visibleMonths],
  );

  const columnCount = FIXED_COL_COUNT + visibleMonths.length + 1;

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'total' ? 'desc' : 'asc');
    }
  };

  const renderSortLabel = (label: string, key: SortKey, align: 'left' | 'center' = 'left') => {
    const active = sortKey === key;
    const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className={`inline-flex items-center gap-1 font-bold hover:underline ${align === 'center' ? 'justify-center w-full' : ''}`}
        title={`Sort by ${label}`}
      >
        {label}
        <Icon className={`w-3.5 h-3.5 ${active ? '' : 'opacity-40'}`} />
      </button>
    );
  };

  const handleExportCSV = () => {
    const { headers, body, totalRow } = buildExportRows(sortedData, visibleMonths, totals);
    const formatRow = (row: ExportCell[]) =>
      row.map((cell, col) => (col < FIXED_COL_COUNT ? toCsvField(cell) : toCsvAmountField(cell))).join(',');
    const csv = [headers.map(toCsvField).join(','), ...[...body, totalRow].map(formatRow)].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `atm-monthly-sales-${selectedYear}-${exportFileSuffix(selectedPlatform)}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    const { headers, body, totalRow } = buildExportRows(sortedData, visibleMonths, totals);
    const lastCol = headers.length - 1;
    const monthStartCol = FIXED_COL_COUNT;

    // Add title row with platform filter
    const platformText = selectedPlatform === 'both'
      ? 'Both platforms'
      : selectedPlatform === 'bitstop'
        ? 'Bitstop platform'
        : 'Denet platform';

    const excelData: ExportCell[][] = [
      [`Sales by Month - by ATM - ${selectedYear} (${platformText})`],
      [], // Empty row
      headers,
      ...body,
      totalRow,
    ];

    // Create worksheet. Null (zero) cells are omitted so they're truly blank in
    // Excel; xlsx-js-style can't write a value-less cell, so blanks carry no style.
    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths
    ws['!cols'] = [
      { wch: 10 },  // Status
      { wch: 12 },  // Install
      { wch: 12 },  // Removed
      { wch: 10 },  // ATM ID
      { wch: 30 },  // ATM Name
      { wch: 12 },  // Platform
      ...visibleMonths.map(() => ({ wch: 12 })), // Month columns
      { wch: 15 }   // Totals
    ];

    // Style the title row (row 1)
    ws['A1'].s = {
      font: { bold: true, sz: 14, color: { rgb: "1F2937" } },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: "D1D5DB" } }
    };

    // Merge title cells across all exported columns
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } }];

    const border = {
      top: { style: 'thin', color: { rgb: "000000" } },
      bottom: { style: 'thin', color: { rgb: "000000" } },
      left: { style: 'thin', color: { rgb: "000000" } },
      right: { style: 'thin', color: { rgb: "000000" } }
    };

    // Style header row (row 3)
    const headerStyle = {
      font: { bold: true, sz: 12, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "1F2937" } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border
    };

    const headerRowIdx = 2;
    for (let c = 0; c <= lastCol; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r: headerRowIdx, c })];
      if (cell) cell.s = headerStyle;
    }

    // Style data rows and totals row
    const dataStartRowIdx = headerRowIdx + 1;
    const totalRowIdx = dataStartRowIdx + body.length;

    for (let r = dataStartRowIdx; r <= totalRowIdx; r++) {
      const isTotal = r === totalRowIdx;
      const rowData = isTotal ? null : sortedData[r - dataStartRowIdx];

      for (let c = 0; c <= lastCol; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue; // blank zero cell
        const cellValue = cell.v;

        if (c === 0) {
          // Status column - with red/green color
          const isInactive = cellValue === 'Inactive';
          cell.s = {
            font: {
              bold: isTotal,
              sz: 12,
              color: isTotal ? undefined : (isInactive ? { rgb: "EF4444" } : { rgb: "22C55E" }) // red-500 or green-500
            },
            alignment: { horizontal: 'left', vertical: 'center' },
            border,
            fill: isTotal ? { fgColor: { rgb: "D1D5DB" } } : undefined
          };
        } else if (c < monthStartCol) {
          // Install, Removed, ATM ID, Name, and Platform columns
          const isPlatformCol = c === monthStartCol - 1;
          const isBitstop = isPlatformCol && cellValue === 'Bitstop';
          const isDenet = isPlatformCol && cellValue === 'Denet';

          cell.s = {
            font: {
              bold: isTotal,
              sz: 12,
              color: isPlatformCol && !isTotal
                ? (isBitstop ? { rgb: "3B82F6" } : isDenet ? { rgb: "22C55E" } : undefined)
                : undefined
            },
            alignment: { horizontal: 'left', vertical: 'center' },
            border,
            fill: isTotal
              ? { fgColor: { rgb: "D1D5DB" } }
              : isPlatformCol
                ? (isBitstop ? { fgColor: { rgb: "DBEAFE" } } : isDenet ? { fgColor: { rgb: "D1FAE5" } } : undefined)
                : undefined
          };
        } else {
          // Month columns and Total column (last) - currency format
          const isTotalsCol = c === lastCol;
          const isNegative = typeof cellValue === 'number' && cellValue < 0;

          // Determine if this is the install or removal month for this ATM
          let isInstallMonth = false;
          let isRemovalMonth = false;
          if (rowData && !isTotalsCol) {
            const monthNum = visibleMonths[c - monthStartCol].monthNum;

            if (rowData.installed_date) {
              const [iYear, iMonth] = rowData.installed_date.split('-').map(Number);
              isInstallMonth = iYear === selectedYear && iMonth === monthNum;
            }

            if (rowData.removed_date) {
              const [rYear, rMonth] = rowData.removed_date.split('-').map(Number);
              isRemovalMonth = rYear === selectedYear && rMonth === monthNum;
            }
          }

          cell.s = {
            font: {
              sz: 12,
              color: isNegative ? { rgb: "DC2626" } : undefined,
              bold: isTotalsCol || isTotal // Bold for Totals column or totals row
            },
            alignment: { horizontal: 'center', vertical: 'center' },
            numFmt: '$#,##0',
            border,
            fill: isTotal
              ? { fgColor: { rgb: "D1D5DB" } }
              : isRemovalMonth
                ? { fgColor: { rgb: "FECACA" } } // Light red for removal month
                : isInstallMonth
                  ? { fgColor: { rgb: "FEF3C7" } } // Light yellow for install month
                  : undefined
          };
        }
      }
    }

    // Create workbook and download
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ATM Monthly Sales');
    XLSX.writeFile(wb, `atm-monthly-sales-${selectedYear}-${exportFileSuffix(selectedPlatform)}.xlsx`);
  };

  const stickyHead = 'sticky z-20 bg-muted text-foreground font-bold';

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
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className={`${stickyHead} left-0 w-[90px] min-w-[90px]`}>Status</TableHead>
                <TableHead className={`${stickyHead} left-[90px] w-[100px] min-w-[100px]`}>Install</TableHead>
                <TableHead className={`${stickyHead} left-[190px] w-[100px] min-w-[100px]`}>Removed</TableHead>
                <TableHead className={`${stickyHead} left-[290px] w-[100px] min-w-[100px]`}>
                  {renderSortLabel('ATM ID', 'atm_id')}
                </TableHead>
                <TableHead className={`${stickyHead} left-[390px] w-[250px] min-w-[250px]`}>
                  {renderSortLabel('ATM Name', 'atm_name')}
                </TableHead>
                <TableHead className={`${stickyHead} left-[640px] w-[100px] min-w-[100px] border-r-2 border-white/20`}>Platform</TableHead>
                {visibleMonths.map(month => (
                  <TableHead key={month.key} className="text-center font-bold text-foreground bg-muted w-[110px] min-w-[110px] max-w-[110px]">
                    {month.label}
                  </TableHead>
                ))}
                <TableHead className={`text-center w-[120px] min-w-[120px] ${TOTAL_COL_EDGE}`}>
                  {renderSortLabel('Totals', 'total', 'center')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : sortedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center text-muted-foreground">
                    No data available for {selectedYear}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {sortedData.map((row, idx) => {
                    const band = `${ROW_BAND[idx % 2]} ${ROW_HOVER}`;
                    const sticky = `sticky z-20 ${band}`;
                    return (
                      <TableRow key={idx} className="group border-white/5">
                        <TableCell className={`font-semibold ${sticky} left-0 w-[90px] min-w-[90px] ${row.active === false ? 'text-red-500' : 'text-green-500'}`}>
                          {row.active === false ? 'Inactive' : 'Active'}
                        </TableCell>
                        <TableCell className={`${sticky} left-[90px] w-[100px] min-w-[100px]`}>{formatDate(row.installed_date)}</TableCell>
                        <TableCell className={`${sticky} left-[190px] w-[100px] min-w-[100px]`}>{formatDate(row.removed_date)}</TableCell>
                        <TableCell className={`font-medium ${sticky} left-[290px] w-[100px] min-w-[100px]`}>{row.atm_id}</TableCell>
                        <TableCell className={`whitespace-nowrap ${sticky} left-[390px] w-[250px] min-w-[250px]`}>{row.atm_name}</TableCell>
                        <TableCell className={`${sticky} left-[640px] w-[100px] min-w-[100px] border-r-2 border-white/20`}>
                          <span className={`px-2 py-1 rounded text-xs ${
                            row.platform === 'bitstop'
                              ? 'bg-blue-500/20 text-blue-300'
                              : 'bg-green-500/20 text-green-300'
                          }`}>
                            {platformLabel(row.platform)}
                          </span>
                        </TableCell>
                        {visibleMonths.map(month => {
                          const value = row.monthlyTotals[month.key] || 0;

                          // Check if this is the install month for this ATM
                          let isInstallMonth = false;
                          if (row.installed_date) {
                            const [iYear, iMonth] = row.installed_date.split('-').map(Number);
                            isInstallMonth = iYear === selectedYear && iMonth === month.monthNum;
                          }

                          // Check if this is the removal month for this ATM
                          let isRemovalMonth = false;
                          if (row.removed_date) {
                            const [rYear, rMonth] = row.removed_date.split('-').map(Number);
                            isRemovalMonth = rYear === selectedYear && rMonth === month.monthNum;
                          }

                          return (
                            <TableCell
                              key={month.key}
                              className={`text-center font-mono w-[110px] min-w-[110px] max-w-[110px] ${band}`}
                            >
                              <span className={isRemovalMonth ? 'text-red-600 font-semibold' : isInstallMonth ? 'text-green-600 font-semibold' : isZero(value) ? 'text-muted-foreground' : ''}>
                                {formatMoney(value)}
                              </span>
                            </TableCell>
                          );
                        })}
                        <TableCell className={`text-center font-mono font-bold text-white w-[120px] min-w-[120px] border-l-2 border-slate-400 ${TOTAL_COL_BAND[idx % 2]} ${TOTAL_COL_HOVER}`}>
                          {formatMoney(row.yearTotal)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals Row */}
                  <TableRow className="border-t-2 border-white/20 font-bold hover:bg-transparent">
                    <TableCell colSpan={FIXED_COL_COUNT} className="sticky left-0 z-20 bg-muted border-r-2 border-white/20">TOTAL</TableCell>
                    {visibleMonths.map(month => (
                      <TableCell key={month.key} className="text-center font-mono bg-muted w-[110px] min-w-[110px] max-w-[110px]">
                        {formatMoney(totals.monthlyTotals[month.key] || 0)}
                      </TableCell>
                    ))}
                    <TableCell className={`text-center font-mono w-[120px] min-w-[120px] ${TOTAL_COL_EDGE}`}>
                      {formatMoney(totals.yearTotal)}
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
