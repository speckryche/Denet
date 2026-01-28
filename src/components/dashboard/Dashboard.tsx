import React, { useState, useEffect } from 'react';
import { MetricsGrid } from './MetricsGrid';
import { DataTable } from './DataTable';
import DatePickerWithRange from '@/components/ui/date-picker-with-range';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Filter, Search } from 'lucide-react';
import UserMenu from '@/components/layout/UserMenu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from '@/lib/supabase';
import { DateRange } from 'react-day-picker';

export default function Dashboard() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [atmIdFilter, setAtmIdFilter] = useState<string>('');

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

      let countQuery = supabase.from('transactions').select('*', { count: 'exact', head: true });

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

        let query = supabase.from('transactions').select('sale, fee, bitstop_fee, sent, platform, atm_id, date');

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
    "date"
  ];

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20">
      {/* Header */}
      <header className="border-b border-white/10 bg-background/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[95%] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/images/DNET Logo (black).png"
              alt="Denet Logo"
              className="w-20 h-20 object-contain"
            />
            <h1 className="font-display font-bold text-xl tracking-tight">
              Denet <span className="text-muted-foreground font-normal">Analytics</span>
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-secondary/10 rounded-lg p-1">
              <Filter className="w-4 h-4 ml-2 text-muted-foreground" />
              <Select value={selectedPlatform} onValueChange={setSelectedPlatform}>
                <SelectTrigger className="w-[140px] border-0 bg-transparent focus:ring-0 h-8">
                  <SelectValue placeholder="Platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Platforms</SelectItem>
                  <SelectItem value="denet">Denet</SelectItem>
                  <SelectItem value="bitstop">Bitstop</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="hidden md:flex items-center gap-2">
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
            <UserMenu />
          </div>
        </div>
      </header>

      <main className="max-w-[95%] mx-auto px-6 py-8 space-y-8">

        {/* Error Banner */}
        {error && (
          <Alert variant="destructive" className="mb-6 animate-in slide-in-from-top-2">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Metrics Section */}
        <div className="space-y-4">
          <h2 className="text-xl font-display font-bold">Overview</h2>
          <MetricsGrid
            denetMetrics={metrics.denet}
            bitstopMetrics={metrics.bitstop}
          />
        </div>

        {/* Data Table Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-bold">Recent Transactions</h2>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filter by ATM ID..."
                className="pl-8 w-[180px] h-9 bg-card border-white/10"
                value={atmIdFilter}
                onChange={(e) => setAtmIdFilter(e.target.value)}
              />
              {atmIdFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAtmIdFilter('')}
                  className="absolute right-1 top-1 h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
          <DataTable data={transactions} columns={dbColumns} />
        </div>
      </main>
    </div>
  );
}
