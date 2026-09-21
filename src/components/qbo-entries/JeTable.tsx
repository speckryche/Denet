// A journal entry rendered the way QBO shows one: Account / Debit / Credit /
// Description, with the JE date and the month text above it. Every amount has a
// copy button, plus a copy-all for each column, so the numbers can be typed
// into QBO without re-reading them.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Check, Copy } from 'lucide-react';
import { fmtAmount } from '@/lib/qbo/money';
import type { Je } from '@/lib/qbo/types';

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard can be blocked; fall back to a hidden textarea + execCommand.
      const el = document.createElement('textarea');
      el.value = value;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      try {
        document.execCommand('copy');
      } catch {
        /* nothing more we can do — the value stays visible for manual copying */
      }
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={`Copy ${label || value}`}
      aria-label={`Copy ${label || value}`}
      className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground align-middle"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export function JeTable({ je, title }: { je: Je; title: string }) {
  const columnValues = (side: 'debit' | 'credit') =>
    je.lines.map((l) => (l[side] === 0 ? '' : fmtAmount(l[side]))).join('\n');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <div className="text-sm text-muted-foreground flex items-center gap-4">
          <span>
            JE date: <span className="font-mono text-foreground">{je.date}</span>
            <CopyButton value={je.date} label="journal entry date" />
          </span>
          <span>
            Month: <span className="text-foreground">{je.monthText}</span>
            <CopyButton value={je.monthText} label="month text" />
          </span>
        </div>
      </div>

      <div className="rounded-md border border-white/10 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-white/10 hover:bg-transparent">
              <TableHead className="font-bold text-foreground">Account</TableHead>
              <TableHead className="font-bold text-foreground text-right w-[180px]">
                Debit
                <CopyButton value={columnValues('debit')} label="all debit amounts" />
              </TableHead>
              <TableHead className="font-bold text-foreground text-right w-[180px]">
                Credit
                <CopyButton value={columnValues('credit')} label="all credit amounts" />
              </TableHead>
              <TableHead className="font-bold text-foreground">Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {je.lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  Nothing to post for this month.
                </TableCell>
              </TableRow>
            ) : (
              je.lines.map((line, idx) => (
                <TableRow key={`${line.account}-${idx}`} className="border-white/5">
                  <TableCell className="font-medium">{line.account}</TableCell>
                  <TableCell className="text-right font-mono">
                    {line.debit === 0 ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      <>
                        {fmtAmount(line.debit)}
                        <CopyButton value={fmtAmount(line.debit)} />
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {line.credit === 0 ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      <>
                        {fmtAmount(line.credit)}
                        <CopyButton value={fmtAmount(line.credit)} />
                      </>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{line.description}</TableCell>
                </TableRow>
              ))
            )}

            <TableRow className="border-t-2 border-white/20 font-bold hover:bg-transparent">
              <TableCell>Total</TableCell>
              <TableCell className="text-right font-mono">{fmtAmount(je.totalDebits)}</TableCell>
              <TableCell className="text-right font-mono">{fmtAmount(je.totalCredits)}</TableCell>
              <TableCell
                className={
                  je.totalDebits === je.totalCredits ? 'text-green-500' : 'text-red-500'
                }
              >
                {je.totalDebits === je.totalCredits ? 'Balanced' : 'Out of balance'}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
