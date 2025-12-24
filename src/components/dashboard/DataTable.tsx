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

interface DataTableProps {
  data: any[];
  columns: string[];
}

export function DataTable({ data = [], columns = [] }: DataTableProps) {
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
      <div className="flex flex-col items-center justify-center h-64 border border-dashed border-white/10 rounded-lg bg-card/20">
        <FileX className="w-10 h-10 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium text-foreground">No Data Available</h3>
        <p className="text-sm text-muted-foreground">Upload a CSV file to view transactions</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 w-full max-w-sm">
          <div className="relative w-full">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search transactions..."
              className="pl-8 bg-card border-white/10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5">
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Filter Columns
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
                    <Label htmlFor={col} className="capitalize">{col}</Label>
                  </div>
                ))}
              </div>
            </SheetContent>
          </Sheet>
          
          <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5" onClick={exportToCSV}>
            Export
          </Button>
        </div>
      </div>
      
      <div className="rounded-md border border-white/10 bg-card/50 overflow-hidden">
        <Table>
          <TableHeader className="bg-white/5">
            <TableRow className="border-white/10 hover:bg-transparent">
              {columns.map((col) => (
                visibleColumns[col] && (
                  <TableHead key={col} className="text-muted-foreground font-display whitespace-nowrap">
                    {col}
                  </TableHead>
                )
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {searchQuery ? 'No results found for your search.' : 'No records found.'}
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, i) => (
                <TableRow key={i} className="border-white/5 hover:bg-white/5 transition-colors">
                  {columns.map((col) => {
                    // Format date for date column
                    let cellValue = row[col];
                    if (col === 'date' && cellValue) {
                      try {
                        const date = new Date(cellValue);
                        if (!isNaN(date.getTime())) {
                          const month = String(date.getMonth() + 1).padStart(2, '0');
                          const day = String(date.getDate()).padStart(2, '0');
                          const year = date.getFullYear();
                          cellValue = `${month}/${day}/${year}`;
                        }
                      } catch (e) {
                        // If date parsing fails, keep original value
                      }
                    }

                    // Format numeric columns with 2 decimal places and commas
                    if (['sale', 'fee', 'sent', 'bitstop_fee'].includes(col) && cellValue != null && cellValue !== '') {
                      const numValue = typeof cellValue === 'number' ? cellValue : parseFloat(cellValue);
                      if (!isNaN(numValue)) {
                        cellValue = numValue.toLocaleString('en-US', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        });
                      }
                    }

                    return visibleColumns[col] && (
                      <TableCell key={`${i}-${col}`} className="font-mono text-xs">
                        {cellValue}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing {filteredData.length === 0 ? 0 : startIndex + 1} to {Math.min(endIndex, filteredData.length)} of {filteredData.length} results
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages || 1}
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 hover:bg-white/5"
              onClick={handlePreviousPage}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-white/10 hover:bg-white/5"
              onClick={handleNextPage}
              disabled={currentPage === totalPages || totalPages === 0}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
