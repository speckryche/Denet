import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadZone } from './UploadZone';
import { MetricsGrid } from './MetricsGrid';
import { DataTable } from './DataTable';
import { LastUploadDates } from './LastUploadDates';
import DatePickerWithRange from '@/components/ui/date-picker-with-range';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Settings, AlertCircle, X, Filter, Calculator, Search, Bell, BarChart3, Banknote, TrendingUp } from 'lucide-react';
import UserMenu from '@/components/layout/UserMenu';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadHistory } from './UploadHistory';
import Papa from 'papaparse';
import { supabase } from '@/lib/supabase';
import { DateRange } from 'react-day-picker';
import { addDays } from 'date-fns';

export default function Dashboard() {
  const navigate = useNavigate();
  const [showDedupeBanner, setShowDedupeBanner] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [uploadStats, setUploadStats] = useState({ processed: 0, duplicates: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [uploadHistoryKey, setUploadHistoryKey] = useState(0);

  // Default date range: 1st of current month to today
  const getCurrentMonthDateRange = (): DateRange => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1); // 1st of current month
    return {
      from: startOfMonth,
      to: today
    };
  };

  const [dateRange, setDateRange] = useState<DateRange | undefined>(getCurrentMonthDateRange());
  const [newATMIds, setNewATMIds] = useState<string[]>([]);
  const [showNewATMAlert, setShowNewATMAlert] = useState(false);
  const [atmIdFilter, setAtmIdFilter] = useState<string>('');

  const fetchTransactions = async () => {
    try {
      let query = supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false });

      if (selectedPlatform !== 'all') {
        query = query.eq('platform', selectedPlatform);
      }

      // Apply ATM ID filter
      if (atmIdFilter.trim()) {
        query = query.eq('atm_id', atmIdFilter.trim());
      }

      // Apply date range filter
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

  // Store metrics separately to handle batch fetching - split by platform
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

  // Fetch and calculate metrics using ALL transactions (batch fetching)
  const fetchMetrics = async () => {
    try {
      // Helper to parse currency string
      const parseCurrency = (val: any) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const cleanVal = val.toString().replace(/[$,]/g, '');
        const num = parseFloat(cleanVal);
        return isNaN(num) ? 0 : num;
      };

      // Build count query with filters
      let countQuery = supabase.from('transactions').select('*', { count: 'exact', head: true });

      // Apply platform filter
      if (selectedPlatform !== 'all') {
        countQuery = countQuery.eq('platform', selectedPlatform);
      }

      // Apply ATM ID filter
      if (atmIdFilter.trim()) {
        countQuery = countQuery.eq('atm_id', atmIdFilter.trim());
      }

      // Apply date range filter
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

      // Get total count with filters applied
      const { count } = await countQuery;

      console.log('Total transactions for metrics:', count);

      // Fetch in batches
      const batchSize = 1000;
      const batches = Math.ceil((count || 0) / batchSize);
      let allTransactions: any[] = [];

      for (let i = 0; i < batches; i++) {
        const from = i * batchSize;
        const to = from + batchSize - 1;

        // Rebuild query for each batch
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

      // Calculate metrics from all transactions - split by platform
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

      // Fetch active ATM counts (independent of date range)
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

      // Update metrics with active ATM counts
      calculatedMetrics.denet.activeATMCount = denetActiveCount || 0;
      calculatedMetrics.bitstop.activeATMCount = bitstopActiveCount || 0;

      setMetrics(calculatedMetrics);
    } catch (error) {
      console.error('Error fetching metrics:', error);
    }
  };

  // Fetch metrics when filters change
  useEffect(() => {
    fetchMetrics();
  }, [selectedPlatform, dateRange, atmIdFilter]);

  // Calculate first and last transaction dates for each platform (using ALL transactions)
  const [transactionDates, setTransactionDates] = useState({
    denetFirst: null as string | null,
    denetLast: null as string | null,
    bitstopFirst: null as string | null,
    bitstopLast: null as string | null
  });

  const fetchAllTransactionDates = async () => {
    try {
      const formatDate = (date: Date) => {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        return `${month}/${day}/${year}`;
      };

      // Fetch min/max dates for Denet platform using order and limit
      const { data: denetFirst } = await supabase
        .from('transactions')
        .select('date')
        .eq('platform', 'denet')
        .not('date', 'is', null)
        .order('date', { ascending: true })
        .limit(1);

      const { data: denetLast } = await supabase
        .from('transactions')
        .select('date')
        .eq('platform', 'denet')
        .not('date', 'is', null)
        .order('date', { ascending: false })
        .limit(1);

      // Fetch min/max dates for Bitstop platform using order and limit
      const { data: bitstopFirst } = await supabase
        .from('transactions')
        .select('date')
        .eq('platform', 'bitstop')
        .not('date', 'is', null)
        .order('date', { ascending: true })
        .limit(1);

      const { data: bitstopLast } = await supabase
        .from('transactions')
        .select('date')
        .eq('platform', 'bitstop')
        .not('date', 'is', null)
        .order('date', { ascending: false })
        .limit(1);

      setTransactionDates({
        denetFirst: denetFirst?.[0]?.date ? formatDate(new Date(denetFirst[0].date)) : null,
        denetLast: denetLast?.[0]?.date ? formatDate(new Date(denetLast[0].date)) : null,
        bitstopFirst: bitstopFirst?.[0]?.date ? formatDate(new Date(bitstopFirst[0].date)) : null,
        bitstopLast: bitstopLast?.[0]?.date ? formatDate(new Date(bitstopLast[0].date)) : null
      });
    } catch (error) {
      console.error('Error fetching transaction dates:', error);
      // Set empty dates on error to prevent UI issues
      setTransactionDates({
        denetFirst: null,
        denetLast: null,
        bitstopFirst: null,
        bitstopLast: null
      });
    }
  };

  useEffect(() => {
    fetchAllTransactionDates();
  }, []);

  const handleFileSelect = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const allData = results.data as any[];
        console.log('CSV Headers:', results.meta.fields);
        console.log('First row raw:', allData[0]);

        if (results.errors.length > 0) {
          console.error('CSV Parsing Errors:', results.errors);
        }

        // Helper to find value case-insensitively
        const getValue = (row: any, key: string) => {
          const foundKey = Object.keys(row).find(k => k.toLowerCase().trim() === key.toLowerCase().trim());
          return foundKey ? row[foundKey] : undefined;
        };

        // Track new ATM IDs for this upload
        const newATMsInUpload: string[] = [];

        // Fetch all existing ticker mappings and ATM profiles ONCE
        console.log('Fetching existing ticker mappings and ATM profiles...');
        const { data: existingTickers } = await supabase
          .from('ticker_mappings')
          .select('*');

        const { data: existingATMs } = await supabase
          .from('atm_profiles')
          .select('*');

        // Create lookup maps for O(1) lookups
        const tickerMap = new Map(existingTickers?.map(t => [t.original_value, t.display_value || t.original_value]) || []);
        const feePercentageMap = new Map(existingTickers?.map(t => [t.original_value, t.fee_percentage || 0.10]) || []);
        const atmMap = new Map(existingATMs?.map(a => [a.atm_id, a]) || []);

        // Collect new tickers and ATMs to insert later
        const newTickers = new Set<string>();
        const newATMsToInsert = new Map<string, { atm_id: string, atm_name: string | null }>();

        // Helper to map ticker (no async calls)
        const mapTicker = (originalTicker: string | null | undefined): string | null => {
          if (!originalTicker) return null;
          const ticker = originalTicker.toString().trim();
          if (!ticker) return null;

          // Check if exists in map
          if (tickerMap.has(ticker)) {
            return tickerMap.get(ticker) || ticker;
          }

          // Mark as new ticker to insert later
          newTickers.add(ticker);
          tickerMap.set(ticker, ticker); // Add to map for subsequent rows
          feePercentageMap.set(ticker, 0.10); // Default 10% fee for new tickers
          return ticker;
        };

        // Helper to map ATM (no async calls)
        const mapATM = (atmId: string | null | undefined, originalAtmName: string | null | undefined): { atm_id: string | null, atm_name: string | null } => {
          if (!atmId) return { atm_id: null, atm_name: null };
          const cleanAtmId = atmId.toString().trim();
          if (!cleanAtmId) return { atm_id: null, atm_name: null };

          // Check if exists in map
          if (atmMap.has(cleanAtmId)) {
            const existing = atmMap.get(cleanAtmId)!;
            return {
              atm_id: cleanAtmId,
              atm_name: existing.atm_name || originalAtmName?.toString().trim() || null
            };
          }

          // Mark as new ATM to insert later
          if (!newATMsToInsert.has(cleanAtmId) && !newATMsInUpload.includes(cleanAtmId)) {
            newATMsInUpload.push(cleanAtmId);
          }
          newATMsToInsert.set(cleanAtmId, {
            atm_id: cleanAtmId,
            atm_name: originalAtmName?.toString().trim() || null
          });

          return {
            atm_id: cleanAtmId,
            atm_name: originalAtmName?.toString().trim() || null
          };
        };
        
        // Auto-detect platform based on headers
        const headers = results.meta.fields || [];
        const isBitstop = headers.some(h => ['atmid', 'cointype', 'inserted'].includes(h.toLowerCase().trim()));
        const currentPlatform = isBitstop ? 'bitstop' : 'denet';
        
        console.log('Detected Platform:', currentPlatform);

        let mappedData: any[] = [];

        if (currentPlatform === 'denet') {
          // Map Denet CSV columns (synchronous mapping using pre-fetched data)
          mappedData = allData.map(row => {
            const id = getValue(row, 'ID') || getValue(row, 'transaction_id');
            const rawTicker = getValue(row, 'ticker');
            const mappedTicker = mapTicker(rawTicker);

            const rawAtmId = getValue(row, 'atm.id') || getValue(row, 'atm_id');
            const rawAtmName = getValue(row, 'atm.name') || getValue(row, 'atm_name');
            const atmData = mapATM(rawAtmId, rawAtmName);

            return {
              id: id,
              customer_id: getValue(row, 'customer_id'),
              customer_first_name: getValue(row, 'customer.first_name') || getValue(row, 'customer_first_name'),
              customer_last_name: getValue(row, 'customer.last_name') || getValue(row, 'customer_last_name'),
              customer_city: getValue(row, 'customer.city') || getValue(row, 'customer_city'),
              customer_state: getValue(row, 'customer.state') || getValue(row, 'customer_state'),
              atm_id: atmData.atm_id,
              atm_name: atmData.atm_name,
              location_name: atmData.atm_name,
              ticker: mappedTicker,
              fee: getValue(row, 'fee') ? parseFloat(getValue(row, 'fee').toString().replace(/[$,]/g, '')) : null,
              sent: getValue(row, 'enviando') ? parseFloat(getValue(row, 'enviando').toString().replace(/[$,]/g, '')) : null,
              sale: getValue(row, 'fiat') ? parseFloat(getValue(row, 'fiat').toString().replace(/[$,]/g, '')) : null,
              bitstop_fee: getValue(row, 'operator_fee_usd') ? parseFloat(getValue(row, 'operator_fee_usd').toString().replace(/[$,]/g, '')) : null,
              date: getValue(row, 'created_at_transaction_local'),
              platform: 'denet'
            };
          });
          mappedData = mappedData.filter(row => row.id);
        } else if (currentPlatform === 'bitstop') {
          // Map Bitstop CSV columns (synchronous mapping using pre-fetched data)
          mappedData = allData.map(row => {
            const id = getValue(row, 'Id');

            const saleAmount = getValue(row, 'Inserted') ? parseFloat(getValue(row, 'Inserted').toString().replace(/[$,]/g, '')) : null;
            const rawTicker = getValue(row, 'CoinType');
            const mappedTicker = mapTicker(rawTicker);

            const rawAtmId = getValue(row, 'ATMID') || getValue(row, 'AtmId');
            const rawAtmName = getValue(row, 'Atm') || getValue(row, 'Atm.Name');
            const atmData = mapATM(rawAtmId, rawAtmName);

            // Get fee percentage for this ticker (use original value to lookup)
            const feePercentage = rawTicker ? (feePercentageMap.get(rawTicker.toString().trim()) || 0.10) : 0.10;
            const calculatedFee = saleAmount ? parseFloat((saleAmount * feePercentage).toFixed(2)) : null;

            return {
              id: id,
              customer_id: null,
              customer_first_name: null,
              customer_last_name: null,
              customer_city: null,
              customer_state: null,
              atm_id: atmData.atm_id,
              atm_name: atmData.atm_name,
              location_name: atmData.atm_name,
              ticker: mappedTicker,
              fee: calculatedFee,
              sent: getValue(row, 'Sent') ? parseFloat(getValue(row, 'Sent').toString().replace(/[$,]/g, '')) : null,
              sale: saleAmount,
              bitstop_fee: 0,
              date: getValue(row, 'CreatedAt'),
              platform: 'bitstop'
            };
          });
          mappedData = mappedData.filter(row => row.id);
        }

        console.log('Mapped Data (first 2 rows):', mappedData.slice(0, 2));

        if (mappedData.length === 0) {
          setError(`No valid records found in CSV. Please check column headers.`);
          return;
        }

        // Batch insert new tickers and ATMs BEFORE processing transactions
        try {
          if (newTickers.size > 0) {
            console.log(`Inserting ${newTickers.size} new tickers...`);
            const tickersToInsert = Array.from(newTickers).map(ticker => ({
              original_value: ticker,
              display_value: null,
              fee_percentage: 0.10
            }));
            const { error: tickerError } = await supabase
              .from('ticker_mappings')
              .insert(tickersToInsert);
            if (tickerError) console.error('Error inserting tickers:', tickerError);
          }

          if (newATMsToInsert.size > 0) {
            console.log(`Inserting ${newATMsToInsert.size} new ATM profiles...`);
            const atmsToInsert = Array.from(newATMsToInsert.values()).map(atm => ({
              atm_id: atm.atm_id,
              location_name: atm.atm_name,
              monthly_rent: 0,
              cash_management_rps: 0,
              cash_management_rep: 0
            }));
            const { error: atmError } = await supabase
              .from('atm_profiles')
              .insert(atmsToInsert);
            if (atmError) console.error('Error inserting ATM profiles:', atmError);
          }
        } catch (error) {
          console.error('Error batch inserting tickers/ATMs:', error);
        }

        try {
          // 1. Check for existing transaction IDs in batches to avoid URL length limits
          const transactionIds = mappedData.map(row => row.id);
          const batchSize = 500; // Process 500 IDs at a time to stay within URL limits
          const existingIds = new Set();

          for (let i = 0; i < transactionIds.length; i += batchSize) {
            const batch = transactionIds.slice(i, i + batchSize);
            const { data: existingBatch, error: checkError } = await supabase
              .from('transactions')
              .select('id')
              .in('id', batch);

            if (checkError) throw checkError;

            existingBatch?.forEach(t => existingIds.add(t.id));
          }

          // 2. Separate new and duplicate transactions
          const newTransactions = mappedData.filter(row => !existingIds.has(row.id));
          const duplicateCount = mappedData.length - newTransactions.length;

          // 3. Create Upload Record
          const { data: uploadData, error: uploadError } = await supabase
            .from('uploads')
            .insert({
              filename: file.name,
              platform: currentPlatform,
              record_count: newTransactions.length
            })
            .select()
            .single();

          if (uploadError) throw uploadError;
          const uploadId = uploadData.id;

          // 4. Only insert new transactions
          if (newTransactions.length > 0) {
            const dataWithUploadId = newTransactions.map(row => ({
              ...row,
              upload_id: uploadId
            }));

            console.log(`Inserting ${dataWithUploadId.length} new transactions...`);

            const { error: insertError } = await supabase
              .from('transactions')
              .insert(dataWithUploadId);

            if (insertError) throw insertError;
            console.log('Insert successful!');
          } else {
            console.log('No new transactions to insert - all were duplicates');
          }

          setUploadStats({
            processed: mappedData.length,
            duplicates: duplicateCount
          });
          console.log(`Upload stats: ${mappedData.length} processed, ${duplicateCount} duplicates`);
          setShowDedupeBanner(true);
          setError(null); // Clear any previous errors
          setUploadHistoryKey(prev => prev + 1);

          // Show alert if new ATM IDs were detected
          if (newATMsInUpload.length > 0) {
            console.log(`New ATM IDs detected: ${newATMsInUpload.join(', ')}`);
            setNewATMIds(newATMsInUpload);
            setShowNewATMAlert(true);
          } else {
            console.log('No new ATM IDs detected');
          }

          console.log('Refreshing data after upload...');
          // Refresh data
          await fetchTransactions();
          await fetchMetrics();
          await fetchAllTransactionDates();
          console.log('Data refresh complete!');
        } catch (error) {
          console.error('Error uploading data:', error);
          setError(error instanceof Error ? error.message : 'Failed to upload data to database');
        }
      },
      error: (error) => {
        console.error('Error parsing CSV:', error);
        setError('Failed to parse CSV file: ' + error.message);
      }
    });
  };

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
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/reports')}
              title="Reports"
            >
              <BarChart3 className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/commissions')}
              title="Commission Calculator"
            >
              <Calculator className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/cash-management')}
              title="Cash Management"
            >
              <Banknote className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/bitstop-commissions')}
              title="Bitstop Commissions"
            >
              <TrendingUp className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => navigate('/settings')}
            >
              <Settings className="w-5 h-5" />
            </Button>
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

        {/* Deduplication Banner */}
        {showDedupeBanner && (
          <Alert className="bg-secondary/10 border-secondary/20 text-secondary animate-in slide-in-from-top-2">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Import Complete</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>
                Processed {uploadStats.processed} records. <span className="font-bold">{uploadStats.duplicates} duplicates were skipped.</span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-secondary hover:text-secondary/80"
                onClick={() => setShowDedupeBanner(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* New ATM Alert */}
        {showNewATMAlert && (
          <Alert className="bg-yellow-500/10 border-yellow-500/20 text-yellow-500 animate-in slide-in-from-top-2">
            <Bell className="h-4 w-4" />
            <AlertTitle>New ATM IDs Detected!</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                The following {newATMIds.length} new ATM ID{newATMIds.length > 1 ? 's were' : ' was'} detected and added to your system:
              </p>
              <div className="font-mono text-sm bg-black/20 p-2 rounded">
                {newATMIds.sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0)).join(', ')}
              </div>
              <div className="flex items-center justify-between pt-2">
                <Button
                  size="sm"
                  onClick={() => navigate('/settings')}
                  className="bg-yellow-500 text-black hover:bg-yellow-400"
                >
                  Go to Settings to Add Details
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-yellow-500 hover:text-yellow-400"
                  onClick={() => setShowNewATMAlert(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </AlertDescription>
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

        {/* Upload Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-bold">Upload Data</h2>
            <UploadHistory key={uploadHistoryKey} onUploadDeleted={fetchTransactions} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <UploadZone onFileSelect={handleFileSelect} />
            <LastUploadDates
              denetFirstDate={transactionDates.denetFirst}
              denetLastDate={transactionDates.denetLast}
              bitstopFirstDate={transactionDates.bitstopFirst}
              bitstopLastDate={transactionDates.bitstopLast}
            />
          </div>
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
