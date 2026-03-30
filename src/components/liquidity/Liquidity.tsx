import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
  ChevronDown,
  Wallet,
  TrendingUp,
  DollarSign,
  Calendar,
  Settings2,
} from 'lucide-react';
import { LiquiditySnapshotTable } from './LiquiditySnapshotTable';
import { AddSnapshotDialog } from './AddSnapshotDialog';
import { CategoryManager } from './CategoryManager';
import { CryptoInvestments } from './CryptoInvestments';

interface LiquidityCategory {
  id: string;
  name: string;
  type: 'asset' | 'liability' | 'crypto';
  display_order: number;
  active: boolean;
  coin_id: string | null;
  ticker: string | null;
}

interface LiquiditySnapshot {
  id: string;
  snapshot_date: string;
  bitcoin_price: number;
  liquidity_snapshot_values: {
    category_id: string;
    value: number;
    quantity: number | null;
  }[];
}

const STARTING_LIQUIDITY = 150_000;
const DENET_START_DATE = new Date('2022-05-01');

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

export default function Liquidity() {
  const [categories, setCategories] = useState<LiquidityCategory[]>([]);
  const [snapshots, setSnapshots] = useState<LiquiditySnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const [editingSnapshot, setEditingSnapshot] =
    useState<LiquiditySnapshot | null>(null);
  const [deleteSnapshotId, setDeleteSnapshotId] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    await Promise.all([fetchCategories(), fetchSnapshots()]);
    setIsLoading(false);
  };

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('liquidity_categories')
      .select('*')
      .order('display_order');
    if (error) console.error('Error fetching categories:', error);
    else setCategories(data || []);
  };

  const fetchSnapshots = async () => {
    const { data, error } = await supabase
      .from('liquidity_snapshots')
      .select(
        `
        id,
        snapshot_date,
        bitcoin_price,
        liquidity_snapshot_values (
          category_id,
          value,
          quantity
        )
      `
      )
      .order('snapshot_date', { ascending: false });
    if (error) console.error('Error fetching snapshots:', error);
    else setSnapshots(data || []);
  };

  const handleEditSnapshot = (snapshot: LiquiditySnapshot) => {
    setEditingSnapshot(snapshot);
    setSnapshotDialogOpen(true);
  };

  const handleDeleteSnapshot = async () => {
    if (!deleteSnapshotId) return;
    const { error } = await supabase
      .from('liquidity_snapshots')
      .delete()
      .eq('id', deleteSnapshotId);
    if (error) console.error('Error deleting snapshot:', error);
    setDeleteSnapshotId(null);
    fetchSnapshots();
  };

  const handleSnapshotSaved = () => {
    setEditingSnapshot(null);
    fetchSnapshots();
  };

  const handleAddNew = () => {
    setEditingSnapshot(null);
    setSnapshotDialogOpen(true);
  };

  // Compute summary from latest snapshot
  const latestSnapshot = snapshots[0];
  let summaryTotal = 0;
  let summaryGain = 0;
  let summaryDailyAvg = 0;

  if (latestSnapshot) {
    const activeCategories = categories.filter((c) => c.active);
    const valueMap = new Map(
      latestSnapshot.liquidity_snapshot_values.map((v) => [
        v.category_id,
        v.value,
      ])
    );
    let assetTotal = 0;
    let liabilityTotal = 0;
    activeCategories.forEach((cat) => {
      const val = valueMap.get(cat.id) || 0;
      if (cat.type === 'liability') liabilityTotal += val;
      else assetTotal += val; // both 'asset' and 'crypto' are assets
    });
    summaryTotal = assetTotal - liabilityTotal;
    summaryGain = summaryTotal - STARTING_LIQUIDITY;
    const daysSinceStart = Math.floor(
      (new Date(latestSnapshot.snapshot_date).getTime() -
        DENET_START_DATE.getTime()) /
        86400000
    );
    summaryDailyAvg = daysSinceStart > 0 ? summaryGain / daysSinceStart : 0;
  }

  const summaryCards = [
    {
      label: 'Current Total',
      value: formatCurrency(summaryTotal),
      icon: <Wallet className="w-4 h-4" />,
      color: 'text-foreground',
    },
    {
      label: 'Starting Liquidity',
      value: formatCurrency(STARTING_LIQUIDITY),
      icon: <DollarSign className="w-4 h-4" />,
      color: 'text-muted-foreground',
    },
    {
      label: 'Gain in Liquidity',
      value: formatCurrency(summaryGain),
      icon: <TrendingUp className="w-4 h-4" />,
      color: summaryGain >= 0 ? 'text-green-400' : 'text-red-400',
      highlight: true,
    },
    {
      label: 'Daily Profit Avg',
      value: formatCurrency(summaryDailyAvg),
      icon: <Calendar className="w-4 h-4" />,
      color: 'text-muted-foreground',
      sub: latestSnapshot
        ? `as of ${new Date(latestSnapshot.snapshot_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}`
        : undefined,
    },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <PageHeader title="Liquidity" />
        <div className="max-w-[95%] mx-auto px-6 py-8">
          <div className="text-center py-16 text-muted-foreground">
            Loading...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader title="Liquidity" />

      <main className="max-w-[95%] mx-auto px-6 py-8 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {summaryCards.map((card) => (
            <Card
              key={card.label}
              className={cn(
                'bg-card/30 border-white/10',
                card.highlight && 'bg-green-500/[0.04] border-green-400/20'
              )}
            >
              <CardContent className="px-5 py-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  <span className={card.color}>{card.icon}</span>
                  {card.label}
                </div>
                <div
                  className={cn(
                    'text-2xl font-bold font-mono tabular-nums',
                    card.color
                  )}
                >
                  {card.value}
                </div>
                {card.sub && (
                  <div className="text-xs text-muted-foreground mt-1">
                    {card.sub}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Liquidity Snapshots Table */}
        <Card className="bg-card/30 border-white/10">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Wallet className="w-5 h-5 text-primary" />
              Liquidity Snapshots
            </CardTitle>
            <Button size="sm" onClick={handleAddNew}>
              <Plus className="w-4 h-4 mr-1.5" />
              Add Snapshot
            </Button>
          </CardHeader>
          <CardContent>
            <LiquiditySnapshotTable
              snapshots={snapshots}
              categories={categories}
              onEdit={handleEditSnapshot}
              onDelete={(id) => setDeleteSnapshotId(id)}
            />
          </CardContent>
        </Card>

        {/* Asset Categories (Collapsible) */}
        <Collapsible open={categoriesOpen} onOpenChange={setCategoriesOpen}>
          <Card className="bg-card/30 border-white/10">
            <CollapsibleTrigger asChild>
              <CardHeader className="flex flex-row items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors rounded-t-xl">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings2 className="w-4 h-4 text-muted-foreground" />
                  Asset Categories
                </CardTitle>
                <ChevronDown
                  className={cn(
                    'w-4 h-4 text-muted-foreground transition-transform',
                    categoriesOpen && 'rotate-180'
                  )}
                />
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <CategoryManager
                  categories={categories}
                  onChanged={fetchCategories}
                />
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Crypto Investments */}
        <CryptoInvestments />
      </main>

      {/* Snapshot Add/Edit Dialog */}
      <AddSnapshotDialog
        open={snapshotDialogOpen}
        onOpenChange={(open) => {
          setSnapshotDialogOpen(open);
          if (!open) setEditingSnapshot(null);
        }}
        categories={categories}
        editingSnapshot={editingSnapshot}
        onSaved={handleSnapshotSaved}
      />

      {/* Delete Snapshot Confirmation */}
      <AlertDialog
        open={!!deleteSnapshotId}
        onOpenChange={(open) => !open && setDeleteSnapshotId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Snapshot</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this liquidity snapshot and all its
              values. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSnapshot}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
