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
}

export default function ATMProfitLoss() {
  // Get previous complete month as default
  const today = new Date();
  const currentMonth = today.getMonth() + 1; // 1-12
  const previousMonth = currentMonth === 1 ? 12 : currentMonth - 1;
  const defaultYear = currentMonth === 1 ? today.getFullYear() - 1 : today.getFullYear();
  const defaultMonthStr = String(previousMonth).padStart(2, '0');

  const [data, setData] = useState<ATMPLData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(defaultYear);
  const [selectedStartMonth, setSelectedStartMonth] = useState<string>(defaultMonthStr);
  const [selectedEndMonth, setSelectedEndMonth] = useState<string>(defaultMonthStr);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('both');
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [sortField, setSortField] = useState<keyof ATMPLData>('platform');
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

  // Helper function to check if a month is complete (can be used for P&L)
  const isMonthComplete = (year: number, month: string): boolean => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1; // 1-12

    // If year is in the future, month is not complete
    if (year > currentYear) return false;

    // If year is in the past, all months are complete
    if (year < currentYear) return true;

    // For current year, only months before current month are complete
    const monthNum = parseInt(month);
    return monthNum < currentMonth;
  };

  useEffect(() => {
    fetchAvailableYears();
  }, []);

  useEffect(() => {
    if (availableYears.length > 0) {
      fetchATMProfitLoss();
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

  const fetchATMProfitLoss = async () => {
    setIsLoading(true);
    try {
      // Build date range
      const startDate = `${selectedYear}-${selectedStartMonth}-01`;
      const endMonth = parseInt(selectedEndMonth);
      const lastDay = new Date(selectedYear, endMonth, 0).getDate();
      const endDate = `${selectedYear}-${selectedEndMonth}-${lastDay}`;

      // Calculate number of months in the date range
      const startMonthNum = parseInt(selectedStartMonth);
      const endMonthNum = parseInt(selectedEndMonth);
      const numMonths = endMonthNum - startMonthNum + 1;

      console.log(`P&L Report: Date range ${selectedYear}-${selectedStartMonth} to ${selectedYear}-${selectedEndMonth} = ${numMonths} months`);

      // Fetch ALL ATM profiles (including historical ones with date ranges)
      const { data: atmProfiles, error: atmError } = await supabase
        .from('atm_profiles')
        .select('atm_id, location_name, state, platform, platform_switch_date, monthly_rent, cash_management_rps, cash_management_rep, sales_rep_id, installed_date, removed_date, active');

      if (atmError) throw atmError;

      // Filter to ATM profiles relevant to the selected date range
      const rangeStart = new Date(parseInt(selectedYear.toString()), parseInt(selectedStartMonth) - 1, 1);
      const rangeEnd = new Date(parseInt(selectedYear.toString()), parseInt(selectedEndMonth), 0); // last day of end month
      const relevantProfiles = atmProfiles?.filter(p => {
        if (!p.atm_id) return false;
        // Active ATMs installed before/during the range
        if (p.active && p.installed_date && new Date(p.installed_date) <= rangeEnd) return true;
        // Inactive ATMs that overlapped the range
        if (p.active === false) {
          if (!p.installed_date) return false;
          if (new Date(p.installed_date) > rangeEnd) return false;
          if (p.removed_date && new Date(p.removed_date) < rangeStart) return false;
          return true;
        }
        return false;
      }) || [];

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
          .select('atm_id, sale, fee, bitstop_fee, platform, date')
          .gte('date', startDate)
          .lte('date', endDate)
          .range(from, to);

        if (error) throw error;
        if (data) {
          allTransactions = allTransactions.concat(data);
        }
      }

      // Report date range for calculations
      // Parse dates in local timezone to avoid timezone offset issues
      const [reportStartYear, reportStartMonthNum, reportStartDay] = startDate.split('-').map(Number);
      const [reportEndYear, reportEndMonthNum, reportEndDay] = endDate.split('-').map(Number);
      const reportStartDate = new Date(reportStartYear, reportStartMonthNum - 1, reportStartDay);
      const reportEndDate = new Date(reportEndYear, reportEndMonthNum - 1, reportEndDay);

      // Helper function: Check if ATM profile should be included based on platform filter
      const shouldIncludeProfile = (profile: any): boolean => {
        if (selectedPlatform === 'both') return true;

        // For ATMs with switch dates, determine which platform they were on during the report period
        if (profile.platform_switch_date) {
          const [sYear, sMonth, sDay] = profile.platform_switch_date.split('-').map(Number);
          const switchDate = new Date(sYear, sMonth - 1, sDay);

          // If report period is entirely BEFORE switch date, ATM was on Denet
          if (reportEndDate < switchDate) {
            return selectedPlatform === 'denet';
          }

          // If report period is entirely ON/AFTER switch date, ATM is on current platform (Bitstop)
          if (reportStartDate >= switchDate) {
            return profile.platform === selectedPlatform;
          }

          // If report period SPANS the switch date, include on both platforms
          // (This shouldn't happen often since we're typically running monthly reports)
          return true;
        }

        // No switch date: use current platform
        return profile.platform === selectedPlatform;
      };

      // Helper function: Determine which platform to use for a transaction based on switch date
      const getEffectivePlatform = (profile: any, transactionDate: Date): string => {
        // If no switch date, use current platform
        if (!profile.platform_switch_date) {
          return profile.platform;
        }

        const [sYear, sMonth, sDay] = profile.platform_switch_date.split('-').map(Number);
        const switchDate = new Date(sYear, sMonth - 1, sDay);

        // Before switch date, ATM was on Denet; on/after switch date, it's on current platform (Bitstop)
        if (transactionDate < switchDate) {
          return 'denet';
        } else {
          return profile.platform;
        }
      };

      // Helper function: Calculate expense months considering install/removed dates
      const calculateExpenseMonths = (profile: any, reportStartDate: Date, reportEndDate: Date): number => {
        // Skip if no install date
        if (!profile.installed_date) {
          return 0;
        }
        
        // Parse dates in local timezone to avoid timezone offset issues
        const [iYear, iMonth, iDay] = profile.installed_date.split('-').map(Number);
        const installDate = new Date(iYear, iMonth - 1, iDay);

        let removalDate = null;
        if (profile.removed_date) {
          const [rYear, rMonth, rDay] = profile.removed_date.split('-').map(Number);
          removalDate = new Date(rYear, rMonth - 1, rDay);
        }

        // Install date: first full month starts the FOLLOWING calendar month
        const monthAfterInstall = new Date(installDate.getFullYear(), installDate.getMonth() + 1, 1);

        // Determine effective start date (later of: month after install OR report start)
        // We need to compare at the MONTH level, not day level
        const reportStartMonth = new Date(reportStartDate.getFullYear(), reportStartDate.getMonth(), 1);
        let effectiveStart = monthAfterInstall > reportStartMonth ? monthAfterInstall : reportStartMonth;

        // Determine effective end date
        // Convert report end to first of month for consistent month counting
        const reportEndMonth = new Date(reportEndDate.getFullYear(), reportEndDate.getMonth(), 1);
        let effectiveEnd = reportEndMonth;

        if (removalDate) {
          // Get first day of the removal month
          const removalMonth = new Date(removalDate.getFullYear(), removalDate.getMonth(), 1);
          if (removalMonth < effectiveEnd) {
            effectiveEnd = removalMonth;
          }
        }

        // If effective start is after effective end, no expense months
        if (effectiveStart > effectiveEnd) {
          return 0;
        }

        // Count full months between effective start and end
        const startYear = effectiveStart.getFullYear();
        const startMonth = effectiveStart.getMonth();
        const endYear = effectiveEnd.getFullYear();
        const endMonth = effectiveEnd.getMonth();

        const monthCount = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;

        console.log(`[${profile.atm_id}] Install: ${profile.installed_date}, Report: ${reportStartDate.toISOString().split('T')[0]} to ${reportEndDate.toISOString().split('T')[0]}, MonthAfterInstall: ${monthAfterInstall.toISOString().split('T')[0]}, EffectiveStart: ${effectiveStart.toISOString().split('T')[0]}, EffectiveEnd: ${effectiveEnd.toISOString().split('T')[0]}, MonthCount: ${monthCount}`);

        return Math.max(0, monthCount);
      };

      // Fetch commission details for the date range
      const monthYears: string[] = [];
      for (let m = startMonthNum; m <= endMonthNum; m++) {
        const monthYear = `${selectedYear}-${String(m).padStart(2, '0')}-01`;
        monthYears.push(monthYear);
      }

      const { data: commissionDetails, error: commError } = await supabase
        .from('commission_details')
        .select('atm_id, commission_amount, commissions!inner(month_year)')
        .in('commissions.month_year', monthYears);

      if (commError) console.error('Error fetching commissions:', commError);

      // Create a map of commission amounts by ATM
      const commissionMap = new Map<string, number>();
      commissionDetails?.forEach(detail => {
        const current = commissionMap.get(detail.atm_id) || 0;
        commissionMap.set(detail.atm_id, current + (detail.commission_amount || 0));
      });

      // Group transactions by ATM ID for easy lookup
      const transactionsByATM = new Map<string, any[]>();
      allTransactions.forEach(tx => {
        if (!tx.atm_id) return;
        const existing = transactionsByATM.get(tx.atm_id) || [];
        existing.push(tx);
        transactionsByATM.set(tx.atm_id, existing);
      });

      // **PROFILE-DRIVEN APPROACH**: Start with all ATM profiles
      const resultData: ATMPLData[] = [];

      atmProfiles?.forEach(profile => {
        // Check if this profile should be included based on platform filter
        if (!shouldIncludeProfile(profile)) {
          return;
        }

        // Get transactions for this ATM first
        const atmTransactions = transactionsByATM.get(profile.atm_id) || [];

        // Calculate expense months based on install/removed dates and report period
        const expenseMonths = calculateExpenseMonths(profile, reportStartDate, reportEndDate);

        // Skip this ATM only if BOTH: no expense months AND no transactions
        if (expenseMonths === 0 && atmTransactions.length === 0) {
          return;
        }

        // Calculate expenses based on actual months the ATM was active
        // This considers install/removed dates
        const monthlyRent = profile.monthly_rent || 0;
        const monthlyMgmtRps = profile.cash_management_rps || 0;
        const monthlyMgmtRep = profile.cash_management_rep || 0;

        const rent = monthlyRent * expenseMonths;
        const mgmt_rps = monthlyMgmtRps * expenseMonths;
        const mgmt_rep = monthlyMgmtRep * expenseMonths;
        const commissions = commissionMap.get(profile.atm_id) || 0;

        console.log(`ATM ${profile.atm_id} (${profile.location_name}): ${expenseMonths} expense months (Rent: $${monthlyRent} × ${expenseMonths} = $${rent})`);

        // Aggregate transaction totals
        let total_sales = 0;
        let total_fees = 0;
        let bitstop_fees = 0;

        atmTransactions.forEach(tx => {
          // Only include transactions that match the effective platform for this ATM at this transaction date
          const txDate = new Date(tx.date);
          const effectivePlatform = getEffectivePlatform(profile, txDate);

          // For platform-switched ATMs: include all transactions regardless of transaction.platform
          // For non-switched ATMs: transaction.platform should match profile.platform (but we trust CSV data)
          // Since we're showing current profile platform, we include ALL transactions for this ATM
          total_sales += tx.sale || 0;
          total_fees += tx.fee || 0;
          bitstop_fees += tx.bitstop_fee || 0;
        });

        // Calculate fee percentage and net profit
        const fee_pct = total_sales > 0 ? (total_fees / total_sales) * 100 : 0;
        const net_profit = total_fees - bitstop_fees - rent - mgmt_rps - mgmt_rep - commissions;

        resultData.push({
          active: profile.active,
          installed_date: profile.installed_date,
          atm_id: profile.atm_id,
          atm_name: profile.location_name || profile.atm_id,
          state: profile.state || '',
          platform: profile.platform, // Show current platform from profile (Option A)
          total_sales,
          total_fees,
          fee_pct,
          bitstop_fees,
          rent,
          mgmt_rps,
          mgmt_rep,
          commissions,
          net_profit
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

  // Sort data based on current sort field and direction
  const sortedData = [...data].sort((a, b) => {
    // Primary sort: Platform (ascending)
    const platformCompare = (a.platform || '').localeCompare(b.platform || '');
    if (platformCompare !== 0) {
      return platformCompare;
    }

    // Secondary sort: Net Profit (descending)
    return b.net_profit - a.net_profit;
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
    const dateRange = selectedStartMonth === selectedEndMonth
      ? `${months.find(m => m.value === selectedStartMonth)?.label}-${selectedYear}`
      : `${months.find(m => m.value === selectedStartMonth)?.label}-${months.find(m => m.value === selectedEndMonth)?.label}-${selectedYear}`;
    link.download = `atm-profit-loss-${dateRange}.csv`;
    link.click();
  };

  const handleExportExcel = () => {
    // Prepare data for Excel
    const excelData = [];

    // Add title row with platform filter
    const dateRange = selectedStartMonth === selectedEndMonth
      ? `${months.find(m => m.value === selectedStartMonth)?.label} ${selectedYear}`
      : `${months.find(m => m.value === selectedStartMonth)?.label} thru ${months.find(m => m.value === selectedEndMonth)?.label} ${selectedYear}`;

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
              {months.map(month => {
                const isComplete = isMonthComplete(selectedYear, month.value);
                return (
                  <SelectItem
                    key={month.value}
                    value={month.value}
                    disabled={!isComplete}
                  >
                    {month.label} {!isComplete && '(Incomplete)'}
                  </SelectItem>
                );
              })}
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
                  <button
                    onClick={() => handleSort('commissions')}
                    className="flex items-center gap-1 hover:text-foreground/80 ml-auto"
                  >
                    Commissions
                    {sortField === 'commissions' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
                    ) : (
                      <ArrowUpDown className="w-4 h-4 opacity-50" />
                    )}
                  </button>
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
                        ${Math.round(row.total_sales).toLocaleString('en-US')}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        ${Math.round(row.total_fees).toLocaleString('en-US')}
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
                      <TableCell className={`text-right font-mono font-semibold ${row.net_profit < 0 ? 'text-red-400' : ''}`}>
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
