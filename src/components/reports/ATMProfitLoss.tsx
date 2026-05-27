import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import {
  calculateExpenseMonths,
  profilesForWindow,
  txsByProfile as groupTxsByProfile,
} from '@/lib/atm-profile';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, FileSpreadsheet, ArrowUpDown, ArrowUp, ArrowDown, Pencil, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const COMMISSIONS_TOOLTIP =
  "Commission values can be negative for ATMs whose monthly net profit is below zero while the assigned sales rep's overall monthly profit is positive. This is intentional attribution accounting — it shows which ATMs are dragging the rep's earnings down. The negative values balance against positive values from other ATMs and do NOT represent money owed by anyone. The total commission paid to the rep is always ≥ $0.";
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
import ATMSalesDrillDown from './ATMSalesDrillDown';
import { TransactionRow } from './TransactionsTable';

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

interface ATMPLData {
  active: boolean | null;
  installed_date: string | null;
  atm_id: string;
  atm_name: string;
  state: string;
  platform: string;
  total_sales: number;
  total_fees: number;
  fee_pct: number;
  bitstop_fees: number;
  rent: number;
  mgmt_rps: number;
  mgmt_rep: number;
  commissions: number;
  net_profit: number;
  has_override: boolean;
  /** The exact transactions used to compute total_sales for this row, after install/removed/sibling filtering. */
  transactions: TransactionRow[];
}

export default function ATMProfitLoss() {
  // Default: previous complete month
  const today = new Date();
  const currentMonth = today.getMonth() + 1; // 1-12
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const defaultYear = currentMonth === 1 ? today.getFullYear() - 1 : today.getFullYear();
  const defaultMonthStr = String(previousMonth).padStart(2, '0');
  const defaultLastDay = new Date(defaultYear, previousMonth, 0).getDate();
  const defaultFromDate = `${defaultYear}-${defaultMonthStr}-01`;
  const defaultToDate = `${defaultYear}-${defaultMonthStr}-${String(defaultLastDay).padStart(2, '0')}`;

  const [data, setData] = useState<ATMPLData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string>(defaultFromDate);
  const [toDate, setToDate] = useState<string>(defaultToDate);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('both');
  const [sortField, setSortField] = useState<keyof ATMPLData>('platform');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const escapeRef = useRef(false);
  const savingRef = useRef(false);
  const [drillDownRow, setDrillDownRow] = useState<ATMPLData | null>(null);

  // Single-month when fromDate and toDate are within the same year-month
  const isSingleMonth = fromDate.slice(0, 7) === toDate.slice(0, 7);

  // Derive the report's date-range strings (YYYY-MM-DD) for the drill-down.
  const reportStartDateStr = fromDate;
  const reportEndDateStr = toDate;

  useEffect(() => {
    fetchATMProfitLoss();
  }, [fromDate, toDate, selectedPlatform]);

  const fetchATMProfitLoss = async () => {
    // Bail before any fetch / Date() construction when picker state is invalid
    // (empty string, partial keystroke, malformed). Re-fires when state settles.
    if (!isValidYMD(fromDate) || !isValidYMD(toDate)) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      // Build date range from picker
      const startDate = fromDate;
      const endDate = `${toDate}T23:59:59`;

      // Parse year/month for cross-year month iteration
      const [startYear, startMonthNum] = fromDate.split('-').map(Number);
      const [endYear, endMonthNum] = toDate.split('-').map(Number);

      console.log(`P&L Report: Date range ${fromDate} to ${toDate}`);

      // Fetch ALL ATM profiles (including historical ones with date ranges)
      const { data: atmProfiles, error: atmError } = await supabase
        .from('atm_profiles')
        .select('id, atm_id, location_name, state, platform, monthly_rent, cash_management_rps, cash_management_rep, sales_rep_id, installed_date, removed_date, active');

      if (atmError) throw atmError;

      // Profiles whose [installed_date, removed_date] window overlaps the
      // report range. DB invariants in migration 20240522000034 guarantee
      // non-overlapping windows + one active=true per atm_id, so no
      // sibling-aware or active-flag logic is needed here.
      const rangeStart = new Date(startYear, startMonthNum - 1, 1);
      const rangeEnd = new Date(endYear, endMonthNum, 0); // last day of end month
      const relevantProfiles = profilesForWindow(atmProfiles || [], rangeStart, rangeEnd)
        .filter((p) => !!p.atm_id);

      // **VALIDATION: Check for missing platforms (only relevant ATMs)**
      const missingPlatform = relevantProfiles.filter(p => !p.platform);
      if (missingPlatform.length > 0) {
        const atmIds = [...new Set(missingPlatform.map(p => p.atm_id))].join(', ');
        setError(`Cannot run report: The following ATM IDs are missing platform assignments in ATM Profile settings: ${atmIds}. Please assign a platform (Bitstop or Denet) to these ATMs before running the report.`);
        setIsLoading(false);
        return;
      }

      // **VALIDATION: Check for missing install dates (only relevant ATMs)**
      const missingInstallDate = relevantProfiles.filter(p => !p.installed_date);
      if (missingInstallDate.length > 0) {
        const atmIds = [...new Set(missingInstallDate.map(p => p.atm_id))].join(', ');
        console.log('ATMs missing install dates:', missingInstallDate);
        setError(`Cannot run report: The following ATM IDs are missing install dates in ATM Profile settings: ${atmIds}. Please add an install date to these ATMs before running the report.`);
        setIsLoading(false);
        return;
      }

      // Clear any previous errors
      setError(null);

      // Fetch ALL transactions in date range (no platform filter yet)
      let allTransactions: any[] = [];
      const { count } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .gte('date', startDate)
        .lte('date', endDate);

      const batchSize = 1000;
      const batches = Math.ceil((count || 0) / batchSize);

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;

        const { data, error } = await supabase
          .from('transactions')
          .select('id, atm_id, atm_name, sale, fee, bitstop_fee, platform, date, customer_first_name, customer_last_name, ticker')
          .gte('date', startDate)
          .lte('date', endDate)
          .range(from, to);

        if (error) throw error;
        if (data) {
          allTransactions = allTransactions.concat(data);
        }
      }

      // Report date range for calculations (parsed in local TZ to avoid offset issues)
      const [reportStartYear, reportStartMonthNum, reportStartDay] = fromDate.split('-').map(Number);
      const [reportEndYear, reportEndMonthNum, reportEndDay] = toDate.split('-').map(Number);
      const reportStartDate = new Date(reportStartYear, reportStartMonthNum - 1, reportStartDay);
      const reportEndDate = new Date(reportEndYear, reportEndMonthNum - 1, reportEndDay);

      // calculateExpenseMonths imported from src/lib/atm-profile.
      // The Phase-1 boundary-derivation / month-window helpers used to
      // sit here; Phase 2b removed them once each profile became its
      // own one-platform period.

      // Fetch commission details for the date range (cross-year safe)
      const monthYears: string[] = [];
      const overrideMonths: string[] = [];
      for (let y = startYear; y <= endYear; y++) {
        const mStart = y === startYear ? startMonthNum : 1;
        const mEnd = y === endYear ? endMonthNum : 12;
        for (let m = mStart; m <= mEnd; m++) {
          const ymPadded = String(m).padStart(2, '0');
          monthYears.push(`${y}-${ymPadded}-01`);
          overrideMonths.push(`${y}-${ymPadded}`);
        }
      }

      const { data: commissionDetails, error: commError } = await supabase
        .from('commission_details')
        .select('atm_id, commission_amount, commissions!inner(month_year)')
        .in('commissions.month_year', monthYears);

      if (commError) console.error('Error fetching commissions:', commError);

      // Fetch bitstop fee overrides for the selected period

      const { data: feeOverrides, error: overrideError } = await supabase
        .from('bitstop_fee_overrides')
        .select('atm_id, year_month, actual_fees')
        .in('year_month', overrideMonths);

      if (overrideError) console.error('Error fetching fee overrides:', overrideError);

      // Build override lookup map: "atm_id:year_month" -> actual_fees
      const overrideMap = new Map<string, number>();
      feeOverrides?.forEach(o => {
        overrideMap.set(`${o.atm_id}:${o.year_month}`, Number(o.actual_fees));
      });

      // Map of commission detail rows by ATM (preserved per-month so we can
      // split commissions across the conversion boundary for converted ATMs).
      const commissionDetailsByATM = new Map<string, Array<{ month_ym: string; amount: number }>>();
      commissionDetails?.forEach(detail => {
        // Supabase v2 may return the !inner-joined parent as an object or an
        // array depending on relationship resolution; handle both shapes.
        const c = (detail.commissions as any);
        const monthYear = Array.isArray(c) ? c[0]?.month_year : c?.month_year;
        if (!monthYear) return;
        const arr = commissionDetailsByATM.get(detail.atm_id) || [];
        arr.push({ month_ym: monthYear.slice(0, 7), amount: detail.commission_amount || 0 });
        commissionDetailsByATM.set(detail.atm_id, arr);
      });

      // Per-transaction profile attribution. An atm_id may have multiple
      // atm_profiles rows (e.g., a move between locations); each tx must be
      // attributed to exactly ONE profile so that aggregation doesn't
      // double-count. The shared helper does strict date-window matching
      // and silently drops txs that fall outside every profile's window —
      // such gaps now indicate a data problem (DB invariants ensure each
      // active period has a single covering profile).
      const txsByProfile = groupTxsByProfile(allTransactions, relevantProfiles);

      // **PROFILE-DRIVEN APPROACH**: Start with all ATM profiles
      const resultData: ATMPLData[] = [];

      relevantProfiles?.forEach(profile => {
        // Transactions for this specific profile (per-tx attribution above).
        // No more install/removed/sibling filter — that's already enforced by
        // findProfileForTx so the same tx can't appear in two profiles' buckets.
        const atmTransactions = txsByProfile.get(profile.id) || [];

        const totalExpenseMonths = calculateExpenseMonths(profile, reportStartDate, reportEndDate);

        // Skip ATMs with no transactions AND no expense months
        if (totalExpenseMonths === 0 && atmTransactions.length === 0) {
          return;
        }

        const monthlyRent = profile.monthly_rent || 0;
        const monthlyMgmtRps = profile.cash_management_rps || 0;
        const monthlyMgmtRep = profile.cash_management_rep || 0;
        const atmCommDetails = commissionDetailsByATM.get(profile.atm_id) || [];
        const totalCommissions = atmCommDetails.reduce((s, d) => s + d.amount, 0);

        // Zero-tx fallback: keep the row (so rent losses stay visible) and use
        // atm_profiles.platform as a label-of-last-resort. Skip when all three
        // expense rates are zero — an unpopulated profile shouldn't add a noise
        // row of all-zeros next to the real-tx row for the same ATM.
        if (atmTransactions.length === 0) {
          if (monthlyRent === 0 && monthlyMgmtRps === 0 && monthlyMgmtRep === 0) return;

          const fallbackPlatform = (profile.platform || '').toLowerCase() || 'denet';
          if (selectedPlatform !== 'both' && fallbackPlatform !== selectedPlatform) return;

          const rent = monthlyRent * totalExpenseMonths;
          const mgmt_rps = monthlyMgmtRps * totalExpenseMonths;
          const mgmt_rep = monthlyMgmtRep * totalExpenseMonths;
          const net_profit = -rent - mgmt_rps - mgmt_rep - totalCommissions;

          resultData.push({
            active: profile.active,
            installed_date: profile.installed_date,
            atm_id: profile.atm_id,
            atm_name: profile.location_name || profile.atm_id,
            state: profile.state || '',
            platform: fallbackPlatform,
            total_sales: 0,
            total_fees: 0,
            fee_pct: 0,
            bitstop_fees: 0,
            rent,
            mgmt_rps,
            mgmt_rep,
            commissions: totalCommissions,
            net_profit,
            has_override: false,
            transactions: [],
          });
          return;
        }

        // Per-profile aggregation. Each profile represents one platform
        // period under the multi-row model, so no per-platform re-split
        // within a profile is needed — that machinery moved here from
        // Phase 2a's bucket-derivation block.
        const profilePlatform = (profile.platform || '').toLowerCase();
        if (selectedPlatform !== 'both' && profilePlatform !== selectedPlatform) {
          return;
        }

        let total_sales = 0;
        let total_fees = 0;
        let bitstop_fees = 0;
        atmTransactions.forEach((tx: any) => {
          total_sales += tx.sale || 0;
          total_fees += tx.fee || 0;
          bitstop_fees += tx.bitstop_fee || 0;
        });

        // Commission attribution: months whose YYYY-MM is inside this
        // profile's calendar window get credited to this profile. The
        // window is derived from installed_date / removed_date directly;
        // under the EXCLUDE constraint, no month is shared between two
        // profiles of the same atm_id.
        const profileFirstYM = profile.installed_date
          ? profile.installed_date.slice(0, 7)
          : '0000-00';
        const profileLastYM = profile.removed_date
          ? profile.removed_date.slice(0, 7)
          : '9999-12';
        const profileCommissions = atmCommDetails
          .filter((d) => d.month_ym >= profileFirstYM && d.month_ym <= profileLastYM)
          .reduce((s, d) => s + d.amount, 0);

        // Bitstop fee overrides: only when this profile is on Bitstop AND
        // only for months inside the profile's window. The override map is
        // keyed by (atm_id, ym); without the window guard, an override
        // targeting a different profile's months on the same atm_id could
        // leak in.
        let has_override = false;
        if (profilePlatform === 'bitstop') {
          const feesByMonth = new Map<string, number>();
          atmTransactions.forEach((tx: any) => {
            if (tx.date) {
              const ym = tx.date.slice(0, 7);
              feesByMonth.set(ym, (feesByMonth.get(ym) || 0) + (tx.fee || 0));
            }
          });

          let overriddenTotal = 0;
          for (let y = startYear; y <= endYear; y++) {
            const mStart = y === startYear ? startMonthNum : 1;
            const mEnd = y === endYear ? endMonthNum : 12;
            for (let m = mStart; m <= mEnd; m++) {
              const ym = `${y}-${String(m).padStart(2, '0')}`;
              if (ym < profileFirstYM || ym > profileLastYM) continue;
              const key = `${profile.atm_id}:${ym}`;
              if (overrideMap.has(key)) {
                overriddenTotal += overrideMap.get(key)!;
                has_override = true;
              } else {
                overriddenTotal += feesByMonth.get(ym) || 0;
              }
            }
          }
          if (has_override) {
            total_fees = overriddenTotal;
          }
        }

        const rent = monthlyRent * totalExpenseMonths;
        const mgmt_rps = monthlyMgmtRps * totalExpenseMonths;
        const mgmt_rep = monthlyMgmtRep * totalExpenseMonths;
        const fee_pct = total_sales > 0 ? (total_fees / total_sales) * 100 : 0;
        const net_profit =
          total_fees - bitstop_fees - rent - mgmt_rps - mgmt_rep - profileCommissions;

        const drillDownTransactions: TransactionRow[] = atmTransactions.map((tx: any) => ({
          id: tx.id || '',
          date: tx.date || '',
          atm_id: tx.atm_id || '',
          atm_name: tx.atm_name || profile.location_name || profile.atm_id,
          platform: tx.platform || profilePlatform,
          customer_first_name: tx.customer_first_name || '',
          customer_last_name: tx.customer_last_name || '',
          ticker: tx.ticker || '',
          sale: tx.sale || 0,
          fee: tx.fee || 0,
          bitstop_fee: tx.bitstop_fee || 0,
        }));

        resultData.push({
          active: profile.active,
          installed_date: profile.installed_date,
          atm_id: profile.atm_id,
          atm_name: profile.location_name || profile.atm_id,
          state: profile.state || '',
          platform: profilePlatform,
          total_sales,
          total_fees,
          fee_pct,
          bitstop_fees,
          rent,
          mgmt_rps,
          mgmt_rep,
          commissions: profileCommissions,
          net_profit,
          has_override,
          transactions: drillDownTransactions,
        });
      });

      setData(resultData);
    } catch (error) {
      console.error('Error fetching ATM P&L:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSort = (field: keyof ATMPLData) => {
    if (sortField === field) {
      // Toggle direction if clicking same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleSaveOverride = async (atmId: string, value: string) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setEditingCell(null);

    // Editing requires single-month mode — pull YYYY-MM from fromDate
    const yearMonth = fromDate.slice(0, 7);
    const numValue = parseFloat(value);

    if (isNaN(numValue) || value.trim() === '') {
      // Delete override → revert to calculated fee
      await supabase
        .from('bitstop_fee_overrides')
        .delete()
        .eq('atm_id', atmId)
        .eq('year_month', yearMonth);
    } else {
      // Upsert override
      await supabase
        .from('bitstop_fee_overrides')
        .upsert({
          atm_id: atmId,
          year_month: yearMonth,
          actual_fees: numValue,
          updated_at: new Date().toISOString()
        }, { onConflict: 'atm_id,year_month' });
    }

    await fetchATMProfitLoss();
    savingRef.current = false;
  };

  // ATMs that produced more than one row (a Denet and a Bitstop bucket in range).
  // Used to label the drill-down sheet header so the user can tell which slice
  // they're viewing for a converted machine.
  const convertedAtmIds = (() => {
    const counts = new Map<string, number>();
    data.forEach(r => counts.set(r.atm_id, (counts.get(r.atm_id) || 0) + 1));
    const set = new Set<string>();
    counts.forEach((n, id) => { if (n > 1) set.add(id); });
    return set;
  })();

  // Sort data based on current sort field and direction
  const sortedData = [...data].sort((a, b) => {
    const aVal = a[sortField];
    const bVal = b[sortField];
    let compare = 0;

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      compare = (aVal || '').localeCompare(bVal || '');
    } else {
      compare = (Number(aVal) || 0) - (Number(bVal) || 0);
    }

    return sortDirection === 'asc' ? compare : -compare;
  });

  // Helper function to format dates as MM/DD/YY
  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
  };

  const handleExportCSV = () => {
    const headers = [
      'Status',
      'Install',
      'ATM ID',
      'ATM Name',
      'State',
      'Platform',
      'Total Sales',
      'Total Fees',
      'Fee %',
      'Bitstop Fees',
      'Rent',
      'Mgmt - RPS',
      'Mgmt - Rep',
      'Commissions',
      'Net Profit'
    ];

    const rows = data.map(row => [
      row.active === false ? 'Inactive' : 'Active',
      formatDate(row.installed_date),
      row.atm_id,
      row.atm_name,
      row.state,
      row.platform,
      Math.round(row.total_sales),
      Math.round(row.total_fees),
      row.fee_pct.toFixed(2) + '%',
      Math.round(row.bitstop_fees),
      Math.round(row.rent),
      Math.round(row.mgmt_rps),
      Math.round(row.mgmt_rep),
      Math.round(row.commissions),
      Math.round(row.net_profit)
    ]);

    // Add totals row
    const totals = data.reduce((acc, row) => ({
      total_sales: acc.total_sales + row.total_sales,
      total_fees: acc.total_fees + row.total_fees,
      bitstop_fees: acc.bitstop_fees + row.bitstop_fees,
      rent: acc.rent + row.rent,
      mgmt_rps: acc.mgmt_rps + row.mgmt_rps,
      mgmt_rep: acc.mgmt_rep + row.mgmt_rep,
      commissions: acc.commissions + row.commissions,
      net_profit: acc.net_profit + row.net_profit,
    }), {
      total_sales: 0,
      total_fees: 0,
      bitstop_fees: 0,
      rent: 0,
      mgmt_rps: 0,
      mgmt_rep: 0,
      commissions: 0,
      net_profit: 0,
    });

    const totalFeePct = totals.total_sales > 0 ? (totals.total_fees / totals.total_sales) * 100 : 0;

    rows.push([
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      Math.round(totals.total_sales),
      Math.round(totals.total_fees),
      totalFeePct.toFixed(2) + '%',
      Math.round(totals.bitstop_fees),
      Math.round(totals.rent),
      Math.round(totals.mgmt_rps),
      Math.round(totals.mgmt_rep),
      Math.round(totals.commissions),
      Math.round(totals.net_profit)
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateRange = formatDateRangeText(fromDate, toDate).replace(/ /g, '-');
    link.download = `atm-profit-loss-${dateRange}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    // Prepare data for Excel
    const excelData = [];

    // Add title row with platform filter
    const dateRange = formatDateRangeText(fromDate, toDate);

    const platformText = selectedPlatform === 'both'
      ? 'Both platforms'
      : selectedPlatform === 'bitstop'
        ? 'Bitstop platform'
        : 'Denet platform';

    excelData.push([`ATM Profit & Loss Report - ${dateRange} (${platformText})`]);
    excelData.push([]); // Empty row

    // Calculate scorecard metrics
    const totals = data.reduce((acc, row) => ({
      total_sales: acc.total_sales + row.total_sales,
      total_fees: acc.total_fees + row.total_fees,
      bitstop_fees: acc.bitstop_fees + row.bitstop_fees,
      rent: acc.rent + row.rent,
      mgmt_rps: acc.mgmt_rps + row.mgmt_rps,
      mgmt_rep: acc.mgmt_rep + row.mgmt_rep,
      commissions: acc.commissions + row.commissions,
      net_profit: acc.net_profit + row.net_profit,
    }), {
      total_sales: 0,
      total_fees: 0,
      bitstop_fees: 0,
      rent: 0,
      mgmt_rps: 0,
      mgmt_rep: 0,
      commissions: 0,
      net_profit: 0,
    });

    const totalFeePct = totals.total_sales > 0 ? (totals.total_fees / totals.total_sales) : 0;
    const totalExpenses = totals.bitstop_fees + totals.rent + totals.mgmt_rps + totals.mgmt_rep + totals.commissions;
    const pctOfTotalSales = totals.total_sales > 0 ? (totals.net_profit / totals.total_sales) : 0;
    const pctOfTotalRevenue = totals.total_fees > 0 ? (totals.net_profit / totals.total_fees) : 0;

    // Add scorecards
    excelData.push(['Key Metrics', '']); // Row 3 - header with both columns
    excelData.push(['Total Sales', Math.round(totals.total_sales)]);
    excelData.push(['Total Fees', Math.round(totals.total_fees)]);
    excelData.push(['Total Fee %', totalFeePct]);
    excelData.push(['Total Expenses', Math.round(totalExpenses)]);
    excelData.push(['Total Net Profit $', Math.round(totals.net_profit)]);
    excelData.push(['% of Total Sales', pctOfTotalSales]);
    excelData.push(['% of Total Revenue', pctOfTotalRevenue]);
    excelData.push([]);
    excelData.push([]);

    // Add headers
    excelData.push([
      'Status',
      'Install',
      'ATM ID',
      'ATM Name',
      'State',
      'Platform',
      'Total Sales',
      'Total Fees',
      'Fee %',
      'Bitstop Fees',
      'Rent',
      'Mgmt - RPS',
      'Mgmt - Rep',
      'Commissions',
      'Net Profit'
    ]);

    // Sort data by Platform (ascending), then Net Profit (descending)
    const sortedExcelData = [...data].sort((a, b) => {
      const platformCompare = (a.platform || '').localeCompare(b.platform || '');
      if (platformCompare !== 0) {
        return platformCompare;
      }
      return b.net_profit - a.net_profit;
    });

    // Add data rows
    sortedExcelData.forEach(row => {
      excelData.push([
        row.active === false ? 'Inactive' : 'Active',
        formatDate(row.installed_date),
        row.atm_id,
        row.atm_name,
        row.state,
        row.platform,
        Math.round(row.total_sales),
        Math.round(row.total_fees),
        row.fee_pct / 100, // Convert to decimal for percentage formatting
        Math.round(row.bitstop_fees),
        Math.round(row.rent),
        Math.round(row.mgmt_rps),
        Math.round(row.mgmt_rep),
        Math.round(row.commissions),
        Math.round(row.net_profit)
      ]);
    });

    // Add totals row
    excelData.push([
      'TOTAL',
      '',
      '',
      '',
      '',
      '',
      Math.round(totals.total_sales),
      Math.round(totals.total_fees),
      totalFeePct,
      Math.round(totals.bitstop_fees),
      Math.round(totals.rent),
      Math.round(totals.mgmt_rps),
      Math.round(totals.mgmt_rep),
      Math.round(totals.commissions),
      Math.round(totals.net_profit)
    ]);

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // Set column widths
    ws['!cols'] = [
      { wch: 22 },  // Column A - Wide enough for "% of Total Revenue" (longest key metric text)
      { wch: 15 },  // Column B - Values
      { wch: 10 },  // ATM ID
      { wch: 30 },  // ATM Name
      { wch: 6 },   // State
      { wch: 12 },  // Platform
      { wch: 15 },  // Total Sales
      { wch: 15 },  // Total Fees
      { wch: 10 },  // Fee %
      { wch: 15 },  // Bitstop Fees
      { wch: 12 },  // Rent
      { wch: 12 },  // Mgmt - RPS
      { wch: 12 },  // Mgmt - Rep
      { wch: 15 },  // Commissions
      { wch: 15 }   // Net Profit
    ];

    // Style the title row (row 1)
    ws['A1'].s = {
      font: { bold: true, sz: 14, color: { rgb: "1F2937" } },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: "D1D5DB" } }
    };

    // Merge title cells
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 14 } }];

    // Border style for Key Metrics section
    const metricBorder = {
      top: { style: 'thin', color: { rgb: "000000" } },
      bottom: { style: 'thin', color: { rgb: "000000" } },
      left: { style: 'thin', color: { rgb: "000000" } },
      right: { style: 'thin', color: { rgb: "000000" } }
    };

    // Style "Key Metrics" header (Row 3, cells A3 and B3) - Yellow highlight
    ws['A3'].s = {
      font: { bold: true, sz: 12, color: { rgb: "000000" } },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: "FFFF00" } }, // Yellow
      border: metricBorder
    };
    ws['B3'].s = {
      font: { bold: true, sz: 12, color: { rgb: "000000" } },
      alignment: { horizontal: 'right', vertical: 'center' },
      fill: { fgColor: { rgb: "FFFF00" } }, // Yellow
      border: metricBorder
    };

    // Style scorecard data rows (4-10: Total Sales through % of Total Revenue)
    const scorecardLabelStyle = {
      font: { bold: true, sz: 11 },
      alignment: { horizontal: 'left', vertical: 'center' },
      fill: { fgColor: { rgb: "E5E7EB" } },
      border: metricBorder
    };

    for (let row = 4; row <= 10; row++) {
      // Label column (A)
      if (ws[`A${row}`]) ws[`A${row}`].s = scorecardLabelStyle;

      // Value column (B)
      if (ws[`B${row}`]) {
        const cell = ws[`B${row}`];
        // Check if it's a percentage (rows 6, 9, 10: Total Fee %, % of Total Sales, % of Total Revenue)
        if (row === 6 || row === 9 || row === 10) {
          cell.s = {
            font: { sz: 11 },
            alignment: { horizontal: 'right', vertical: 'center' },
            numFmt: '0.00%',
            border: metricBorder
          };
        } else {
          cell.s = {
            font: { sz: 11 },
            alignment: { horizontal: 'right', vertical: 'center' },
            numFmt: '$#,##0',
            border: metricBorder
          };
        }
      }
    }

    // Style the header row - data table headers are now at row 13
    const headerRow = 13;
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

    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'].forEach(col => {
      const cell = `${col}${headerRow}`;
      if (ws[cell]) {
        ws[cell].s = headerStyle;
      }
    });

    // Attach an Excel comment to the Commissions header (column N) so the
    // explanation rides along with the export.
    const commissionsHeaderCell = `N${headerRow}`;
    if (ws[commissionsHeaderCell]) {
      (ws[commissionsHeaderCell] as any).c = [{ a: 'Denet', t: COMMISSIONS_TOOLTIP }];
    }

    // Style data rows and totals row
    const dataStartRow = 14; // First data row after headers (header is row 13)
    const totalRow = dataStartRow + sortedExcelData.length; // Total row is right after last data row

    for (let i = dataStartRow; i <= totalRow; i++) {
      const isTotal = i === totalRow;

      // Status, Install, ATM ID, Name, State, and Platform (columns A, B, C, D, E, and F)
      ['A', 'B', 'C', 'D', 'E', 'F'].forEach(col => {
        const cell = `${col}${i}`;
        if (ws[cell]) {
          const cellValue = ws[cell].v;
          const isInactive = cellValue === 'Inactive';
          const isActive = cellValue === 'Active';
          const isBitstop = col === 'F' && cellValue?.toLowerCase() === 'bitstop';
          const isDenet = col === 'F' && cellValue?.toLowerCase() === 'denet';

          ws[cell].s = {
            font: {
              bold: isTotal,
              sz: 12,
              color: col === 'A' && !isTotal 
                ? (isInactive ? { rgb: "DC2626" } : isActive ? { rgb: "22C55E" } : undefined)
                : col === 'F' && !isTotal
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
              : col === 'F' && !isTotal
                ? (isBitstop ? { fgColor: { rgb: "DBEAFE" } } : isDenet ? { fgColor: { rgb: "D1FAE5" } } : undefined)
                : undefined
          };
        }
      });

      // Currency columns (G, H, J-O) - currency format
      ['G', 'H', 'J', 'K', 'L', 'M', 'N', 'O'].forEach(col => {
        const cell = `${col}${i}`;
        if (ws[cell]) {
          const cellValue = ws[cell].v;
          const isNegative = typeof cellValue === 'number' && cellValue < 0;

          ws[cell].s = {
            font: {
              bold: isTotal,
              sz: 12,
              color: isNegative ? { rgb: "DC2626" } : undefined // Red color for negative values
            },
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

      // Fee % column (I) - percentage format
      const feePctCell = `I${i}`;
      if (ws[feePctCell]) {
        ws[feePctCell].s = {
          font: {
            bold: isTotal,
            sz: 12
          },
          alignment: { horizontal: 'right', vertical: 'center' },
          numFmt: '0.00%',
          border: {
            top: { style: 'thin', color: { rgb: "000000" } },
            bottom: { style: 'thin', color: { rgb: "000000" } },
            left: { style: 'thin', color: { rgb: "000000" } },
            right: { style: 'thin', color: { rgb: "000000" } }
          },
          fill: isTotal ? { fgColor: { rgb: "D1D5DB" } } : undefined
        };
      }
    }

    // Create workbook and download
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ATM P&L');

    // Add platform to filename
    const platformSuffix = selectedPlatform === 'both'
      ? 'Both'
      : selectedPlatform === 'bitstop'
        ? 'Bitstop'
        : 'Denet';

    XLSX.writeFile(wb, `atm-profit-loss-${dateRange.replace(/ /g, '-')}-${platformSuffix}.xlsx`);
  };

  // Calculate totals
  const totals = data.reduce((acc, row) => ({
    total_sales: acc.total_sales + row.total_sales,
    total_fees: acc.total_fees + row.total_fees,
    bitstop_fees: acc.bitstop_fees + row.bitstop_fees,
    rent: acc.rent + row.rent,
    mgmt_rps: acc.mgmt_rps + row.mgmt_rps,
    mgmt_rep: acc.mgmt_rep + row.mgmt_rep,
    commissions: acc.commissions + row.commissions,
    net_profit: acc.net_profit + row.net_profit,
  }), {
    total_sales: 0,
    total_fees: 0,
    bitstop_fees: 0,
    rent: 0,
    mgmt_rps: 0,
    mgmt_rep: 0,
    commissions: 0,
    net_profit: 0,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>ATM Profit & Loss Report</CardTitle>
            <CardDescription>
              Detailed P&L breakdown by ATM
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
        {/* Error Alert */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-md">
            <p className="text-sm">{error}</p>
          </div>
        )}

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
        </div>

        {/* Scorecards */}
        {!isLoading && data.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <Card className="bg-white/5 border-white/10">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Total Sales</div>
                <div className="text-2xl font-bold">${Math.round(totals.total_sales).toLocaleString('en-US')}</div>
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/10">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Total Fees</div>
                <div className="text-2xl font-bold">${Math.round(totals.total_fees).toLocaleString('en-US')}</div>
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/10">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Total Fee %</div>
                <div className="text-2xl font-bold">{totals.total_sales > 0 ? ((totals.total_fees / totals.total_sales) * 100).toFixed(2) : '0.00'}%</div>
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/10">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Total Expenses</div>
                <div className="text-2xl font-bold">${Math.round(totals.bitstop_fees + totals.rent + totals.mgmt_rps + totals.mgmt_rep + totals.commissions).toLocaleString('en-US')}</div>
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/10">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">Net Profit $</div>
                <div className={`text-2xl font-bold ${totals.net_profit < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  ${Math.round(totals.net_profit).toLocaleString('en-US')}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/10">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">% of Total Sales</div>
                <div className={`text-2xl font-bold ${totals.total_sales > 0 && (totals.net_profit / totals.total_sales) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {totals.total_sales > 0 ? ((totals.net_profit / totals.total_sales) * 100).toFixed(2) : '0.00'}%
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white/5 border-white/10">
              <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">% of Total Rev</div>
                <div className={`text-2xl font-bold ${totals.total_fees > 0 && (totals.net_profit / totals.total_fees) < 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {totals.total_fees > 0 ? ((totals.net_profit / totals.total_fees) * 100).toFixed(2) : '0.00'}%
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Drill-down sheet */}
        <ATMSalesDrillDown
          open={drillDownRow !== null}
          onOpenChange={(open) => { if (!open) setDrillDownRow(null); }}
          machineName={drillDownRow?.atm_name ?? ''}
          atmId={drillDownRow?.atm_id ?? ''}
          startDate={reportStartDateStr}
          endDate={reportEndDateStr}
          transactions={drillDownRow?.transactions ?? []}
          platformLabel={
            drillDownRow && convertedAtmIds.has(drillDownRow.atm_id)
              ? (drillDownRow.platform?.toLowerCase() === 'bitstop' ? 'Bitstop' : 'Denet')
              : null
          }
        />

        {/* Table */}
        <div className="rounded-md border border-white/10 overflow-x-auto">
          <Table>
            <TableHeader className="bg-white/5">
              <TableRow className="border-white/10">
                <TableHead className="font-bold">
                  <button
                    onClick={() => handleSort('active')}
                    className="flex items-center gap-1 hover:text-foreground/80"
                  >
                    Status
                    {sortField === 'active' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="font-bold">
                  <button
                    onClick={() => handleSort('installed_date')}
                    className="flex items-center gap-1 hover:text-foreground/80"
                  >
                    Install
                    {sortField === 'installed_date' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
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
                    onClick={() => handleSort('state')}
                    className="flex items-center gap-1 hover:text-foreground/80"
                  >
                    State
                    {sortField === 'state' ? (
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
                    onClick={() => handleSort('fee_pct')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Fee %
                    {sortField === 'fee_pct' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <button
                    onClick={() => handleSort('bitstop_fees')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Bitstop Fees
                    {sortField === 'bitstop_fees' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <button
                    onClick={() => handleSort('rent')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Rent
                    {sortField === 'rent' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <button
                    onClick={() => handleSort('mgmt_rps')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Mgmt - RPS
                    {sortField === 'mgmt_rps' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <button
                    onClick={() => handleSort('mgmt_rep')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Mgmt - Rep
                    {sortField === 'mgmt_rep' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleSort('commissions')}
                      className="flex items-center gap-1 hover:text-foreground/80"
                    >
                      Commissions
                      {sortField === 'commissions' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                      ) : (
                        <ArrowUpDown className="w-4 h-4 opacity-50" />
                      )}
                    </button>
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="About negative commission values"
                            className="flex items-center text-muted-foreground hover:text-foreground/80"
                          >
                            <Info className="w-3.5 h-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-sm text-left whitespace-normal leading-snug">
                          {COMMISSIONS_TOOLTIP}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </TableHead>
                <TableHead className="text-right font-bold">
                  <button
                    onClick={() => handleSort('net_profit')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Net Profit
                    {sortField === 'net_profit' ? (
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
                  <TableCell colSpan={15} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : data.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={15} className="text-center text-muted-foreground">
                    No data available for selected period
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {sortedData.map((row, idx) => (
                    <TableRow key={idx} className="border-white/5">
                      <TableCell className={`font-semibold ${row.active === false ? 'text-red-500' : 'text-green-500'}`}>
                        {row.active === false ? 'Inactive' : 'Active'}
                      </TableCell>
                      <TableCell>{formatDate(row.installed_date)}</TableCell>
                      <TableCell className="font-medium">{row.atm_id}</TableCell>
                      <TableCell className="max-w-[200px] truncate whitespace-nowrap overflow-hidden" title={row.atm_name}>
                        {row.atm_name}
                      </TableCell>
                      <TableCell>{row.state}</TableCell>
                      <TableCell>
                        <span className={`px-2 py-1 rounded text-xs ${
                          row.platform?.toLowerCase() === 'bitstop'
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'bg-green-500/20 text-green-300'
                        }`}>
                          {row.platform}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.total_sales > 0 ? (
                          <button
                            type="button"
                            onClick={() => setDrillDownRow(row)}
                            className="font-mono hover:underline cursor-pointer focus:outline-none focus-visible:underline"
                            title="View transactions"
                          >
                            ${Math.round(row.total_sales).toLocaleString('en-US')}
                          </button>
                        ) : (
                          <>${Math.round(row.total_sales).toLocaleString('en-US')}</>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.platform?.toLowerCase() === 'bitstop' && isSingleMonth ? (
                          editingCell === String(idx) ? (
                            <div className="flex items-center gap-1 justify-end">
                              <span className="text-muted-foreground">$</span>
                              <input
                                type="number"
                                className="w-24 bg-background border border-border rounded px-2 py-1 text-right text-sm font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    (e.target as HTMLInputElement).blur();
                                  }
                                  if (e.key === 'Escape') {
                                    escapeRef.current = true;
                                    setEditingCell(null);
                                  }
                                }}
                                onBlur={() => {
                                  if (escapeRef.current) {
                                    escapeRef.current = false;
                                    return;
                                  }
                                  if (savingRef.current) return;
                                  handleSaveOverride(row.atm_id, editValue);
                                }}
                                autoFocus
                              />
                            </div>
                          ) : (
                            <div
                              className="group flex items-center gap-1.5 justify-end cursor-pointer"
                              onClick={() => {
                                setEditingCell(String(idx));
                                setEditValue(String(Math.round(row.total_fees)));
                              }}
                            >
                              {row.has_override && (
                                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/40 inline-block flex-shrink-0" title="Using vendor override" />
                              )}
                              ${Math.round(row.total_fees).toLocaleString('en-US')}
                              <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity flex-shrink-0" />
                            </div>
                          )
                        ) : (
                          <div className="flex items-center gap-1.5 justify-end" title={row.platform?.toLowerCase() === 'bitstop' && !isSingleMonth ? 'Select a single month to edit' : undefined}>
                            {row.has_override && (
                              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400/40 inline-block flex-shrink-0" title="Using vendor override" />
                            )}
                            ${Math.round(row.total_fees).toLocaleString('en-US')}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {row.fee_pct.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.bitstop_fees).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.rent).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.mgmt_rps).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.mgmt_rep).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.commissions).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className={`text-right font-mono font-semibold ${row.net_profit < 0 ? 'text-red-400' : row.net_profit > 0 ? 'text-green-400' : ''}`}>
                        ${Math.round(row.net_profit).toLocaleString('en-US')}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="border-white/10 bg-white/5 font-bold">
                    <TableCell colSpan={6}>TOTAL</TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.total_sales).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.total_fees).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {totals.total_sales > 0 ? ((totals.total_fees / totals.total_sales) * 100).toFixed(2) : '0.00'}%
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.bitstop_fees).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.rent).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.mgmt_rps).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.mgmt_rep).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${Math.round(totals.commissions).toLocaleString('en-US')}
                    </TableCell>
                    <TableCell className={`text-right font-mono ${totals.net_profit < 0 ? 'text-red-400' : ''}`}>
                      ${Math.round(totals.net_profit).toLocaleString('en-US')}
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
