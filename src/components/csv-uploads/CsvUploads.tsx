import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadZone } from '../dashboard/UploadZone';
import { LastUploadDates } from '../dashboard/LastUploadDates';
import { UploadHistory } from '../dashboard/UploadHistory';
import { Button } from '@/components/ui/button';
import { AlertCircle, X, Bell } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import Papa from 'papaparse';
import { supabase } from '@/lib/supabase';

export default function CsvUploads() {
  const navigate = useNavigate();
  const [showDedupeBanner, setShowDedupeBanner] = useState(false);
  const [uploadStats, setUploadStats] = useState({ processed: 0, duplicates: 0 });
  const [error, setError] = useState<string | null>(null);
  const [uploadHistoryKey, setUploadHistoryKey] = useState(0);
  const [newATMIds, setNewATMIds] = useState<string[]>([]);
  const [showNewATMAlert, setShowNewATMAlert] = useState(false);

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

        const getValue = (row: any, key: string) => {
          const foundKey = Object.keys(row).find(k => k.toLowerCase().trim() === key.toLowerCase().trim());
          return foundKey ? row[foundKey] : undefined;
        };

        const newATMsInUpload: string[] = [];

        console.log('Fetching existing ticker mappings and ATM profiles...');
        const { data: existingTickers } = await supabase
          .from('ticker_mappings')
          .select('*');

        const { data: existingATMs } = await supabase
          .from('atm_profiles')
          .select('*');

        const tickerMap = new Map(existingTickers?.map(t => [t.original_value, t.display_value || t.original_value]) || []);
        const feePercentageMap = new Map(existingTickers?.map(t => [t.original_value, t.fee_percentage || 0.10]) || []);
        const atmMap = new Map(existingATMs?.map(a => [a.atm_id, a]) || []);

        const newTickers = new Set<string>();
        const newATMsToInsert = new Map<string, { atm_id: string, atm_name: string | null }>();

        const mapTicker = (originalTicker: string | null | undefined): string | null => {
          if (!originalTicker) return null;
          const ticker = originalTicker.toString().trim();
          if (!ticker) return null;

          if (tickerMap.has(ticker)) {
            return tickerMap.get(ticker) || ticker;
          }

          newTickers.add(ticker);
          tickerMap.set(ticker, ticker);
          feePercentageMap.set(ticker, 0.10);
          return ticker;
        };

        const mapATM = (atmId: string | null | undefined, originalAtmName: string | null | undefined): { atm_id: string | null, atm_name: string | null } => {
          if (!atmId) return { atm_id: null, atm_name: null };
          const cleanAtmId = atmId.toString().trim();
          if (!cleanAtmId) return { atm_id: null, atm_name: null };

          if (atmMap.has(cleanAtmId)) {
            const existing = atmMap.get(cleanAtmId)!;
            return {
              atm_id: cleanAtmId,
              atm_name: existing.atm_name || originalAtmName?.toString().trim() || null
            };
          }

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

        const headers = results.meta.fields || [];
        const isBitstop = headers.some(h => ['atmid', 'cointype', 'inserted'].includes(h.toLowerCase().trim()));
        const currentPlatform = isBitstop ? 'bitstop' : 'denet';

        console.log('Detected Platform:', currentPlatform);

        let mappedData: any[] = [];

        if (currentPlatform === 'denet') {
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
          mappedData = allData.map(row => {
            const id = getValue(row, 'Id');

            const saleAmount = getValue(row, 'Inserted') ? parseFloat(getValue(row, 'Inserted').toString().replace(/[$,]/g, '')) : null;
            const rawTicker = getValue(row, 'CoinType');
            const mappedTicker = mapTicker(rawTicker);

            const rawAtmId = getValue(row, 'ATMID') || getValue(row, 'AtmId');
            const rawAtmName = getValue(row, 'Atm') || getValue(row, 'Atm.Name');
            const atmData = mapATM(rawAtmId, rawAtmName);

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
          const transactionIds = mappedData.map(row => row.id);
          const batchSize = 500;
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

          const newTransactions = mappedData.filter(row => !existingIds.has(row.id));
          const duplicateCount = mappedData.length - newTransactions.length;

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
          setError(null);
          setUploadHistoryKey(prev => prev + 1);

          if (newATMsInUpload.length > 0) {
            console.log(`New ATM IDs detected: ${newATMsInUpload.join(', ')}`);
            setNewATMIds(newATMsInUpload);
            setShowNewATMAlert(true);
          } else {
            console.log('No new ATM IDs detected');
          }

          console.log('Refreshing data after upload...');
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

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/20">
      <header className="border-b border-white/10 bg-background/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[95%] mx-auto px-6 h-16 flex items-center">
          <div className="flex items-center gap-3">
            <img
              src="/images/DNET Logo (black).png"
              alt="Denet Logo"
              className="w-20 h-20 object-contain"
            />
            <h1 className="font-display font-bold text-xl tracking-tight">
              CSV <span className="text-muted-foreground font-normal">Uploads</span>
            </h1>
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

        {/* Upload Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-display font-bold">Upload Data</h2>
            <UploadHistory key={uploadHistoryKey} onUploadDeleted={() => fetchAllTransactionDates()} />
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
      </main>
    </div>
  );
}
