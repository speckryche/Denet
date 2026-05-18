import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileSpreadsheet, RotateCcw, Loader2, Info } from 'lucide-react';
import * as XLSX from 'xlsx-js-style';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────
interface ATMProfile {
  atm_id: string;
  location_name: string | null;
  state: string | null;
  platform: string;
  platform_switch_date: string | null;
  monthly_rent: number | null;
  cash_management_rps: number | null;
  cash_management_rep: number | null;
  installed_date: string | null;
  removed_date: string | null;
  active: boolean | null;
  sales_rep_id: string | null;
}

interface PerMachinePL {
  atm_id: string;
  total_sales: number;
  total_fees: number;
  bitstop_fees: number;
  rent: number;
  mgmt_rps: number;
  mgmt_rep: number;
  commissions: number;
  net_profit: number;
}

interface CommissionRateInfo {
  rate: number;
  basis: string; // description of how rate was derived
  isFallback: boolean;
  isEmpty: boolean;
}

// ──────────────────────────────────────────────────────────────
// Helpers (mirrored from ATMProfitLoss.tsx)
// ──────────────────────────────────────────────────────────────
const parseLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const getEffectivePlatform = (
  profile: ATMProfile,
  transactionDate: Date
): string => {
  if (!profile.platform_switch_date) return profile.platform;
  const switchDate = parseLocalDate(profile.platform_switch_date);
  return transactionDate < switchDate ? 'denet' : profile.platform;
};

const calculateExpenseMonths = (
  profile: ATMProfile,
  reportStartDate: Date,
  reportEndDate: Date
): number => {
  if (!profile.installed_date) return 0;
  const installDate = parseLocalDate(profile.installed_date);
  let removalDate: Date | null = null;
  if (profile.removed_date) removalDate = parseLocalDate(profile.removed_date);

  const monthAfterInstall = new Date(
    installDate.getFullYear(),
    installDate.getMonth() + 1,
    1
  );
  const reportStartMonth = new Date(
    reportStartDate.getFullYear(),
    reportStartDate.getMonth(),
    1
  );
  const effectiveStart =
    monthAfterInstall > reportStartMonth ? monthAfterInstall : reportStartMonth;

  const reportEndMonth = new Date(
    reportEndDate.getFullYear(),
    reportEndDate.getMonth(),
    1
  );
  let effectiveEnd = reportEndMonth;
  if (removalDate) {
    const removalMonth = new Date(
      removalDate.getFullYear(),
      removalDate.getMonth(),
      1
    );
    if (removalMonth < effectiveEnd) effectiveEnd = removalMonth;
  }

  if (effectiveStart > effectiveEnd) return 0;
  const monthCount =
    (effectiveEnd.getFullYear() - effectiveStart.getFullYear()) * 12 +
    (effectiveEnd.getMonth() - effectiveStart.getMonth()) +
    1;
  return Math.max(0, monthCount);
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const formatPct = (value: number) =>
  isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : '—';

// ──────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────
export default function PlatformComparison() {
  // Default date range: trailing 12 months (previous 12 complete months)
  const today = new Date();
  const endMonth = today.getMonth(); // 0-indexed, current month (incomplete)
  const endYear = today.getFullYear();
  // Go back 12 months from the last complete month
  const prevMonth = endMonth === 0 ? 11 : endMonth - 1;
  const prevYear = endMonth === 0 ? endYear - 1 : endYear;
  const startMonth12 = prevMonth - 11;
  const defaultStartYear =
    startMonth12 < 0 ? prevYear - 1 : prevYear;
  const defaultStartMonth = ((startMonth12 % 12) + 12) % 12; // 0-indexed

  const [fromDate, setFromDate] = useState(
    `${defaultStartYear}-${String(defaultStartMonth + 1).padStart(2, '0')}-01`
  );
  const [toDate, setToDate] = useState(() => {
    const lastDay = new Date(prevYear, prevMonth + 1, 0).getDate();
    return `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Commission rate
  const [defaultRateInfo, setDefaultRateInfo] =
    useState<CommissionRateInfo | null>(null);
  const [rateOverride, setRateOverride] = useState<string>('');
  const isOverridden = rateOverride !== '';
  const effectiveRate = isOverridden
    ? parseFloat(rateOverride) || 0
    : defaultRateInfo?.rate || 0;

  // Results
  const [machineCount, setMachineCount] = useState(0);
  const [actuals, setActuals] = useState({
    total_fees: 0,
    bitstop_fees: 0,
    rent: 0,
    mgmt_rps: 0,
    mgmt_rep: 0,
    commissions: 0,
    total_sales: 0,
    net_profit: 0,
  });

  useEffect(() => {
    fetchDefaultRate();
  }, [fromDate, toDate]);

  useEffect(() => {
    if (defaultRateInfo && !defaultRateInfo.isEmpty) {
      fetchReport();
    }
  }, [fromDate, toDate, defaultRateInfo]);

  // ── Fetch default commission rate ────────────────────────
  const fetchDefaultRate = async () => {
    const { data: allRecords } = await supabase
      .from('bitstop_commissions')
      .select('month, year, commission_percent, total_sales')
      .gt('total_sales', 0)
      .gt('commission_percent', 0);

    if (!allRecords || allRecords.length === 0) {
      setDefaultRateInfo({
        rate: 0,
        basis: 'No reconciled commission data available',
        isFallback: false,
        isEmpty: true,
      });
      return;
    }

    // Map month names to numbers
    const MONTH_MAP: Record<string, number> = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
      Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
    };

    // Filter to records within the selected date range
    const fromParts = fromDate.split('-').map(Number);
    const toParts = toDate.split('-').map(Number);
    const fromYM = fromParts[0] * 12 + fromParts[1];
    const toYM = toParts[0] * 12 + toParts[1];

    const inRange = allRecords.filter((r) => {
      const mNum = MONTH_MAP[r.month] || 0;
      const ym = r.year * 12 + mNum;
      return ym >= fromYM && ym <= toYM;
    });

    if (inRange.length > 0) {
      const avg =
        inRange.reduce((sum, r) => sum + r.commission_percent, 0) /
        inRange.length;
      setDefaultRateInfo({
        rate: Math.round(avg * 100) / 100,
        basis: `avg of ${inRange.length} reconciled month${inRange.length !== 1 ? 's' : ''} in range`,
        isFallback: false,
        isEmpty: false,
      });
    } else {
      const avg =
        allRecords.reduce((sum, r) => sum + r.commission_percent, 0) /
        allRecords.length;
      setDefaultRateInfo({
        rate: Math.round(avg * 100) / 100,
        basis: `all-time fallback — no reconciled data in range`,
        isFallback: true,
        isEmpty: false,
      });
    }
  };

  // ── Fetch report data (mirrors ATM P&L logic for Denet only) ──
  const fetchReport = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const startDate = fromDate;
      const endDate = `${toDate}T23:59:59`;

      const reportStartDate = parseLocalDate(fromDate);
      const reportEndDate = parseLocalDate(toDate);

      // Parse year/month for commission queries
      const startYM = fromDate.split('-').map(Number);
      const endYM = toDate.split('-').map(Number);
      const startMonthNum = startYM[1];
      const endMonthNum = endYM[1];
      const startYear = startYM[0];
      const endYear2 = endYM[0];

      // ── 1. Fetch ATM profiles ──
      const { data: atmProfiles, error: atmError } = await supabase
        .from('atm_profiles')
        .select(
          'atm_id, location_name, state, platform, platform_switch_date, monthly_rent, cash_management_rps, cash_management_rep, sales_rep_id, installed_date, removed_date, active'
        );
      if (atmError) throw atmError;

      // Filter to profiles relevant to the report period
      const rangeStart = new Date(startYM[0], startYM[1] - 1, 1);
      const rangeEnd = new Date(endYM[0], endYM[1], 0);

      const relevantProfiles = (atmProfiles || []).filter((p) => {
        if (!p.atm_id) return false;
        if (p.active && p.installed_date && new Date(p.installed_date) <= rangeEnd) return true;
        if (p.active === false) {
          if (!p.installed_date) return false;
          if (new Date(p.installed_date) > rangeEnd) return false;
          if (p.removed_date && new Date(p.removed_date) < rangeStart) return false;
          if (!p.removed_date) {
            const hasActiveSibling = atmProfiles?.some(
              (other) => other.atm_id === p.atm_id && other.active === true
            );
            if (hasActiveSibling) return false;
          }
          return true;
        }
        return false;
      });

      // Filter to Denet platform only (using same shouldIncludeProfile logic)
      const denetProfiles = relevantProfiles.filter((profile) => {
        if (profile.platform_switch_date) {
          const switchDate = parseLocalDate(profile.platform_switch_date);
          if (reportEndDate < switchDate) return true; // was on Denet
          if (reportStartDate >= switchDate) return false; // already switched to Bitstop
          return true; // spans switch date - include
        }
        return profile.platform?.toLowerCase() === 'denet';
      });

      // ── 2. Fetch transactions ──
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
        const { data, error: txError } = await supabase
          .from('transactions')
          .select(
            'id, atm_id, atm_name, sale, fee, bitstop_fee, platform, date'
          )
          .gte('date', startDate)
          .lte('date', endDate)
          .range(from, to);
        if (txError) throw txError;
        if (data) allTransactions = allTransactions.concat(data);
      }

      // Group transactions by ATM
      const txByATM = new Map<string, any[]>();
      allTransactions.forEach((tx) => {
        if (!tx.atm_id) return;
        const arr = txByATM.get(tx.atm_id) || [];
        arr.push(tx);
        txByATM.set(tx.atm_id, arr);
      });

      // ── 3. Fetch commissions ──
      const monthYears: string[] = [];
      for (let y = startYear; y <= endYear2; y++) {
        const mStart = y === startYear ? startMonthNum : 1;
        const mEnd = y === endYear2 ? endMonthNum : 12;
        for (let m = mStart; m <= mEnd; m++) {
          monthYears.push(`${y}-${String(m).padStart(2, '0')}-01`);
        }
      }

      const { data: commissionDetails } = await supabase
        .from('commission_details')
        .select('atm_id, commission_amount, commissions!inner(month_year)')
        .in('commissions.month_year', monthYears);

      const commissionMap = new Map<string, number>();
      commissionDetails?.forEach((d) => {
        const cur = commissionMap.get(d.atm_id) || 0;
        commissionMap.set(d.atm_id, cur + (d.commission_amount || 0));
      });

      // ── 4. Fetch bitstop fee overrides ──
      const overrideMonths: string[] = [];
      for (let y = startYear; y <= endYear2; y++) {
        const mStart = y === startYear ? startMonthNum : 1;
        const mEnd = y === endYear2 ? endMonthNum : 12;
        for (let m = mStart; m <= mEnd; m++) {
          overrideMonths.push(`${y}-${String(m).padStart(2, '0')}`);
        }
      }

      const { data: feeOverrides } = await supabase
        .from('bitstop_fee_overrides')
        .select('atm_id, year_month, actual_fees')
        .in('year_month', overrideMonths);

      const overrideMap = new Map<string, number>();
      feeOverrides?.forEach((o) => {
        overrideMap.set(`${o.atm_id}:${o.year_month}`, Number(o.actual_fees));
      });

      // ── 5. Process each Denet profile ──
      const machines: PerMachinePL[] = [];

      denetProfiles.forEach((profile) => {
        const allAtmTx = txByATM.get(profile.atm_id) || [];

        // Sibling check
        const siblings = relevantProfiles.filter(
          (p) => p.atm_id === profile.atm_id
        );
        const hasSiblings = siblings.length > 1;

        // Filter transactions to this profile's active period
        const atmTx = allAtmTx.filter((tx) => {
          if (!tx.date) return false;
          const txDate = parseLocalDate(tx.date.split('T')[0]);
          if (profile.installed_date && txDate < parseLocalDate(profile.installed_date)) return false;
          if (profile.removed_date && txDate > parseLocalDate(profile.removed_date)) return false;
          if (hasSiblings && profile.active === false && !profile.removed_date) return false;
          return true;
        });

        // For Denet-only: filter to transactions where effective platform is denet
        const denetTx = atmTx.filter((tx) => {
          const txDate = parseLocalDate(tx.date.split('T')[0]);
          return getEffectivePlatform(profile, txDate) === 'denet';
        });

        const expenseMonths = calculateExpenseMonths(
          profile,
          reportStartDate,
          reportEndDate
        );

        if (expenseMonths === 0 && denetTx.length === 0) return;

        let total_sales = 0;
        let total_fees = 0;
        let bitstop_fees = 0;

        denetTx.forEach((tx) => {
          total_sales += tx.sale || 0;
          total_fees += tx.fee || 0;
          bitstop_fees += tx.bitstop_fee || 0;
        });

        // Apply fee overrides (same logic as P&L)
        if (profile.platform?.toLowerCase() === 'bitstop') {
          const feesByMonth = new Map<string, number>();
          denetTx.forEach((tx) => {
            if (tx.date) {
              const [y, m] = tx.date.split('-');
              feesByMonth.set(`${y}-${m}`, (feesByMonth.get(`${y}-${m}`) || 0) + (tx.fee || 0));
            }
          });

          let overriddenTotal = 0;
          let hasOverride = false;
          for (let y = startYear; y <= endYear2; y++) {
            const mStart = y === startYear ? startMonthNum : 1;
            const mEnd = y === endYear2 ? endMonthNum : 12;
            for (let m = mStart; m <= mEnd; m++) {
              const ym = `${y}-${String(m).padStart(2, '0')}`;
              const key = `${profile.atm_id}:${ym}`;
              if (overrideMap.has(key)) {
                overriddenTotal += overrideMap.get(key)!;
                hasOverride = true;
              } else {
                overriddenTotal += feesByMonth.get(ym) || 0;
              }
            }
          }
          if (hasOverride) total_fees = overriddenTotal;
        }

        const rent = (profile.monthly_rent || 0) * expenseMonths;
        const mgmt_rps = (profile.cash_management_rps || 0) * expenseMonths;
        const mgmt_rep = (profile.cash_management_rep || 0) * expenseMonths;
        const commissions = commissionMap.get(profile.atm_id) || 0;
        const net_profit =
          total_fees - bitstop_fees - rent - mgmt_rps - mgmt_rep - commissions;

        machines.push({
          atm_id: profile.atm_id,
          total_sales,
          total_fees,
          bitstop_fees,
          rent,
          mgmt_rps,
          mgmt_rep,
          commissions,
          net_profit,
        });
      });

      // ── 6. Aggregate totals ──
      const totals = machines.reduce(
        (acc, m) => ({
          total_sales: acc.total_sales + m.total_sales,
          total_fees: acc.total_fees + m.total_fees,
          bitstop_fees: acc.bitstop_fees + m.bitstop_fees,
          rent: acc.rent + m.rent,
          mgmt_rps: acc.mgmt_rps + m.mgmt_rps,
          mgmt_rep: acc.mgmt_rep + m.mgmt_rep,
          commissions: acc.commissions + m.commissions,
          net_profit: acc.net_profit + m.net_profit,
        }),
        {
          total_sales: 0,
          total_fees: 0,
          bitstop_fees: 0,
          rent: 0,
          mgmt_rps: 0,
          mgmt_rep: 0,
          commissions: 0,
          net_profit: 0,
        }
      );

      setMachineCount(machines.length);
      setActuals(totals);
    } catch (err: any) {
      console.error('Error fetching platform comparison:', err);
      setError(err.message || 'Failed to load report data.');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Projected values ──
  const projectedCommission = actuals.total_sales * (effectiveRate / 100);
  const projectedProfit =
    projectedCommission -
    actuals.rent -
    actuals.mgmt_rps -
    actuals.mgmt_rep;
  const profitDelta = projectedProfit - actuals.net_profit;
  const profitDeltaPct =
    actuals.net_profit !== 0 ? (profitDelta / Math.abs(actuals.net_profit)) * 100 : 0;

  const revenueDelta = projectedCommission - actuals.total_fees;
  const revenueDeltaPct =
    actuals.total_fees !== 0 ? (revenueDelta / Math.abs(actuals.total_fees)) * 100 : 0;

  // ── Date display ──
  const formatDisplayDate = (d: string) => {
    const date = parseLocalDate(d);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // ── Export ──
  const handleExport = () => {
    const border = {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } },
    };

    const data: any[][] = [
      ['Platform Profitability Comparison'],
      [],
      ['Date Range', `${formatDisplayDate(fromDate)} — ${formatDisplayDate(toDate)}`],
      [
        'Commission Rate',
        `${effectiveRate.toFixed(2)}%${isOverridden ? ' (overridden)' : ` (${defaultRateInfo?.basis})`}`,
      ],
      ['Denet Machines', machineCount],
      [],
      ['', 'Actuals (Denet)', 'Projected (Bitstop)', 'Delta $', 'Delta %'],
      ['Revenue', actuals.total_fees, projectedCommission, revenueDelta, revenueDeltaPct / 100],
      ['Bitstop Fees', actuals.bitstop_fees, 'N/A', '', ''],
      ['Rent', actuals.rent, actuals.rent, 0, ''],
      ['Mgmt RPS', actuals.mgmt_rps, actuals.mgmt_rps, 0, ''],
      ['Mgmt Rep', actuals.mgmt_rep, actuals.mgmt_rep, 0, ''],
      ['Commissions', actuals.commissions, 'N/A', '', ''],
      ['Profit / Loss', actuals.net_profit, projectedProfit, profitDelta, profitDeltaPct / 100],
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 22 }, { wch: 14 }, { wch: 12 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];

    const cell = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });

    // Title
    if (ws[cell(0, 0)]) {
      ws[cell(0, 0)].s = {
        font: { bold: true, sz: 14, color: { rgb: '1F2937' } },
        fill: { fgColor: { rgb: 'D1D5DB' } },
        alignment: { horizontal: 'left' },
      };
    }

    // Metadata rows (2-4)
    for (let r = 2; r <= 4; r++) {
      if (ws[cell(r, 0)]) ws[cell(r, 0)].s = { font: { bold: true, sz: 11 } };
    }

    // Header row (6)
    for (let c = 0; c <= 4; c++) {
      const ref = cell(6, c);
      if (ws[ref]) {
        ws[ref].s = {
          font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' } },
          fill: { fgColor: { rgb: '1F2937' } },
          alignment: { horizontal: c === 0 ? 'left' : 'right' },
          border,
        };
      }
    }

    // Data rows (7-13)
    for (let r = 7; r <= 13; r++) {
      for (let c = 0; c <= 4; c++) {
        const ref = cell(r, c);
        if (!ws[ref]) continue;
        const isProfit = r === 13;
        ws[ref].s = {
          font: {
            sz: 11,
            bold: isProfit,
            ...(isProfit && ws[ref].v < 0 ? { color: { rgb: 'DC2626' } } : {}),
          },
          alignment: { horizontal: c === 0 ? 'left' : 'right' },
          border,
          ...(c >= 1 && c <= 3 && typeof ws[ref].v === 'number'
            ? { numFmt: '$#,##0' }
            : {}),
          ...(c === 4 && typeof ws[ref].v === 'number'
            ? { numFmt: '0.0%' }
            : {}),
          ...(isProfit ? { fill: { fgColor: { rgb: 'D1D5DB' } } } : {}),
        };
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Platform Comparison');
    XLSX.writeFile(wb, `platform-comparison-${fromDate}-to-${toDate}.xlsx`);
  };

  // ── Render ──
  const canRun = defaultRateInfo && !defaultRateInfo.isEmpty;

  const rows = [
    {
      label: 'Revenue',
      actual: actuals.total_fees,
      projected: projectedCommission,
      deltaAmt: revenueDelta,
      deltaPct: revenueDeltaPct,
      sublabel: { actual: 'Total Fees', projected: 'Est. Commission' },
    },
    {
      label: 'Bitstop Fees',
      actual: actuals.bitstop_fees,
      projected: null,
      deltaAmt: null,
      deltaPct: null,
    },
    {
      label: 'Rent',
      actual: actuals.rent,
      projected: actuals.rent,
      deltaAmt: 0,
      deltaPct: null,
    },
    {
      label: 'Mgmt RPS',
      actual: actuals.mgmt_rps,
      projected: actuals.mgmt_rps,
      deltaAmt: 0,
      deltaPct: null,
    },
    {
      label: 'Mgmt Rep',
      actual: actuals.mgmt_rep,
      projected: actuals.mgmt_rep,
      deltaAmt: 0,
      deltaPct: null,
    },
    {
      label: 'Commissions',
      actual: actuals.commissions,
      projected: null,
      deltaAmt: null,
      deltaPct: null,
    },
  ];

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader>
        <CardTitle>Platform Profitability Comparison</CardTitle>
        <CardDescription>
          Denet Platform actuals vs. projected Bitstop affiliate model
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Controls */}
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
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Affiliate Commission Rate (%)
            </Label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  value={rateOverride}
                  onChange={(e) => setRateOverride(e.target.value)}
                  placeholder={
                    defaultRateInfo
                      ? `${defaultRateInfo.rate.toFixed(2)}%`
                      : '—'
                  }
                  className={cn(
                    'w-[120px] h-9 font-mono',
                    isOverridden && 'border-amber-400/50'
                  )}
                />
                {isOverridden && (
                  <span className="absolute -top-2 right-1 text-[10px] bg-amber-400/20 text-amber-400 px-1.5 rounded-full">
                    overridden
                  </span>
                )}
              </div>
              {isOverridden && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setRateOverride('')}
                  title="Reset to default"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isLoading || !canRun || machineCount === 0}
            className="ml-auto"
          >
            <FileSpreadsheet className="w-4 h-4 mr-1.5" />
            Export to Excel
          </Button>
        </div>

        {/* Rate basis label */}
        {defaultRateInfo && !defaultRateInfo.isEmpty && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="w-3 h-3" />
            Default: {defaultRateInfo.rate.toFixed(2)}% (
            {defaultRateInfo.basis})
            {defaultRateInfo.isFallback && (
              <span className="text-amber-400 ml-1">fallback</span>
            )}
          </div>
        )}

        {/* Empty state: no commission data */}
        {defaultRateInfo?.isEmpty && (
          <div className="text-center py-12 space-y-2">
            <p className="text-muted-foreground">
              No reconciled Bitstop commission data found.
            </p>
            <p className="text-sm text-muted-foreground">
              Enter a commission rate override above to run the comparison.
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-md px-4 py-3">
            {error}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading report data...
          </div>
        )}

        {/* Results */}
        {!isLoading && canRun && machineCount > 0 && (
          <>
            {/* Summary header */}
            <div className="flex items-center gap-6 text-sm border-b border-white/10 pb-4">
              <div>
                <span className="text-muted-foreground">Date Range: </span>
                <span className="font-medium">
                  {formatDisplayDate(fromDate)} — {formatDisplayDate(toDate)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">
                  Commission Rate:{' '}
                </span>
                <span className="font-medium font-mono">
                  {effectiveRate.toFixed(2)}%
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">
                  Denet Machines:{' '}
                </span>
                <span className="font-medium">{machineCount}</span>
              </div>
            </div>

            {/* Comparison table */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <colgroup>
                  <col style={{ width: '200px' }} />
                  <col style={{ width: '180px' }} />
                  <col style={{ width: '180px' }} />
                  <col style={{ width: '160px' }} />
                </colgroup>
                <thead>
                  <tr className="border-b-2 border-white/10">
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      &nbsp;
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-widest text-primary">
                      Actuals (Denet)
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-widest text-amber-400">
                      Projected (Bitstop)
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-widest text-muted-foreground">
                      Delta
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.label}
                      className="border-b border-white/[0.04] hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3 text-sm font-medium">
                        {row.label}
                        {row.sublabel && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {row.sublabel.actual} → {row.sublabel.projected}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-base tabular-nums">
                        {formatCurrency(row.actual)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-base tabular-nums">
                        {row.projected !== null ? (
                          formatCurrency(row.projected)
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                        {row.deltaAmt !== null ? (
                          <span
                            className={
                              row.deltaAmt > 0
                                ? 'text-green-400'
                                : row.deltaAmt < 0
                                  ? 'text-red-400'
                                  : 'text-muted-foreground'
                            }
                          >
                            {formatCurrency(row.deltaAmt)}
                            {row.deltaPct !== null && row.deltaPct !== 0 && (
                              <span className="ml-1.5 text-xs">
                                {formatPct(row.deltaPct)}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-primary/30 bg-white/[0.03]">
                    <td className="px-4 py-3 text-sm font-bold">
                      Profit / Loss
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-mono text-lg font-bold tabular-nums',
                        actuals.net_profit >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                      )}
                    >
                      {formatCurrency(actuals.net_profit)}
                    </td>
                    <td
                      className={cn(
                        'px-4 py-3 text-right font-mono text-lg font-bold tabular-nums',
                        projectedProfit >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                      )}
                    >
                      {formatCurrency(projectedProfit)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-bold tabular-nums">
                      <span
                        className={
                          profitDelta > 0
                            ? 'text-green-400'
                            : profitDelta < 0
                              ? 'text-red-400'
                              : 'text-muted-foreground'
                        }
                      >
                        {formatCurrency(profitDelta)}
                        <span className="ml-1.5 text-xs">
                          {formatPct(profitDeltaPct)}
                        </span>
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        {/* No machines found */}
        {!isLoading && canRun && machineCount === 0 && !error && (
          <div className="text-center py-12 text-muted-foreground">
            No Denet Platform machines found for the selected date range.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
