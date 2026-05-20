import { useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import TransactionsTable, {
  TransactionRow,
  TransactionsSortField,
  sortTransactionRows,
  formatTransactionDate,
} from './TransactionsTable';

interface ATMSalesDrillDownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  machineName: string;
  atmId: string;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD */
  endDate: string;
  transactions: TransactionRow[];
  /** Optional platform label to disambiguate the drill-down for converted ATMs */
  platformLabel?: string | null;
}

function sanitizeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]+/g, '_').replace(/^_+|_+$/g, '');
}

export default function ATMSalesDrillDown({
  open,
  onOpenChange,
  machineName,
  atmId,
  startDate,
  endDate,
  transactions,
  platformLabel,
}: ATMSalesDrillDownProps) {
  const [sortField, setSortField] = useState<TransactionsSortField>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const sortedRows = useMemo(
    () => sortTransactionRows(transactions, sortField, sortDirection),
    [transactions, sortField, sortDirection],
  );

  const handleSort = (field: TransactionsSortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleExportCSV = () => {
    const totals = sortedRows.reduce(
      (acc, row) => ({
        sale: acc.sale + row.sale,
        fee: acc.fee + row.fee,
        bitstop_fee: acc.bitstop_fee + row.bitstop_fee,
      }),
      { sale: 0, fee: 0, bitstop_fee: 0 },
    );

    const headers = ['Date', 'ATM ID', 'ATM Name', 'Platform', 'Customer', 'Ticker', 'Sale', 'Fee', 'Bitstop Fee'];
    const rows = sortedRows.map(row => [
      formatTransactionDate(row.date),
      row.atm_id,
      row.atm_name,
      row.platform === 'bitstop' ? 'Bitstop' : 'Denet',
      `${row.customer_first_name} ${row.customer_last_name}`.trim(),
      row.ticker,
      Math.round(row.sale),
      Math.round(row.fee),
      Math.round(row.bitstop_fee),
    ]);
    rows.push([
      'TOTAL', '', '', '', '', '',
      Math.round(totals.sale),
      Math.round(totals.fee),
      Math.round(totals.bitstop_fee),
    ]);

    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFilenamePart(machineName)}_Sales_${startDate}_to_${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-5xl overflow-y-auto"
      >
        <SheetHeader className="pr-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <SheetTitle>
                {machineName}{atmId ? ` (${atmId})` : ''}{platformLabel ? ` — ${platformLabel}` : ''} — Sales Transactions: {startDate} to {endDate}
              </SheetTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {sortedRows.length.toLocaleString('en-US')} transaction{sortedRows.length === 1 ? '' : 's'}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              disabled={sortedRows.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </SheetHeader>

        <div className="mt-6">
          <TransactionsTable
            rows={sortedRows}
            sortField={sortField}
            sortDirection={sortDirection}
            onSortChange={handleSort}
            emptyMessage="No transactions in this period"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
