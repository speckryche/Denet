import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import XLSX from 'xlsx-js-style';
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
  FileSpreadsheet,
  Upload,
  Loader2,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LiquiditySnapshotTable } from './LiquiditySnapshotTable';
import { AddSnapshotDialog } from './AddSnapshotDialog';
import { ImportSnapshotsDialog } from './ImportSnapshotsDialog';
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
  solana_price: number;
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

const formatDate = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}/${year.slice(2)}`;
};

export default function Liquidity() {
  const [categories, setCategories] = useState<LiquidityCategory[]>([]);
  const [snapshots, setSnapshots] = useState<LiquiditySnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [snapshotDialogOpen, setSnapshotDialogOpen] = useState(false);
  const [editingSnapshot, setEditingSnapshot] =
    useState<LiquiditySnapshot | null>(null);
  const [deleteSnapshotId, setDeleteSnapshotId] = useState<string | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [showCount, setShowCount] = useState<number | 'all'>(5);

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
        solana_price,
        liquidity_snapshot_values (
          category_id,
          value,
          quantity
        )
      `
      )
      .order('snapshot_date', { ascending: true });
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

  // Backfill missing BTC/SOL prices from CoinGecko historical API
  const [isBackfilling, setIsBackfilling] = useState(false);
  const handleBackfillPrices = async () => {
    const missing = snapshots.filter(
      (s) => !s.bitcoin_price || s.bitcoin_price === 0 || !s.solana_price || s.solana_price === 0
    );
    if (missing.length === 0) return;
    setIsBackfilling(true);

    for (const snap of missing) {
      try {
        const [y, m, d] = snap.snapshot_date.split('-');
        const cgDate = `${d}-${m}-${y}`;

        // Fetch BTC price if missing
        const needsBtc = !snap.bitcoin_price || snap.bitcoin_price === 0;
        const needsSol = !snap.solana_price || snap.solana_price === 0;

        const updates: Record<string, number> = {};

        if (needsBtc) {
          const res = await fetch(
            `https://api.coingecko.com/api/v3/coins/bitcoin/history?date=${cgDate}&localization=false`
          );
          const data = await res.json();
          const price = data?.market_data?.current_price?.usd;
          if (price) {
            updates.bitcoin_price = Math.round(price);
          }
          await new Promise((r) => setTimeout(r, 1500));
        }

        if (needsSol) {
          const res = await fetch(
            `https://api.coingecko.com/api/v3/coins/solana/history?date=${cgDate}&localization=false`
          );
          const data = await res.json();
          const price = data?.market_data?.current_price?.usd;
          if (price) {
            updates.solana_price = Math.round(price * 100) / 100;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }

        if (Object.keys(updates).length > 0) {
          await supabase
            .from('liquidity_snapshots')
            .update(updates)
            .eq('id', snap.id);

          // Also update crypto quantities where missing
          const btcPrice = updates.bitcoin_price || snap.bitcoin_price;
          const vals = snap.liquidity_snapshot_values || [];
          for (const v of vals) {
            const cat = categories.find((c) => c.id === v.category_id);
            if (
              cat?.type === 'crypto' &&
              cat.coin_id === 'bitcoin' &&
              btcPrice > 0 &&
              v.value > 0 &&
              (!v.quantity || v.quantity === 0)
            ) {
              const estQty = parseFloat((v.value / btcPrice).toFixed(4));
              await supabase
                .from('liquidity_snapshot_values')
                .update({ quantity: estQty })
                .eq('snapshot_id', snap.id)
                .eq('category_id', v.category_id);
            }
          }
        }
      } catch (err) {
        console.error(`Failed to fetch price for ${snap.snapshot_date}:`, err);
      }
    }

    setIsBackfilling(false);
    fetchSnapshots();
  };

  const missingPriceCount = snapshots.filter(
    (s) => !s.bitcoin_price || s.bitcoin_price === 0 || !s.solana_price || s.solana_price === 0
  ).length;

  // Compute summary from latest snapshot (last in array since sorted ascending)
  const latestSnapshot =
    snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  let summaryTotal = 0;
  let summaryGain = 0;
  let summaryDailyAvg = 0;

  const activeCategories = categories.filter((c) => c.active);
  const assets = activeCategories.filter((c) => c.type === 'asset');
  const cryptos = activeCategories.filter((c) => c.type === 'crypto');
  const liabilities = activeCategories.filter((c) => c.type === 'liability');

  const computeSnapshotTotals = (snapshot: LiquiditySnapshot) => {
    const valueMap = new Map(
      snapshot.liquidity_snapshot_values.map((v) => [v.category_id, v.value])
    );
    let assetTotal = 0;
    let liabilityTotal = 0;
    activeCategories.forEach((cat) => {
      const val = valueMap.get(cat.id) || 0;
      if (cat.type === 'liability') liabilityTotal += val;
      else assetTotal += val;
    });
    const total = assetTotal - liabilityTotal;
    const gain = total - STARTING_LIQUIDITY;
    const daysSinceStart = Math.floor(
      (new Date(snapshot.snapshot_date).getTime() -
        DENET_START_DATE.getTime()) /
        86400000
    );
    const dailyAvg = daysSinceStart > 0 ? gain / daysSinceStart : 0;
    return { total, gain, dailyAvg };
  };

  if (latestSnapshot) {
    const totals = computeSnapshotTotals(latestSnapshot);
    summaryTotal = totals.total;
    summaryGain = totals.gain;
    summaryDailyAvg = totals.dailyAvg;
  }

  // ── Excel Export ──────────────────────────────────────────────
  const exportToExcel = (snapshotsToExport: LiquiditySnapshot[], filename: string) => {
    const numCols = snapshotsToExport.length;
    const data: any[][] = [];

    const border = {
      top: { style: 'thin', color: { rgb: '000000' } },
      bottom: { style: 'thin', color: { rgb: '000000' } },
      left: { style: 'thin', color: { rgb: '000000' } },
      right: { style: 'thin', color: { rgb: '000000' } },
    };

    const headerStyle = {
      font: { bold: true, sz: 12, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1F2937' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border,
    };

    const labelStyle = {
      font: { sz: 11 },
      alignment: { horizontal: 'left', vertical: 'center' },
      border,
    };

    const currencyStyle = {
      font: { sz: 11 },
      alignment: { horizontal: 'right', vertical: 'center' },
      border,
      numFmt: '$#,##0',
    };

    const sectionHeaderFont = (rgb: string) => ({
      font: { bold: true, sz: 10, color: { rgb } },
      alignment: { horizontal: 'left', vertical: 'center' },
    });

    const totalLabelStyle = {
      font: { bold: true, sz: 12 },
      fill: { fgColor: { rgb: 'D1D5DB' } },
      alignment: { horizontal: 'left', vertical: 'center' },
      border,
    };

    const totalValueStyle = {
      font: { bold: true, sz: 12 },
      fill: { fgColor: { rgb: 'D1D5DB' } },
      alignment: { horizontal: 'right', vertical: 'center' },
      border,
      numFmt: '$#,##0',
    };

    // Row 0: Title
    data.push(['DeNet Liquidity Tracking', ...Array(numCols).fill('')]);

    // Row 1: empty spacer
    data.push(Array(numCols + 1).fill(''));

    // Row 2: Date headers
    data.push(['Asset', ...snapshotsToExport.map((s) => formatDate(s.snapshot_date))]);

    // Row 3: Bitcoin Price
    data.push(['Bitcoin Price', ...snapshotsToExport.map((s) => s.bitcoin_price)]);

    // Row 4: Solana Price
    data.push(['Solana Price', ...snapshotsToExport.map((s) => s.solana_price)]);

    // Row 5: empty spacer
    data.push(Array(numCols + 1).fill(''));

    // Track row index for styling
    let rowIdx = 6;

    // CASH ASSETS section header
    data.push(['CASH ASSETS', ...Array(numCols).fill('')]);
    const cashHeaderRow = rowIdx++;

    // Cash asset rows
    const cashRows: number[] = [];
    assets.forEach((cat) => {
      const row: any[] = [cat.name];
      snapshotsToExport.forEach((snap) => {
        const val = snap.liquidity_snapshot_values.find((v) => v.category_id === cat.id)?.value || 0;
        row.push(val);
      });
      data.push(row);
      cashRows.push(rowIdx++);
    });

    // Empty row
    data.push(Array(numCols + 1).fill(''));
    rowIdx++;

    // CRYPTO ASSETS section header
    data.push(['CRYPTO ASSETS', ...Array(numCols).fill('')]);
    const cryptoHeaderRow = rowIdx++;

    // Crypto asset rows
    const cryptoRows: number[] = [];
    cryptos.forEach((cat) => {
      const row: any[] = [cat.name];
      snapshotsToExport.forEach((snap) => {
        const snapVal = snap.liquidity_snapshot_values.find((v) => v.category_id === cat.id);
        const val = snapVal?.value || 0;
        const qty = snapVal?.quantity;
        if (qty != null && qty > 0) {
          row.push(val); // Store numeric value; we'll add quantity as a note via comment-style
        } else {
          row.push(val);
        }
      });
      data.push(row);
      cryptoRows.push(rowIdx++);
    });

    // Empty row
    data.push(Array(numCols + 1).fill(''));
    rowIdx++;

    // LIABILITIES section header
    data.push(['LIABILITIES', ...Array(numCols).fill('')]);
    const liabHeaderRow = rowIdx++;

    // Liability rows
    const liabRows: number[] = [];
    liabilities.forEach((cat) => {
      const row: any[] = [cat.name];
      snapshotsToExport.forEach((snap) => {
        const val = snap.liquidity_snapshot_values.find((v) => v.category_id === cat.id)?.value || 0;
        row.push(val > 0 ? -val : 0);
      });
      data.push(row);
      liabRows.push(rowIdx++);
    });

    // Empty row
    data.push(Array(numCols + 1).fill(''));
    rowIdx++;

    // TOTAL row
    const totalRowIdx = rowIdx++;
    {
      const row: any[] = ['Total'];
      snapshotsToExport.forEach((snap) => {
        const { total } = computeSnapshotTotals(snap);
        row.push(total);
      });
      data.push(row);
    }

    // Starting Liquidity
    const startingRow = rowIdx++;
    data.push(['Starting Liquidity', ...snapshotsToExport.map(() => STARTING_LIQUIDITY)]);

    // Gain in Liquidity
    const gainRow = rowIdx++;
    {
      const row: any[] = ['Gain in Liquidity'];
      snapshotsToExport.forEach((snap) => {
        const { gain } = computeSnapshotTotals(snap);
        row.push(gain);
      });
      data.push(row);
    }

    // Daily Profit Avg
    const dailyRow = rowIdx++;
    {
      const row: any[] = ['Daily Profit Avg'];
      snapshotsToExport.forEach((snap) => {
        const { dailyAvg } = computeSnapshotTotals(snap);
        row.push(Math.round(dailyAvg));
      });
      data.push(row);
    }

    // Build worksheet
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Column widths
    ws['!cols'] = [
      { wch: 25 },
      ...snapshotsToExport.map(() => ({ wch: 16 })),
    ];

    // Merge title row
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: numCols } },
    ];

    // Helper to get cell ref
    const cell = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });

    // Style title row
    const titleCell = ws[cell(0, 0)];
    if (titleCell) {
      titleCell.s = {
        font: { bold: true, sz: 14, color: { rgb: '1F2937' } },
        fill: { fgColor: { rgb: 'D1D5DB' } },
        alignment: { horizontal: 'left', vertical: 'center' },
      };
    }

    // Style date header row (row 2)
    for (let c = 0; c <= numCols; c++) {
      const ref = cell(2, c);
      if (ws[ref]) ws[ref].s = headerStyle;
    }

    // Style BTC price row (row 3) and SOL price row (row 4)
    for (const priceRow of [3, 4]) {
      for (let c = 0; c <= numCols; c++) {
        const ref = cell(priceRow, c);
        if (ws[ref]) {
          ws[ref].s = {
            font: { bold: true, sz: 11, color: { rgb: 'B45309' } },
            fill: { fgColor: { rgb: 'FEF3C7' } },
            alignment: { horizontal: c === 0 ? 'left' : 'right', vertical: 'center' },
            border,
            numFmt: c > 0 ? '$#,##0' : undefined,
          };
        }
      }
    }

    // Style section headers
    [
      { row: cashHeaderRow, color: '16A34A' },
      { row: cryptoHeaderRow, color: 'D97706' },
      { row: liabHeaderRow, color: 'DC2626' },
    ].forEach(({ row, color }) => {
      const ref = cell(row, 0);
      if (ws[ref]) ws[ref].s = sectionHeaderFont(color);
    });

    // Style data rows
    const allDataRows = [...cashRows, ...cryptoRows, ...liabRows];
    allDataRows.forEach((r) => {
      const labelRef = cell(r, 0);
      if (ws[labelRef]) ws[labelRef].s = labelStyle;
      for (let c = 1; c <= numCols; c++) {
        const ref = cell(r, c);
        if (ws[ref]) {
          const isLiab = liabRows.includes(r);
          ws[ref].s = {
            ...currencyStyle,
            font: {
              sz: 11,
              ...(isLiab ? { color: { rgb: 'DC2626' } } : {}),
            },
          };
        }
      }
    });

    // Style total row
    {
      const ref = cell(totalRowIdx, 0);
      if (ws[ref]) ws[ref].s = totalLabelStyle;
      for (let c = 1; c <= numCols; c++) {
        const r = cell(totalRowIdx, c);
        if (ws[r]) ws[r].s = totalValueStyle;
      }
    }

    // Style starting liquidity row
    {
      const ref = cell(startingRow, 0);
      if (ws[ref]) ws[ref].s = labelStyle;
      for (let c = 1; c <= numCols; c++) {
        const r = cell(startingRow, c);
        if (ws[r]) ws[r].s = currencyStyle;
      }
    }

    // Style gain row
    {
      const ref = cell(gainRow, 0);
      if (ws[ref]) {
        ws[ref].s = {
          font: { bold: true, sz: 11, color: { rgb: '16A34A' } },
          fill: { fgColor: { rgb: 'D1FAE5' } },
          alignment: { horizontal: 'left', vertical: 'center' },
          border,
        };
      }
      for (let c = 1; c <= numCols; c++) {
        const r = cell(gainRow, c);
        if (ws[r]) {
          const val = ws[r].v as number;
          ws[r].s = {
            font: { bold: true, sz: 11, color: { rgb: val >= 0 ? '16A34A' : 'DC2626' } },
            fill: { fgColor: { rgb: val >= 0 ? 'D1FAE5' : 'FEE2E2' } },
            alignment: { horizontal: 'right', vertical: 'center' },
            border,
            numFmt: '$#,##0',
          };
        }
      }
    }

    // Style daily avg row
    {
      const ref = cell(dailyRow, 0);
      if (ws[ref]) ws[ref].s = labelStyle;
      for (let c = 1; c <= numCols; c++) {
        const r = cell(dailyRow, c);
        if (ws[r]) ws[r].s = currencyStyle;
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Liquidity');
    XLSX.writeFile(wb, filename);
  };

  const handleExportAll = () => {
    if (snapshots.length === 0) return;
    exportToExcel(snapshots, 'denet-liquidity-all.xlsx');
  };

  const handleExportLatest = () => {
    if (!latestSnapshot) return;
    const date = latestSnapshot.snapshot_date;
    exportToExcel([latestSnapshot], `denet-liquidity-${date}.xlsx`);
  };

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
            <div className="flex items-center gap-2">
              <Select
                value={String(showCount)}
                onValueChange={(v) =>
                  setShowCount(v === 'all' ? 'all' : parseInt(v))
                }
              >
                <SelectTrigger className="w-[130px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">Last 3</SelectItem>
                  <SelectItem value="5">Last 5</SelectItem>
                  <SelectItem value="10">Last 10</SelectItem>
                  <SelectItem value="20">Last 20</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportDialogOpen(true)}
              >
                <Upload className="w-4 h-4 mr-1.5" />
                Import CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportAll}
                disabled={snapshots.length === 0}
              >
                <FileSpreadsheet className="w-4 h-4 mr-1.5" />
                Export All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportLatest}
                disabled={!latestSnapshot}
              >
                <FileSpreadsheet className="w-4 h-4 mr-1.5" />
                Export Latest
              </Button>
              <Button size="sm" onClick={handleAddNew}>
                <Plus className="w-4 h-4 mr-1.5" />
                Add Snapshot
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {missingPriceCount > 0 && (
              <div className="mb-4 flex items-center justify-between bg-amber-400/10 border border-amber-400/20 rounded-md px-4 py-2.5">
                <span className="text-sm text-amber-400">
                  {missingPriceCount} snapshot{missingPriceCount !== 1 ? 's' : ''} missing price data
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBackfillPrices}
                  disabled={isBackfilling}
                  className="border-amber-400/30 text-amber-400 hover:text-amber-300"
                >
                  {isBackfilling ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      Fetching prices...
                    </>
                  ) : (
                    'Fetch Missing Prices'
                  )}
                </Button>
              </div>
            )}
            <LiquiditySnapshotTable
              snapshots={
                showCount === 'all'
                  ? snapshots
                  : snapshots.slice(-showCount)
              }
              categories={categories}
              onEdit={handleEditSnapshot}
              onDelete={(id) => setDeleteSnapshotId(id)}
            />
          </CardContent>
        </Card>

        {/* Crypto Investments */}
        <CryptoInvestments />

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
      </main>

      {/* Import CSV Dialog */}
      <ImportSnapshotsDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        categories={categories}
        onImported={fetchSnapshots}
      />

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
