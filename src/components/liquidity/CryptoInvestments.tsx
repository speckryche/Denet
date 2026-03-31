import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Loader2, Bitcoin, RefreshCw } from 'lucide-react';

interface CryptoInvestment {
  id: string;
  as_of_date: string;
  crypto_name: string;
  quantity: number;
  total_cost: number;
  current_value: number;
  realized_gain: number;
}

// Map common crypto names to CoinGecko IDs
const CRYPTO_TO_COINGECKO: Record<string, string> = {
  btc: 'bitcoin',
  bitcoin: 'bitcoin',
  sol: 'solana',
  solana: 'solana',
  eth: 'ethereum',
  ethereum: 'ethereum',
  ltc: 'litecoin',
  litecoin: 'litecoin',
  doge: 'dogecoin',
  dogecoin: 'dogecoin',
  xrp: 'ripple',
  ripple: 'ripple',
  ada: 'cardano',
  cardano: 'cardano',
  dot: 'polkadot',
  polkadot: 'polkadot',
  link: 'chainlink',
  chainlink: 'chainlink',
};

const getCoinGeckoId = (name: string): string | null => {
  return CRYPTO_TO_COINGECKO[name.toLowerCase().trim()] || null;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const formatQuantity = (value: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  }).format(value);

const formatDate = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}/${year.slice(2)}`;
};

const getPacificDateString = () => {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  });
};

const emptyForm = {
  crypto_name: '',
  as_of_date: getPacificDateString(),
  quantity: '',
  total_cost: '',
  current_value: '',
  realized_gain: '0',
};

export function CryptoInvestments() {
  const [investments, setInvestments] = useState<CryptoInvestment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);

  useEffect(() => {
    fetchInvestments();
  }, []);

  // Fetch live prices whenever investments change
  useEffect(() => {
    if (investments.length > 0) fetchLivePrices();
  }, [investments]);

  const fetchLivePrices = async () => {
    const coinIds = [
      ...new Set(
        investments
          .map((inv) => getCoinGeckoId(inv.crypto_name))
          .filter((id): id is string => !!id)
      ),
    ];
    if (coinIds.length === 0) return;
    setIsFetchingPrices(true);
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds.join(',')}&vs_currencies=usd`
      );
      const data = await res.json();
      const prices: Record<string, number> = {};
      for (const id of coinIds) {
        if (data?.[id]?.usd) prices[id] = data[id].usd;
      }
      setLivePrices(prices);
    } catch (err) {
      console.error('Failed to fetch live prices:', err);
    } finally {
      setIsFetchingPrices(false);
    }
  };

  const fetchInvestments = async () => {
    const { data, error } = await supabase
      .from('crypto_investments')
      .select('*')
      .order('crypto_name');
    if (error) {
      console.error('Error fetching crypto investments:', error);
    } else {
      setInvestments(data || []);
    }
    setIsLoading(false);
  };

  const openAdd = () => {
    setEditingId(null);
    setFormData({ ...emptyForm, as_of_date: getPacificDateString() });
    setError('');
    setDialogOpen(true);
  };

  const openEdit = (inv: CryptoInvestment) => {
    setEditingId(inv.id);
    setFormData({
      crypto_name: inv.crypto_name,
      as_of_date: inv.as_of_date,
      quantity: inv.quantity.toString(),
      total_cost: inv.total_cost.toString(),
      current_value: inv.current_value.toString(),
      realized_gain: inv.realized_gain.toString(),
    });
    setError('');
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSaving(true);

    const row = {
      crypto_name: formData.crypto_name.trim(),
      as_of_date: formData.as_of_date,
      quantity: parseFloat(formData.quantity) || 0,
      total_cost: parseFloat(formData.total_cost) || 0,
      current_value: parseFloat(formData.current_value) || 0,
      realized_gain: parseFloat(formData.realized_gain) || 0,
      updated_at: new Date().toISOString(),
    };

    if (!row.crypto_name) {
      setError('Crypto name is required.');
      setIsSaving(false);
      return;
    }

    try {
      if (editingId) {
        const { error: err } = await supabase
          .from('crypto_investments')
          .update(row)
          .eq('id', editingId);
        if (err) throw err;
      } else {
        const { error: err } = await supabase
          .from('crypto_investments')
          .insert(row);
        if (err) throw err;
      }
      setDialogOpen(false);
      fetchInvestments();
    } catch (err: any) {
      setError(err.message || 'Failed to save.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase
      .from('crypto_investments')
      .delete()
      .eq('id', deleteTarget);
    if (error) console.error('Error deleting:', error);
    setDeleteTarget(null);
    fetchInvestments();
  };

  // Compute derived fields, using live prices when available
  const enriched = investments.map((inv) => {
    const coinId = getCoinGeckoId(inv.crypto_name);
    const livePrice = coinId ? livePrices[coinId] : null;
    const currentValue = livePrice ? Math.round(inv.quantity * livePrice) : inv.current_value;
    const avgCost = inv.quantity > 0 ? inv.total_cost / inv.quantity : 0;
    const unrealizedGain = currentValue - inv.total_cost;
    const totalGain = unrealizedGain + inv.realized_gain;
    return { ...inv, current_value: currentValue, avgCost, unrealizedGain, totalGain };
  });

  const totals = enriched.reduce(
    (acc, inv) => ({
      total_cost: acc.total_cost + inv.total_cost,
      current_value: acc.current_value + inv.current_value,
      unrealizedGain: acc.unrealizedGain + inv.unrealizedGain,
      realized_gain: acc.realized_gain + inv.realized_gain,
      totalGain: acc.totalGain + inv.totalGain,
    }),
    {
      total_cost: 0,
      current_value: 0,
      unrealizedGain: 0,
      realized_gain: 0,
      totalGain: 0,
    }
  );

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <>
      <Card className="bg-card/30 border-white/10">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bitcoin className="w-5 h-5 text-amber-400" />
            Crypto Investments
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchLivePrices}
              disabled={isFetchingPrices}
              title="Refresh live prices"
            >
              <RefreshCw className={cn('w-4 h-4 mr-1.5', isFetchingPrices && 'animate-spin')} />
              Refresh Prices
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add Crypto
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading...
            </div>
          ) : enriched.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No crypto investments tracked yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '4%' }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Crypto
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Current Price
                    </th>
                    <th className="px-3 py-2.5 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      As Of
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Quantity
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Total Cost
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Current Value
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Avg Cost Each
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Unrealized
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Realized
                    </th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Total Gain
                    </th>
                    <th className="px-3 py-2.5 w-[80px]" />
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((inv) => (
                    <tr
                      key={inv.id}
                      className="border-b border-white/5 hover:bg-white/[0.02] transition-colors group"
                    >
                      <td className="px-3 py-2.5 font-medium">{inv.crypto_name}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                        {(() => {
                          const coinId = getCoinGeckoId(inv.crypto_name);
                          const price = coinId ? livePrices[coinId] : null;
                          return price ? formatCurrency(price) : '—';
                        })()}
                      </td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground">
                        {formatDate(inv.as_of_date)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatQuantity(inv.quantity)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatCurrency(inv.total_cost)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                        {formatCurrency(inv.current_value)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                        {formatCurrency(inv.avgCost)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2.5 text-right font-mono tabular-nums',
                          inv.unrealizedGain >= 0
                            ? 'text-green-400'
                            : 'text-red-400'
                        )}
                      >
                        {formatCurrency(inv.unrealizedGain)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2.5 text-right font-mono tabular-nums',
                          inv.realized_gain >= 0
                            ? 'text-green-400'
                            : 'text-red-400'
                        )}
                      >
                        {formatCurrency(inv.realized_gain)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2.5 text-right font-mono font-semibold tabular-nums',
                          inv.totalGain >= 0
                            ? 'text-green-400'
                            : 'text-red-400'
                        )}
                      >
                        {formatCurrency(inv.totalGain)}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => openEdit(inv)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-red-400"
                            onClick={() => setDeleteTarget(inv.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {enriched.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 border-primary/30 bg-white/[0.03]">
                      <td className="px-3 py-3 font-bold" colSpan={4}>
                        Totals
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold tabular-nums">
                        {formatCurrency(totals.total_cost)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold tabular-nums">
                        {formatCurrency(totals.current_value)}
                      </td>
                      <td className="px-3 py-3" />
                      <td
                        className={cn(
                          'px-3 py-3 text-right font-mono font-bold tabular-nums',
                          totals.unrealizedGain >= 0
                            ? 'text-green-400'
                            : 'text-red-400'
                        )}
                      >
                        {formatCurrency(totals.unrealizedGain)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right font-mono font-bold tabular-nums',
                          totals.realized_gain >= 0
                            ? 'text-green-400'
                            : 'text-red-400'
                        )}
                      >
                        {formatCurrency(totals.realized_gain)}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-3 text-right font-mono font-bold tabular-nums',
                          totals.totalGain >= 0
                            ? 'text-green-400'
                            : 'text-red-400'
                        )}
                      >
                        {formatCurrency(totals.totalGain)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Crypto Investment' : 'Add Crypto Investment'}
            </DialogTitle>
            <DialogDescription>
              Track your crypto holdings and gains.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Crypto Name</Label>
                <Input
                  value={formData.crypto_name}
                  onChange={(e) => updateField('crypto_name', e.target.value)}
                  placeholder="e.g. BTC"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>As Of Date</Label>
                <Input
                  type="date"
                  value={formData.as_of_date}
                  onChange={(e) => updateField('as_of_date', e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                step="0.00000001"
                value={formData.quantity}
                onChange={(e) => updateField('quantity', e.target.value)}
                placeholder="0"
                className="font-mono"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Total Cost ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.total_cost}
                  onChange={(e) => updateField('total_cost', e.target.value)}
                  placeholder="0"
                  className="font-mono"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Current Value ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.current_value}
                  onChange={(e) => updateField('current_value', e.target.value)}
                  placeholder="0"
                  className="font-mono"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Realized Gain ($)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.realized_gain}
                onChange={(e) => updateField('realized_gain', e.target.value)}
                placeholder="0"
                className="font-mono"
              />
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {editingId ? 'Update' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Investment</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this crypto investment record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
