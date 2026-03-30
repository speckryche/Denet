import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import {
  Plus,
  Pencil,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  EyeOff,
} from 'lucide-react';
import { SUPPORTED_COINS } from './AddSnapshotDialog';

interface LiquidityCategory {
  id: string;
  name: string;
  type: 'asset' | 'liability' | 'crypto';
  display_order: number;
  active: boolean;
  coin_id: string | null;
  ticker: string | null;
}

const COIN_TICKERS: Record<string, string> = {
  bitcoin: 'BTC',
  solana: 'SOL',
  ethereum: 'ETH',
  litecoin: 'LTC',
  dogecoin: 'DOGE',
  cardano: 'ADA',
  polkadot: 'DOT',
  chainlink: 'LINK',
  ripple: 'XRP',
};

interface CategoryManagerProps {
  categories: LiquidityCategory[];
  onChanged: () => void;
}

const SECTIONS: {
  type: 'asset' | 'crypto' | 'liability';
  label: string;
  color: string;
  borderColor: string;
}[] = [
  {
    type: 'asset',
    label: 'Cash Assets',
    color: 'text-green-400/80',
    borderColor: 'border-green-400/20',
  },
  {
    type: 'crypto',
    label: 'Crypto Assets',
    color: 'text-amber-400/80',
    borderColor: 'border-amber-400/20',
  },
  {
    type: 'liability',
    label: 'Liabilities',
    color: 'text-red-400/80',
    borderColor: 'border-red-400/20',
  },
];

export function CategoryManager({
  categories,
  onChanged,
}: CategoryManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<'asset' | 'liability' | 'crypto'>(
    'asset'
  );
  const [newCoinId, setNewCoinId] = useState('bitcoin');
  const [deactivateTarget, setDeactivateTarget] =
    useState<LiquidityCategory | null>(null);

  const activeCategories = categories
    .filter((c) => c.active)
    .sort((a, b) => a.display_order - b.display_order);

  const getCategoriesByType = (type: string) =>
    activeCategories.filter((c) => c.type === type);

  const startEdit = (cat: LiquidityCategory) => {
    setEditingId(cat.id);
    setEditName(cat.name);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    const { error } = await supabase
      .from('liquidity_categories')
      .update({ name: editName.trim(), updated_at: new Date().toISOString() })
      .eq('id', editingId);
    if (error) {
      console.error('Error updating category:', error);
      return;
    }
    setEditingId(null);
    setEditName('');
    onChanged();
  };

  const addCategory = async () => {
    if (!newName.trim()) return;
    const maxOrder = activeCategories.reduce(
      (max, c) => Math.max(max, c.display_order),
      0
    );
    const row: any = {
      name: newName.trim(),
      type: newType,
      display_order: maxOrder + 1,
    };
    if (newType === 'crypto') {
      row.coin_id = newCoinId;
      row.ticker = COIN_TICKERS[newCoinId] || newCoinId.toUpperCase();
    }
    const { error } = await supabase.from('liquidity_categories').insert(row);
    if (error) {
      console.error('Error adding category:', error);
      return;
    }
    setNewName('');
    setNewType('asset');
    setNewCoinId('bitcoin');
    onChanged();
  };

  const deactivateCategory = async () => {
    if (!deactivateTarget) return;
    const { error } = await supabase
      .from('liquidity_categories')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', deactivateTarget.id);
    if (error) {
      console.error('Error deactivating category:', error);
      return;
    }
    setDeactivateTarget(null);
    onChanged();
  };

  const moveCategory = async (
    cat: LiquidityCategory,
    direction: 'up' | 'down',
    sectionItems: LiquidityCategory[]
  ) => {
    const idx = sectionItems.findIndex((c) => c.id === cat.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sectionItems.length) return;

    const other = sectionItems[swapIdx];
    const tempOrder = cat.display_order;

    await supabase
      .from('liquidity_categories')
      .update({ display_order: other.display_order })
      .eq('id', cat.id);
    await supabase
      .from('liquidity_categories')
      .update({ display_order: tempOrder })
      .eq('id', other.id);

    onChanged();
  };

  const renderCategoryRow = (
    cat: LiquidityCategory,
    idx: number,
    sectionItems: LiquidityCategory[]
  ) => (
    <div
      key={cat.id}
      className="flex items-center gap-3 py-2 px-1 group"
    >
      {/* Order controls */}
      <div className="flex flex-col gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => moveCategory(cat, 'up', sectionItems)}
          disabled={idx === 0}
        >
          <ChevronUp className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => moveCategory(cat, 'down', sectionItems)}
          disabled={idx === sectionItems.length - 1}
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        {editingId === cat.id ? (
          <div className="flex items-center gap-2">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-8 text-sm"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') cancelEdit();
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-green-400 hover:text-green-300"
              onClick={saveEdit}
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={cancelEdit}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <span className="text-sm font-medium">{cat.name}</span>
        )}
      </div>

      {/* Coin badge for crypto */}
      {cat.type === 'crypto' && cat.ticker && (
        <Badge
          variant="outline"
          className="border-amber-400/20 text-amber-400/60 text-[10px]"
        >
          {cat.ticker}
        </Badge>
      )}

      {/* Actions */}
      {editingId !== cat.id && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => startEdit(cat)}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-red-400"
            onClick={() => setDeactivateTarget(cat)}
          >
            <EyeOff className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Sections */}
      {SECTIONS.map((section) => {
        const items = getCategoriesByType(section.type);
        return (
          <div key={section.type}>
            <div
              className={`text-xs font-semibold uppercase tracking-wider ${section.color} border-b ${section.borderColor} pb-2 mb-1`}
            >
              {section.label}
              <span className="ml-2 text-[10px] font-normal text-muted-foreground normal-case">
                {items.length} {items.length === 1 ? 'item' : 'items'}
              </span>
            </div>
            {items.length === 0 ? (
              <div className="py-3 px-1 text-sm text-muted-foreground italic">
                No categories
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {items.map((cat, idx) =>
                  renderCategoryRow(cat, idx, items)
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Add new category */}
      <div className="flex items-center gap-3 pt-3 border-t border-white/10">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category name"
          className="flex-1 h-8 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') addCategory();
          }}
        />
        <Select
          value={newType}
          onValueChange={(v) =>
            setNewType(v as 'asset' | 'liability' | 'crypto')
          }
        >
          <SelectTrigger className="w-[120px] h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asset">Asset</SelectItem>
            <SelectItem value="crypto">Crypto</SelectItem>
            <SelectItem value="liability">Liability</SelectItem>
          </SelectContent>
        </Select>
        {newType === 'crypto' && (
          <Select value={newCoinId} onValueChange={setNewCoinId}>
            <SelectTrigger className="w-[140px] h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SUPPORTED_COINS).map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name} ({COIN_TICKERS[id]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={addCategory}
          disabled={!newName.trim()}
          className="h-8"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      </div>

      {/* Deactivate confirmation dialog */}
      <AlertDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide Category</AlertDialogTitle>
            <AlertDialogDescription>
              "{deactivateTarget?.name}" will be hidden from the snapshot table
              and future snapshots. Historical data will be preserved but not
              displayed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deactivateCategory}>
              Hide Category
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
