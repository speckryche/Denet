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

  // Initialize visible columns when columns prop changes
  React.useEffect(() => {
    if (columns.length > 0) {
      const initialVisibility = columns.reduce((acc, col) => ({
        ...acc,
        [col]: true
      }), {});
      setVisibleColumns(initialVisibility);
    }
  }, [columns]);

  const toggleColumn = (column: string) => {
    setVisibleColumns(prev => ({ ...prev, [column]: !prev[column] }));
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
            <Input placeholder="Search transactions..." className="pl-8 bg-card border-white/10" />
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
          
          <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5">
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
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No records found.
                </TableCell>
              </TableRow>
            ) : (
              data.map((row, i) => (
                <TableRow key={i} className="border-white/5 hover:bg-white/5 transition-colors">
                  {columns.map((col) => (
                    visibleColumns[col] && (
                      <TableCell key={`${i}-${col}`} className="font-mono text-xs">
                        {row[col]}
                      </TableCell>
                    )
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-end space-x-2">
        <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5" disabled>
          <ChevronLeft className="h-4 w-4" />
          Previous
        </Button>
        <Button variant="outline" size="sm" className="border-white/10 hover:bg-white/5">
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
