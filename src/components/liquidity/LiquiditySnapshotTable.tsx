import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2 } from 'lucide-react';

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

interface LiquiditySnapshotTableProps {
  snapshots: LiquiditySnapshot[];
  categories: LiquidityCategory[];
  onEdit: (snapshot: LiquiditySnapshot) => void;
  onDelete: (snapshotId: string) => void;
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

const cellPad = 'px-5 py-2.5';
const stickyBg = 'bg-[#161B22]';

export function LiquiditySnapshotTable({
  snapshots,
  categories,
  onEdit,
  onDelete,
}: LiquiditySnapshotTableProps) {
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

  if (snapshots.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">No snapshots yet</p>
        <p className="text-sm mt-1">
          Add your first liquidity snapshot to get started.
        </p>
      </div>
    );
  }

  const renderValueCell = (
    snap: LiquiditySnapshot,
    cat: LiquidityCategory
  ) => {
    const snapVal = snap.liquidity_snapshot_values.find(
      (v) => v.category_id === cat.id
    );
    const val = snapVal?.value || 0;
    const qty = snapVal?.quantity;
    const isLiability = cat.type === 'liability';
    const isCrypto = cat.type === 'crypto';

    return (
      <td
        key={snap.id}
        className={cn(
          cellPad,
          'text-right font-mono tabular-nums text-base',
          isLiability && val > 0 && 'text-red-400'
        )}
      >
        {isCrypto && qty != null && qty > 0 ? (
          <div>
            <div className="text-xs text-amber-400/60 mb-0.5">
              {qty.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}{' '}
              {cat.ticker}
            </div>
            <div>{formatCurrency(val)}</div>
          </div>
        ) : val === 0 ? (
          <span className="text-white/15">$0</span>
        ) : (
          formatCurrency(isLiability ? -val : val)
        )}
      </td>
    );
  };

  const renderSectionHeader = (label: string, color: string) => (
    <tr>
      <td
        className={cn(
          'sticky left-0 z-20',
          stickyBg,
          'px-5 pt-5 pb-1.5 text-xs font-bold uppercase tracking-widest',
          color
        )}
      >
        {label}
      </td>
      {snapshots.map((snap) => (
        <td key={snap.id} className="pt-5 pb-1.5" />
      ))}
    </tr>
  );

  const renderCategoryRow = (cat: LiquidityCategory, isEven: boolean) => {
    const isLiability = cat.type === 'liability';
    const isCrypto = cat.type === 'crypto';
    return (
      <tr
        key={cat.id}
        className={cn(
          'border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]',
          isEven && 'bg-white/[0.015]'
        )}
      >
        <td
          className={cn(
            'sticky left-0 z-20',
            stickyBg,
            cellPad,
            'font-medium whitespace-nowrap text-sm',
            isLiability && 'text-red-400/90',
            isCrypto && 'text-amber-400/90'
          )}
          style={isEven ? { backgroundColor: 'rgba(255,255,255,0.015)' } : undefined}
        >
          {cat.name}
        </td>
        {snapshots.map((snap) => renderValueCell(snap, cat))}
      </tr>
    );
  };

  return (
    <div className="overflow-x-auto -mx-6">
      <table className="border-collapse" style={{ minWidth: 'auto' }}>
        <colgroup>
          <col style={{ width: '220px', minWidth: '220px' }} />
          {snapshots.map((snap) => (
            <col key={snap.id} style={{ width: '150px', minWidth: '150px' }} />
          ))}
        </colgroup>

        <thead>
          <tr className="border-b-2 border-white/10">
            <th
              className={cn(
                'sticky left-0 z-20',
                stickyBg,
                'px-5 py-3 text-left text-xs font-bold uppercase tracking-widest text-muted-foreground'
              )}
            >
              Asset
            </th>
            {snapshots.map((snap) => (
              <th key={snap.id} className="px-5 py-3 text-right">
                <div className="flex items-center justify-end gap-2">
                  <span className="font-bold text-primary text-base whitespace-nowrap">
                    {formatDate(snap.snapshot_date)}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground/50 hover:text-foreground"
                      onClick={() => onEdit(snap)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground/50 hover:text-red-400"
                      onClick={() => onDelete(snap.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              </th>
            ))}
          </tr>
          {/* BTC Price row */}
          <tr className="border-b border-white/[0.06] bg-amber-400/[0.03]">
            <td
              className={cn(
                'sticky left-0 z-20',
                stickyBg,
                'px-5 py-2 text-sm text-amber-400/70 font-medium bg-amber-400/[0.03]'
              )}
            >
              Bitcoin Price
            </td>
            {snapshots.map((snap) => (
              <td
                key={snap.id}
                className="px-5 py-2 text-right text-sm font-mono font-semibold text-amber-400/80"
              >
                {formatCurrency(snap.bitcoin_price)}
              </td>
            ))}
          </tr>
        </thead>

        <tbody>
          {assets.length > 0 &&
            renderSectionHeader('Cash Assets', 'text-green-400/60')}
          {assets.map((cat, idx) => renderCategoryRow(cat, idx % 2 === 1))}

          {cryptos.length > 0 &&
            renderSectionHeader('Crypto Assets', 'text-amber-400/60')}
          {cryptos.map((cat, idx) => renderCategoryRow(cat, idx % 2 === 1))}

          {liabilities.length > 0 &&
            renderSectionHeader('Liabilities', 'text-red-400/60')}
          {liabilities.map((cat, idx) => renderCategoryRow(cat, idx % 2 === 1))}
        </tbody>

        <tfoot>
          <tr className="border-t-2 border-primary/40 bg-primary/[0.05]">
            <td
              className={cn(
                'sticky left-0 z-20',
                stickyBg,
                'px-5 py-3 font-bold text-foreground text-base bg-primary/[0.05]'
              )}
            >
              Total
            </td>
            {snapshots.map((snap) => {
              const { total } = computeSnapshotTotals(snap);
              return (
                <td
                  key={snap.id}
                  className="px-5 py-3 text-right font-mono font-bold tabular-nums text-foreground text-lg"
                >
                  {formatCurrency(total)}
                </td>
              );
            })}
          </tr>
          <tr className="border-b border-white/[0.04]">
            <td
              className={cn(
                'sticky left-0 z-20',
                stickyBg,
                cellPad,
                'text-muted-foreground text-sm'
              )}
            >
              Starting Liquidity
            </td>
            {snapshots.map((snap) => (
              <td
                key={snap.id}
                className={cn(
                  cellPad,
                  'text-right font-mono tabular-nums text-muted-foreground text-base'
                )}
              >
                {formatCurrency(STARTING_LIQUIDITY)}
              </td>
            ))}
          </tr>
          <tr className="border-b border-white/[0.04] bg-green-500/[0.03]">
            <td
              className={cn(
                'sticky left-0 z-20',
                stickyBg,
                cellPad,
                'font-bold text-green-400 bg-green-500/[0.03] text-sm'
              )}
            >
              Gain in Liquidity
            </td>
            {snapshots.map((snap) => {
              const { gain } = computeSnapshotTotals(snap);
              return (
                <td
                  key={snap.id}
                  className={cn(
                    cellPad,
                    'text-right font-mono font-bold tabular-nums text-base',
                    gain >= 0 ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {formatCurrency(gain)}
                </td>
              );
            })}
          </tr>
          <tr>
            <td
              className={cn(
                'sticky left-0 z-20',
                stickyBg,
                cellPad,
                'text-muted-foreground text-sm'
              )}
            >
              Daily Profit Avg
            </td>
            {snapshots.map((snap) => {
              const { dailyAvg } = computeSnapshotTotals(snap);
              return (
                <td
                  key={snap.id}
                  className={cn(
                    cellPad,
                    'text-right font-mono tabular-nums text-muted-foreground text-base'
                  )}
                >
                  {formatCurrency(dailyAvg)}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
