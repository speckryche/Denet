// Upload the Coinbase Prime monthly ZIP exactly as downloaded.
//
// Only detail_*.csv and asset_balances_*.csv are read; the other members are
// ignored. Anything unexpected (missing file, changed headers, unreadable
// period) fails loudly here rather than producing a wrong journal entry.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileArchive, Loader2, Upload } from 'lucide-react';
import { parseCoinbaseZip } from '@/lib/qbo/coinbase-parse';
import { saveStatement } from '@/lib/qbo/data';
import { monthText } from '@/lib/qbo/period';
import type { CoinbaseStatement } from '@/lib/qbo/types';

export function CoinbaseUpload({
  selectedMonth,
  onImported,
}: {
  selectedMonth: string;
  onImported: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [periodWarning, setPeriodWarning] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setIsBusy(true);
    setError(null);
    setResult(null);
    setPeriodWarning(null);
    try {
      const statement: CoinbaseStatement = await parseCoinbaseZip(file);
      const saved = await saveStatement(statement);
      setResult(
        `Imported ${saved.detailRows} transaction rows and ${saved.balanceRows} balance rows for ` +
          `${monthText(statement.month)} (${statement.periodStart} to ${statement.periodEnd}).`,
      );
      if (statement.month !== selectedMonth) {
        setPeriodWarning(
          `That statement covers ${monthText(statement.month)}, but ${monthText(selectedMonth)} is selected. ` +
            `Switch months to see its entry.`,
        );
      }
      await onImported();
    } catch (err) {
      console.error('Coinbase import failed:', err);
      setError(err instanceof Error ? err.message : 'Could not read that ZIP.');
    } finally {
      setIsBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={isBusy}>
          {isBusy ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          {isBusy ? 'Reading...' : 'Upload Coinbase Prime ZIP'}
        </Button>
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <FileArchive className="w-3.5 h-3.5" />
          Upload the monthly ZIP as downloaded — re-uploading the same file changes nothing.
        </span>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {result && (
        <Alert className="bg-green-500/10 border-green-500/20 text-green-500">
          <AlertDescription>{result}</AlertDescription>
        </Alert>
      )}
      {periodWarning && (
        <Alert className="bg-amber-500/10 border-amber-500/20 text-amber-400">
          <AlertDescription>{periodWarning}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert className="bg-red-500/10 border-red-500/20 text-red-500">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
