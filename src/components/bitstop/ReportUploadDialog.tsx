// Upload one month's Bitstop commission .xlsx.
//
// Follows the parse → pause → confirm → commit shape of the platform-conversion
// dialog in CsvUploads.tsx: the file is fully parsed and checked in memory, and
// nothing is written until either the check passes or the user resolves the
// column mapping. Two things can stop the import:
//
//   * a required column cannot be identified — the mapping dialog opens, and
//     the answer is remembered for this header layout;
//   * the line items do not sum to the report's own TOTAL — a hard BLOCK, since
//     importing a report that disagrees with itself would poison the audit.

import { useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import {
  parseBitstopReport, REQUIRED_FIELDS, type CanonicalField, type ParsedReport,
} from '@/lib/bitstop-report/parse';
import {
  importBitstopReport, fetchSavedMapping, saveMapping, type BitstopMonthRow,
} from '@/lib/bitstop-report/data';

const money = (v: number | null | undefined) =>
  `$${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  monthRow: BitstopMonthRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export default function ReportUploadDialog({ monthRow, open, onOpenChange, onImported }: Props) {
  const { user } = useAuth();
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [parsed, setParsed] = useState<ParsedReport | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<CanonicalField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const reset = () => {
    setRows(null); setParsed(null); setMapping({});
    setError(null); setResult(null);
  };

  const onFile = async (file: File) => {
    reset();
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
      setRows(grid);

      const saved = await fetchSavedMapping(
        parseBitstopReport(grid).headerFingerprint,
      ).catch(() => null);
      const p = parseBitstopReport(grid, saved ?? undefined);
      setParsed(p);
      if (saved) setMapping(saved);
    } catch (e) {
      console.error('[bitstop-report] parse failed', e);
      setError(e instanceof Error ? e.message : 'Could not read the spreadsheet');
    } finally {
      setBusy(false);
    }
  };

  const applyMapping = () => {
    if (!rows) return;
    const p = parseBitstopReport(rows, mapping);
    setParsed(p);
  };

  const commit = async () => {
    if (!rows || !monthRow || !parsed) return;
    setBusy(true);
    setError(null);
    try {
      if (parsed.unresolved.length === 0 && Object.keys(mapping).length > 0) {
        await saveMapping(parsed.headerFingerprint, parsed.headers, mapping, user?.email ?? null);
      }
      const outcome = await importBitstopReport({
        rows,
        monthRow,
        savedMapping: Object.keys(mapping).length > 0 ? mapping : undefined,
        today: new Date().toISOString().slice(0, 10),
      });
      const s = outcome.match.stats;
      setResult(
        `Imported ${outcome.parsed.lines.length} lines. ` +
          `Matched ${s.matchedCount}. ` +
          `${s.missingFromReport} missing from report, ${s.notInApp} not in app, ` +
          `${s.amountDiffs} amount difference${s.amountDiffs === 1 ? '' : 's'}` +
          (s.lateCorrections ? `, ${s.lateCorrections} late correction${s.lateCorrections === 1 ? '' : 's'}` : '') +
          `. Audit items: ${outcome.added} new, ${outcome.kept} kept, ${outcome.cleared} cleared.`,
      );
      onImported();
    } catch (e) {
      console.error('[bitstop-report] import failed', e);
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const needsMapping = parsed != null && parsed.unresolved.length > 0;
  const blocked = parsed != null && !parsed.blockCheck.ok && !needsMapping;
  const canCommit = parsed != null && parsed.unresolved.length === 0 && parsed.blockCheck.ok && !result;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="sm:max-w-[680px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Upload Bitstop report{monthRow ? ` — ${monthRow.month} ${monthRow.year}` : ''}
          </DialogTitle>
          <DialogDescription>
            The month totals are filled in from the report's own TOTAL row, and every line is
            audited against our Bitstop-platform transactions.
          </DialogDescription>
        </DialogHeader>

        {!rows && (
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <FileSpreadsheet className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
            <input
              id="bitstop-report-file"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
            />
            <Button onClick={() => document.getElementById('bitstop-report-file')?.click()} disabled={busy}>
              {busy ? 'Reading…' : 'Choose .xlsx'}
            </Button>
          </div>
        )}

        {parsed && (
          <div className="rounded-md border border-border p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Line items</span>
              <span>{parsed.lines.length} ({parsed.subtotalRowCount} subtotal rows skipped)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Report total — fiat</span>
              <span>{money(parsed.blockCheck.fiatTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Report total — commission</span>
              <span>{money(parsed.blockCheck.commissionTotal)}</span>
            </div>
          </div>
        )}

        {needsMapping && (
          <div className="space-y-3">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Tell us which column is which</AlertTitle>
              <AlertDescription>
                This file's headers don't match anything we recognise. Map the required columns
                once — we'll remember this layout next time.
              </AlertDescription>
            </Alert>
            {REQUIRED_FIELDS.map((field) => (
              <div key={field} className="grid grid-cols-[140px_1fr] items-center gap-3">
                <Label>{field}</Label>
                <Select
                  value={mapping[field] ?? ''}
                  onValueChange={(v) => setMapping((m) => ({ ...m, [field]: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select a column…" /></SelectTrigger>
                  <SelectContent>
                    {parsed!.headers.filter(Boolean).map((h) => (
                      <SelectItem key={h} value={h}>{h}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <Button variant="outline" onClick={applyMapping} disabled={REQUIRED_FIELDS.some((f) => !mapping[f])}>
              Apply mapping
            </Button>
          </div>
        )}

        {blocked && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Report doesn't add up — import blocked</AlertTitle>
            <AlertDescription>
              {parsed!.blockCheck.reason}
              <div className="mt-2 text-xs">
                fiat: lines {money(parsed!.blockCheck.fiatSum)} vs TOTAL {money(parsed!.blockCheck.fiatTotal)} ·
                commission: lines {money(parsed!.blockCheck.commissionSum)} vs TOTAL {money(parsed!.blockCheck.commissionTotal)}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {result && (
          <Alert className="bg-green-500/10 border-green-500/30 text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Imported</AlertTitle>
            <AlertDescription>{result}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }} disabled={busy}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button onClick={commit} disabled={!canCommit || busy}>
              {busy ? 'Importing…' : 'Import report'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
