import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';

export interface TransactionRow {
  id: string;
  date: string;
  atm_id: string;
  atm_name: string;
  platform: string;
  customer_first_name: string;
  customer_last_name: string;
  ticker: string;
  sale: number;
  fee: number;
  bitstop_fee: number;
}

export type TransactionsSortField = keyof TransactionRow;

interface OverrideMonthRange {
  startYear: number;
  startMonth: string;
  endYear: number;
  endMonth: string;
}

interface TransactionsTableProps {
  rows: TransactionRow[];
  sortField: TransactionsSortField;
  sortDirection: 'asc' | 'desc';
  onSortChange: (field: TransactionsSortField) => void;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Optional fee-override map keyed by `${atm_id}:${YYYY-MM}` — produces an asterisked, override-adjusted Fee total in the footer. */
  feeOverrides?: Map<string, number>;
  /** Required when feeOverrides is set; defines the month span the overrides cover. */
  overrideMonthRange?: OverrideMonthRange;
}

export function sortTransactionRows(
  rows: TransactionRow[],
  field: TransactionsSortField,
  direction: 'asc' | 'desc',
): TransactionRow[] {
  return [...rows].sort((a, b) => {
    const aValue = a[field];
    const bValue = b[field];

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return direction === 'asc'
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    }
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return direction === 'asc' ? aValue - bValue : bValue - aValue;
    }
    return 0;
  });
}

export function formatTransactionDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${month}/${day}/${year}`;
}

function computeAdjustedFeeTotal(
  rows: TransactionRow[],
  feeOverrides: Map<string, number> | undefined,
  overrideMonthRange: OverrideMonthRange | undefined,
): { fee: number; hasOverrides: boolean } {
  const rawFeeTotal = rows.reduce((sum, r) => sum + r.fee, 0);

  if (!feeOverrides || feeOverrides.size === 0 || !overrideMonthRange) {
    return { fee: rawFeeTotal, hasOverrides: false };
  }

  let nonBitstopFees = 0;
  const feesByAtmMonth = new Map<string, Map<string, number>>();

  rows.forEach((row) => {
    if (row.platform !== 'bitstop') {
      nonBitstopFees += row.fee;
      return;
    }
    if (!row.date) return;
    const [y, m] = row.date.split('-');
    const ym = `${y}-${m}`;
    if (!feesByAtmMonth.has(row.atm_id)) feesByAtmMonth.set(row.atm_id, new Map());
    const monthMap = feesByAtmMonth.get(row.atm_id)!;
    monthMap.set(ym, (monthMap.get(ym) || 0) + row.fee);
  });

  const startMonthNum = parseInt(overrideMonthRange.startMonth);
  const endMonthNum = parseInt(overrideMonthRange.endMonth);
  const { startYear, endYear } = overrideMonthRange;
  let bitstopFees = 0;
  let hasOverrides = false;

  feesByAtmMonth.forEach((monthFees, atmId) => {
    for (let y = startYear; y <= endYear; y++) {
      const mStart = y === startYear ? startMonthNum : 1;
      const mEnd = y === endYear ? endMonthNum : 12;
      for (let m = mStart; m <= mEnd; m++) {
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        const key = `${atmId}:${ym}`;
        if (feeOverrides.has(key)) {
          bitstopFees += feeOverrides.get(key)!;
          hasOverrides = true;
        } else {
          bitstopFees += monthFees.get(ym) || 0;
        }
      }
    }
  });

  return { fee: nonBitstopFees + bitstopFees, hasOverrides };
}

export default function TransactionsTable({
  rows,
  sortField,
  sortDirection,
  onSortChange,
  isLoading = false,
  emptyMessage = 'No transactions found',
  feeOverrides,
  overrideMonthRange,
}: TransactionsTableProps) {
  const totals = rows.reduce(
    (acc, row) => ({
      sale: acc.sale + row.sale,
      fee: acc.fee + row.fee,
      bitstop_fee: acc.bitstop_fee + row.bitstop_fee,
    }),
    { sale: 0, fee: 0, bitstop_fee: 0 },
  );

  const adjustedFeeTotals = computeAdjustedFeeTotal(rows, feeOverrides, overrideMonthRange);

  const SortButton = ({
    field,
    label,
    align,
  }: {
    field: TransactionsSortField;
    label: string;
    align?: 'right';
  }) => (
    <button
      onClick={() => onSortChange(field)}
      className={`flex items-center gap-1 hover:text-foreground/80 ${align === 'right' ? 'ml-auto' : ''}`}
    >
      {label}
      {sortField === field ? (
        sortDirection === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />
      ) : (
        <ArrowUpDown className="w-4 h-4 opacity-50" />
      )}
    </button>
  );

  return (
    <div className="rounded-md border border-white/10 overflow-x-auto">
      <Table>
        <TableHeader className="bg-white/5">
          <TableRow className="border-white/10">
            <TableHead className="font-bold"><SortButton field="date" label="Date" /></TableHead>
            <TableHead className="font-bold"><SortButton field="atm_id" label="ATM ID" /></TableHead>
            <TableHead className="font-bold"><SortButton field="atm_name" label="ATM Name" /></TableHead>
            <TableHead className="font-bold"><SortButton field="platform" label="Platform" /></TableHead>
            <TableHead className="font-bold"><SortButton field="customer_last_name" label="Customer" /></TableHead>
            <TableHead className="font-bold"><SortButton field="ticker" label="Ticker" /></TableHead>
            <TableHead className="text-right font-bold"><SortButton field="sale" label="Sale" align="right" /></TableHead>
            <TableHead className="text-right font-bold"><SortButton field="fee" label="Fee" align="right" /></TableHead>
            <TableHead className="text-right font-bold"><SortButton field="bitstop_fee" label="Bitstop Fee" align="right" /></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                Loading...
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            <>
              {rows.map((row, idx) => (
                <TableRow key={row.id || idx} className="border-white/5">
                  <TableCell>{formatTransactionDate(row.date)}</TableCell>
                  <TableCell className="font-medium">{row.atm_id}</TableCell>
                  <TableCell>{row.atm_name}</TableCell>
                  <TableCell>
                    <span className={`px-2 py-1 rounded text-xs ${
                      row.platform === 'bitstop'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-green-500/20 text-green-300'
                    }`}>
                      {row.platform === 'bitstop' ? 'Bitstop' : 'Denet'}
                    </span>
                  </TableCell>
                  <TableCell>{row.customer_first_name} {row.customer_last_name}</TableCell>
                  <TableCell>{row.ticker}</TableCell>
                  <TableCell className="text-right font-mono">
                    ${Math.round(row.sale).toLocaleString('en-US')}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${Math.round(row.fee).toLocaleString('en-US')}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    ${Math.round(row.bitstop_fee).toLocaleString('en-US')}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-white/10 bg-white/5 font-bold">
                <TableCell colSpan={6}>
                  TOTAL ({rows.length.toLocaleString('en-US')} transactions)
                </TableCell>
                <TableCell className="text-right font-mono">
                  ${Math.round(totals.sale).toLocaleString('en-US')}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {adjustedFeeTotals.hasOverrides ? (
                    <span title="Adjusted with Bitstop fee overrides">
                      ${Math.round(adjustedFeeTotals.fee).toLocaleString('en-US')} *
                    </span>
                  ) : (
                    <>${Math.round(totals.fee).toLocaleString('en-US')}</>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">
                  ${Math.round(totals.bitstop_fee).toLocaleString('en-US')}
                </TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
      {adjustedFeeTotals.hasOverrides && (
        <p className="text-xs text-yellow-400/70 mt-2">
          * Fee total adjusted with Bitstop actual fee overrides. Individual transaction fees shown are calculated estimates.
        </p>
      )}
    </div>
  );
}
