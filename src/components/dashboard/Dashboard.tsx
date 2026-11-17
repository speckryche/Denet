import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MetricsGrid } from './MetricsGrid';
import { DataTable } from './DataTable';
import DatePickerWithRange from '@/components/ui/date-picker-with-range';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, AlertTriangle, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { usePendingCount } from '@/components/pending/pending-count';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { findCtrQualifyingGroups } from '@/lib/ctr';
import { DateRange } from 'react-day-picker';

export default function Dashboard() {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [atmIdFilter, setAtmIdFilter] = useState<string>('');
  const [pendingCTRCount, setPendingCTRCount] = useState(0);
  // Same hook/count as the sidebar badge (count only, no extra metrics query).
  const pendingCount = usePendingCount();

  // Default date range: 1st of current month to today
  const getCurrentMonthDateRange = (): DateRange => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      from: startOfMonth,
      to: today
    };
  };

  const [dateRange, setDateRange] = useState<DateRange | undefined>(getCurrentMonthDateRange());

  const fetchTransactions = async () => {
    try {
      let query = supabase
        .from('transactions')
        .select('*')
        // LIST view: fetch ALL statuses. Non-completed rows are shown greyed/
        // tagged (DataTable) but excluded from the Overview metrics, which are
        // computed separately in fetchMetrics (completed-only). Do NOT filter by
        // status here.
        .order('date', { ascending: false });

      if (selectedPlatform !== 'all') {
        query = query.eq('platform', selectedPlatform);
      }

      if (atmIdFilter.trim()) {
        query = query.eq('atm_id', atmIdFilter.trim());
      }

      if (dateRange?.from) {
        const fromDate = new Date(dateRange.from);
        fromDate.setHours(0, 0, 0, 0);
        query = query.gte('date', fromDate.toISOString());
      }

      if (dateRange?.to) {
        const toDate = new Date(dateRange.to);
        toDate.setHours(23, 59, 59, 999);
        query = query.lte('date', toDate.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;
      setTransactions(data || []);
    } catch (error) {
      console.error('Error fetching transactions:', error);
      setError(error instanceof Error ? error.message : 'An error occurred fetching transactions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [selectedPlatform, dateRange, atmIdFilter]);

  const [metrics, setMetrics] = useState({
    denet: {
      totalSales: 0,
      totalFees: 0,
      totalOperatorFees: 0,
      totalBitcoinSent: 0,
      activeATMCount: 0,
    },
    bitstop: {
      totalSales: 0,
      totalFees: 0,
      totalOperatorFees: 0,
      totalBitcoinSent: 0,
      activeATMCount: 0,
    }
  });

  const fetchMetrics = async () => {
    try {
      const parseCurrency = (val: any) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const cleanVal = val.toString().replace(/[$,]/g, '');
        const num = parseFloat(cleanVal);
        return isNaN(num) ? 0 : num;
      };

      let countQuery = supabase
        .from('financial_transactions')
        .select('*', { count: 'exact', head: true });

      if (selectedPlatform !== 'all') {
        countQuery = countQuery.eq('platform', selectedPlatform);
      }

      if (atmIdFilter.trim()) {
        countQuery = countQuery.eq('atm_id', atmIdFilter.trim());
      }

      if (dateRange?.from) {
        const fromDate = new Date(dateRange.from);
        fromDate.setHours(0, 0, 0, 0);
        countQuery = countQuery.gte('date', fromDate.toISOString());
      }

      if (dateRange?.to) {
        const toDate = new Date(dateRange.to);
        toDate.setHours(23, 59, 59, 999);
        countQuery = countQuery.lte('date', toDate.toISOString());
      }

      const { count } = await countQuery;

      console.log('Total transactions for metrics:', count);

      const batchSize = 1000;
      const batches = Math.ceil((count || 0) / batchSize);
      let allTransactions: any[] = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;

        let query = supabase
          .from('financial_transactions')
          .select('sale, fee, bitstop_fee, sent, platform, atm_id, date');

        if (selectedPlatform !== 'all') {
          query = query.eq('platform', selectedPlatform);
        }

        if (atmIdFilter.trim()) {
          query = query.eq('atm_id', atmIdFilter.trim());
        }

        if (dateRange?.from) {
          const fromDate = new Date(dateRange.from);
          fromDate.setHours(0, 0, 0, 0);
          query = query.gte('date', fromDate.toISOString());
        }

        if (dateRange?.to) {
          const toDate = new Date(dateRange.to);
          toDate.setHours(23, 59, 59, 999);
          query = query.lte('date', toDate.toISOString());
        }

        const { data, error } = await query.range(from, to);

        if (error) throw error;
        if (data) {
          allTransactions = allTransactions.concat(data);
        }
      }

      console.log('Fetched transactions for metrics:', allTransactions.length);

      const calculatedMetrics = allTransactions.reduce((acc, row) => {
        const platform = row.platform?.toLowerCase() || 'denet';

        if (platform === 'denet') {
          acc.denet.totalSales += parseCurrency(row.sale);
          acc.denet.totalFees += parseCurrency(row.fee);
          acc.denet.totalOperatorFees += parseCurrency(row.bitstop_fee);
          acc.denet.totalBitcoinSent += parseCurrency(row.sent);
        } else if (platform === 'bitstop') {
          acc.bitstop.totalSales += parseCurrency(row.sale);
          acc.bitstop.totalFees += parseCurrency(row.fee);
          acc.bitstop.totalOperatorFees += parseCurrency(row.bitstop_fee);
          acc.bitstop.totalBitcoinSent += parseCurrency(row.sent);
        }

        return acc;
      }, {
        denet: {
          totalSales: 0,
          totalFees: 0,
          totalOperatorFees: 0,
          totalBitcoinSent: 0,
          activeATMCount: 0,
        },
        bitstop: {
          totalSales: 0,
          totalFees: 0,
          totalOperatorFees: 0,
          totalBitcoinSent: 0,
          activeATMCount: 0,
        }
      });

      const { count: denetActiveCount } = await supabase
        .from('atm_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('active', true)
        .eq('platform', 'denet');

      const { count: bitstopActiveCount } = await supabase
        .from('atm_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('active', true)
        .eq('platform', 'bitstop');

      calculatedMetrics.denet.activeATMCount = denetActiveCount || 0;
      calculatedMetrics.bitstop.activeATMCount = bitstopActiveCount || 0;

      setMetrics(calculatedMetrics);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [selectedPlatform, dateRange, atmIdFilter]);

  // Check for pending CTR filings. A qualifying day counts as pending if it
  // has no ctr_filings row yet (not-yet-synced — surface promptly to protect
  // the 15-day filing window) OR its row is category='current' AND filed=false.
  // Historical entries are audit records and never contribute to the alert.
  useEffect(() => {
    const checkCTR = async () => {
      try {
        const now = new Date();
        const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        const fromDate = threeMonthsAgo.toISOString().split('T')[0];

        const groups = await findCtrQualifyingGroups({ fromDate });
        if (groups.length === 0) {
          setPendingCTRCount(0);
          return;
        }

        const { data: filings } = await supabase
          .from('ctr_filings')
          .select('customer_id, trigger_date, category, filed')
          .gte('trigger_date', fromDate);

        const filingMap = new Map<string, { category: string; filed: boolean }>();
        filings?.forEach((f: any) => {
          filingMap.set(`${f.customer_id}|${f.trigger_date}`, {
            category: f.category,
            filed: f.filed,
          });
        });

        const pending = groups.filter((g) => {
          const f = filingMap.get(`${g.customer_id}|${g.trigger_date}`);
          return !f || (f.category === 'current' && !f.filed);
        }).length;

        setPendingCTRCount(pending);
      } catch (err) {
        console.error('Error checking CTR status:', err);
      }
    };
    checkCTR();
  }, []);

  const dbColumns = [
    "id",
    "platform",
    "customer_id",
    "customer_first_name",
    "customer_last_name",
    "customer_city",
    "customer_state",
    "atm_id",
    "atm_name",
    "location_name",
    "ticker",
    "sale",
    "fee",
    "sent",
    "bitstop_fee",
    "date",
    "status"
  ];

  const platformOptions = [
    { value: 'all', label: 'All' },
    { value: 'denet', label: 'Denet' },
    { value: 'bitstop', label: 'Bitstop' },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      <PageHeader
        title="Dashboard"
        actions={
          <>
            <div className="hidden md:flex items-center gap-1.5">
              <DatePickerWithRange
                date={dateRange}
                onDateChange={setDateRange}
              />
              {dateRange && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDateRange(undefined)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  All Time
                </Button>
              )}
            </div>
            <div
              role="group"
              aria-label="Platform filter"
              className="inline-flex rounded-lg border border-border bg-surface-2 p-[3px]"
            >
              {platformOptions.map((opt) => {
                const on = selectedPlatform === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelectedPlatform(opt.value)}
                    className={cn(
                      "h-7 rounded-md px-2.5 text-[12.5px] font-semibold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </>
        }
      />

      <main className="px-6 pb-8 pt-6 lg:px-7 space-y-[18px]">

        {/* Error Banner */}
        {error && (
          <Alert variant="destructive" className="animate-in slide-in-from-top-2">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* CTR Alert Banner */}
        {pendingCTRCount > 0 && (
          <button
            type="button"
            onClick={() => navigate('/reports?tab=ctr-filings')}
            className="flex w-full items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring animate-in slide-in-from-top-2"
          >
            <AlertTriangle className="h-[18px] w-[18px] shrink-0 text-danger" />
            <span>
              <strong className="font-semibold text-danger">CTR filing required.</strong>{' '}
              {pendingCTRCount} customer{pendingCTRCount !== 1 ? 's' : ''} ha{pendingCTRCount !== 1 ? 've' : 's'} exceeded $10,001 in daily transactions and need{pendingCTRCount === 1 ? 's' : ''} a CTR filed.
            </span>
            <span className="ml-auto whitespace-nowrap text-[13px] font-semibold">View CTR Filings →</span>
          </button>
        )}

        {/* KPIs */}
        <MetricsGrid
          denetMetrics={metrics.denet}
          bitstopMetrics={metrics.bitstop}
          pendingCount={pendingCount}
        />

        {/* Recent transactions */}
        <DataTable
          data={transactions}
          columns={dbColumns}
          title="Recent transactions"
          toolbar={
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
              <Input
                placeholder="Filter by ATM ID…"
                aria-label="Filter by ATM ID"
                className="h-[34px] w-[170px] bg-background pl-8 text-[13px]"
                value={atmIdFilter}
                onChange={(e) => setAtmIdFilter(e.target.value)}
              />
              {atmIdFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAtmIdFilter('')}
                  className="absolute right-1 top-1/2 h-6 -translate-y-1/2 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </Button>
              )}
            </div>
          }
        />
      </main>
    </div>
  );
}
