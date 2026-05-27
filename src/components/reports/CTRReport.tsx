import { useState, useEffect, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  X,
} from 'lucide-react';
import { CTR_THRESHOLD, findCtrQualifyingGroups } from '@/lib/ctr';
import { useToast } from '@/components/ui/use-toast';

type CategoryFilter = 'current' | 'historical' | 'all';

interface CTRItem {
  id: string;
  customer_id: string;
  customer_name: string;
  trigger_date: string;
  total_amount: number;
  transaction_count: number;
  filed: boolean;
  filed_date: string | null;
  notes: string | null;
  category: 'current' | 'historical';
  wont_file_reason: string | null;
}

interface ExpansionData {
  customer_address: string;
  transactions: { id: string; sale: number; atm_name: string; atm_address: string; date: string }[];
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

// Add one day to an ISO date string, returning an ISO date string. UTC math.
const addOneDay = (isoDate: string): string => {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
};

export default function CTRReport() {
  const [items, setItems] = useState<CTRItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showFiled, setShowFiled] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('current');
  const [nameSearch, setNameSearch] = useState('');
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [expansionCache, setExpansionCache] = useState<Map<string, ExpansionData>>(new Map());
  const [loadingExpansion, setLoadingExpansion] = useState<Set<string>>(new Set());
  const [atmAddressMap, setAtmAddressMap] = useState<Map<string, string>>(new Map());

  // Unified Edit dialog state
  const [editingItem, setEditingItem] = useState<CTRItem | null>(null);
  const [editFiled, setEditFiled] = useState(false);
  const [editFiledDate, setEditFiledDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editWontFileReason, setEditWontFileReason] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data: atmProfiles } = await supabase
        .from('atm_profiles')
        .select('atm_id, street_address, city, state, zip_code');
      const addrMap = new Map<string, string>();
      atmProfiles?.forEach((atm: any) => {
        const parts = [atm.street_address, atm.city, atm.state, atm.zip_code].filter(Boolean);
        addrMap.set(atm.atm_id, parts.join(', '));
      });
      setAtmAddressMap(addrMap);

      // Sync-on-view: insert any newly qualifying days from the rolling 3-month window
      // that aren't yet in ctr_filings.
      await syncCurrentWindow();

      // Authoritative read from ctr_filings
      const { data: filings, error } = await supabase
        .from('ctr_filings')
        .select('*')
        .order('trigger_date', { ascending: false });

      if (error) throw error;

      const ctrItems: CTRItem[] = (filings || []).map((f: any) => ({
        id: f.id,
        customer_id: f.customer_id,
        customer_name: f.customer_name,
        trigger_date: f.trigger_date,
        total_amount: parseFloat(f.total_amount?.toString() || '0'),
        transaction_count: f.transaction_count,
        filed: f.filed,
        filed_date: f.filed_date,
        notes: f.notes,
        category: f.category,
        wont_file_reason: f.wont_file_reason,
      }));
      setItems(ctrItems);
    } catch (error) {
      console.error('Error fetching CTR data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Detect newly qualifying customer-days within the rolling 3-month window
  // and insert them as 'current'. Idempotent via the (customer_id, trigger_date) unique key.
  const syncCurrentWindow = async () => {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const fromDate = threeMonthsAgo.toISOString().split('T')[0];

    const groups = await findCtrQualifyingGroups({ fromDate });
    if (groups.length === 0) return;

    const { data: existing } = await supabase
      .from('ctr_filings')
      .select('customer_id, trigger_date')
      .gte('trigger_date', fromDate);

    const existingKeys = new Set(
      (existing || []).map((f: any) => `${f.customer_id}|${f.trigger_date}`),
    );
    const newGroups = groups.filter(
      (g) => !existingKeys.has(`${g.customer_id}|${g.trigger_date}`),
    );
    if (newGroups.length === 0) return;

    const newRows = newGroups.map((g) => ({
      customer_id: g.customer_id,
      customer_name: g.customer_name,
      trigger_date: g.trigger_date,
      total_amount: g.total_amount,
      transaction_count: g.transaction_count,
      filed: false,
      category: 'current',
    }));

    const { error } = await supabase
      .from('ctr_filings')
      .upsert(newRows, { onConflict: 'customer_id,trigger_date', ignoreDuplicates: true });
    if (error) console.error('Error syncing current CTR entries:', error);
  };

  // Lazy-load per-tx details + customer address when a row is expanded.
  const loadExpansion = async (item: CTRItem) => {
    const key = `${item.customer_id}|${item.trigger_date}`;
    if (expansionCache.has(key) || loadingExpansion.has(key)) return;

    setLoadingExpansion((prev) => new Set(prev).add(key));
    try {
      const dayStart = item.trigger_date;
      const nextDayStr = addOneDay(item.trigger_date);

      const { data: txs } = await supabase
        .from('transactions')
        .select(
          'id, customer_address, customer_city, customer_state, customer_zipcode, sale, date, atm_id, atm_name',
        )
        .eq('platform', 'denet')
        .eq('customer_id', item.customer_id)
        .gte('date', dayStart)
        .lt('date', nextDayStr)
        .order('date', { ascending: false });

      const firstTx = (txs || [])[0];
      const custAddrParts = firstTx
        ? [
            firstTx.customer_address,
            firstTx.customer_city,
            firstTx.customer_state,
            firstTx.customer_zipcode,
          ].filter(Boolean)
        : [];

      const expansion: ExpansionData = {
        customer_address: custAddrParts.join(', '),
        transactions: (txs || []).map((tx: any) => ({
          id: tx.id,
          sale: parseFloat(tx.sale?.toString() || '0'),
          atm_name: tx.atm_name || 'Unknown',
          atm_address: atmAddressMap.get(tx.atm_id) || '',
          date: tx.date,
        })),
      };
      setExpansionCache((prev) => new Map(prev).set(key, expansion));
    } catch (error) {
      console.error('Error loading row expansion:', error);
    } finally {
      setLoadingExpansion((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const toggleRow = (item: CTRItem) => {
    const key = `${item.customer_id}|${item.trigger_date}`;
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        void loadExpansion(item);
      }
      return next;
    });
  };

  const openEditDialog = (item: CTRItem) => {
    setEditingItem(item);
    setEditFiled(item.filed);
    setEditFiledDate(item.filed_date || getPacificDateString());
    setEditNotes(item.notes || '');
    setEditWontFileReason(item.wont_file_reason || '');
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;
    setIsSaving(true);
    try {
      const payload = {
        filed: editFiled,
        filed_date: editFiled ? editFiledDate : null,
        notes: editNotes.trim() || null,
        wont_file_reason: editWontFileReason.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from('ctr_filings')
        .update(payload)
        .eq('id', editingItem.id);
      if (error) throw error;
      setEditingItem(null);
      await fetchData();
    } catch (error) {
      console.error('Error saving CTR filing:', error);
    } finally {
      setIsSaving(false);
    }
  };

  // Quick toggle of filed status without opening the dialog. Optimistic UI:
  // mutate local state first, revert on failure. Notes and wont_file_reason
  // are intentionally not touched.
  const handleQuickToggle = async (item: CTRItem) => {
    if (togglingIds.has(item.id)) return;

    const nextFiled = !item.filed;
    const nextFiledDate = nextFiled ? getPacificDateString() : null;
    const prevFiled = item.filed;
    const prevFiledDate = item.filed_date;

    setTogglingIds((prev) => new Set(prev).add(item.id));
    setItems((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, filed: nextFiled, filed_date: nextFiledDate } : i,
      ),
    );

    try {
      const { error } = await supabase
        .from('ctr_filings')
        .update({
          filed: nextFiled,
          filed_date: nextFiledDate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id);
      if (error) throw error;
    } catch (error) {
      console.error('Error toggling CTR filed status:', error);
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, filed: prevFiled, filed_date: prevFiledDate } : i,
        ),
      );
      toast({
        title: 'Error',
        description: `Failed to ${nextFiled ? 'mark filed' : 'unmark'}. Please try again.`,
        variant: 'destructive',
      });
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  // Filtering: category → name-search → filed-status
  const categoryFiltered = items.filter(
    (i) => categoryFilter === 'all' || i.category === categoryFilter,
  );
  const searchedItems = nameSearch.trim()
    ? categoryFiltered.filter((i) =>
        i.customer_name.toLowerCase().includes(nameSearch.trim().toLowerCase()),
      )
    : categoryFiltered;
  const unfiled = searchedItems.filter((i) => !i.filed);
  const displayItems = showFiled ? searchedItems : unfiled;

  // Summary banner: tailored to selected category
  const currentUnfiled = items.filter((i) => i.category === 'current' && !i.filed).length;
  const summaryCount = categoryFilter === 'current' || categoryFilter === 'all'
    ? currentUnfiled
    : unfiled.length;
  const summaryCopy = (() => {
    if (categoryFilter === 'historical') {
      return unfiled.length > 0
        ? `${unfiled.length} historical CTR record${unfiled.length !== 1 ? 's' : ''} pending review`
        : 'All historical CTR records have been reviewed';
    }
    return currentUnfiled > 0
      ? `${currentUnfiled} current CTR filing${currentUnfiled !== 1 ? 's' : ''} required`
      : 'All current CTR filings are up to date';
  })();

  if (isLoading) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading CTR filings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Banner */}
      <div
        className={cn(
          'flex items-center gap-4 p-4 rounded-lg border',
          summaryCount > 0
            ? 'bg-red-500/[0.06] border-red-400/20'
            : 'bg-green-500/[0.06] border-green-400/20',
        )}
      >
        {summaryCount > 0 ? (
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
        ) : (
          <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
        )}
        <div>
          <div className="font-semibold">{summaryCopy}</div>
          <div className="text-sm text-muted-foreground">
            Customers with ${CTR_THRESHOLD.toLocaleString()}+ in Denet transactions within a single day
          </div>
        </div>
      </div>

      {/* Filters: category + name search (historical only) + filed-status */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Label htmlFor="category-filter" className="text-sm text-muted-foreground">
            Category
          </Label>
          <Select
            value={categoryFilter}
            onValueChange={(v) => setCategoryFilter(v as CategoryFilter)}
          >
            <SelectTrigger id="category-filter" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Current</SelectItem>
              <SelectItem value="historical">Historical Audit</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="relative w-[260px]">
          <Input
            placeholder="Search by customer name"
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
            className="pr-8"
          />
          {nameSearch && (
            <button
              type="button"
              onClick={() => setNameSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

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
            All ({searchedItems.length})
          </Button>
        </div>
      </div>

      {/* CTR Table */}
      {displayItems.length === 0 ? (
        <Card className="bg-card/30 border-white/10">
          <CardContent className="py-12 text-center text-muted-foreground">
            {showFiled
              ? 'No CTR entries match this filter.'
              : 'No pending CTR filings in this view.'}
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
                  <TableHead className="text-right">Daily Total</TableHead>
                  <TableHead className="text-center"># Txns</TableHead>
                  <TableHead className="text-center">Category</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead>Filed Date</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Won't File Reason</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayItems.map((item) => {
                  const key = `${item.customer_id}|${item.trigger_date}`;
                  const isExpanded = expandedRows.has(key);
                  const expansion = expansionCache.get(key);
                  const isExpansionLoading = loadingExpansion.has(key);
                  return (
                    <Fragment key={key}>
                      <TableRow
                        className={cn(
                          'cursor-pointer',
                          !item.filed && item.category === 'current' && 'bg-red-500/[0.03]',
                        )}
                        onClick={() => toggleRow(item)}
                      >
                        <TableCell className="w-8 px-2">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        <TableCell className="font-mono">{formatDate(item.trigger_date)}</TableCell>
                        <TableCell className="font-medium">{item.customer_name}</TableCell>
                        <TableCell className="text-muted-foreground font-mono text-sm">
                          {item.customer_id}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-red-400">
                          {formatCurrency(item.total_amount)}
                        </TableCell>
                        <TableCell className="text-center">{item.transaction_count}</TableCell>
                        <TableCell className="text-center">
                          {item.category === 'historical' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 bg-amber-300/10 border border-amber-300/20 rounded-full px-2.5 py-0.5">
                              Historical
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-sky-300 bg-sky-300/10 border border-sky-300/20 rounded-full px-2.5 py-0.5">
                              Current
                            </span>
                          )}
                        </TableCell>
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
                        <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                          {item.wont_file_reason || '—'}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={togglingIds.has(item.id)}
                              onClick={() => handleQuickToggle(item)}
                              className={cn(
                                !item.filed &&
                                  'border-green-400/30 text-green-400 hover:bg-green-400/10 hover:text-green-300',
                              )}
                            >
                              {item.filed ? 'Unmark' : 'Mark Filed'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openEditDialog(item)}>
                              Edit
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={12} className="p-0">
                            <div className="bg-white/[0.02] border-t border-b border-white/[0.06] px-8 py-3">
                              {isExpansionLoading ? (
                                <div className="text-xs text-muted-foreground py-2 flex items-center gap-2">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Loading transactions...
                                </div>
                              ) : expansion ? (
                                <>
                                  {expansion.customer_address && (
                                    <div className="text-xs text-muted-foreground mb-2">
                                      <span className="uppercase tracking-wider">Customer address:</span>{' '}
                                      <span className="text-foreground">{expansion.customer_address}</span>
                                    </div>
                                  )}
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
                                      {expansion.transactions.map((tx) => (
                                        <tr key={tx.id} className="border-t border-white/[0.04]">
                                          <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">
                                            {tx.id}
                                          </td>
                                          <td className="py-1.5 pr-4">{tx.atm_name}</td>
                                          <td className="py-1.5 pr-4 text-muted-foreground">
                                            {tx.atm_address || '—'}
                                          </td>
                                          <td className="py-1.5 text-right font-mono">
                                            {formatCurrency(tx.sale)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </>
                              ) : (
                                <div className="text-xs text-muted-foreground py-2">
                                  No transaction details available.
                                </div>
                              )}
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

      {/* Unified Edit dialog */}
      <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Edit CTR Filing Entry</DialogTitle>
            <DialogDescription>
              {editingItem && (
                <>
                  <span className="font-medium text-foreground">{editingItem.customer_name}</span>
                  {' — '}
                  {formatCurrency(editingItem.total_amount)} on{' '}
                  {formatDate(editingItem.trigger_date)}
                  {editingItem.category === 'historical' && (
                    <span className="ml-2 inline-flex items-center text-xs text-amber-300">
                      (Historical)
                    </span>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="filed-toggle" className="text-sm">
                Marked as filed
              </Label>
              <Switch
                id="filed-toggle"
                checked={editFiled}
                onCheckedChange={setEditFiled}
              />
            </div>
            {editFiled && (
              <div className="space-y-2">
                <Label htmlFor="filed-date">Date Filed</Label>
                <Input
                  id="filed-date"
                  type="date"
                  value={editFiledDate}
                  onChange={(e) => setEditFiledDate(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="filing-notes">Notes</Label>
              <Textarea
                id="filing-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Filing reference number, details..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wont-file-reason">Won't File Reason</Label>
              <Textarea
                id="wont-file-reason"
                value={editWontFileReason}
                onChange={(e) => setEditWontFileReason(e.target.value)}
                placeholder="e.g., deadline passed, exempt customer, duplicate of another filing..."
                rows={2}
              />
              <p className="text-xs text-muted-foreground">
                Use this for entries that will not be filed (e.g., past deadline).
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingItem(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
