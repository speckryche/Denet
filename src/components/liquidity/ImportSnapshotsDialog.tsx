import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Upload, Download, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface LiquidityCategory {
  id: string;
  name: string;
  type: 'asset' | 'liability' | 'crypto';
  display_order: number;
  active: boolean;
  coin_id: string | null;
  ticker: string | null;
}

interface ImportSnapshotsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: LiquidityCategory[];
  onImported: () => void;
}

interface ParsedRow {
  snapshot_date: string;
  bitcoin_price: number;
  values: { category_id: string; value: number; quantity: number | null }[];
}

// Fetch historical price from CoinGecko for a specific date
// Date format for CoinGecko: dd-mm-yyyy
const fetchHistoricalPrice = async (
  coinId: string,
  date: string
): Promise<number> => {
  const [y, m, d] = date.split('-');
  const cgDate = `${d}-${m}-${y}`;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/history?date=${cgDate}&localization=false`
    );
    const data = await res.json();
    return data?.market_data?.current_price?.usd || 0;
  } catch {
    return 0;
  }
};

// Batch fetch prices for multiple dates, with rate limiting
const fetchPricesForDates = async (
  dates: string[],
  coinIds: string[]
): Promise<Map<string, Record<string, number>>> => {
  // key: "date", value: { coinId: price }
  const priceMap = new Map<string, Record<string, number>>();

  for (const date of dates) {
    const prices: Record<string, number> = {};
    for (const coinId of coinIds) {
      const price = await fetchHistoricalPrice(coinId, date);
      prices[coinId] = price;
      // CoinGecko free tier: ~10-30 req/min, small delay between calls
      await new Promise((r) => setTimeout(r, 1200));
    }
    priceMap.set(date, prices);
  }

  return priceMap;
};

export function ImportSnapshotsDialog({
  open,
  onOpenChange,
  categories,
  onImported,
}: ImportSnapshotsDialogProps) {
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [importResult, setImportResult] = useState<{
    created: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeCategories = categories.filter((c) => c.active);
  const cryptoCategories = activeCategories.filter((c) => c.type === 'crypto');

  // For historical import we only need bitcoin price (to estimate BTC quantities)
  const neededCoinIds = ['bitcoin'];

  const resetState = () => {
    setParsedRows([]);
    setParseErrors([]);
    setImportResult(null);
    setImportStatus('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) resetState();
    onOpenChange(open);
  };

  // Categories to include in import (exclude SOL for historical import)
  const importCategories = activeCategories.filter(
    (c) => !(c.type === 'crypto' && c.coin_id === 'solana')
  );
  const importCryptoCategories = importCategories.filter((c) => c.type === 'crypto');

  // Download vertical CSV template
  const downloadTemplate = () => {
    const rows: string[][] = [];

    // Row 0: blank label cell + example date columns
    rows.push(['', '8/26/22', '11/27/22']);

    // All categories get a row — crypto uses dollar values (not qty) for historical import
    importCategories.forEach((cat) => {
      rows.push([cat.name, '', '']);
    });

    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'liquidity-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Normalize date string to YYYY-MM-DD
  const normalizeDate = (dateStr: string): string | null => {
    const trimmed = dateStr.trim();
    if (!trimmed) return null;

    if (trimmed.includes('/')) {
      const parts = trimmed.split('/');
      if (parts.length === 3) {
        let [m, d, y] = parts;
        if (y.length === 2) y = `20${y}`;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return null;
  };

  // Parse vertical CSV: row 1 = dates across columns, subsequent rows = category values
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportResult(null);
    setParseErrors([]);

    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const errors: string[] = [];
        const grid = results.data as string[][];

        if (grid.length < 2) {
          setParseErrors(['CSV must have at least a date row and one data row.']);
          return;
        }

        // Row 0: first cell is blank or label, remaining cells are dates
        const dateRow = grid[0];
        const dates: { col: number; date: string }[] = [];

        for (let c = 1; c < dateRow.length; c++) {
          const raw = (dateRow[c] || '').trim();
          if (!raw) continue;
          const normalized = normalizeDate(raw);
          if (!normalized) {
            errors.push(`Column ${c + 1}: Invalid date "${raw}". Use M/D/YY or YYYY-MM-DD`);
            continue;
          }
          dates.push({ col: c, date: normalized });
        }

        if (dates.length === 0) {
          setParseErrors([
            'No valid dates found in the first row. Put dates across the top starting in column B.',
            ...errors,
          ]);
          return;
        }

        // Build a map: label (lowercase) -> row data cells
        const labelMap = new Map<string, string[]>();
        for (let r = 1; r < grid.length; r++) {
          const label = (grid[r][0] || '').trim().toLowerCase();
          if (!label) continue;
          labelMap.set(label, grid[r]);
        }

        // Build parsed rows, one per date column
        // All values entered as dollar amounts; crypto quantities estimated during import
        const parsedRows: ParsedRow[] = dates.map(({ col, date }) => {
          const values: ParsedRow['values'] = [];

          importCategories.forEach((cat) => {
            const rowData = labelMap.get(cat.name.toLowerCase());
            const raw = rowData?.[col] || '';
            const val = parseFloat(raw.replace(/[$,]/g, '')) || 0;
            values.push({
              category_id: cat.id,
              value: Math.abs(val),
              quantity: null, // estimated from BTC price during import for crypto
            });
          });

          return {
            snapshot_date: date,
            bitcoin_price: 0, // fetched during import
            values,
          };
        });

        setParsedRows(parsedRows);
        setParseErrors(errors);
      },
    });
  };

  // Import: fetch historical prices then insert
  const handleImport = async () => {
    setIsImporting(true);
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Collect unique dates
    const uniqueDates = [...new Set(parsedRows.map((r) => r.snapshot_date))];

    // Fetch historical prices for all dates
    setImportStatus(
      `Fetching historical prices for ${uniqueDates.length} date${uniqueDates.length !== 1 ? 's' : ''}...`
    );

    const priceMap = await fetchPricesForDates(uniqueDates, neededCoinIds);

    setImportStatus('Importing snapshots...');

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      setImportStatus(
        `Importing ${i + 1} of ${parsedRows.length}...`
      );

      // Check if snapshot already exists
      const { data: existing } = await supabase
        .from('liquidity_snapshots')
        .select('id')
        .eq('snapshot_date', row.snapshot_date)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Get prices for this date
      const datePrices = priceMap.get(row.snapshot_date) || {};
      const btcPrice = Math.round(datePrices.bitcoin || 0);

      // Insert snapshot
      const { data: snap, error: snapError } = await supabase
        .from('liquidity_snapshots')
        .insert({
          snapshot_date: row.snapshot_date,
          bitcoin_price: btcPrice,
        })
        .select('id')
        .single();

      if (snapError) {
        errors.push(`${row.snapshot_date}: ${snapError.message}`);
        continue;
      }

      // For crypto categories: estimate quantity from value / BTC price
      const valueRows = row.values.map((v) => {
        const cat = importCategories.find((c) => c.id === v.category_id);
        let value = v.value;
        let quantity = v.quantity;

        if (cat?.type === 'crypto' && cat.coin_id === 'bitcoin' && btcPrice > 0 && value > 0) {
          // Estimate BTC quantity from dollar value
          quantity = parseFloat((value / btcPrice).toFixed(4));
        }

        return {
          snapshot_id: snap.id,
          category_id: v.category_id,
          value,
          quantity,
        };
      });

      const { error: valError } = await supabase
        .from('liquidity_snapshot_values')
        .insert(valueRows);

      if (valError) {
        errors.push(`${row.snapshot_date} values: ${valError.message}`);
      } else {
        created++;
      }
    }

    setImportResult({ created, skipped, errors });
    setImportStatus('');
    setIsImporting(false);
    if (created > 0) onImported();
  };

  const formatDateDisplay = (d: string) => {
    const [y, m, day] = d.split('-');
    return `${m}/${day}/${y.slice(2)}`;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Liquidity Snapshots</DialogTitle>
          <DialogDescription>
            Upload a CSV with historical data. Bitcoin and crypto prices will be
            fetched automatically from CoinGecko for each date.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Template download */}
          <Button
            variant="outline"
            size="sm"
            onClick={downloadTemplate}
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            Download CSV Template
          </Button>

          {/* Info box */}
          <div className="bg-primary/5 border border-primary/20 rounded-md px-3 py-2 text-xs text-muted-foreground space-y-1">
            <p>
              <strong className="text-foreground">Layout:</strong> Dates across
              the top (columns), categories down the left (rows) — matches your
              spreadsheet.
            </p>
            <p>
              <strong className="text-foreground">Dates:</strong> M/D/YY (e.g.
              8/26/22) or YYYY-MM-DD
            </p>
            <p>
              <strong className="text-foreground">All values in dollars.</strong>{' '}
              BTC price is auto-fetched per date. BTC quantities are estimated
              from the dollar value.
            </p>
          </div>

          {/* File upload */}
          <div
            className="border-2 border-dashed border-white/10 rounded-lg p-6 text-center cursor-pointer hover:border-primary/40 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Click to select a CSV file
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>

          {/* Parse errors */}
          {parseErrors.length > 0 && (
            <div className="bg-red-400/10 border border-red-400/20 rounded-md p-3 space-y-1">
              <div className="flex items-center gap-2 text-sm font-medium text-red-400">
                <AlertCircle className="w-4 h-4" />
                {parseErrors.length} parsing{' '}
                {parseErrors.length === 1 ? 'error' : 'errors'}
              </div>
              <div className="text-xs text-red-400/80 space-y-0.5 max-h-24 overflow-y-auto">
                {parseErrors.map((err, i) => (
                  <div key={i}>{err}</div>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {parsedRows.length > 0 && !importResult && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                Preview: {parsedRows.length} snapshot
                {parsedRows.length !== 1 ? 's' : ''} found
              </div>
              <div className="bg-white/[0.02] border border-white/10 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.03]">
                      <th className="px-3 py-2 text-left text-muted-foreground font-medium">
                        Date
                      </th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-medium">
                        Cash/Liab Fields
                      </th>
                      <th className="px-3 py-2 text-right text-muted-foreground font-medium">
                        Crypto Qty Fields
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 10).map((row, i) => {
                      const cashCount = row.values.filter((v) => {
                        const cat = activeCategories.find(
                          (c) => c.id === v.category_id
                        );
                        return (
                          cat &&
                          cat.type !== 'crypto' &&
                          v.value > 0
                        );
                      }).length;
                      const cryptoCount = row.values.filter((v) => {
                        const cat = activeCategories.find(
                          (c) => c.id === v.category_id
                        );
                        return (
                          cat?.type === 'crypto' &&
                          v.quantity != null &&
                          v.quantity > 0
                        );
                      }).length;
                      return (
                        <tr key={i} className="border-b border-white/5">
                          <td className="px-3 py-1.5 font-mono">
                            {formatDateDisplay(row.snapshot_date)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">
                            {cashCount} with values
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">
                            {cryptoCount} with qty
                          </td>
                        </tr>
                      );
                    })}
                    {parsedRows.length > 10 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-3 py-1.5 text-center text-muted-foreground italic"
                        >
                          ...and {parsedRows.length - 10} more
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {neededCoinIds.length > 0 && (
                <div className="text-xs text-amber-400/70">
                  Prices will be fetched from CoinGecko for{' '}
                  {neededCoinIds.join(', ')}. This may take a moment for many
                  dates.
                </div>
              )}
            </div>
          )}

          {/* Import status */}
          {isImporting && importStatus && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {importStatus}
            </div>
          )}

          {/* Import result */}
          {importResult && (
            <div
              className={cn(
                'border rounded-md p-4 space-y-1',
                importResult.errors.length > 0
                  ? 'bg-amber-400/10 border-amber-400/20'
                  : 'bg-green-400/10 border-green-400/20'
              )}
            >
              <div className="flex items-center gap-2 text-sm font-medium text-green-400">
                <CheckCircle className="w-4 h-4" />
                Import complete
              </div>
              <div className="text-sm text-muted-foreground">
                {importResult.created} snapshot
                {importResult.created !== 1 ? 's' : ''} created
                {importResult.skipped > 0 && (
                  <>
                    , {importResult.skipped} skipped (date already exists)
                  </>
                )}
              </div>
              {importResult.errors.length > 0 && (
                <div className="text-xs text-red-400/80 space-y-0.5 mt-2">
                  {importResult.errors.map((err, i) => (
                    <div key={i}>{err}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {importResult ? 'Close' : 'Cancel'}
          </Button>
          {!importResult && parsedRows.length > 0 && (
            <Button onClick={handleImport} disabled={isImporting}>
              {isImporting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Import {parsedRows.length} Snapshot
              {parsedRows.length !== 1 ? 's' : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
