import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadZone } from '../dashboard/UploadZone';
import { LastUploadDates } from '../dashboard/LastUploadDates';
import { UploadHistory } from '../dashboard/UploadHistory';
import { Button } from '@/components/ui/button';
import { AlertCircle, X, Bell, ArrowRightLeft } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import Papa from 'papaparse';
import { supabase } from '@/lib/supabase';

// A pending platform switch on a single ATM: the currently-active profile is
// on `currentPlatform`, but the inbound CSV brings tx data for `newPlatform`.
// User must confirm before the importer closes the old profile and opens a new
// one matching the CSV's platform.
type PendingConversion = {
  atm_id: string;
  current_profile_id: string;
  current_platform: string;
  new_platform: string;
  first_tx_date: string;
  location_name: string | null;
};

// Snapshot of the parsed CSV state captured at the moment we detect a pending
// conversion. Held in component state across the user confirmation step, then
// passed back into runImport() once they approve.
type PendingImportState = {
  mappedData: any[];
  newTickers: string[];
  newATMsToInsert: Array<{ atm_id: string; atm_name: string | null }>;
  newATMsInUpload: string[];
  currentPlatform: 'denet' | 'bitstop';
  fileName: string;
  negativeSpreadCount: number;
  commissionRateWarning: string | null;
};

export default function CsvUploads() {
  const navigate = useNavigate();
  const [showDedupeBanner, setShowDedupeBanner] = useState(false);
  const [uploadStats, setUploadStats] = useState({ processed: 0, duplicates: 0, negativeSpreadCount: 0, commissionRateWarning: null as string | null });
  const [error, setError] = useState<string | null>(null);
  const [uploadHistoryKey, setUploadHistoryKey] = useState(0);
  const [newATMIds, setNewATMIds] = useState<string[]>([]);
  const [showNewATMAlert, setShowNewATMAlert] = useState(false);
  const [newTickerNames, setNewTickerNames] = useState<string[]>([]);
  const [showNewTickerAlert, setShowNewTickerAlert] = useState(false);

  // Pending platform-conversion state. When the CSV brings tx data for an
  // atm_id whose active profile is on a different platform, we pause the
  // import and surface a confirmation dialog rather than silently mixing
  // platforms (which broke aggregations in the old single-row model).
  const [pendingConversions, setPendingConversions] = useState<PendingConversion[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImportState | null>(null);
  const [isConfirmingConversions, setIsConfirmingConversions] = useState(false);

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

  // Insert tickers, insert auto-create ATMs, dedupe transaction IDs, write
  // the upload row, write transactions. Extracted from the inline Papa.parse
  // body so it can be invoked either directly (no conversions) or after the
  // user confirms a platform-conversion dialog.
  const runImport = async (state: PendingImportState) => {
    const {
      mappedData,
      newTickers,
      newATMsToInsert,
      newATMsInUpload,
      currentPlatform,
      fileName,
      negativeSpreadCount,
      commissionRateWarning,
    } = state;

    try {
      if (newTickers.length > 0) {
        const tickersToInsert = newTickers.map((ticker) => ({
          original_value: ticker,
          display_value: null,
        }));
        const { error: tickerError } = await supabase
          .from('ticker_mappings')
          .insert(tickersToInsert);
        if (tickerError) console.error('Error inserting tickers:', tickerError);
      }

      if (newATMsToInsert.length > 0) {
        const atmsToInsert = newATMsToInsert.map((atm) => ({
          atm_id: atm.atm_id,
          location_name: atm.atm_name,
          platform: currentPlatform,
          monthly_rent: 0,
          cash_management_rps: 0,
          cash_management_rep: 0,
        }));
        const { error: atmError } = await supabase
          .from('atm_profiles')
          .insert(atmsToInsert);
        if (atmError) console.error('Error inserting ATM profiles:', atmError);
      }
    } catch (e) {
      console.error('Error batch inserting tickers/ATMs:', e);
    }

    try {
      const transactionIds = mappedData.map((row) => row.id);
      const batchSize = 500;
      const existingIds = new Set();

      for (let i = 0; i < transactionIds.length; i += batchSize) {
        const batch = transactionIds.slice(i, i + batchSize);
        const { data: existingBatch, error: checkError } = await supabase
          .from('transactions')
          .select('id')
          .in('id', batch);
        if (checkError) throw checkError;
        existingBatch?.forEach((t) => existingIds.add(t.id));
      }

      const newTransactions = mappedData.filter((row) => !existingIds.has(row.id));
      const duplicateCount = mappedData.length - newTransactions.length;

      const { data: uploadData, error: uploadError } = await supabase
        .from('uploads')
        .insert({
          filename: fileName,
          platform: currentPlatform,
          record_count: newTransactions.length,
        })
        .select()
        .single();
      if (uploadError) throw uploadError;
      const uploadId = uploadData.id;

      if (newTransactions.length > 0) {
        const dataWithUploadId = newTransactions.map((row) => ({
          ...row,
          upload_id: uploadId,
        }));
        const { error: insertError } = await supabase
          .from('transactions')
          .insert(dataWithUploadId);
        if (insertError) throw insertError;
      }

      setUploadStats({
        processed: mappedData.length,
        duplicates: duplicateCount,
        negativeSpreadCount,
        commissionRateWarning,
      });
      setShowDedupeBanner(true);
      setError(null);
      setUploadHistoryKey((prev) => prev + 1);

      if (newATMsInUpload.length > 0) {
        setNewATMIds(newATMsInUpload);
        setShowNewATMAlert(true);
      }
      if (newTickers.length > 0) {
        setNewTickerNames(newTickers);
        setShowNewTickerAlert(true);
      }

      await fetchAllTransactionDates();
    } catch (e) {
      console.error('Error uploading data:', e);
      setError(e instanceof Error ? e.message : 'Failed to upload data to database');
    }
  };

  // For each pending conversion, close the existing active profile (set its
  // removed_date to the day before the CSV's first new tx, mark inactive)
  // and insert a new active profile matching the CSV's platform with
  // installed_date set to the first new tx. Returns true on success, false
  // on the first DB error (caller should abort and surface the error).
  const processConversions = async (conversions: PendingConversion[]): Promise<boolean> => {
    for (const c of conversions) {
      const [y, m, d] = c.first_tx_date.split('-').map(Number);
      const dayBefore = new Date(y, m - 1, d - 1);
      const dayBeforeStr = `${dayBefore.getFullYear()}-${String(
        dayBefore.getMonth() + 1,
      ).padStart(2, '0')}-${String(dayBefore.getDate()).padStart(2, '0')}`;

      const { error: closeErr } = await supabase
        .from('atm_profiles')
        .update({ removed_date: dayBeforeStr, active: false })
        .eq('id', c.current_profile_id);
      if (closeErr) {
        console.error(`Failed to close profile ${c.current_profile_id}:`, closeErr);
        setError(
          `Failed to close existing profile for ATM ${c.atm_id}: ${closeErr.message}`,
        );
        return false;
      }

      const { error: insertErr } = await supabase.from('atm_profiles').insert({
        atm_id: c.atm_id,
        location_name: c.location_name,
        platform: c.new_platform,
        installed_date: c.first_tx_date,
        active: true,
        monthly_rent: 0,
        cash_management_rps: 0,
        cash_management_rep: 0,
      });
      if (insertErr) {
        console.error(`Failed to insert new profile for ATM ${c.atm_id}:`, insertErr);
        setError(
          `Failed to create new profile for ATM ${c.atm_id}: ${insertErr.message}`,
        );
        return false;
      }
    }
    return true;
  };

  const handleConfirmConversions = async () => {
    if (!pendingImport) return;
    setIsConfirmingConversions(true);
    try {
      const ok = await processConversions(pendingConversions);
      if (!ok) return;
      const state = pendingImport;
      setPendingConversions([]);
      setPendingImport(null);
      await runImport(state);
    } finally {
      setIsConfirmingConversions(false);
    }
  };

  const handleCancelConversions = () => {
    setPendingConversions([]);
    setPendingImport(null);
  };

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

        // atm_profiles now has multiple rows per atm_id. The map below keys by
        // atm_id for the "is this ATM currently in the system?" check, so we
        // filter to active=true — guaranteed unique per atm_id by migration
        // 20240522000034's partial unique index.
        const { data: existingATMs } = await supabase
          .from('atm_profiles')
          .select('*')
          .eq('active', true);

        const tickerMap = new Map(existingTickers?.map(t => [t.original_value, t.display_value || t.original_value]) || []);
        const atmMap = new Map(existingATMs?.map(a => [a.atm_id, a]) || []);

        const newTickers = new Set<string>();
        const newATMsToInsert = new Map<string, { atm_id: string, atm_name: string | null }>();

        // mapTicker: returns display_value if set, otherwise falls back to raw value (never null when input is present)
        const mapTicker = (originalTicker: string | null | undefined): string | null => {
          if (!originalTicker) return null;
          const ticker = originalTicker.toString().trim();
          if (!ticker) return null;

          if (tickerMap.has(ticker)) {
            return tickerMap.get(ticker) || ticker;
          }

          newTickers.add(ticker);
          tickerMap.set(ticker, ticker);
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
        let negativeSpreadCount = 0;
        let commissionRateWarning: string | null = null;

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
              customer_address: getValue(row, 'customer.address') || getValue(row, 'customer_address'),
              customer_zipcode: getValue(row, 'customer.zipcode') || getValue(row, 'customer_zipcode'),
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
          // ── Bitstop header validation ──
          const requiredBitstopHeaders = ['id', 'inserted', 'sent', 'cointype', 'createdat'];
          const normalizedHeaders = headers.map(h => h.toLowerCase().trim());
          const atmHeader = normalizedHeaders.some(h => ['atmid', 'atm.id', 'atm_id'].includes(h));
          const atmNameHeader = normalizedHeaders.some(h => ['atm', 'atm.name', 'atm_name'].includes(h));

          const missingHeaders: string[] = [];
          for (const req of requiredBitstopHeaders) {
            if (!normalizedHeaders.includes(req)) {
              missingHeaders.push(req);
            }
          }
          if (!atmHeader) missingHeaders.push('ATMID/AtmId');
          if (!atmNameHeader) missingHeaders.push('Atm/Atm.Name');

          if (missingHeaders.length > 0) {
            setError(`Bitstop CSV is missing required column(s): ${missingHeaders.join(', ')}. Please check the file format.`);
            return;
          }

          // ── Fetch commission rate from app_settings ──
          let commissionRate = 0.56; // fallback default
          const { data: rateSetting, error: rateError } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'bitstop_commission_rate')
            .single();
          const fallbackWarning = '⚠️ Could not load commission rate from settings. Used fallback rate of 0.56. Please verify settings and reimport if needed.';
          if (rateError) {
            console.error('Error fetching bitstop_commission_rate:', rateError);
            commissionRateWarning = fallbackWarning;
          } else {
            const parsed = parseFloat(rateSetting?.value);
            if (!parsed || isNaN(parsed)) {
              console.warn('Invalid bitstop_commission_rate value:', rateSetting?.value);
              commissionRateWarning = fallbackWarning;
            } else {
              commissionRate = parsed;
            }
          }
          console.log('Bitstop commission rate:', commissionRate);

          mappedData = allData.map(row => {
            const id = getValue(row, 'Id');

            const saleAmount = getValue(row, 'Inserted') ? parseFloat(getValue(row, 'Inserted').toString().replace(/[$,]/g, '')) : null;
            const sentAmount = getValue(row, 'Sent') ? parseFloat(getValue(row, 'Sent').toString().replace(/[$,]/g, '')) : null;
            const rawTicker = getValue(row, 'CoinType');
            const mappedTicker = mapTicker(rawTicker);

            const rawAtmId = getValue(row, 'ATMID') || getValue(row, 'Atm.Id') || getValue(row, 'Atm_Id');
            const rawAtmName = getValue(row, 'Atm') || getValue(row, 'Atm.Name') || getValue(row, 'Atm_Name');
            const atmData = mapATM(rawAtmId, rawAtmName);

            // New fee calculation: spread = Inserted - Sent, fee = spread * commission rate
            const bitstopSpread = (saleAmount != null && sentAmount != null)
              ? parseFloat((saleAmount - sentAmount).toFixed(2))
              : null;
            const calculatedFee = bitstopSpread != null
              ? parseFloat((bitstopSpread * commissionRate).toFixed(2))
              : null;

            // Track negative/zero spreads
            if (bitstopSpread != null && bitstopSpread <= 0) {
              negativeSpreadCount++;
            }

            return {
              id: id,
              customer_id: null,
              customer_first_name: null,
              customer_last_name: null,
              customer_city: null,
              customer_state: null,
              customer_address: null,
              customer_zipcode: null,
              atm_id: atmData.atm_id,
              atm_name: atmData.atm_name,
              location_name: atmData.atm_name,
              ticker: mappedTicker,
              fee: calculatedFee,
              sent: sentAmount,
              sale: saleAmount,
              bitstop_fee: 0,
              bitstop_spread: bitstopSpread,
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

        // Per-atm first new tx date. Used both for conversion windows below
        // and (when the user approves) as the new profile's installed_date.
        const firstTxDateByAtmId = new Map<string, string>();
        mappedData.forEach((tx: any) => {
          if (!tx.atm_id || !tx.date) return;
          const dateOnly = String(tx.date).split('T')[0];
          const existing = firstTxDateByAtmId.get(tx.atm_id);
          if (!existing || dateOnly < existing) {
            firstTxDateByAtmId.set(tx.atm_id, dateOnly);
          }
        });

        // Detect platform conversions: CSV brings tx data for an atm_id
        // whose currently-active profile is on a different platform.
        const conversions: PendingConversion[] = [];
        const seenAtmIds = new Set(
          mappedData.map((tx: any) => tx.atm_id).filter(Boolean) as string[],
        );
        seenAtmIds.forEach((atmId) => {
          const existing = atmMap.get(atmId);
          if (!existing) return; // No active profile -> handled by auto-create
          const existingPlatform = (existing.platform || '').toLowerCase();
          if (existingPlatform === currentPlatform) return; // Match — no action
          const firstTxDate = firstTxDateByAtmId.get(atmId);
          if (!firstTxDate) return;
          conversions.push({
            atm_id: atmId,
            current_profile_id: existing.id,
            current_platform: existingPlatform,
            new_platform: currentPlatform,
            first_tx_date: firstTxDate,
            location_name: existing.location_name,
          });
        });

        const importState: PendingImportState = {
          mappedData,
          newTickers: Array.from(newTickers),
          newATMsToInsert: Array.from(newATMsToInsert.values()),
          newATMsInUpload,
          currentPlatform: currentPlatform as 'denet' | 'bitstop',
          fileName: file.name,
          negativeSpreadCount,
          commissionRateWarning,
        };

        if (conversions.length > 0) {
          setPendingConversions(conversions);
          setPendingImport(importState);
          return;
        }

        await runImport(importState);
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
              <div>
                <span>
                  Processed {uploadStats.processed} records. <span className="font-bold">{uploadStats.duplicates} duplicates were skipped.</span>
                </span>
                {uploadStats.negativeSpreadCount > 0 && (
                  <div className="mt-1 text-amber-400">
                    Heads up: {uploadStats.negativeSpreadCount} row{uploadStats.negativeSpreadCount !== 1 ? 's' : ''} had a zero or negative spread — review for accuracy.
                  </div>
                )}
                {uploadStats.commissionRateWarning && (
                  <div className="mt-1 text-amber-400">
                    {uploadStats.commissionRateWarning}
                  </div>
                )}
              </div>
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

        {/* New Ticker Alert */}
        {showNewTickerAlert && (
          <Alert className="bg-purple-500/10 border-purple-500/20 text-purple-400 animate-in slide-in-from-top-2">
            <Bell className="h-4 w-4" />
            <AlertTitle>New Ticker(s) Detected!</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                {newTickerNames.length} new ticker{newTickerNames.length !== 1 ? 's' : ''} detected: <span className="font-mono font-bold">{newTickerNames.join(', ')}</span> — please set display names in Ticker Mappings settings.
              </p>
              <div className="flex items-center justify-between pt-2">
                <Button
                  size="sm"
                  onClick={() => navigate('/settings')}
                  className="bg-purple-500 text-white hover:bg-purple-400"
                >
                  Go to Ticker Mappings
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-purple-400 hover:text-purple-300"
                  onClick={() => setShowNewTickerAlert(false)}
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

      {/* Platform-conversion confirmation. Blocks the import until the user
          approves closing the old active profile(s) and opening new one(s). */}
      <Dialog
        open={pendingConversions.length > 0}
        onOpenChange={(open) => {
          if (!open && !isConfirmingConversions) handleCancelConversions();
        }}
      >
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Platform conversion detected</DialogTitle>
            <DialogDescription>
              The CSV brings transaction data for {pendingConversions.length} ATM
              {pendingConversions.length !== 1 ? 's' : ''} whose currently-active
              profile is on a different platform. Confirming will close each
              active profile (set its removed_date to the day before the first
              new transaction) and open a new profile matching the CSV's
              platform. Cancel to abort the entire import.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {pendingConversions.map((c) => (
              <div
                key={c.atm_id}
                className="flex items-center gap-3 p-3 rounded border border-amber-400/20 bg-amber-400/5"
              >
                <ArrowRightLeft className="w-4 h-4 text-amber-400 shrink-0" />
                <div className="flex-1 text-sm">
                  <div className="font-medium">
                    {c.location_name || c.atm_id}{' '}
                    <span className="text-muted-foreground font-mono text-xs">
                      ({c.atm_id})
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="capitalize">{c.current_platform}</span>
                    {' → '}
                    <span className="capitalize">{c.new_platform}</span>, first
                    new tx on {c.first_tx_date}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelConversions}
              disabled={isConfirmingConversions}
            >
              Cancel import
            </Button>
            <Button
              onClick={handleConfirmConversions}
              disabled={isConfirmingConversions}
            >
              {isConfirmingConversions
                ? 'Processing…'
                : `Confirm ${pendingConversions.length} conversion${pendingConversions.length !== 1 ? 's' : ''} and import`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
