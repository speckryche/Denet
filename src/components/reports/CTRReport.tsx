import { useState, useEffect, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileWarning,
  Loader2,
  Shield,
} from 'lucide-react';

const CTR_THRESHOLD = 10001;

interface CTRItem {
  customer_id: string;
  customer_name: string;
  customer_address: string;
  trigger_date: string;
  total_amount: number;
  transaction_count: number;
  transactions: { id: string; sale: number; atm_name: string; atm_address: string; date: string }[];
  // Filing status from ctr_filings table
  filing_id: string | null;
  filed: boolean;
  filed_date: string | null;
  notes: string | null;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}/${year}`;
};

const getPacificDateString = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

export default function CTRReport() {
  const [items, setItems] = useState<CTRItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFiled, setShowFiled] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Filing dialog
  const [filingItem, setFilingItem] = useState<CTRItem | null>(null);
  const [filingDate, setFilingDate] = useState('');
  const [filingNotes, setFilingNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Calculate 3 months ago
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      const fromDate = threeMonthsAgo.toISOString().split('T')[0];

      // Fetch Denet transactions with customer data in the date range
      const { data: transactions, error: txError } = await supabase
        .from('transactions')
        .select('id, customer_id, customer_first_name, customer_last_name, customer_address, customer_city, customer_state, customer_zipcode, sale, date, atm_id, atm_name')
        .eq('platform', 'denet')
        .not('customer_id', 'is', null)
        .gte('date', fromDate)
        .order('date', { ascending: false });

      if (txError) throw txError;

      // Fetch ATM profiles for address lookup
      const { data: atmProfiles } = await supabase
        .from('atm_profiles')
        .select('atm_id, location_name, street_address, city, state, zip_code');

      const atmAddressMap = new Map<string, string>();
      atmProfiles?.forEach((atm: any) => {
        const parts = [atm.street_address, atm.city, atm.state, atm.zip_code].filter(Boolean);
        atmAddressMap.set(atm.atm_id, parts.join(', '));
      });

      // Fetch all CTR filings
      const { data: filings, error: filingsError } = await supabase
        .from('ctr_filings')
        .select('*');

      if (filingsError) throw filingsError;

      // Build filing lookup: key = "customer_id|trigger_date"
      const filingMap = new Map<string, any>();
      filings?.forEach((f: any) => {
        filingMap.set(`${f.customer_id}|${f.trigger_date}`, f);
      });

      // Group transactions by customer_id + date
      const grouped = new Map<string, {
        customer_id: string;
        customer_name: string;
        customer_address: string;
        trigger_date: string;
        total_amount: number;
        transactions: { id: string; sale: number; atm_name: string; atm_address: string; date: string }[];
      }>();

      transactions?.forEach((tx: any) => {
        if (!tx.customer_id) return;
        const dateOnly = tx.date?.split('T')[0] || tx.date;
        const key = `${tx.customer_id}|${dateOnly}`;
        const sale = parseFloat(tx.sale?.toString() || '0');
        const name = [tx.customer_first_name, tx.customer_last_name].filter(Boolean).join(' ') || 'Unknown';
        const custAddrParts = [tx.customer_address, tx.customer_city, tx.customer_state, tx.customer_zipcode].filter(Boolean);
        const custAddr = custAddrParts.join(', ');

        if (!grouped.has(key)) {
          grouped.set(key, {
            customer_id: tx.customer_id,
            customer_name: name,
            customer_address: custAddr,
            trigger_date: dateOnly,
            total_amount: 0,
            transactions: [],
          });
        }

        const entry = grouped.get(key)!;
        entry.total_amount += sale;
        entry.transactions.push({
          id: tx.id,
          sale,
          atm_name: tx.atm_name || 'Unknown',
          atm_address: atmAddressMap.get(tx.atm_id) || '',
          date: tx.date,
        });
      });

      // Filter to threshold and merge filing status
      const ctrItems: CTRItem[] = [];
      grouped.forEach((entry) => {
        if (entry.total_amount >= CTR_THRESHOLD) {
          const filing = filingMap.get(`${entry.customer_id}|${entry.trigger_date}`);
          ctrItems.push({
            ...entry,
            transaction_count: entry.transactions.length,
            filing_id: filing?.id || null,
            filed: filing?.filed || false,
            filed_date: filing?.filed_date || null,
            notes: filing?.notes || null,
          });
        }
      });

      // Sort by date descending, unfiled first
      ctrItems.sort((a, b) => {
        if (a.filed !== b.filed) return a.filed ? 1 : -1;
        return b.trigger_date.localeCompare(a.trigger_date);
      });

      setItems(ctrItems);
    } catch (error) {
      console.error('Error fetching CTR data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openFilingDialog = (item: CTRItem) => {
    setFilingItem(item);
    setFilingDate(getPacificDateString());
    setFilingNotes(item.notes || '');
  };

  const handleMarkFiled = async () => {
    if (!filingItem) return;
    setIsSaving(true);
    try {
      const payload = {
        customer_id: filingItem.customer_id,
        customer_name: filingItem.customer_name,
        trigger_date: filingItem.trigger_date,
        total_amount: filingItem.total_amount,
        transaction_count: filingItem.transaction_count,
        filed: true,
        filed_date: filingDate,
        notes: filingNotes || null,
        updated_at: new Date().toISOString(),
      };

      if (filingItem.filing_id) {
        await supabase
          .from('ctr_filings')
          .update(payload)
          .eq('id', filingItem.filing_id);
      } else {
        await supabase.from('ctr_filings').insert(payload);
      }

      setFilingItem(null);
      fetchData();
    } catch (error) {
      console.error('Error saving CTR filing:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnfile = async (item: CTRItem) => {
    if (!item.filing_id) return;
    try {
      await supabase
        .from('ctr_filings')
        .update({ filed: false, filed_date: null, updated_at: new Date().toISOString() })
        .eq('id', item.filing_id);
      fetchData();
    } catch (error) {
      console.error('Error unfiling CTR:', error);
    }
  };

  const unfiled = items.filter((i) => !i.filed);
  const filed = items.filter((i) => i.filed);
  const displayItems = showFiled ? items : unfiled;

  if (isLoading) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Scanning transactions for CTR requirements...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Banner */}
      <div className={cn(
        'flex items-center gap-4 p-4 rounded-lg border',
        unfiled.length > 0
          ? 'bg-red-500/[0.06] border-red-400/20'
          : 'bg-green-500/[0.06] border-green-400/20'
      )}>
        {unfiled.length > 0 ? (
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
        ) : (
          <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
        )}
        <div>
          <div className="font-semibold">
            {unfiled.length > 0
              ? `${unfiled.length} CTR filing${unfiled.length !== 1 ? 's' : ''} required`
              : 'All CTR filings are up to date'}
          </div>
          <div className="text-sm text-muted-foreground">
            Customers with ${CTR_THRESHOLD.toLocaleString()}+ in Denet transactions within a single day (last 3 months)
          </div>
        </div>
      </div>

      {/* Filter Toggle */}
      <div className="flex items-center gap-3">
        <Button
          variant={showFiled ? 'outline' : 'default'}
          size="sm"
          onClick={() => setShowFiled(false)}
        >
          <FileWarning className="w-4 h-4 mr-1.5" />
          Pending ({unfiled.length})
        </Button>
        <Button
          variant={showFiled ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowFiled(true)}
        >
          <Shield className="w-4 h-4 mr-1.5" />
          All ({items.length})
        </Button>
      </div>

      {/* CTR Table */}
      {displayItems.length === 0 ? (
        <Card className="bg-card/30 border-white/10">
          <CardContent className="py-12 text-center text-muted-foreground">
            {showFiled ? 'No CTR items found in the last 3 months.' : 'No pending CTR filings. You\'re all caught up!'}
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/30 border-white/10">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Customer ID</TableHead>
                  <TableHead>Customer Address</TableHead>
                  <TableHead className="text-right">Daily Total</TableHead>
                  <TableHead className="text-center"># Txns</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>Filed Date</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayItems.map((item) => {
                  const key = `${item.customer_id}|${item.trigger_date}`;
                  const isExpanded = expandedRows.has(key);
                  return (
                    <Fragment key={key}>
                      <TableRow
                        className={cn(
                          'cursor-pointer',
                          !item.filed && 'bg-red-500/[0.03]'
                        )}
                        onClick={() => toggleRow(key)}
                      >
                        <TableCell className="w-8 px-2">
                          {isExpanded
                            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        </TableCell>
                        <TableCell className="font-mono">{formatDate(item.trigger_date)}</TableCell>
                        <TableCell className="font-medium">{item.customer_name}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-sm">{item.customer_id}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{item.customer_address || '—'}</TableCell>
                        <TableCell className="text-right font-mono font-semibold text-red-400">
                          {formatCurrency(item.total_amount)}
                        </TableCell>
                        <TableCell className="text-center">{item.transaction_count}</TableCell>
                        <TableCell className="text-center">
                          {item.filed ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 border border-green-400/20 rounded-full px-2.5 py-0.5">
                              <CheckCircle2 className="w-3 h-3" />
                              Filed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-400/10 border border-red-400/20 rounded-full px-2.5 py-0.5">
                              <AlertTriangle className="w-3 h-3" />
                              Pending
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {item.filed_date ? formatDate(item.filed_date) : '—'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                          {item.notes || '—'}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          {item.filed ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-muted-foreground hover:text-foreground text-xs"
                              onClick={() => handleUnfile(item)}
                            >
                              Undo
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30"
                              onClick={() => openFilingDialog(item)}
                            >
                              Mark Filed
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={11} className="p-0">
                            <div className="bg-white/[0.02] border-t border-b border-white/[0.06] px-8 py-3">
                              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                                Transactions on {formatDate(item.trigger_date)}
                              </div>
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="text-xs text-muted-foreground">
                                    <th className="text-left py-1.5 pr-4">Transaction ID</th>
                                    <th className="text-left py-1.5 pr-4">ATM</th>
                                    <th className="text-left py-1.5 pr-4">ATM Address</th>
                                    <th className="text-right py-1.5">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.transactions.map((tx) => (
                                    <tr key={tx.id} className="border-t border-white/[0.04]">
                                      <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">{tx.id}</td>
                                      <td className="py-1.5 pr-4">{tx.atm_name}</td>
                                      <td className="py-1.5 pr-4 text-muted-foreground">{tx.atm_address || '—'}</td>
                                      <td className="py-1.5 text-right font-mono">{formatCurrency(tx.sale)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Mark as Filed Dialog */}
      <Dialog open={!!filingItem} onOpenChange={(open) => !open && setFilingItem(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Mark CTR as Filed</DialogTitle>
            <DialogDescription>
              {filingItem && (
                <>
                  <span className="font-medium text-foreground">{filingItem.customer_name}</span>
                  {' — '}
                  {formatCurrency(filingItem.total_amount)} on {formatDate(filingItem.trigger_date)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="filed-date">Date Filed</Label>
              <Input
                id="filed-date"
                type="date"
                value={filingDate}
                onChange={(e) => setFilingDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="filing-notes">Notes</Label>
              <Textarea
                id="filing-notes"
                value={filingNotes}
                onChange={(e) => setFilingNotes(e.target.value)}
                placeholder="Filing reference number, details..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFilingItem(null)}>
              Cancel
            </Button>
            <Button onClick={handleMarkFiled} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Filed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
