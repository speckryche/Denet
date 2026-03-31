import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { RefreshCw, Loader2 } from 'lucide-react';

interface LiquidityCategory {
  id: string;
  name: string;
  type: 'asset' | 'liability' | 'crypto';
  display_order: number;
  active: boolean;
  coin_id: string | null;
  ticker: string | null;
}

interface SnapshotToEdit {
  id: string;
  snapshot_date: string;
  bitcoin_price: number;
  solana_price: number;
  liquidity_snapshot_values: {
    category_id: string;
    value: number;
    quantity: number | null;
  }[];
}

interface AddSnapshotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: LiquidityCategory[];
  editingSnapshot: SnapshotToEdit | null;
  onSaved: () => void;
}

const getPacificDateString = () => {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  });
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

// Supported coins for CoinGecko price fetch
const SUPPORTED_COINS: Record<string, string> = {
  bitcoin: 'Bitcoin',
  solana: 'Solana',
  ethereum: 'Ethereum',
  litecoin: 'Litecoin',
  dogecoin: 'Dogecoin',
  cardano: 'Cardano',
  polkadot: 'Polkadot',
  chainlink: 'Chainlink',
  ripple: 'XRP',
};

export { SUPPORTED_COINS };

export function AddSnapshotDialog({
  open,
  onOpenChange,
  categories,
  editingSnapshot,
  onSaved,
}: AddSnapshotDialogProps) {
  const [snapshotDate, setSnapshotDate] = useState(getPacificDateString());
  const [bitcoinPrice, setBitcoinPrice] = useState('');
  const [solanaPrice, setSolanaPrice] = useState('');
  const [categoryValues, setCategoryValues] = useState<Record<string, string>>(
    {}
  );
  const [categoryQuantities, setCategoryQuantities] = useState<
    Record<string, string>
  >({});
  const [coinPrices, setCoinPrices] = useState<Record<string, number>>({});
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const activeCategories = categories.filter((c) => c.active);
  const assets = activeCategories.filter((c) => c.type === 'asset');
  const cryptoCategories = activeCategories.filter((c) => c.type === 'crypto');
  const liabilities = activeCategories.filter((c) => c.type === 'liability');
  const isEditing = !!editingSnapshot;

  // Get unique coin IDs needed for price fetch
  const neededCoinIds = [
    ...new Set(
      cryptoCategories
        .map((c) => c.coin_id)
        .filter((id): id is string => !!id)
    ),
  ];
  // Always include bitcoin and solana for the price header fields
  if (!neededCoinIds.includes('bitcoin')) neededCoinIds.push('bitcoin');
  if (!neededCoinIds.includes('solana')) neededCoinIds.push('solana');

  useEffect(() => {
    if (open) {
      setError('');
      if (editingSnapshot) {
        setSnapshotDate(editingSnapshot.snapshot_date);
        setBitcoinPrice(editingSnapshot.bitcoin_price.toString());
        setSolanaPrice(editingSnapshot.solana_price?.toString() || '');
        // Use the snapshot's stored prices for crypto value calculations
        const storedPrices: Record<string, number> = {};
        if (editingSnapshot.bitcoin_price) storedPrices.bitcoin = editingSnapshot.bitcoin_price;
        if (editingSnapshot.solana_price) storedPrices.solana = editingSnapshot.solana_price;
        setCoinPrices(storedPrices);
        const vals: Record<string, string> = {};
        const qtys: Record<string, string> = {};
        editingSnapshot.liquidity_snapshot_values.forEach((v) => {
          vals[v.category_id] = v.value.toString();
          if (v.quantity != null) {
            qtys[v.category_id] = v.quantity.toString();
          }
        });
        setCategoryValues(vals);
        setCategoryQuantities(qtys);
      } else {
        setSnapshotDate(getPacificDateString());
        setCategoryValues({});
        setCategoryQuantities({});
        // Only fetch live prices for new snapshots
        fetchAllPrices(neededCoinIds);
      }
    }
  }, [open, editingSnapshot, categories]);

  const fetchAllPrices = async (coinIds: string[]) => {
    if (coinIds.length === 0) return;
    setIsFetchingPrices(true);
    try {
      const ids = coinIds.join(',');
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`
      );
      const data = await response.json();
      const prices: Record<string, number> = {};
      for (const coinId of coinIds) {
        if (data?.[coinId]?.usd) {
          prices[coinId] = data[coinId].usd;
        }
      }
      setCoinPrices(prices);
      if (prices.bitcoin) {
        setBitcoinPrice(Math.round(prices.bitcoin).toString());
      }
      if (prices.solana) {
        setSolanaPrice(Math.round(prices.solana * 100 / 100).toString());
      }
    } catch (err) {
      console.error('Failed to fetch prices:', err);
    } finally {
      setIsFetchingPrices(false);
    }
  };

  // Get the current price for a coin, using price fields as fallback
  const getCoinPrice = (coinId: string | null): number => {
    if (!coinId) return 0;
    if (coinId === 'bitcoin') {
      return coinPrices.bitcoin || parseFloat(bitcoinPrice) || 0;
    }
    if (coinId === 'solana') {
      return coinPrices.solana || parseFloat(solanaPrice) || 0;
    }
    return coinPrices[coinId] || 0;
  };

  // Compute crypto value from quantity * price
  const getCryptoValue = (cat: LiquidityCategory): number => {
    const qty = parseFloat(categoryQuantities[cat.id] || '0') || 0;
    return qty * getCoinPrice(cat.coin_id);
  };

  // When quantity changes for a crypto category, update the computed value
  const updateCryptoQuantity = (catId: string, quantity: string) => {
    setCategoryQuantities((prev) => ({ ...prev, [catId]: quantity }));
    const cat = cryptoCategories.find((c) => c.id === catId);
    if (cat?.coin_id) {
      const qty = parseFloat(quantity) || 0;
      const price = getCoinPrice(cat.coin_id);
      const value = Math.round(qty * price);
      setCategoryValues((prev) => ({
        ...prev,
        [catId]: value.toString(),
      }));
    }
  };

  // When BTC price manually changes, recalculate BTC crypto categories
  const handleBitcoinPriceChange = (newPrice: string) => {
    setBitcoinPrice(newPrice);
    const btcPrice = parseFloat(newPrice) || 0;
    setCoinPrices((prev) => ({ ...prev, bitcoin: btcPrice }));
    cryptoCategories
      .filter((c) => c.coin_id === 'bitcoin')
      .forEach((cat) => {
        const qty = parseFloat(categoryQuantities[cat.id] || '0') || 0;
        const value = Math.round(qty * btcPrice);
        setCategoryValues((prev) => ({
          ...prev,
          [cat.id]: value.toString(),
        }));
      });
  };

  // When SOL price manually changes, recalculate SOL crypto categories
  const handleSolanaPriceChange = (newPrice: string) => {
    setSolanaPrice(newPrice);
    const solPrice = parseFloat(newPrice) || 0;
    setCoinPrices((prev) => ({ ...prev, solana: solPrice }));
    cryptoCategories
      .filter((c) => c.coin_id === 'solana')
      .forEach((cat) => {
        const qty = parseFloat(categoryQuantities[cat.id] || '0') || 0;
        const value = Math.round(qty * solPrice);
        setCategoryValues((prev) => ({
          ...prev,
          [cat.id]: value.toString(),
        }));
      });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSaving(true);

    const price = parseFloat(bitcoinPrice);
    const solPrice = parseFloat(solanaPrice) || 0;
    if (!snapshotDate || isNaN(price)) {
      setError('Date and Bitcoin Price are required.');
      setIsSaving(false);
      return;
    }

    try {
      let snapshotId: string;

      if (isEditing) {
        const { error: updateError } = await supabase
          .from('liquidity_snapshots')
          .update({
            snapshot_date: snapshotDate,
            bitcoin_price: price,
            solana_price: solPrice,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingSnapshot.id);
        if (updateError) throw updateError;
        snapshotId = editingSnapshot.id;

        await supabase
          .from('liquidity_snapshot_values')
          .delete()
          .eq('snapshot_id', snapshotId);
      } else {
        const { data: newSnap, error: insertError } = await supabase
          .from('liquidity_snapshots')
          .insert({
            snapshot_date: snapshotDate,
            bitcoin_price: price,
            solana_price: solPrice,
          })
          .select('id')
          .single();
        if (insertError) {
          if (insertError.code === '23505') {
            setError('A snapshot already exists for this date.');
            setIsSaving(false);
            return;
          }
          throw insertError;
        }
        snapshotId = newSnap.id;
      }

      const valueRows = activeCategories.map((cat) => ({
        snapshot_id: snapshotId,
        category_id: cat.id,
        value: parseFloat(categoryValues[cat.id] || '0') || 0,
        quantity:
          cat.type === 'crypto'
            ? parseFloat(categoryQuantities[cat.id] || '0') || 0
            : null,
      }));

      const { error: valuesError } = await supabase
        .from('liquidity_snapshot_values')
        .insert(valueRows);
      if (valuesError) throw valuesError;

      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Error saving snapshot:', err);
      setError(err.message || 'Failed to save snapshot.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateCategoryValue = (catId: string, value: string) => {
    setCategoryValues((prev) => ({ ...prev, [catId]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Snapshot' : 'Add Liquidity Snapshot'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the values for this snapshot.'
              : 'Enter the current value for each asset and liability.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Date & Prices */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="snapshot-date">Snapshot Date</Label>
              <Input
                id="snapshot-date"
                type="date"
                value={snapshotDate}
                onChange={(e) => setSnapshotDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="btc-price">Bitcoin Price</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  $
                </span>
                <Input
                  id="btc-price"
                  type="number"
                  step="0.01"
                  value={bitcoinPrice}
                  onChange={(e) => handleBitcoinPriceChange(e.target.value)}
                  placeholder="0"
                  required
                  className="pl-7 font-mono"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sol-price">Solana Price</Label>
              <div className="flex gap-1.5">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    $
                  </span>
                  <Input
                    id="sol-price"
                    type="number"
                    step="0.01"
                    value={solanaPrice}
                    onChange={(e) => handleSolanaPriceChange(e.target.value)}
                    placeholder="0"
                    className="pl-7 font-mono"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => fetchAllPrices(neededCoinIds)}
                  disabled={isFetchingPrices}
                  title="Fetch current prices"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isFetchingPrices ? 'animate-spin' : ''}`}
                  />
                </Button>
              </div>
            </div>
          </div>

          {/* Cash Assets Section */}
          {assets.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-white/10 pb-2">
                Cash Assets
              </div>
              <div className="grid gap-3">
                {assets.map((cat) => (
                  <div key={cat.id} className="flex items-center gap-3">
                    <Label className="w-[180px] shrink-0 text-sm">
                      {cat.name}
                    </Label>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        $
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        value={categoryValues[cat.id] || ''}
                        onChange={(e) =>
                          updateCategoryValue(cat.id, e.target.value)
                        }
                        placeholder="0"
                        className="pl-7 font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Crypto Assets Section */}
          {cryptoCategories.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-400/70 border-b border-amber-400/20 pb-2">
                Crypto Assets
                <span className="ml-2 text-[10px] font-normal text-amber-400/40 normal-case">
                  enter quantity, value calculated from price
                </span>
              </div>
              <div className="grid gap-3">
                {cryptoCategories.map((cat) => {
                  const computedValue = getCryptoValue(cat);
                  return (
                    <div key={cat.id} className="space-y-1">
                      <div className="flex items-center gap-3">
                        <Label className="w-[180px] shrink-0 text-sm text-amber-400/80">
                          {cat.name}
                        </Label>
                        <div className="flex-1">
                          <Input
                            type="number"
                            step="0.0001"
                            value={categoryQuantities[cat.id] || ''}
                            onChange={(e) =>
                              updateCryptoQuantity(cat.id, e.target.value)
                            }
                            placeholder="0.0000"
                            className="font-mono"
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="w-[180px] shrink-0" />
                        <div className="flex-1 flex items-center justify-between text-xs text-muted-foreground px-1">
                          <span>
                            {cat.ticker} @ {formatCurrency(getCoinPrice(cat.coin_id))}
                          </span>
                          <span className="font-mono font-medium text-foreground">
                            = {formatCurrency(computedValue)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Liabilities Section */}
          {liabilities.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-red-400/70 border-b border-red-400/20 pb-2">
                Liabilities
                <span className="ml-2 text-[10px] font-normal text-red-400/40 normal-case">
                  subtracted from total
                </span>
              </div>
              <div className="grid gap-3">
                {liabilities.map((cat) => (
                  <div key={cat.id} className="flex items-center gap-3">
                    <Label className="w-[180px] shrink-0 text-sm text-red-400/80">
                      {cat.name}
                    </Label>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        $
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        value={categoryValues[cat.id] || ''}
                        onChange={(e) =>
                          updateCategoryValue(cat.id, e.target.value)
                        }
                        placeholder="0"
                        className="pl-7 font-mono border-red-400/20 focus-visible:ring-red-400/30"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEditing ? 'Update Snapshot' : 'Save Snapshot'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
