import React, { useState, useEffect } from 'react';
import { UploadZone } from './UploadZone';
import { MetricsGrid } from './MetricsGrid';
import { DataTable } from './DataTable';
import DatePickerWithRange from '@/components/ui/date-picker-with-range';
import { Button } from '@/components/ui/button';
import { Bell, Settings, AlertCircle, X, Filter } from 'lucide-react';
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

export default function Dashboard() {
  const [showDedupeBanner, setShowDedupeBanner] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [uploadStats, setUploadStats] = useState({ processed: 0, duplicates: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>('all');
  const [uploadHistoryKey, setUploadHistoryKey] = useState(0);

  const fetchTransactions = async () => {
    try {
      let query = supabase
        .from('transactions')
        .select('*')
        .order('created_at_transaction_local', { ascending: false });

      if (selectedPlatform !== 'all') {
        query = query.eq('platform', selectedPlatform);
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
  }, [selectedPlatform]);

  const metrics = React.useMemo(() => {
    return transactions.reduce((acc, row) => {
      // Helper to parse currency string (remove $ and , if present)
      const parseCurrency = (val: any) => {
        if (typeof val === 'number') return val;
        if (!val) return 0;
        const cleanVal = val.toString().replace(/[$,]/g, '');
        const num = parseFloat(cleanVal);
        return isNaN(num) ? 0 : num;
      };

      return {
        totalSales: acc.totalSales + parseCurrency(row.fiat),
        totalFees: acc.totalFees + parseCurrency(row.fee),
        totalOperatorFees: acc.totalOperatorFees + parseCurrency(row.operator_fee_usd),
        totalBitcoinSent: acc.totalBitcoinSent + parseCurrency(row.enviando),
      };
    }, {
      totalSales: 0,
      totalFees: 0,
      totalOperatorFees: 0,
      totalBitcoinSent: 0,
    });
  }, [transactions]);

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
        
        // Auto-detect platform based on headers
        const headers = results.meta.fields || [];
        const isBitstop = headers.some(h => ['atmid', 'cointype', 'inserted'].includes(h.toLowerCase().trim()));
        const currentPlatform = isBitstop ? 'bitstop' : 'denet';
        
        console.log('Detected Platform:', currentPlatform);

        let mappedData: any[] = [];

        if (currentPlatform === 'denet') {
          // Map Denet CSV columns
          mappedData = allData.map(row => {
            const id = getValue(row, 'ID') || getValue(row, 'transaction_id');
            
            return {
              id: id,
              customer_id: getValue(row, 'customer_id'),
              customer_first_name: getValue(row, 'customer.first_name') || getValue(row, 'customer_first_name'),
              customer_last_name: getValue(row, 'customer.last_name') || getValue(row, 'customer_last_name'),
              customer_city: getValue(row, 'customer.city') || getValue(row, 'customer_city'),
              customer_state: getValue(row, 'customer.state') || getValue(row, 'customer_state'),
              atm_id: getValue(row, 'atm.id') || getValue(row, 'atm_id'),
              atm_name: getValue(row, 'atm.name') || getValue(row, 'atm_name'),
              ticker: getValue(row, 'ticker'),
              fee: getValue(row, 'fee') ? parseFloat(getValue(row, 'fee').toString().replace(/[$,]/g, '')) : null,
              enviando: getValue(row, 'enviando') ? parseFloat(getValue(row, 'enviando').toString().replace(/[$,]/g, '')) : null,
              fiat: getValue(row, 'fiat') ? parseFloat(getValue(row, 'fiat').toString().replace(/[$,]/g, '')) : null,
              operator_fee_usd: getValue(row, 'operator_fee_usd') ? parseFloat(getValue(row, 'operator_fee_usd').toString().replace(/[$,]/g, '')) : null,
              created_at_transaction_local: getValue(row, 'created_at_transaction_local'),
              platform: 'denet'
            };
          }).filter(row => row.id);
        } else if (currentPlatform === 'bitstop') {
          // Map Bitstop CSV columns
          mappedData = allData.map(row => {
            const id = getValue(row, 'Id');
            
            return {
              id: id,
              customer_id: null,
              customer_first_name: null,
              customer_last_name: null,
              customer_city: null,
              customer_state: null,
              atm_id: getValue(row, 'ATMID') || getValue(row, 'AtmId'),
              atm_name: getValue(row, 'Atm') || getValue(row, 'Atm.Name'),
              ticker: getValue(row, 'CoinType'),
              fee: null,
              enviando: getValue(row, 'Sent') ? parseFloat(getValue(row, 'Sent').toString().replace(/[$,]/g, '')) : null,
              fiat: getValue(row, 'Inserted') ? parseFloat(getValue(row, 'Inserted').toString().replace(/[$,]/g, '')) : null,
              operator_fee_usd: null,
              created_at_transaction_local: getValue(row, 'CreatedAt'),
              platform: 'bitstop'
            };
          }).filter(row => row.id);
        }

        console.log('Mapped Data (first 2 rows):', mappedData.slice(0, 2));

        if (mappedData.length === 0) {
          setError(`No valid records found in CSV. Please check column headers.`);
          return;
        }

        try {
          // 1. Create Upload Record
          const { data: uploadData, error: uploadError } = await supabase
            .from('uploads')
            .insert({
              filename: file.name,
              platform: currentPlatform,
              record_count: mappedData.length
            })
            .select()
            .single();

          if (uploadError) throw uploadError;
          const uploadId = uploadData.id;

          // 2. Add upload_id to mapped data
          const dataWithUploadId = mappedData.map(row => ({
            ...row,
            upload_id: uploadId
          }));

          // 3. Upsert data to handle duplicates
          // We use upsert to update existing records if they are re-uploaded
          const { data, error } = await supabase
            .from('transactions')
            .upsert(dataWithUploadId, { 
              onConflict: 'id', 
              ignoreDuplicates: false // Update existing records to link them to the new upload (or update platform)
            })
            .select();

          if (error) throw error;

          // Calculate stats
          const insertedCount = data ? data.length : 0;
          const duplicateCount = mappedData.length - insertedCount;

          setUploadStats({
            processed: mappedData.length,
            duplicates: duplicateCount
          });
          setShowDedupeBanner(true);
          setError(null); // Clear any previous errors
          setUploadHistoryKey(prev => prev + 1);
          
          // Refresh data
          fetchTransactions();
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
    "ticker",
    "fee",
    "enviando",
    "fiat",
    "operator_fee_usd",
    "created_at_transaction_local"
  ];

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20">
      {/* Header */}
      <header className="border-b border-white/10 bg-background/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <span className="font-display font-bold text-white">D</span>
            </div>
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
            <DatePickerWithRange className="hidden md:grid" />
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Bell className="w-5 h-5" />
            </Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Settings className="w-5 h-5" />
            </Button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-purple-500" />
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8">
        
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

        {/* Top Section: Upload & Metrics */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">Upload Data</h3>
              <UploadHistory key={uploadHistoryKey} onUploadDeleted={fetchTransactions} />
            </div>
            <UploadZone onFileSelect={handleFileSelect} />
          </div>
          <div className="lg:col-span-2">
            <MetricsGrid 
              totalSales={metrics.totalSales}
              totalFees={metrics.totalFees}
              totalOperatorFees={metrics.totalOperatorFees}
              totalBitcoinSent={metrics.totalBitcoinSent}
            />
          </div>
        </div>

        {/* Data Table Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-bold">Recent Transactions</h2>
          </div>
          <DataTable data={transactions} columns={dbColumns} />
        </div>
      </main>
    </div>
  );
}
