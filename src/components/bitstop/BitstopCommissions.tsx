import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Save, Plus, Trash2, TrendingUp, ChevronDown, ChevronRight, Upload, ClipboardList } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import ReportUploadDialog from './ReportUploadDialog';
import AuditItemsDialog from './AuditItemsDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { PageHeader } from '@/components/layout/PageHeader';

interface BitstopCommission {
  id: string;
  month: string;
  year: number;
  received_report: boolean;
  total_sales: number;
  commission_amount: number;
  commission_percent: number;
  paid: boolean;
  date_paid: string | null;
  amount_received: number | null;
  notes: string | null;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const MONTH_ORDER: { [key: string]: number } = {
  'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
  'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
};

export default function BitstopCommissions() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';
  const [records, setRecords] = useState<BitstopCommission[]>([]);
  // Open-audit counts per month row, for the badge in the Audit column.
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});
  const [uploadFor, setUploadFor] = useState<BitstopCommission | null>(null);
  const [auditFor, setAuditFor] = useState<BitstopCommission | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('bitstop_commissions')
        .select('*')
        .order('year', { ascending: false });

      if (error) throw error;

      // Open-audit counts drive the per-month badge. Fetched as one pass over
      // open items rather than a count per row, so the page still makes two
      // queries no matter how many months exist.
      const { data: openItems, error: itemsError } = await supabase
        .from('bitstop_audit_items')
        .select('commission_id')
        .eq('status', 'open');
      if (itemsError) {
        // A badge failing to load must not blank the page it sits on.
        console.error('Error fetching audit item counts:', itemsError);
        setOpenCounts({});
      } else {
        const counts: Record<string, number> = {};
        (openItems || []).forEach((r: any) => {
          counts[r.commission_id] = (counts[r.commission_id] || 0) + 1;
        });
        setOpenCounts(counts);
      }

      // Sort by year (desc) then by month (desc)
      const sorted = (data || []).sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return MONTH_ORDER[b.month] - MONTH_ORDER[a.month];
      });

      setRecords(sorted);
    } catch (err) {
      console.error('Error fetching commission data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Auto-expand current year when records are loaded
  useEffect(() => {
    if (records.length > 0 && expandedYears.size === 0) {
      const currentYear = new Date().getFullYear();
      setExpandedYears(new Set([currentYear]));
    }
  }, [records]);

  const handleFieldChange = (id: string, field: keyof BitstopCommission, value: any) => {
    setRecords(prev =>
      prev.map(record => {
        if (record.id === id) {
          const updated = { ...record, [field]: value };

          // Auto-calculate commission percentage
          if (field === 'total_sales' || field === 'commission_amount') {
            const sales = field === 'total_sales' ? value : record.total_sales;
            const commission = field === 'commission_amount' ? value : record.commission_amount;

            if (sales > 0 && commission > 0) {
              updated.commission_percent = (commission / sales) * 100;
            } else {
              updated.commission_percent = 0;
            }
          }

          return updated;
        }
        return record;
      })
    );
  };

  const handleAddRecord = async () => {
    try {
      const currentDate = new Date();
      const currentMonth = MONTHS[currentDate.getMonth()];
      const currentYear = currentDate.getFullYear();

      const newRecord = {
        month: currentMonth,
        year: currentYear,
        received_report: false,
        total_sales: 0,
        commission_amount: 0,
        commission_percent: 0,
        paid: false,
        date_paid: null,
        notes: null
      };

      const { data, error } = await supabase
        .from('bitstop_commissions')
        .insert([newRecord])
        .select()
        .single();

      if (error) throw error;

      setSuccessMessage('Record added successfully!');
      fetchData();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error adding record:', err);
      setError(err instanceof Error ? err.message : 'Failed to add record');
    }
  };

  const handleDeleteRecord = async (id: string) => {
    if (!confirm('Are you sure you want to delete this commission record?')) return;

    try {
      const { error } = await supabase
        .from('bitstop_commissions')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setSuccessMessage('Record deleted successfully!');
      fetchData();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error deleting record:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete record');
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      const updates = records.map(record => ({
        id: record.id,
        month: record.month,
        year: record.year,
        received_report: record.received_report,
        total_sales: record.total_sales,
        commission_amount: record.commission_amount,
        commission_percent: record.commission_percent,
        paid: record.paid,
        date_paid: record.date_paid,
        amount_received: record.amount_received,
        notes: record.notes,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('bitstop_commissions')
        .upsert(updates);

      if (error) throw error;

      setSuccessMessage('Commission records saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
      await fetchData();
    } catch (err: any) {
      console.error('Error saving records:', err);
      const errorMessage = err?.message || 'Failed to save records';
      setError(`Error: ${errorMessage}`);
    } finally {
      setIsSaving(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader title="Bitstop Commission Tracking" />

      <div className="max-w-[95%] mx-auto px-6 py-8">
        <Card className="bg-card/30 border-white/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  Monthly Commission Records
                </CardTitle>
                <CardDescription>
                  Track commission reports and payments from Bitstop
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {successMessage && (
              <Alert className="mb-4 bg-green-500/10 border-green-500/20 text-green-500">
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
            )}

            {error && (
              <Alert className="mb-4 bg-red-500/10 border-red-500/20 text-red-500">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Year Sections with Collapsible Tables */}
            {!isLoading && records.length > 0 && (() => {
              // Group records by year
              const recordsByYear = records.reduce((acc, record) => {
                if (!acc[record.year]) {
                  acc[record.year] = [];
                }
                acc[record.year].push(record);
                return acc;
              }, {} as Record<number, BitstopCommission[]>);

              const years = Object.keys(recordsByYear).map(Number).sort((a, b) => b - a);

              return (
                <div className="space-y-4">
                  {years.map(year => {
                    const yearRecords = recordsByYear[year];
                    const isExpanded = expandedYears.has(year);

                    // Calculate year totals
                    const totalSales = yearRecords.reduce((sum, r) => sum + (r.total_sales || 0), 0);
                    const totalCommissions = yearRecords.reduce((sum, r) => sum + (r.commission_amount || 0), 0);
                    const commissionPercent = totalSales > 0 ? (totalCommissions / totalSales) * 100 : 0;

                    return (
                      <div key={year} className="rounded-md border border-white/10 overflow-hidden">
                        {/* Year Header with Summary */}
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
                              ({yearRecords.length} month{yearRecords.length !== 1 ? 's' : ''})
                            </span>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">Total Sales</div>
                              <div className="text-lg font-mono font-semibold text-primary">
                                ${Math.round(totalSales).toLocaleString('en-US')}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">Commissions</div>
                              <div className="text-lg font-mono font-semibold text-green-500">
                                ${Math.round(totalCommissions).toLocaleString('en-US')}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-muted-foreground">Comm %</div>
                              <div className="text-lg font-mono font-semibold text-blue-400">
                                {commissionPercent.toFixed(2)}%
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
                                  <TableHead className="min-w-[100px]">Month</TableHead>
                                  <TableHead className="min-w-[80px]">Year</TableHead>
                                  <TableHead className="min-w-[140px]">Received Comm Report</TableHead>
                                  <TableHead className="min-w-[120px]">Total Sales</TableHead>
                                  <TableHead className="min-w-[120px]">Commissions</TableHead>
                                  <TableHead className="min-w-[100px]">Comm %</TableHead>
                                  <TableHead className="min-w-[100px]">Paid</TableHead>
                                  <TableHead className="min-w-[120px]">Date Paid</TableHead>
                                  <TableHead className="min-w-[130px]">Amount Received</TableHead>
                                  <TableHead className="min-w-[110px]">Audit</TableHead>
                                  <TableHead className="min-w-[200px]">Notes</TableHead>
                                  <TableHead className="min-w-[120px]">Actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {yearRecords.map((record) => (
                                  <TableRow key={record.id} className="border-white/5">
                        <TableCell>
                          <Select
                            value={record.month}
                            onValueChange={(value) => handleFieldChange(record.id, 'month', value)}
                          >
                            <SelectTrigger className="bg-card border-white/10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MONTHS.map(month => (
                                <SelectItem key={month} value={month}>{month}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={record.year}
                            onChange={(e) => handleFieldChange(record.id, 'year', parseInt(e.target.value) || 2025)}
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={record.received_report ? 'yes' : 'no'}
                            onValueChange={(value) => handleFieldChange(record.id, 'received_report', value === 'yes')}
                          >
                            <SelectTrigger className={`bg-card border-white/10 ${
                              record.received_report ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'
                            }`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="yes">Yes</SelectItem>
                              <SelectItem value="no">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="text"
                            value={record.total_sales > 0 ? `$${Math.round(record.total_sales).toLocaleString('en-US')}` : ''}
                            onChange={(e) => {
                              const numericValue = e.target.value.replace(/[^0-9]/g, '');
                              handleFieldChange(record.id, 'total_sales', numericValue ? parseFloat(numericValue) : 0);
                            }}
                            placeholder="$0"
                            className="bg-card border-white/10 font-mono text-right"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="text"
                            value={record.commission_amount > 0 ? `$${Math.round(record.commission_amount).toLocaleString('en-US')}` : ''}
                            onChange={(e) => {
                              const numericValue = e.target.value.replace(/[^0-9]/g, '');
                              handleFieldChange(record.id, 'commission_amount', numericValue ? parseFloat(numericValue) : 0);
                            }}
                            placeholder="$0"
                            className="bg-card border-white/10 font-mono text-right"
                          />
                        </TableCell>
                        <TableCell className="font-mono">
                          {record.commission_percent > 0
                            ? `${record.commission_percent.toFixed(2)}%`
                            : '-'
                          }
                        </TableCell>
                        <TableCell>
                          <Select
                            value={record.paid ? 'yes' : 'no'}
                            onValueChange={(value) => handleFieldChange(record.id, 'paid', value === 'yes')}
                          >
                            <SelectTrigger className={`bg-card border-white/10 ${
                              record.paid ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'
                            }`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="yes">Yes</SelectItem>
                              <SelectItem value="no">No</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={record.date_paid || ''}
                            onChange={(e) => handleFieldChange(record.id, 'date_paid', e.target.value || null)}
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={record.amount_received ?? ''}
                            onChange={(e) =>
                              handleFieldChange(
                                record.id,
                                'amount_received',
                                e.target.value === '' ? null : parseFloat(e.target.value),
                              )
                            }
                            placeholder="—"
                            className="bg-card border-white/10"
                          />
                          {/* Report total vs what Bitstop actually deposited. Part 2
                              subtracts expected clawbacks from the expected figure. */}
                          {record.amount_received != null &&
                            record.commission_amount != null &&
                            Math.abs(record.amount_received - record.commission_amount) > 0.01 && (
                              <div className="text-xs text-amber-400 mt-1">
                                {record.amount_received > record.commission_amount ? '+' : ''}
                                {(record.amount_received - record.commission_amount).toLocaleString('en-US', {
                                  style: 'currency', currency: 'USD',
                                })}{' '}vs report
                              </div>
                            )}
                        </TableCell>
                        <TableCell>
                          {openCounts[record.id] > 0 ? (
                            <Badge
                              className="bg-red-500/15 text-red-400 border-red-500/30 cursor-pointer"
                              onClick={() => setAuditFor(record)}
                            >
                              {openCounts[record.id]} open
                            </Badge>
                          ) : record.received_report ? (
                            <span className="text-xs text-green-400">clear</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Textarea
                            value={record.notes || ''}
                            onChange={(e) => handleFieldChange(record.id, 'notes', e.target.value || null)}
                            placeholder="Notes..."
                            className="bg-card border-white/10 min-w-[200px]"
                            rows={2}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setUploadFor(record)}
                                title="Upload Bitstop report (.xlsx)"
                                className="text-secondary hover:text-secondary/80"
                              >
                                <Upload className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setAuditFor(record)}
                              title="View audit results"
                            >
                              <ClipboardList className="w-4 h-4" />
                            </Button>
                            {isAdmin && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteRecord(record.id)}
                                className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                                    </TableCell>
                                  </TableRow>
                                ))}
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

            <div className="flex justify-between items-center mt-6 mb-4">
              <div className="text-sm text-muted-foreground">
                <p><strong>Schedule:</strong> Commission report by 10th of month, payment by 15th</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddRecord}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Month
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isSaving}>
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>

            {isLoading && (
              <div className="text-center py-8 text-muted-foreground">
                Loading...
              </div>
            )}

            {!isLoading && records.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p>No commission records yet. Click "Add Month" to get started.</p>
              </div>
            )}

            <div className="mt-4 text-sm text-muted-foreground">
              <p><strong>How it works:</strong></p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Add a new month record using "Add Month" button</li>
                <li>Mark "Received Comm Report" as Yes when Bitstop sends the report (usually by 10th)</li>
                <li>Enter Total Sales and Commissions $ from the report - Comm % will auto-calculate</li>
                <li>Mark "Paid" as Yes and enter Date Paid when commission is received (usually by 15th)</li>
                <li>Add notes for any special circumstances or details</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
      <ReportUploadDialog
        monthRow={uploadFor as any}
        open={uploadFor !== null}
        onOpenChange={(o) => { if (!o) setUploadFor(null); }}
        onImported={fetchData}
      />
      <AuditItemsDialog
        monthRow={auditFor as any}
        open={auditFor !== null}
        onOpenChange={(o) => { if (!o) setAuditFor(null); }}
        onChanged={fetchData}
      />

    </div>
  );
}
