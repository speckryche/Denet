// Investments page body (/investments). public.investment_transactions is
// the source of truth: holdings, cost basis and realized gain are derived from
// it with FIFO (src/lib/investmentFifo.ts). Any signed-in user can read; only
// admins (DB: is_admin()) can add / edit / delete, and the UI hides those
// controls for everyone else.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/format';
import { fetchSpotPrices } from '@/lib/coingecko';
import {
  computeFifo,
  roundQty,
  INVESTMENT_COINS,
  type FifoResult,
  type InvestmentCoin,
  type InvestmentTransaction,
  type InvestmentTxType,
} from '@/lib/investmentFifo';
import { TableGroup, GROUP_TH, GROUP_TD, GROUP_THEAD, GROUP_TFOOT } from '@/components/ui/table-group';
import { CoinIdentity } from '@/components/investments/CoinIdentity';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';

const COINGECKO_ID: Record<InvestmentCoin, string> = { BTC: 'bitcoin', SOL: 'solana' };
const TX_TYPES: InvestmentTxType[] = ['Buy', 'Sell', 'Adjustment'];
// Matches the DB check constraint on investment_transactions.venue (or null).
const VENUES = ['Coinbase Prime', 'BitGo'] as const;
type Venue = (typeof VENUES)[number];
const DEFAULT_VENUE: Venue = 'Coinbase Prime';
const isVenue = (v: string | null): v is Venue => VENUES.includes(v as Venue);

const qtyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 8, maximumFractionDigits: 8 });
const formatQty = (n: number) => qtyFmt.format(roundQty(n));
// Table display only: 4 decimals. Stored values, FIFO math and the form keep 8.
const qtyFmt4 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const formatQtyTable = (n: number) => qtyFmt4.format(roundQty(n));

const formatDate = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
};

const todayPacific = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

const gainClass = (n: number) => (n > 0.005 ? 'text-success' : n < -0.005 ? 'text-danger' : '');

interface FormState {
  tx_date: string;
  coin: InvestmentCoin;
  tx_type: InvestmentTxType;
  adjustmentSign: 1 | -1;
  quantity: string; // always positive as typed
  usd_amount: string;
  venue: Venue | ''; // '' = none (legacy rows imported without a venue)
  note: string;
}

const emptyForm = (): FormState => ({
  tx_date: todayPacific(),
  coin: 'BTC',
  tx_type: 'Buy',
  adjustmentSign: 1,
  quantity: '',
  usd_amount: '',
  venue: DEFAULT_VENUE,
  note: '',
});

interface InvestmentTransactionsProps {
  /** Called with the row count after every load (the page header shows it). */
  onCountChange?: (count: number) => void;
}

export function InvestmentTransactions({ onCountChange }: InvestmentTransactionsProps = {}) {
  const isAdmin = useAuth().role === 'admin';
  const { toast } = useToast();

  const [txs, setTxs] = useState<InvestmentTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [prices, setPrices] = useState<Partial<Record<InvestmentCoin, number>>>({});
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);

  const [holdingsOpen, setHoldingsOpen] = useState(true);
  const [txOpen, setTxOpen] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InvestmentTransaction | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InvestmentTransaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchTxs = useCallback(async () => {
    const { data, error } = await supabase
      .from('investment_transactions')
      .select('id, tx_date, coin, tx_type, quantity, usd_amount, venue, note, created_at, updated_at');
    if (error) {
      console.error('Error fetching investment_transactions:', error);
      setLoadError(error.message);
    } else {
      setLoadError('');
      setTxs(
        (data ?? []).map((r) => ({
          ...r,
          quantity: Number(r.quantity),
          usd_amount: Number(r.usd_amount),
        })) as InvestmentTransaction[],
      );
    }
    setIsLoading(false);
  }, []);

  const fetchPrices = useCallback(async () => {
    setIsFetchingPrices(true);
    try {
      const p = await fetchSpotPrices(INVESTMENT_COINS.map((c) => COINGECKO_ID[c]));
      const next: Partial<Record<InvestmentCoin, number>> = {};
      for (const c of INVESTMENT_COINS) if (p[COINGECKO_ID[c]]) next[c] = p[COINGECKO_ID[c]];
      setPrices(next);
    } catch (err) {
      console.error('Failed to fetch live prices:', err);
    } finally {
      setIsFetchingPrices(false);
    }
  }, []);

  useEffect(() => {
    fetchTxs();
    fetchPrices();
  }, [fetchTxs, fetchPrices]);

  useEffect(() => {
    if (!isLoading) onCountChange?.(txs.length);
  }, [isLoading, txs.length, onCountChange]);

  // ── Holdings (FIFO) ──────────────────────────────────────────────────────
  const fifo = useMemo(() => {
    const out = {} as Record<InvestmentCoin, FifoResult>;
    for (const c of INVESTMENT_COINS) out[c] = computeFifo(txs, c);
    return out;
  }, [txs]);

  useEffect(() => {
    if (import.meta.env.DEV && txs.length > 0) {
      for (const c of INVESTMENT_COINS) {
        const r = fifo[c];
        console.info(
          `[investments] FIFO ${c}: qty ${r.qty} basis ${r.costBasis.toFixed(2)} ` +
            `realized ${r.realizedGain.toFixed(2)} avg ${r.avgCost.toFixed(2)} oversold ${r.oversold}`,
        );
      }
    }
  }, [fifo, txs.length]);

  const holdings = INVESTMENT_COINS.map((coin) => {
    const r = fifo[coin];
    const price = prices[coin];
    const value = price != null ? r.qty * price : null;
    return { coin, ...r, price, value, unrealized: value != null ? value - r.costBasis : null };
  });
  const allPriced = holdings.every((h) => h.value != null);
  const totals = holdings.reduce(
    (a, h) => ({
      costBasis: a.costBasis + h.costBasis,
      value: a.value + (h.value ?? 0),
      unrealized: a.unrealized + (h.unrealized ?? 0),
      realized: a.realized + h.realizedGain,
    }),
    { costBasis: 0, value: 0, unrealized: 0, realized: 0 },
  );
  const oversoldCoins = holdings.filter((h) => h.oversold > 0);

  // ── Transactions, newest first ───────────────────────────────────────────
  const sortedTxs = useMemo(
    () =>
      [...txs].sort(
        (a, b) =>
          b.tx_date.localeCompare(a.tx_date) ||
          b.created_at.localeCompare(a.created_at) ||
          b.id.localeCompare(a.id),
      ),
    [txs],
  );
  const totalBought = sortedTxs.filter((r) => r.tx_type === 'Buy').reduce((s, r) => s + r.usd_amount, 0);
  const totalSold = sortedTxs.filter((r) => r.tx_type === 'Sell').reduce((s, r) => s + r.usd_amount, 0);

  // ── Form ────────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (t: InvestmentTransaction) => {
    setEditing(t);
    setForm({
      tx_date: t.tx_date,
      coin: t.coin,
      tx_type: t.tx_type,
      adjustmentSign: t.quantity < 0 ? -1 : 1,
      quantity: String(Math.abs(t.quantity)),
      usd_amount: t.tx_type === 'Adjustment' ? '' : String(t.usd_amount),
      venue: isVenue(t.venue) ? t.venue : '',
      note: t.note ?? '',
    });
    setFormError('');
    setDialogOpen(true);
  };

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  /** Validates the form; returns the row to write or an error message. */
  const buildRow = (): { row: Omit<InvestmentTransaction, 'id' | 'created_at' | 'updated_at'> } | { error: string } => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.tx_date)) return { error: 'Date is required.' };
    if (form.tx_date > todayPacific()) return { error: 'Date cannot be in the future.' };

    const qtyStr = form.quantity.trim();
    if (!/^\d*\.?\d+$/.test(qtyStr)) return { error: 'Quantity must be a positive number (no sign).' };
    const absQty = roundQty(Number(qtyStr));
    if (!(absQty > 0)) return { error: 'Quantity must be greater than 0.' };
    if ((qtyStr.split('.')[1]?.length ?? 0) > 8) return { error: 'Quantity allows at most 8 decimals.' };

    let usd = 0;
    if (form.tx_type !== 'Adjustment') {
      const usdStr = form.usd_amount.trim().replace(/[$,]/g, '');
      if (!/^\d*\.?\d+$/.test(usdStr)) return { error: 'USD amount must be a positive number.' };
      usd = Math.round(Number(usdStr) * 100) / 100;
      if (!(usd > 0)) return { error: 'USD amount must be greater than 0.' };
    }

    const quantity =
      form.tx_type === 'Buy' ? absQty : form.tx_type === 'Sell' ? -absQty : form.adjustmentSign * absQty;

    const row = {
      tx_date: form.tx_date,
      coin: form.coin,
      tx_type: form.tx_type,
      quantity,
      usd_amount: usd,
      venue: form.tx_type === 'Adjustment' || form.venue === '' ? null : form.venue,
      note: form.note.trim() || null,
    };

    // A Sell or negative Adjustment must not take more than the ledger holds.
    const candidate: InvestmentTransaction = {
      ...row,
      id: editing?.id ?? '~new',
      created_at: editing?.created_at ?? new Date().toISOString(),
    };
    const after = [...txs.filter((t) => t.id !== editing?.id), candidate];
    if (computeFifo(after, row.coin).oversold > 0 && fifo[row.coin].oversold === 0) {
      return { error: `This would sell or remove more ${row.coin} than is held on that date.` };
    }
    return { row };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const built = buildRow();
    if ('error' in built) {
      setFormError(built.error);
      return;
    }
    setIsSaving(true);
    try {
      const q = editing
        ? supabase
            .from('investment_transactions')
            .update({ ...built.row, updated_at: new Date().toISOString() })
            .eq('id', editing.id)
            .select('id')
        : supabase.from('investment_transactions').insert(built.row).select('id');
      const { data, error } = await q;
      if (error) throw error;
      // RLS rejects a non-admin write silently with 0 rows.
      if (!data || data.length === 0) {
        toast({
          variant: 'destructive',
          title: editing ? 'Update not saved' : 'Transaction not added',
          description: 'No rows were affected. You may not have permission to change investments.',
        });
        return;
      }
      toast({
        title: editing ? 'Transaction updated' : 'Transaction added',
        description: `${built.row.tx_type} ${formatQty(Math.abs(built.row.quantity))} ${built.row.coin}`,
      });
      setDialogOpen(false);
      fetchTxs();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteWouldOversell = useMemo(() => {
    if (!deleteTarget) return false;
    const c = deleteTarget.coin;
    return (
      fifo[c].oversold === 0 &&
      computeFifo(txs.filter((t) => t.id !== deleteTarget.id), c).oversold > 0
    );
  }, [deleteTarget, txs, fifo]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    const { data, error } = await supabase
      .from('investment_transactions')
      .delete()
      .eq('id', deleteTarget.id)
      .select('id');
    setIsDeleting(false);
    if (error) {
      toast({ variant: 'destructive', title: 'Delete failed', description: error.message });
    } else if (!data || data.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Transaction not deleted',
        description: 'No rows were affected. You may not have permission to change investments.',
      });
    } else {
      toast({ title: 'Transaction deleted' });
    }
    setDeleteTarget(null);
    fetchTxs();
  };

  const isAdjustment = form.tx_type === 'Adjustment';
  const formQty = Number(form.quantity) || 0;
  const formUsd = Number(form.usd_amount.replace(/[$,]/g, '')) || 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchPrices} disabled={isFetchingPrices}>
            <RefreshCw className={cn('w-4 h-4 mr-1.5', isFetchingPrices && 'animate-spin')} />
            Refresh Prices
          </Button>
          {isAdmin && (
            <Button size="sm" onClick={openAdd}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add Transaction
            </Button>
          )}
        </div>
      </div>

      {loadError && (
        <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
          Could not load investment transactions: {loadError}
        </div>
      )}
      {oversoldCoins.length > 0 && (
        <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
          Ledger sells or removes more than it holds:{' '}
          {oversoldCoins.map((h) => `${h.coin} short ${formatQty(h.oversold)}`).join(', ')}. Holdings below are
          not reliable until this is fixed.
        </div>
      )}

      {isLoading ? (
        <div className="text-center px-4 py-8 text-muted-foreground">Loading...</div>
      ) : (
        <>
          {/* Holdings summary */}
          <TableGroup
            label="Holdings"
            count={holdings.length}
            unit="coin"
            expanded={holdingsOpen}
            onToggle={() => setHoldingsOpen((o) => !o)}
            stats={[
              { label: 'Cost basis', value: formatCurrency(totals.costBasis) },
              { label: 'Value', value: allPriced ? formatCurrency(totals.value) : '—' },
              {
                label: 'Total gain',
                value: allPriced ? formatCurrency(totals.unrealized + totals.realized) : '—',
              },
            ]}
          >
            <div className="w-full overflow-x-auto">
              <Table className="table-fixed min-w-[860px]">
                <TableHeader className={GROUP_THEAD}>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={`${GROUP_TH} w-[184px]`}>Coin</TableHead>
                    <TableHead className={`${GROUP_TH} w-[12%] text-right`}>Qty</TableHead>
                    <TableHead className={`${GROUP_TH} text-right`}>Avg cost</TableHead>
                    <TableHead className={`${GROUP_TH} text-right`}>Cost basis</TableHead>
                    <TableHead className={`${GROUP_TH} text-right`}>Current price</TableHead>
                    <TableHead className={`${GROUP_TH} text-right`}>Current value</TableHead>
                    <TableHead className={`${GROUP_TH} text-right`}>Unrealized gain</TableHead>
                    <TableHead className={`${GROUP_TH} text-right`}>Realized gain</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map((h) => (
                    <TableRow key={h.coin}>
                      <TableCell className={GROUP_TD}><CoinIdentity symbol={h.coin} /></TableCell>
                      <TableCell className={`${GROUP_TD} text-right font-mono tabular-nums`}>{formatQtyTable(h.qty)}</TableCell>
                      <TableCell className={`${GROUP_TD} text-right font-mono tabular-nums text-muted-foreground`}>
                        {formatCurrency(h.avgCost, 2)}
                      </TableCell>
                      <TableCell className={`${GROUP_TD} text-right font-mono tabular-nums`}>
                        {formatCurrency(h.costBasis, 2)}
                      </TableCell>
                      <TableCell className={`${GROUP_TD} text-right font-mono tabular-nums text-muted-foreground`}>
                        {h.price != null ? formatCurrency(h.price, 2) : '—'}
                      </TableCell>
                      <TableCell className={`${GROUP_TD} text-right font-mono tabular-nums`}>
                        {h.value != null ? formatCurrency(h.value, 2) : '—'}
                      </TableCell>
                      <TableCell className={cn(GROUP_TD, 'text-right font-mono tabular-nums', h.unrealized != null && gainClass(h.unrealized))}>
                        {h.unrealized != null ? formatCurrency(h.unrealized, 2) : '—'}
                      </TableCell>
                      <TableCell className={cn(GROUP_TD, 'text-right font-mono tabular-nums', gainClass(h.realizedGain))}>
                        {formatCurrency(h.realizedGain, 2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter className={GROUP_TFOOT}>
                  <TableRow className="font-semibold">
                    <TableCell className={GROUP_TD}>Total</TableCell>
                    <TableCell className={GROUP_TD} />
                    <TableCell className={GROUP_TD} />
                    <TableCell className={`${GROUP_TD} text-right font-mono tabular-nums`}>
                      {formatCurrency(totals.costBasis, 2)}
                    </TableCell>
                    <TableCell className={GROUP_TD} />
                    <TableCell className={`${GROUP_TD} text-right font-mono tabular-nums`}>
                      {allPriced ? formatCurrency(totals.value, 2) : '—'}
                    </TableCell>
                    <TableCell className={cn(GROUP_TD, 'text-right font-mono tabular-nums', allPriced && gainClass(totals.unrealized))}>
                      {allPriced ? formatCurrency(totals.unrealized, 2) : '—'}
                    </TableCell>
                    <TableCell className={cn(GROUP_TD, 'text-right font-mono tabular-nums', gainClass(totals.realized))}>
                      {formatCurrency(totals.realized, 2)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </TableGroup>

          {/* Transaction list */}
          {sortedTxs.length === 0 ? (
            <div className="text-center px-4 py-8 text-muted-foreground">No investment transactions yet.</div>
          ) : (
                <TableGroup
                  label="All transactions"
                  count={sortedTxs.length}
                  unit="transaction"
                  expanded={txOpen}
                  onToggle={() => setTxOpen((o) => !o)}
                  stats={[
                    { label: 'Bought', value: formatCurrency(totalBought) },
                    { label: 'Sold', value: formatCurrency(totalSold) },
                  ]}
                >
                  <div className="w-full overflow-x-auto">
                    <Table className="table-fixed min-w-[900px]">
                      <TableHeader className={GROUP_THEAD}>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className={`${GROUP_TH} w-[9%]`}>Date</TableHead>
                          <TableHead className={`${GROUP_TH} w-[6%]`}>Coin</TableHead>
                          <TableHead className={`${GROUP_TH} w-[9%]`}>Type</TableHead>
                          <TableHead className={`${GROUP_TH} w-[14%] text-right`}>Qty</TableHead>
                          <TableHead className={`${GROUP_TH} w-[11%] text-right`}>USD</TableHead>
                          <TableHead className={`${GROUP_TH} w-[11%] text-right`}>Per coin</TableHead>
                          <TableHead className={`${GROUP_TH} w-[12%]`}>Venue</TableHead>
                          <TableHead className={GROUP_TH}>Note</TableHead>
                          {isAdmin && <TableHead className={`${GROUP_TH} w-20 text-right`}>Actions</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedTxs.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className={`${GROUP_TD} tabular-nums`}>{formatDate(t.tx_date)}</TableCell>
                            <TableCell className={`${GROUP_TD} font-medium`}>{t.coin}</TableCell>
                            <TableCell className={GROUP_TD}>{t.tx_type}</TableCell>
                            <TableCell
                              className={cn(
                                GROUP_TD,
                                'text-right font-mono tabular-nums',
                                t.quantity < 0 && 'text-danger',
                              )}
                            >
                              {t.quantity > 0 ? '+' : ''}
                              {formatQtyTable(t.quantity)}
                            </TableCell>
                            <TableCell className={`${GROUP_TD} text-right font-mono tabular-nums`}>
                              {t.tx_type === 'Adjustment' ? '—' : formatCurrency(t.usd_amount, 2)}
                            </TableCell>
                            <TableCell className={`${GROUP_TD} text-right font-mono tabular-nums text-muted-foreground`}>
                              {t.tx_type === 'Adjustment' || t.quantity === 0
                                ? '—'
                                : formatCurrency(t.usd_amount / Math.abs(t.quantity), 2)}
                            </TableCell>
                            <TableCell className={`${GROUP_TD} truncate`} title={t.venue ?? ''}>
                              {t.venue ?? <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className={`${GROUP_TD} truncate text-muted-foreground`} title={t.note ?? ''}>
                              {t.note}
                            </TableCell>
                            {isAdmin && (
                              <TableCell className={`${GROUP_TD} text-right`}>
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                    onClick={() => openEdit(t)}
                                    title="Edit"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-muted-foreground hover:text-danger"
                                    onClick={() => setDeleteTarget(t)}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TableGroup>
          )}
        </>
      )}

      {/* Add / Edit dialog (admin only) */}
      {isAdmin && (
        <Dialog open={dialogOpen} onOpenChange={(o) => !isSaving && setDialogOpen(o)}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Transaction' : 'Add Transaction'}</DialogTitle>
              <DialogDescription>
                Enter quantity as a positive number. Sells are stored as negative automatically.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="inv-date">Date</Label>
                  <Input
                    id="inv-date"
                    type="date"
                    value={form.tx_date}
                    max={todayPacific()}
                    onChange={(e) => setField('tx_date', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Coin</Label>
                  <Select value={form.coin} onValueChange={(v) => setField('coin', v as InvestmentCoin)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INVESTMENT_COINS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={form.tx_type} onValueChange={(v) => setField('tx_type', v as InvestmentTxType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TX_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="inv-qty">Quantity ({form.coin})</Label>
                <div className="flex gap-2">
                  {isAdjustment && (
                    <div className="flex rounded-md border border-input overflow-hidden shrink-0" role="group" aria-label="Adjustment direction">
                      {([1, -1] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={form.adjustmentSign === s}
                          onClick={() => setField('adjustmentSign', s)}
                          className={cn(
                            'w-10 text-base font-semibold transition-colors',
                            form.adjustmentSign === s
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:bg-muted',
                          )}
                          title={s === 1 ? 'Add to holdings' : 'Remove from holdings'}
                        >
                          {s === 1 ? '+' : '−'}
                        </button>
                      ))}
                    </div>
                  )}
                  <Input
                    id="inv-qty"
                    inputMode="decimal"
                    value={form.quantity}
                    onChange={(e) => setField('quantity', e.target.value)}
                    placeholder="0.00000000"
                    className="font-mono"
                  />
                </div>
              </div>

              {!isAdjustment && (
                <div className="space-y-2">
                  <Label htmlFor="inv-usd">
                    {form.tx_type === 'Buy' ? 'USD cost (incl. fees)' : 'USD proceeds'}
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      id="inv-usd"
                      inputMode="decimal"
                      value={form.usd_amount}
                      onChange={(e) => setField('usd_amount', e.target.value)}
                      placeholder="0.00"
                      className="pl-7 font-mono"
                    />
                  </div>
                  {formQty > 0 && formUsd > 0 && (
                    <p className="text-xs text-muted-foreground">
                      = {formatCurrency(formUsd / formQty, 2)} per {form.coin}
                    </p>
                  )}
                </div>
              )}
              {isAdjustment && (
                <p className="text-xs text-muted-foreground">
                  Adjustments carry no USD. A + adjustment adds a zero-cost lot; a − adjustment removes the oldest
                  lots' cost from basis without a realized gain or loss.
                </p>
              )}

              {!isAdjustment && (
                <div className="space-y-2">
                  <Label htmlFor="inv-venue">Venue</Label>
                  <Select value={form.venue} onValueChange={(v) => setField('venue', v as Venue)}>
                    <SelectTrigger id="inv-venue">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      {VENUES.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="inv-note">Note</Label>
                <Textarea id="inv-note" rows={2} value={form.note} onChange={(e) => setField('note', e.target.value)} />
              </div>

              {form.tx_type === 'Buy' && (
                <p className="text-xs text-muted-foreground">
                  Quantity is what reached the wallet; fold any withdrawal fee into the cost.
                </p>
              )}
              {form.tx_type === 'Sell' && (
                <p className="text-xs text-muted-foreground">USD is proceeds after fees.</p>
              )}

              {formError && (
                <div className="text-sm text-danger bg-danger/10 border border-danger/20 rounded-md px-3 py-2">
                  {formError}
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {editing ? 'Update' : 'Add'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete confirmation (admin only) */}
      {isAdmin && (
        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !isDeleting && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete transaction?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget &&
                  `${deleteTarget.tx_type} of ${formatQty(Math.abs(deleteTarget.quantity))} ${deleteTarget.coin} on ${formatDate(deleteTarget.tx_date)}` +
                    (deleteTarget.tx_type !== 'Adjustment' ? ` (${formatCurrency(deleteTarget.usd_amount, 2)})` : '') +
                    '. This permanently removes it and recalculates holdings.'}
                {deleteWouldOversell && (
                  <span className="block mt-2 text-danger">
                    Warning: without this row, later sells would exceed the {deleteTarget?.coin} held.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleDelete(); }}
                disabled={isDeleting}
                className="bg-danger text-white hover:bg-danger/90"
              >
                {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
}
