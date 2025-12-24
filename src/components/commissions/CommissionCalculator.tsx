import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import * as XLSX from 'xlsx-js-style';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowLeft, Calculator, CheckCircle, AlertCircle, Eye, Download, Trash2, ChevronDown, ChevronRight, FileSpreadsheet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface Commission {
  id: string;
  sales_rep_id: string;
  month_year: string;
  total_sales: number;
  total_fees: number;
  bitstop_fees: number;
  rent: number;
  mgmt_rps: number;
  mgmt_rep: number;
  total_net_profit: number;
  commission_amount: number;
  flat_fee_amount: number;
  total_commission: number;
  atm_count: number;
  paid: boolean;
  paid_date: string | null;
  notes: string | null;
  sales_rep?: {
    name: string;
    email: string;
  };
}

interface CommissionDetail {
  id: string;
  commission_id: string;
  atm_id: string;
  total_sales: number;
  total_fees: number;
  bitstop_fees: number;
  rent: number;
  cash_fee: number;
  cash_management_rps: number;
  cash_management_rep: number;
  net_profit: number;
  commission_amount: number;
}

export default function CommissionCalculator() {
  const navigate = useNavigate();
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedCommission, setSelectedCommission] = useState<Commission | null>(null);
  const [commissionDetails, setCommissionDetails] = useState<CommissionDetail[]>([]);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());

  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  const years = Array.from({ length: 5 }, (_, i) => {
    const year = new Date().getFullYear() - i;
    return year.toString();
  });

  const fetchCommissions = async () => {
    try {
      setIsLoading(true);
      const { data, error: err } = await supabase
        .from('commissions')
        .select(`
          *,
          sales_rep:sales_rep_id(name, email)
        `)
        .order('month_year', { ascending: false });

      if (err) throw err;
      setCommissions(data || []);
    } catch (err) {
      console.error('Error fetching commissions:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch commissions');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCommissions();
  }, []);

  // Auto-expand current year when commissions are loaded
  useEffect(() => {
    if (commissions.length > 0 && expandedYears.size === 0) {
      const currentYear = new Date().getFullYear();
      setExpandedYears(new Set([currentYear]));
    }
  }, [commissions]);

  const toggleYear = (year: number) => {
    setExpandedYears(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(year)) {
        newExpanded.delete(year);
      } else {
        newExpanded.add(year);
      }
      return newExpanded;
    });
  };

  const handleCalculateCommissions = async () => {
    if (!selectedMonth || !selectedYear) {
      setError('Please select both month and year');
      return;
    }

    try {
      setIsCalculating(true);
      setError(null);
      setSuccessMessage(null);

      const response = await supabase.functions.invoke('calculate-commissions', {
        body: {
          month: selectedMonth,
          year: parseInt(selectedYear),
        },
      });

      if (response.error) throw response.error;

      setSuccessMessage(
        `Commissions calculated successfully! ${response.data.commissionsCreated} commission records created.`
      );
      fetchCommissions();
      setSelectedMonth('');
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error('Error calculating commissions:', err);
      setError(err instanceof Error ? err.message : 'Failed to calculate commissions');
    } finally {
      setIsCalculating(false);
    }
  };

  const handleViewDetails = async (commission: Commission) => {
    try {
      const { data, error: err } = await supabase
        .from('commission_details')
        .select('*')
        .eq('commission_id', commission.id);

      if (err) throw err;
      setCommissionDetails(data || []);
      setSelectedCommission(commission);
      setShowDetailModal(true);
    } catch (err) {
      console.error('Error fetching commission details:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch details');
    }
  };

  const handleMarkAsPaid = async (commissionId: string) => {
    try {
      const { error: err } = await supabase
        .from('commissions')
        .update({
          paid: true,
          paid_date: new Date().toISOString(),
        })
        .eq('id', commissionId);

      if (err) throw err;
      setSuccessMessage('Commission marked as paid');
      fetchCommissions();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error updating commission:', err);
      setError(err instanceof Error ? err.message : 'Failed to update commission');
    }
  };

  const handleMarkAsUnpaid = async (commissionId: string) => {
    try {
      const { error: err } = await supabase
        .from('commissions')
        .update({
          paid: false,
          paid_date: null,
        })
        .eq('id', commissionId);

      if (err) throw err;
      setSuccessMessage('Commission marked as unpaid');
      fetchCommissions();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error updating commission:', err);
      setError(err instanceof Error ? err.message : 'Failed to update commission');
    }
  };

  const handleDeleteCommission = async (commissionId: string) => {
    if (!confirm('Are you sure you want to delete this commission record? This will also delete all associated commission details.')) {
      return;
    }

    try {
      // First delete all commission_details associated with this commission
      const { error: detailsError } = await supabase
        .from('commission_details')
        .delete()
        .eq('commission_id', commissionId);

      if (detailsError) throw detailsError;

      // Then delete the commission record itself
      const { error: commissionError } = await supabase
        .from('commissions')
        .delete()
        .eq('id', commissionId);

      if (commissionError) throw commissionError;

      setSuccessMessage('Commission record deleted successfully');
      fetchCommissions();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error deleting commission:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete commission');
    }
  };

  const handleExportTransactionDetails = async (commission: Commission) => {
    try {
      // Parse month and year from commission
      const [year, month] = commission.month_year.split('-');
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);

      // Fetch the sales rep's ATM assignments
      const { data: atmAssignments, error: atmError } = await supabase
        .from('atm_profiles')
        .select('atm_id')
        .eq('sales_rep_id', commission.sales_rep_id);

      if (atmError) throw atmError;

      const atmIds = atmAssignments?.map(a => a.atm_id) || [];

      if (atmIds.length === 0) {
        setError('No ATMs assigned to this sales rep');
        return;
      }

      // Fetch all transactions for this sales rep's ATMs in the given month
      const { data: transactions, error: txError } = await supabase
        .from('transactions')
        .select('id, date, atm_id, atm_name, customer_first_name, customer_last_name, ticker, sale, fee, platform')
        .in('atm_id', atmIds)
        .gte('date', startDate.toISOString())
        .lte('date', endDate.toISOString())
        .order('date', { ascending: true });

      if (txError) throw txError;

      if (!transactions || transactions.length === 0) {
        setError('No transactions found for this period');
        return;
      }

      // Fetch ticker mappings to get fee percentages
      const { data: tickerMappings } = await supabase
        .from('ticker_mappings')
        .select('original_value, display_value, fee_percentage');

      const tickerFeeMap = new Map(
        (tickerMappings || []).map(t => [
          t.display_value || t.original_value,
          t.fee_percentage || 0
        ])
      );

      // Build CSV content
      const headers = [
        'Transaction ID',
        'Date',
        'ATM ID',
        'ATM Name',
        'Customer First Name',
        'Customer Last Name',
        'Ticker',
        'Sale Amount',
        'Fee Percentage',
        'Fee Amount',
        'Platform'
      ];

      const rows = transactions.map(tx => {
        const feePercentage = tickerFeeMap.get(tx.ticker || '') || 0;
        const feePercentageDisplay = (feePercentage * 100).toFixed(2) + '%';

        return [
          tx.id || '',
          tx.date ? new Date(tx.date).toLocaleDateString('en-US') : '',
          tx.atm_id || '',
          tx.atm_name || '',
          tx.customer_first_name || '',
          tx.customer_last_name || '',
          tx.ticker || '',
          tx.sale ? tx.sale.toFixed(2) : '0.00',
          feePercentageDisplay,
          tx.fee ? tx.fee.toFixed(2) : '0.00',
          tx.platform || ''
        ];
      });

      // Convert to CSV string
      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      // Create and download the file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const monthStr = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '-');
      const filename = `commission-transactions-${commission.sales_rep?.name}-${monthStr}.csv`;

      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setSuccessMessage(`Transaction details exported: ${transactions.length} transactions`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error exporting transaction details:', err);
      setError(err instanceof Error ? err.message : 'Failed to export transaction details');
    }
  };

  const handleExportCSV = async (commission: Commission) => {
    // Fetch commission details and ATM profiles
    const [detailsResult, atmProfilesResult] = await Promise.all([
      supabase
        .from('commission_details')
        .select('*')
        .eq('commission_id', commission.id),
      supabase
        .from('atm_profiles')
        .select('atm_id, location_name')
    ]);

    if (detailsResult.error) {
      console.error('Error fetching commission details:', detailsResult.error);
      setError('Failed to fetch commission details for export');
      return;
    }

    // Create a map of ATM IDs to location names
    const atmNamesMap = new Map(
      (atmProfilesResult.data || []).map(profile => [profile.atm_id, profile.location_name || ''])
    );

    // Sort details by ATM ID numerically
    const sortedDetails = (detailsResult.data || []).sort((a, b) => {
      const aNum = parseInt(a.atm_id) || 0;
      const bNum = parseInt(b.atm_id) || 0;
      return aNum - bNum;
    });

    // Parse month for display
    const [year, month] = commission.month_year.split('-');
    const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    const monthStr = monthDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });

    // Create title and summary section
    const title = `Denet Commissions - ${monthStr}`;
    const summaryHeaders = [
      'Sales Rep',
      'Month',
      'Total Sales',
      'Total Fees',
      'Bitstop Fees',
      'Rent',
      'Mgmt - RPS',
      'Mgmt - Rep',
      'Net Profit',
      'Commissions',
      'Flat Fee',
      'Total',
      'ATMs'
    ];

    const summaryRow = [
      commission.sales_rep?.name || 'Unknown',
      monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      Math.round(commission.total_sales),
      Math.round(commission.total_fees),
      Math.round(commission.bitstop_fees),
      Math.round(commission.rent),
      Math.round(commission.mgmt_rps),
      Math.round(commission.mgmt_rep),
      Math.round(commission.total_net_profit),
      Math.round(commission.commission_amount),
      Math.round(commission.flat_fee_amount),
      Math.round(commission.total_commission),
      commission.atm_count
    ];

    // Create details section
    const detailsTitle = 'Commission Details by ATM';
    const detailsHeaders = [
      'ATM ID',
      'ATM Name',
      'Total Sales',
      'Total Fees',
      'Bitstop Fees',
      'Rent',
      'Mgmt - RPS',
      'Mgmt - Rep',
      'Net Profit'
    ];

    const detailsRows = sortedDetails.map(detail => [
      detail.atm_id,
      atmNamesMap.get(detail.atm_id) || '',
      Math.round(detail.total_sales || 0),
      Math.round(detail.total_fees),
      Math.round(detail.bitstop_fees),
      Math.round(detail.rent),
      Math.round(detail.cash_management_rps || 0),
      Math.round(detail.cash_management_rep || 0),
      Math.round(detail.net_profit)
    ]);

    // Build worksheet data
    const sheetData = [
      [title],           // Row 1: Title
      [],                // Row 2: Empty
      summaryHeaders,    // Row 3: Summary headers
      summaryRow,        // Row 4: Summary data
      [],                // Row 5: Empty separator
      [],                // Row 6: Empty separator
      [detailsTitle],    // Row 7: Details title
      [],                // Row 8: Empty
      detailsHeaders,    // Row 9: Details headers
      ...detailsRows     // Row 10+: Details data
    ];

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Merge cells for titles
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }, // Main title (A1:M1) - 13 columns
      { s: { r: 6, c: 0 }, e: { r: 6, c: 9 } }   // Details title (A7:J7) - 10 columns
    ];

    // Set column widths
    ws['!cols'] = [
      { wch: 15 }, // Column A - ATM ID / Sales Rep
      { wch: 20 }, // Column B - ATM Name / Month (wider for location names)
      { wch: 12 }, // Column C
      { wch: 12 }, // Column D
      { wch: 12 }, // Column E
      { wch: 12 }, // Column F
      { wch: 12 }, // Column G
      { wch: 12 }, // Column H
      { wch: 12 }, // Column I
      { wch: 12 }, // Column J
      { wch: 12 }, // Column K
      { wch: 12 }, // Column L
      { wch: 12 }, // Column M - ATMs
    ];

    // Style the main title (row 1)
    if (ws['A1']) {
      ws['A1'].s = {
        font: { bold: true, sz: 14 },
        alignment: { horizontal: 'center', vertical: 'center' }
      };
    }

    // Style summary header row (row 3) - bold, grey fill, centered, size 12
    const summaryHeaderCols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
    summaryHeaderCols.forEach(col => {
      const cellRef = `${col}3`;
      if (ws[cellRef]) {
        ws[cellRef].s = {
          font: { bold: true, sz: 12 },
          fill: { fgColor: { rgb: 'D3D3D3' } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } }
          }
        };
      }
    });

    // Style summary data row (row 4) - size 12
    summaryHeaderCols.forEach((col) => {
      const cellRef = `${col}4`;
      if (ws[cellRef]) {
        const alignment = col === 'A' ? 'left' : 'center';
        const baseStyle = {
          font: { sz: 12 },
          alignment: { horizontal: alignment, vertical: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } }
          }
        };

        // Add yellow highlight to Total column (L)
        if (col === 'L') {
          baseStyle.fill = { fgColor: { rgb: 'FFFF00' } };
        }

        ws[cellRef].s = baseStyle;

        // Format currency columns including Total (L)
        if (['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].includes(col)) {
          ws[cellRef].z = '$#,##0';
        }
      }
    });

    // Style details title (row 7)
    if (ws['A7']) {
      ws['A7'].s = {
        font: { bold: true, sz: 14 },
        alignment: { horizontal: 'center', vertical: 'center' }
      };
    }

    // Style details header row (row 9) - bold, grey fill, centered, size 12
    const detailsHeaderCols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    detailsHeaderCols.forEach(col => {
      const cellRef = `${col}9`;
      if (ws[cellRef]) {
        ws[cellRef].s = {
          font: { bold: true, sz: 12 },
          fill: { fgColor: { rgb: 'D3D3D3' } },
          alignment: { horizontal: 'center', vertical: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } }
          }
        };
      }
    });

    // Style details data rows (row 10+) - size 12
    sortedDetails.forEach((detail, idx) => {
      const rowNum = 10 + idx;
      detailsHeaderCols.forEach((col) => {
        const cellRef = `${col}${rowNum}`;
        if (ws[cellRef]) {
          // ATM ID (A) and ATM Name (B) left-aligned, others centered
          const alignment = ['A', 'B'].includes(col) ? 'left' : 'center';
          ws[cellRef].s = {
            font: { sz: 12 },
            alignment: { horizontal: alignment, vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: '000000' } },
              bottom: { style: 'thin', color: { rgb: '000000' } },
              left: { style: 'thin', color: { rgb: '000000' } },
              right: { style: 'thin', color: { rgb: '000000' } }
            }
          };
          // Format numeric columns (C-J) with currency (skip A=ATM ID, B=ATM Name)
          if (['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].includes(col)) {
            ws[cellRef].z = '$#,##0';
          }
        }
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Commission');

    // Generate Excel file and download
    const shortMonth = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).replace(' ', '-');
    XLSX.writeFile(wb, `commission-${commission.sales_rep?.name}-${shortMonth}.xlsx`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="max-w-[95%] mx-auto px-6 py-8">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <header className="border-b border-white/10 bg-background/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[95%] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="font-display font-bold text-xl tracking-tight">Commission Calculator</h1>
          </div>
        </div>
      </header>

      <main className="max-w-[95%] mx-auto px-6 py-8 space-y-6">
        {successMessage && (
          <Alert className="bg-green-500/10 border-green-500/20 text-green-500">
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert className="bg-red-500/10 border-red-500/20 text-red-500">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="w-5 h-5" />
              Calculate Monthly Commissions
            </CardTitle>
            <CardDescription>
              Select a month and year to calculate commissions for all sales reps
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 items-end">
              <div className="space-y-2">
                <label className="text-sm font-medium">Month</label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select month" />
                  </SelectTrigger>
                  <SelectContent>
                    {months.map((month) => (
                      <SelectItem key={month.value} value={month.value}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Year</label>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {years.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleCalculateCommissions} disabled={isCalculating}>
                <Calculator className="w-4 h-4 mr-2" />
                {isCalculating ? 'Calculating...' : 'Calculate'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Commission Records</CardTitle>
            <CardDescription>
              View and manage calculated commissions for all sales representatives
            </CardDescription>
          </CardHeader>
          <CardContent>
            {commissions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No commission records yet. Calculate commissions to get started.</p>
              </div>
            ) : (() => {
              // Group commissions by year
              const commissionsByYear = commissions.reduce((acc, commission) => {
                const year = parseInt(commission.month_year.split('-')[0]);
                if (!acc[year]) {
                  acc[year] = [];
                }
                acc[year].push(commission);
                return acc;
              }, {} as Record<number, Commission[]>);

              const years = Object.keys(commissionsByYear).map(Number).sort((a, b) => b - a);

              return (
                <div className="space-y-4">
                  {years.map(year => {
                    const yearCommissions = commissionsByYear[year];
                    const isExpanded = expandedYears.has(year);

                    // Calculate year totals
                    const totalCommissionAmount = yearCommissions.reduce((sum, c) => sum + (c.total_commission || 0), 0);
                    const totalRecords = yearCommissions.length;

                    return (
                      <div key={year} className="rounded-md border border-white/10 overflow-hidden">
                        {/* Year Header */}
                        <div
                          className="flex items-center justify-between p-4 bg-slate-700/40 cursor-pointer hover:bg-slate-600/50 transition-colors"
                          onClick={() => toggleYear(year)}
                        >
                          <div className="flex items-center gap-4">
                            {isExpanded ? (
                              <ChevronDown className="w-5 h-5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-5 h-5 text-muted-foreground" />
                            )}
                            <span className="font-semibold text-xl">{year}</span>
                            <span className="text-sm text-muted-foreground">
                              ({totalRecords} record{totalRecords !== 1 ? 's' : ''})
                            </span>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">Total Commissions</div>
                              <div className="text-lg font-mono font-semibold text-green-500">
                                ${Math.round(totalCommissionAmount).toLocaleString('en-US')}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Year Content - Table */}
                        {isExpanded && (
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader className="bg-white/5">
                                <TableRow className="border-white/10">
                                  <TableHead>Sales Rep</TableHead>
                                  <TableHead>Month</TableHead>
                                  <TableHead className="text-right">Total Sales</TableHead>
                                  <TableHead className="text-right">Total Fees</TableHead>
                                  <TableHead className="text-right">Bitstop Fees</TableHead>
                                  <TableHead className="text-right">Rent</TableHead>
                                  <TableHead className="text-right">Mgmt - RPS</TableHead>
                                  <TableHead className="text-right">Mgmt - Rep</TableHead>
                                  <TableHead className="text-right">Net Profit</TableHead>
                                  <TableHead className="text-right">Commissions</TableHead>
                                  <TableHead className="text-right">Flat Fee</TableHead>
                                  <TableHead className="text-right">Total</TableHead>
                                  <TableHead className="text-center">ATMs</TableHead>
                                  <TableHead>Status</TableHead>
                                  <TableHead className="w-[200px]">Actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {yearCommissions.map((commission) => {
                                  // Parse YYYY-MM-DD without timezone conversion
                                  const [year, month] = commission.month_year.split('-');
                                  const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
                                  const monthStr = monthDate.toLocaleDateString('en-US', {
                                    month: 'short',
                                    year: 'numeric',
                                  });

                                  return (
                                    <TableRow key={commission.id} className="border-white/5">
                                      <TableCell className="font-medium">
                                        {commission.sales_rep?.name || 'Unknown'}
                                      </TableCell>
                                      <TableCell>{monthStr}</TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${Math.round(commission.total_sales).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${Math.round(commission.total_fees).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${Math.round(commission.bitstop_fees).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${Math.round(commission.rent).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${Math.round(commission.mgmt_rps).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${Math.round(commission.mgmt_rep).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${Math.round(commission.total_net_profit).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${Math.round(commission.commission_amount).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono">
                                        ${Math.round(commission.flat_fee_amount).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-right font-mono font-semibold">
                                        ${Math.round(commission.total_commission).toLocaleString('en-US')}
                                      </TableCell>
                                      <TableCell className="text-center">{commission.atm_count}</TableCell>
                                      <TableCell>
                                        <Badge variant={commission.paid ? 'default' : 'secondary'}>
                                          {commission.paid ? 'Paid' : 'Unpaid'}
                                        </Badge>
                                      </TableCell>
                                      <TableCell>
                                        <div className="flex gap-2">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleViewDetails(commission)}
                                            title="View Summary"
                                          >
                                            <Eye className="w-4 h-4" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleExportTransactionDetails(commission)}
                                            title="Download Transaction Details"
                                          >
                                            <FileSpreadsheet className="w-4 h-4" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleExportCSV(commission)}
                                            title="Download Commission Summary"
                                          >
                                            <Download className="w-4 h-4" />
                                          </Button>
                                          {commission.paid ? (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleMarkAsUnpaid(commission.id)}
                                              className="text-yellow-500 hover:text-yellow-400"
                                            >
                                              Mark Unpaid
                                            </Button>
                                          ) : (
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              onClick={() => handleMarkAsPaid(commission.id)}
                                              className="text-green-500 hover:text-green-400"
                                            >
                                              Mark Paid
                                            </Button>
                                          )}
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDeleteCommission(commission.id)}
                                            className="text-red-500 hover:text-red-400"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </Button>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </main>

      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Commission Details - {selectedCommission?.sales_rep?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedCommission && (() => {
                const [year, month] = selectedCommission.month_year.split('-');
                const date = new Date(parseInt(year), parseInt(month) - 1, 1);
                return date.toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                });
              })()}
            </DialogDescription>
          </DialogHeader>

          {commissionDetails.length > 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white/5 p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Net Profit</p>
                  <p className="text-2xl font-mono font-bold">
                    ${Math.round(selectedCommission?.total_net_profit || 0).toLocaleString('en-US')}
                  </p>
                </div>
                <div className="bg-white/5 p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">Commission Amount</p>
                  <p className="text-2xl font-mono font-bold">
                    ${Math.round(selectedCommission?.commission_amount || 0).toLocaleString('en-US')}
                  </p>
                </div>
                <div className="bg-white/5 p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">Total Owed</p>
                  <p className="text-2xl font-mono font-bold text-primary">
                    ${Math.round(selectedCommission?.total_commission || 0).toLocaleString('en-US')}
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-white/10 overflow-x-auto">
                <Table>
                  <TableHeader className="bg-white/5">
                    <TableRow className="border-white/10">
                      <TableHead>ATM ID</TableHead>
                      <TableHead className="text-right">Total Sales</TableHead>
                      <TableHead className="text-right">Total Fees</TableHead>
                      <TableHead className="text-right">Rent</TableHead>
                      <TableHead className="text-right">Mgmt - RPS</TableHead>
                      <TableHead className="text-right">Mgmt - Rep</TableHead>
                      <TableHead className="text-right">Net Profit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commissionDetails.map((detail) => (
                      <TableRow key={detail.id} className="border-white/5">
                        <TableCell className="font-mono">{detail.atm_id}</TableCell>
                        <TableCell className="text-right font-mono">
                          ${Math.round(detail.total_sales).toLocaleString('en-US')}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${Math.round(detail.total_fees).toLocaleString('en-US')}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${Math.round(detail.rent).toLocaleString('en-US')}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${Math.round(detail.cash_management_rps).toLocaleString('en-US')}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${Math.round(detail.cash_management_rep).toLocaleString('en-US')}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${Math.round(detail.net_profit).toLocaleString('en-US')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => selectedCommission && handleExportTransactionDetails(selectedCommission)}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Download Transaction Details
            </Button>
            <Button variant="outline" onClick={() => setShowDetailModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
