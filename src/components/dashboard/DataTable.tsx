import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Search, ChevronLeft, ChevronRight, SlidersHorizontal, FileX } from "lucide-react";
import { formatStatusLabel, statusBadgeClass } from "@/lib/transaction-status";
import { countsFinancialTx } from "@/lib/refund-overrides";
import { useRefundedIds } from "@/lib/refund-overrides-data";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDisplayDate } from '@/lib/format';

interface DataTableProps {
  data: any[];
  columns: string[];
  // Optional panel title and extra controls rendered in the panel header.
  title?: string;
  toolbar?: React.ReactNode;
}

// Display labels for known transaction columns. Unknown columns fall back to
// the raw key. CSV export keeps the raw keys so downstream files don't change.
const COLUMN_LABELS: Record<string, string> = {
  id: 'ID',
  platform: 'Platform',
  customer_id: 'Customer ID',
  customer_first_name: 'First name',
  customer_last_name: 'Last name',
  customer_city: 'City',
  customer_state: 'State',
  atm_id: 'ATM',
  atm_name: 'ATM name',
  location_name: 'Location',
  ticker: 'Asset',
  sale: 'Sale',
  fee: 'Fee',
  sent: 'Sent',
  bitstop_fee: 'Bitstop fee',
  date: 'Date',
  status: 'Status',
};

const NUMERIC_COLUMNS = ['sale', 'fee', 'sent', 'bitstop_fee'];

const columnLabel = (col: string) => COLUMN_LABELS[col] ?? col;

// Relative column widths for the fixed-layout table. Visible columns share
// 100% of the panel width in proportion to these weights, so all 17 default
// columns fit a laptop without horizontal scroll; long values truncate with a
// tooltip. Unknown columns get the default weight.
const COLUMN_WEIGHTS: Record<string, number> = {
  id: 6, platform: 6.5, customer_id: 6.5, customer_first_name: 5.5, customer_last_name: 5.5,
  customer_city: 6, customer_state: 4, atm_id: 5, atm_name: 7.5, location_name: 8.5,
  ticker: 4.5, sale: 7, fee: 6, sent: 7, bitstop_fee: 6, date: 8, status: 8.5,
};
const DEFAULT_COLUMN_WEIGHT = 6;
const columnWeight = (col: string) => COLUMN_WEIGHTS[col] ?? DEFAULT_COLUMN_WEIGHT;

export function DataTable({ data = [], columns = [], title, toolbar }: DataTableProps) {
  const refundedIds = useRefundedIds();
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 50;

  // Initialize visible columns when columns prop changes
  React.useEffect(() => {
    if (columns.length > 0) {
      const hiddenByDefault = ['id', 'customer_id', 'customer_first_name', 'customer_last_name', 'customer_city', 'customer_state', 'atm_name'];
      const initialVisibility = columns.reduce((acc, col) => ({
        ...acc,
        [col]: !hiddenByDefault.includes(col)
      }), {});
      setVisibleColumns(initialVisibility);
    }
  }, [columns]);

  const toggleColumn = (column: string) => {
    setVisibleColumns(prev => ({ ...prev, [column]: !prev[column] }));
  };

  // Export data to CSV
  const exportToCSV = () => {
    if (filteredData.length === 0) {
      alert('No data to export');
      return;
    }

    // Get visible columns only
    const visibleCols = columns.filter(col => visibleColumns[col] !== false);

    // Create CSV header
    const header = visibleCols.join(',');

    // Create CSV rows
    const rows = filteredData.map(row => {
      return visibleCols.map(col => {
        let value = row[col];

        // Format date for export
        if (col === 'date' && value) {
          try {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const year = date.getFullYear();
              value = `${month}/${day}/${year}`;
            }
          } catch (e) {
            // Keep original value
          }
        }

        // Format numeric columns with 2 decimals
        if (['fee', 'sent', 'bitstop_fee', 'sale'].includes(col) && value != null && value !== '') {
          const numValue = typeof value === 'number' ? value : parseFloat(value);
          if (!isNaN(numValue)) {
            value = numValue.toFixed(2);
          }
        }

        // Handle null/undefined values
        if (value == null) return '';

        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        const stringValue = value.toString();
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',');
    });

    // Combine header and rows
    const csv = [header, ...rows].join('\n');

    // Create blob and download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    // Generate filename with current date
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const filename = `transactions-export-${dateStr}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter data based on search query
  const filteredData = React.useMemo(() => {
    if (!searchQuery.trim()) return data;

    const lowerQuery = searchQuery.toLowerCase();
    return data.filter((row) => {
      // Search across all columns
      return columns.some((col) => {
        const value = row[col];
        if (value == null) return false;
        return value.toString().toLowerCase().includes(lowerQuery);
      });
    });
  }, [data, searchQuery, columns]);

  // Reset to page 1 when search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredData.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const paginatedData = filteredData.slice(startIndex, endIndex);

  const handlePreviousPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
  };

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 border border-dashed border-border rounded-[14px] bg-card">
        <FileX className="w-10 h-10 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground">No Data Available</h3>
        <p className="text-sm text-muted-foreground">Upload a CSV file to view transactions</p>
      </div>
    );
  }

  const visibleCount = columns.filter((col) => visibleColumns[col]).length;
  const totalWeight = columns
    .filter((col) => visibleColumns[col])
    .reduce((sum, col) => sum + columnWeight(col), 0) || 1;

  return (
    <section className="min-w-0 overflow-hidden rounded-[14px] border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[18px] py-3.5">
        {title && (
          <h2 className="text-[15px] font-semibold tracking-tight text-card-foreground">{title}</h2>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {toolbar}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
            <Input
              placeholder="Search transactions…"
              aria-label="Search transactions"
              className="h-[34px] w-[180px] xl:w-[220px] dark:bg-background pl-8 text-[13px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="h-[34px] bg-card">
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Columns
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Customize Columns</SheetTitle>
                <SheetDescription>
                  Select the columns you want to display in the table.
                </SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 py-4">
                {columns.map((col) => (
                  <div key={col} className="flex items-center space-x-2">
                    <Checkbox
                      id={col}
                      checked={visibleColumns[col] ?? true}
                      onCheckedChange={() => toggleColumn(col)}
                    />
                    <Label htmlFor={col}>{columnLabel(col)}</Label>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>

          <Button variant="outline" size="sm" className="h-[34px] bg-card" onClick={exportToCSV}>
            Export
          </Button>
        </div>
      </div>

      {/* table-fixed + weighted % widths; wrapper scroll is only a fallback. */}
      <Table className="table-fixed max-md:min-w-[900px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((col) => (
              visibleColumns[col] && (
                <TableHead
                  key={col}
                  title={columnLabel(col)}
                  style={{ width: `${(columnWeight(col) / totalWeight) * 100}%` }}
                  className={cn(
                    "h-auto px-1.5 py-2 xl:px-3 text-[10px] xl:text-[11px] font-semibold uppercase tracking-[0.04em] xl:tracking-[0.06em] text-table-header-fg leading-tight whitespace-normal [overflow-wrap:anywhere]",
                    NUMERIC_COLUMNS.includes(col) && "text-right"
                  )}
                >
                  {columnLabel(col)}
                </TableHead>
              )
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {paginatedData.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={visibleCount || columns.length} className="h-24 text-center text-muted-foreground">
                {searchQuery ? 'No results found for your search.' : 'No records found.'}
              </TableCell>
            </TableRow>
          ) : (
            paginatedData.map((row, i) => {
              // Non-completed rows (financial surface — transaction-status.ts)
              // are shown greyed/tagged but excluded from the Overview metrics.
              // Rows without a status field are never muted (keeps DataTable
              // generic for any future non-transaction use).
              const muted = !countsFinancialTx(row, refundedIds);
              return (
              <TableRow
                key={i}
                className={cn(
                  "border-border transition-colors hover:bg-surface-2",
                  muted && "bg-surface-2/50 text-dim"
                )}
              >
                {columns.map((col) => {
                  // Status column: render a tag instead of the raw value.
                  if (col === 'status') {
                    return visibleColumns[col] && (
                      <TableCell key={`${i}-${col}`} className="px-1.5 py-2.5 xl:px-3">
                        <span
                          title={formatStatusLabel(row.status) || undefined}
                          className={cn(
                          "inline-flex h-[22px] max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full px-2 text-[11.5px] font-semibold",
                          statusBadgeClass(row.status)
                        )}>
                          {formatStatusLabel(row.status) || '—'}
                        </span>
                      </TableCell>
                    );
                  }

                  // Format date for date column
                  let cellValue = row[col];
                  if (col === 'date' && cellValue) {
                    cellValue = formatDisplayDate(String(cellValue));
                  }

                  // Ledger money: $ prefix, cents, tabular mono in the cell class.
                  const isNumeric = NUMERIC_COLUMNS.includes(col);
                  if (isNumeric && cellValue != null && cellValue !== '') {
                    const numValue = typeof cellValue === 'number' ? cellValue : parseFloat(cellValue);
                    if (!isNaN(numValue)) {
                      cellValue = formatCurrency(numValue, 2);
                    }
                  }

                  return visibleColumns[col] && (
                    <TableCell
                      key={`${i}-${col}`}
                      title={cellValue != null && cellValue !== '' ? String(cellValue) : undefined}
                      className={cn(
                        "truncate px-1.5 py-2.5 xl:px-3 text-xs xl:text-[13px] tabular-nums",
                        isNumeric && "font-mono",
                        isNumeric && "text-right",
                        (col === 'date' || col === 'fee' || col === 'bitstop_fee') && !muted && "text-muted-foreground",
                        col === 'platform' && "capitalize"
                      )}
                    >
                      {cellValue}
                    </TableCell>
                  );
                })}
              </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-[18px] py-3">
        <div className="text-xs text-muted-foreground tabular-nums">
          Showing {filteredData.length === 0 ? 0 : startIndex + 1} to {Math.min(endIndex, filteredData.length)} of {filteredData.length} results
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground tabular-nums">
            Page {currentPage} of {totalPages || 1}
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={handlePreviousPage}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={handleNextPage}
              disabled={currentPage === totalPages || totalPages === 0}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
