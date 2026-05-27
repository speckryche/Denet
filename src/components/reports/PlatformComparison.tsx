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
import { FileSpreadsheet, FileText, RotateCcw, Loader2, Info } from 'lucide-react';
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

// ──────────────────────────────────────────────────────────────
// Helpers (mirrored from ATMProfitLoss.tsx)
// ──────────────────────────────────────────────────────────────
const parseLocalDate = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// Boundary derivation for converted ATMs: returns "YYYY-MM" or null if the
// ATM only has one platform of transactions in the supplied buckets.
// Boundary = min(month after last Denet tx, first Bitstop tx month).
const deriveConversionBoundary = (
  denetTxs: any[],
  bitstopTxs: any[]
): string | null => {
  if (denetTxs.length === 0 || bitstopTxs.length === 0) return null;
  const denetYMs = denetTxs.map((t) => (t.date || '').slice(0, 7)).filter(Boolean);
  const bitstopYMs = bitstopTxs.map((t) => (t.date || '').slice(0, 7)).filter(Boolean);
  if (denetYMs.length === 0 || bitstopYMs.length === 0) return null;
  const lastDenetYM = denetYMs.reduce((a, b) => (a > b ? a : b));
  const firstBitstopYM = bitstopYMs.reduce((a, b) => (a < b ? a : b));
  const [ldY, ldM] = lastDenetYM.split('-').map(Number);
  const monthAfterLastDenet =
    ldM === 12
      ? `${ldY + 1}-01`
      : `${ldY}-${String(ldM + 1).padStart(2, '0')}`;
  return monthAfterLastDenet < firstBitstopYM ? monthAfterLastDenet : firstBitstopYM;
};

const countMonthsInWindow = (
  profile: ATMProfile,
  windowStart: Date,
  windowEnd: Date
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
  const winStartMonth = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
  const winEndMonth = new Date(windowEnd.getFullYear(), windowEnd.getMonth(), 1);
  const effectiveStart =
    monthAfterInstall > winStartMonth ? monthAfterInstall : winStartMonth;
  let effectiveEnd = winEndMonth;
  if (removalDate) {
    const removalMonth = new Date(removalDate.getFullYear(), removalDate.getMonth(), 1);
    if (removalMonth < effectiveEnd) effectiveEnd = removalMonth;
  }
  if (effectiveStart > effectiveEnd) return 0;
  const monthCount =
    (effectiveEnd.getFullYear() - effectiveStart.getFullYear()) * 12 +
    (effectiveEnd.getMonth() - effectiveStart.getMonth()) +
    1;
  return Math.max(0, monthCount);
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

// Guard for date-picker state. `<input type="date">` can emit '' or partial
// values during edit; we must not let those reach Supabase or Date().
const isValidYMD = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

// Hardcoded fallbacks used when the corresponding app_settings row is
// missing or invalid. Both are expressed in percent (not decimal).
const FALLBACK_COMMISSION_RATE = 56;
const FALLBACK_SPREAD_RATE = 24.5;

// ──────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────
export default function PlatformComparison() {
  // Default date range: Jan 1 of the current calendar year through today.
  // Computed on each mount so the defaults stay current as the calendar advances.
  const today = new Date();
  const currentYear = today.getFullYear();

  const [fromDate, setFromDate] = useState(`${currentYear}-01-01`);
  const [toDate, setToDate] = useState(
    `${currentYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  );

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rate defaults (loaded from app_settings, with hardcoded fallbacks).
  // Both stored in percent (e.g. 56 means 56%).
  const [defaultCommissionRate, setDefaultCommissionRate] = useState<number>(FALLBACK_COMMISSION_RATE);
  const [defaultSpreadRate, setDefaultSpreadRate] = useState<number>(FALLBACK_SPREAD_RATE);
  const [defaultsLoaded, setDefaultsLoaded] = useState<boolean>(false);

  // Override inputs (sensitivity testing). Empty string = use default.
  const [commissionRateOverride, setCommissionRateOverride] = useState<string>('');
  const [spreadRateOverride, setSpreadRateOverride] = useState<string>('');
  const isCommissionOverridden = commissionRateOverride !== '';
  const isSpreadOverridden = spreadRateOverride !== '';
  const effectiveCommissionRate = isCommissionOverridden
    ? parseFloat(commissionRateOverride) || 0
    : defaultCommissionRate;
  const effectiveSpreadRate = isSpreadOverridden
    ? parseFloat(spreadRateOverride) || 0
    : defaultSpreadRate;

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
  // Platform-wide Denet totals — summed straight from the raw tx list (scoped
  // to currently-Denet machines) and used for the Total Sales row + projection.
  const [denetSalesTotal, setDenetSalesTotal] = useState(0);
  const [denetTxCount, setDenetTxCount] = useState(0);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    if (defaultsLoaded) {
      fetchReport();
    }
  }, [fromDate, toDate, defaultsLoaded]);

  // ── Fetch rate defaults from app_settings ────────────────
  // Both rates are stored as decimals (e.g. "0.56", "0.245"); we multiply by
  // 100 to keep the rest of the component (which expects percent) consistent.
  // If a row is missing or invalid, fall back to the hardcoded constant.
  const fetchSettings = async () => {
    const readDecimalSetting = async (key: string): Promise<number | null> => {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .single();
      if (error || !data?.value) return null;
      const parsed = parseFloat(data.value);
      if (!isFinite(parsed) || parsed <= 0) return null;
      return parsed * 100;
    };

    const [commission, spread] = await Promise.all([
      readDecimalSetting('bitstop_commission_rate'),
      readDecimalSetting('bitstop_average_spread_rate'),
    ]);

    if (commission !== null) setDefaultCommissionRate(commission);
    if (spread !== null) setDefaultSpreadRate(spread);
    setDefaultsLoaded(true);
  };

  // ── Fetch report data (mirrors ATM P&L logic for Denet only) ──
  const fetchReport = async () => {
    if (!isValidYMD(fromDate) || !isValidYMD(toDate)) {
      setIsLoading(false);
      return;
    }

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
            'id, atm_id, atm_name, sale, fee, bitstop_fee, sent, platform, date'
          )
          .gte('date', startDate)
          .lte('date', endDate)
          .range(from, to);
        if (txError) throw txError;
        if (data) allTransactions = allTransactions.concat(data);
      }

      // Scope: only machines currently on the Denet platform. Converted
      // machines (now on Bitstop) are excluded — their pre-conversion
      // history isn't decision-relevant for this report.
      const denetAtmIds = new Set<string>(
        relevantProfiles
          .filter((p) => (p.platform || '').toLowerCase() === 'denet')
          .map((p) => p.atm_id)
      );

      // Platform-wide Denet totals — restricted to the currently-Denet
      // machines above. Projection is a deterministic per-tx calculation:
      // SUM((sale - sent) * rate) over those txs.
      const allDenetTxs = allTransactions.filter(
        (tx) =>
          (tx.platform || '').toLowerCase() === 'denet' &&
          tx.atm_id &&
          denetAtmIds.has(tx.atm_id)
      );
      const newDenetSales = allDenetTxs.reduce((s, tx) => s + (tx.sale || 0), 0);
      setDenetSalesTotal(newDenetSales);
      setDenetTxCount(allDenetTxs.length);

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

      // Preserve commissions per-month so we can split at the conversion boundary
      const commissionDetailsByATM = new Map<string, Array<{ month_ym: string; amount: number }>>();
      commissionDetails?.forEach((d) => {
        // Supabase v2 may return the !inner-joined parent as an object or an
        // array depending on relationship resolution; handle both shapes.
        const c = (d.commissions as any);
        const monthYear = Array.isArray(c) ? c[0]?.month_year : c?.month_year;
        if (!monthYear) return;
        const arr = commissionDetailsByATM.get(d.atm_id) || [];
        arr.push({ month_ym: monthYear.slice(0, 7), amount: d.commission_amount || 0 });
        commissionDetailsByATM.set(d.atm_id, arr);
      });

      // ── 4. Process each profile, attributing only Denet-source data ──
      const machines: PerMachinePL[] = [];

      relevantProfiles.forEach((profile) => {
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

        // Bucket by tx.platform (CSV source of truth)
        const denetTx = atmTx.filter((tx) => (tx.platform || '').toLowerCase() === 'denet');
        const bitstopTx = atmTx.filter((tx) => (tx.platform || '').toLowerCase() === 'bitstop');

        // Scope: only profiles currently on the Denet platform. Converted
        // machines (now on Bitstop) are excluded — their pre-conversion
        // history isn't decision-relevant for this report.
        if ((profile.platform || '').toLowerCase() !== 'denet') return;

        // After the platform gate, also skip if this profile happens to
        // have zero Denet transactions in the date range (e.g., a brand-new
        // Denet machine installed mid-range with no activity yet).
        if (denetTx.length === 0) return;

        const boundaryYM = deriveConversionBoundary(denetTx, bitstopTx);

        // Denet portion of expense months. If no Bitstop txs in range, use the
        // full window; otherwise cap at the boundary.
        let denetExpenseMonths: number;
        if (bitstopTx.length === 0) {
          denetExpenseMonths = calculateExpenseMonths(profile, reportStartDate, reportEndDate);
        } else if (boundaryYM) {
          const [bY, bM] = boundaryYM.split('-').map(Number);
          const denetEnd = new Date(bY, bM - 1, 0); // last day of month BEFORE boundary
          denetExpenseMonths = countMonthsInWindow(profile, reportStartDate, denetEnd);
        } else {
          denetExpenseMonths = 0;
        }

        // Denet portion of commissions: pre-boundary months only when converted
        const atmCommDetails = commissionDetailsByATM.get(profile.atm_id) || [];
        let commissions = 0;
        if (bitstopTx.length === 0) {
          commissions = atmCommDetails.reduce((s, d) => s + d.amount, 0);
        } else if (boundaryYM) {
          atmCommDetails.forEach((d) => {
            if (d.month_ym < boundaryYM) commissions += d.amount;
          });
        }

        let total_sales = 0;
        let total_fees = 0;
        let bitstop_fees = 0;
        denetTx.forEach((tx) => {
          total_sales += tx.sale || 0;
          total_fees += tx.fee || 0;
          bitstop_fees += tx.bitstop_fee || 0;
        });

        const rent = (profile.monthly_rent || 0) * denetExpenseMonths;
        const mgmt_rps = (profile.cash_management_rps || 0) * denetExpenseMonths;
        const mgmt_rep = (profile.cash_management_rep || 0) * denetExpenseMonths;
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

      // ── 5. Aggregate totals ──
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
  // Flat-benchmark projection: assume Bitstop's average spread (as a % of
  // sales) applies to Denet's actual sales volume, and Bitstop pays Denet
  // the contractual commission rate on that spread. Recomputes on either
  // rate-override change (sensitivity testing) without re-fetching.
  const projectedSpread = denetSalesTotal * (effectiveSpreadRate / 100);
  const projectedCommission = projectedSpread * (effectiveCommissionRate / 100);
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

  // Fee % of Sales — revenue as a share of gross sales.
  // Actuals: profile-filtered fees over denetSalesTotal (matches the displayed
  // Total Sales row). Null only when no sales (true no-data case).
  // Projected: blended derived rate, independent of sales volume.
  const feePctActual =
    denetSalesTotal > 0 ? (actuals.total_fees / denetSalesTotal) * 100 : null;
  const feePctProjected = (effectiveSpreadRate * effectiveCommissionRate) / 100;
  const feePctDelta =
    feePctActual !== null ? feePctProjected - feePctActual : null;

  // ── Date display ──
  const formatDisplayDate = (d: string) => {
    const date = parseLocalDate(d);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // ── PDF export (lazy-loads the heavy @react-pdf/renderer bundle only on click) ──
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const handleExportPDF = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const { exportPlatformComparisonPDF } = await import('./PlatformComparisonPDF');
      await exportPlatformComparisonPDF({
        fromDate,
        toDate,
        commissionRate: effectiveCommissionRate,
        spreadRate: effectiveSpreadRate,
        machineCount,
        denetTxCount,
        denetSalesTotal,
        actuals: {
          total_fees: actuals.total_fees,
          bitstop_fees: actuals.bitstop_fees,
          rent: actuals.rent,
          mgmt_rps: actuals.mgmt_rps,
          mgmt_rep: actuals.mgmt_rep,
          commissions: actuals.commissions,
          net_profit: actuals.net_profit,
        },
        projectedCommission,
        projectedProfit,
        revenueDelta,
        profitDelta,
        feePctActual,
        feePctProjected,
        feePctDelta,
      });
    } catch (err) {
      console.error('PDF export failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate PDF.');
    } finally {
      setIsExportingPdf(false);
    }
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
        'Spread Rate',
        `${effectiveSpreadRate.toFixed(2)}%${isSpreadOverridden ? ' (overridden)' : ' (from settings)'}`,
      ],
      [
        'Commission Rate',
        `${effectiveCommissionRate.toFixed(2)}%${isCommissionOverridden ? ' (overridden)' : ' (from settings)'}`,
      ],
      ['Denet Machines', machineCount],
      [],
      ['', 'Actuals (Denet)', 'Projected (Bitstop)', 'Delta $', 'Delta %'],
      ['Total Sales', denetSalesTotal, denetSalesTotal, 0, ''],
      ['Revenue', actuals.total_fees, projectedCommission, revenueDelta, revenueDeltaPct / 100],
      [
        'Fee % of Sales',
        feePctActual !== null ? feePctActual / 100 : '—',
        feePctProjected !== null ? feePctProjected / 100 : '—',
        feePctDelta !== null ? feePctDelta / 100 : '—',
        '',
      ],
      ['Bitstop Fees', actuals.bitstop_fees, 0, 0, ''],
      ['Rent', actuals.rent, actuals.rent, 0, ''],
      ['Mgmt RPS', actuals.mgmt_rps, actuals.mgmt_rps, 0, ''],
      ['Mgmt Rep', actuals.mgmt_rep, actuals.mgmt_rep, 0, ''],
      ['Commissions', actuals.commissions, 0, 0, ''],
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

    // Data rows (7-15)
    for (let r = 7; r <= 15; r++) {
      for (let c = 0; c <= 4; c++) {
        const ref = cell(r, c);
        if (!ws[ref]) continue;
        const isProfit = r === 15;
        const isFeePct = r === 9; // Fee % of Sales — format cols B–D as percent
        ws[ref].s = {
          font: {
            sz: 11,
            bold: isProfit,
            ...(isProfit && ws[ref].v < 0 ? { color: { rgb: 'DC2626' } } : {}),
          },
          alignment: { horizontal: c === 0 ? 'left' : 'right' },
          border,
          ...(c >= 1 && c <= 3 && typeof ws[ref].v === 'number'
            ? { numFmt: isFeePct ? '0.00%' : '$#,##0' }
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
  const canRun = defaultsLoaded;

  const rows = [
    {
      // Gross customer transaction volume — identical on both sides because
      // platform choice doesn't change the sale amount. Sourced directly
      // from the raw Denet tx list (matches SQL SUM(sale)). Delta is
      // trivially zero (both columns share the same value).
      label: 'Total Sales',
      actual: denetSalesTotal,
      projected: denetSalesTotal,
      deltaAmt: 0,
      deltaPct: null,
    },
    {
      label: 'Revenue',
      actual: actuals.total_fees,
      projected: projectedCommission,
      deltaAmt: revenueDelta,
      deltaPct: revenueDeltaPct,
      sublabel: { actual: 'Total Fees', projected: 'Commission' },
    },
    {
      label: 'Fee % of Sales',
      actual: feePctActual,
      projected: feePctProjected,
      deltaAmt: feePctDelta,
      deltaPct: null,
      format: 'percent' as const,
    },
    {
      // Genuine zero on the Bitstop side — Bitstop affiliate model
      // doesn't charge the per-tx Bitstop fee back to the operator.
      label: 'Bitstop Fees',
      actual: actuals.bitstop_fees,
      projected: 0,
      deltaAmt: 0,
      deltaPct: null,
    },
    {
      // Rent follows the machine regardless of platform — Denet still pays
      // rent under the projected Bitstop affiliate model. Projected mirrors
      // Actuals; delta is therefore $0.
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
      // Genuine zero on the Bitstop affiliate model — no sales-rep
      // commission structure on the affiliate side. $0 is more accurate
      // than '—' here.
      label: 'Commissions',
      actual: actuals.commissions,
      projected: 0,
      deltaAmt: 0,
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
              Avg Bitstop Spread Rate (%)
            </Label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  value={spreadRateOverride}
                  onChange={(e) => setSpreadRateOverride(e.target.value)}
                  placeholder={`${defaultSpreadRate.toFixed(2)}%`}
                  className={cn(
                    'w-[120px] h-9 font-mono',
                    isSpreadOverridden && 'border-amber-400/50'
                  )}
                />
                {isSpreadOverridden && (
                  <span className="absolute -top-2 right-1 text-[10px] bg-amber-400/20 text-amber-400 px-1.5 rounded-full">
                    overridden
                  </span>
                )}
              </div>
              {isSpreadOverridden && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setSpreadRateOverride('')}
                  title="Reset to default"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
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
                  value={commissionRateOverride}
                  onChange={(e) => setCommissionRateOverride(e.target.value)}
                  placeholder={`${defaultCommissionRate.toFixed(2)}%`}
                  className={cn(
                    'w-[120px] h-9 font-mono',
                    isCommissionOverridden && 'border-amber-400/50'
                  )}
                />
                {isCommissionOverridden && (
                  <span className="absolute -top-2 right-1 text-[10px] bg-amber-400/20 text-amber-400 px-1.5 rounded-full">
                    overridden
                  </span>
                )}
              </div>
              {isCommissionOverridden && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => setCommissionRateOverride('')}
                  title="Reset to default"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPDF}
              disabled={isLoading || !canRun || machineCount === 0 || isExportingPdf}
            >
              <FileText className="w-4 h-4 mr-1.5" />
              {isExportingPdf ? 'Generating…' : 'Download PDF'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={isLoading || !canRun || machineCount === 0}
            >
              <FileSpreadsheet className="w-4 h-4 mr-1.5" />
              Export to Excel
            </Button>
          </div>
        </div>

        {/* Defaults chip */}
        {defaultsLoaded && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="w-3 h-3" />
            Defaults: {defaultSpreadRate.toFixed(2)}% spread × {defaultCommissionRate.toFixed(2)}% commission (from settings)
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
                  Effective Rate:{' '}
                </span>
                <span className="font-medium font-mono">
                  {effectiveSpreadRate.toFixed(2)}% × {effectiveCommissionRate.toFixed(2)}% = {feePctProjected.toFixed(2)}%
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">
                  Denet Machines:{' '}
                </span>
                <span className="font-medium">{machineCount}</span>
              </div>
              <div>
                <span className="text-muted-foreground">
                  Transactions:{' '}
                </span>
                <span className="font-medium">
                  {denetTxCount.toLocaleString('en-US')}
                </span>
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
                        {row.actual !== null ? (
                          row.format === 'percent'
                            ? `${row.actual.toFixed(2)}%`
                            : formatCurrency(row.actual)
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-base tabular-nums">
                        {row.projected !== null ? (
                          row.format === 'percent'
                            ? `${row.projected.toFixed(2)}%`
                            : formatCurrency(row.projected)
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
                            {row.format === 'percent'
                              ? `${row.deltaAmt >= 0 ? '+' : ''}${row.deltaAmt.toFixed(2)}%`
                              : formatCurrency(row.deltaAmt)}
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
