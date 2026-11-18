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
//     importing a report that disagrees with itself would poison the audit;
//   * the lines' dates don't fall in this row's month (or no month holds a
//     clear majority) — a WARNING: Cancel is the default and nothing is written
//     unless the user explicitly clicks "Upload anyway".

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { AlertCircle, AlertTriangle, FileSpreadsheet, CheckCircle2 } from 'lucide-react';
import {
  parseBitstopReport, REQUIRED_FIELDS, type CanonicalField, type ParsedReport,
} from '@/lib/bitstop-report/parse';
import {
  importBitstopReport, fetchSavedMapping, saveMapping, toYearMonth, type BitstopMonthRow,
} from '@/lib/bitstop-report/data';
import { checkReportMonth, formatYearMonth, MONTH_MAJORITY } from '@/lib/bitstop-report/month';

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
  const cancelRef = useRef<HTMLButtonElement>(null);

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

  const commit = async (overrideMonth = false) => {
    if (!rows || !monthRow || !parsed) return;
    // Belt and braces: the footer already swaps Import for Upload anyway, but
    // never let a mismatched report through without the explicit override.
    if (monthMismatch && !overrideMonth) return;
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

  // Month guard, evaluated only once the report has passed its own checks.
  const targetYM = useMemo(() => {
    if (!monthRow) return null;
    try { return toYearMonth(monthRow.month, monthRow.year); } catch { return null; }
  }, [monthRow?.month, monthRow?.year]);
  const monthCheck = useMemo(
    () => (canCommit && targetYM ? checkReportMonth(parsed!.lines, targetYM) : null),
    [canCommit, parsed, targetYM],
  );
  const monthMismatch = monthCheck != null && !monthCheck.ok;

  // Cancel is the default action on a mismatch: focus it so Enter cancels.
  useEffect(() => {
    if (monthMismatch) cancelRef.current?.focus();
  }, [monthMismatch]);

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

        {monthMismatch && monthCheck && (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Wrong month?</AlertTitle>
            <AlertDescription>
              {monthCheck.clearMajority && monthCheck.dominant ? (
                <p>
                  This report's transactions are from{' '}
                  <strong>{formatYearMonth(monthCheck.dominant.yearMonth)}</strong>, but you're
                  uploading to the <strong>{formatYearMonth(monthCheck.target)}</strong> row.
                </p>
              ) : (
                <p>
                  No single month holds {Math.round(MONTH_MAJORITY * 100)}% of this report's
                  transactions, and you're uploading to the{' '}
                  <strong>{formatYearMonth(monthCheck.target)}</strong> row.
                </p>
              )}
              {(!monthCheck.clearMajority || monthCheck.breakdown.length > 1) && (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {monthCheck.breakdown.map((b) => (
                    <li key={b.yearMonth} className="tabular-nums">
                      {formatYearMonth(b.yearMonth)}: {b.count} line{b.count === 1 ? '' : 's'} ({Math.round(b.share * 100)}%)
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2">Nothing has been written. Cancel, or upload to this row anyway.</p>
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
          <Alert variant="success">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Imported</AlertTitle>
            <AlertDescription>{result}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button
            ref={cancelRef}
            variant={monthMismatch && !result ? 'default' : 'outline'}
            onClick={() => { onOpenChange(false); reset(); }}
            disabled={busy}
          >
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (monthMismatch ? (
            <Button variant="outline" onClick={() => commit(true)} disabled={busy}>
              {busy ? 'Importing…' : 'Upload anyway'}
            </Button>
          ) : (
            <Button onClick={() => commit()} disabled={!canCommit || busy}>
              {busy ? 'Importing…' : 'Import report'}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
