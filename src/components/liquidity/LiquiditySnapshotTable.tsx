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

export function LiquiditySnapshotTable({
  snapshots,
  categories,
  onEdit,
  onDelete,
}: LiquiditySnapshotTableProps) {
  const activeCategories = categories.filter((c) => c.active);

  const computeSnapshotTotals = (snapshot: LiquiditySnapshot) => {
    const valueMap = new Map(
      snapshot.liquidity_snapshot_values.map((v) => [v.category_id, v.value])
    );
    let assetTotal = 0;
    let liabilityTotal = 0;
    activeCategories.forEach((cat) => {
      const val = valueMap.get(cat.id) || 0;
      if (cat.type === 'liability') liabilityTotal += val;
      else assetTotal += val; // both 'asset' and 'crypto' are assets
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

  return (
    <div className="overflow-x-auto -mx-6">
      <table className="w-full text-sm border-collapse">
        <thead>
          {/* Action row */}
          <tr className="border-b border-white/5">
            <th className="sticky left-0 z-20 bg-card px-4 py-2 text-left w-[200px] min-w-[200px]" />
            {snapshots.map((snap) => (
              <th
                key={snap.id}
                className="px-4 py-2 text-center min-w-[120px]"
              >
                <div className="flex items-center justify-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => onEdit(snap)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-red-400"
                    onClick={() => onDelete(snap.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </th>
            ))}
          </tr>
          {/* Date row */}
          <tr className="border-b border-white/10">
            <th className="sticky left-0 z-20 bg-card px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Asset
            </th>
            {snapshots.map((snap) => (
              <th
                key={snap.id}
                className="px-4 py-2.5 text-center font-semibold text-primary whitespace-nowrap"
              >
                {formatDate(snap.snapshot_date)}
              </th>
            ))}
          </tr>
          {/* BTC Price row */}
          <tr className="border-b border-white/5 bg-white/[0.02]">
            <td className="sticky left-0 z-20 bg-card px-4 py-2 text-xs text-muted-foreground italic">
              Bitcoin Price
            </td>
            {snapshots.map((snap) => (
              <td
                key={snap.id}
                className="px-4 py-2 text-center text-xs font-mono text-amber-400/80"
              >
                {formatCurrency(snap.bitcoin_price)}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {activeCategories.map((cat, idx) => {
            const isLiability = cat.type === 'liability';
            const isCrypto = cat.type === 'crypto';
            return (
              <tr
                key={cat.id}
                className={cn(
                  'border-b border-white/5 transition-colors hover:bg-white/[0.02]',
                  idx === 0 && 'border-t border-white/10'
                )}
              >
                <td
                  className={cn(
                    'sticky left-0 z-20 bg-card px-4 py-2.5 font-medium whitespace-nowrap',
                    isLiability && 'text-red-400/90',
                    isCrypto && 'text-amber-400/90'
                  )}
                >
                  {cat.name}
                  {isLiability && (
                    <span className="ml-1.5 text-[10px] text-red-400/50 uppercase tracking-wider">
                      owed
                    </span>
                  )}
                </td>
                {snapshots.map((snap) => {
                  const snapVal = snap.liquidity_snapshot_values.find(
                    (v) => v.category_id === cat.id
                  );
                  const val = snapVal?.value || 0;
                  const qty = snapVal?.quantity;
                  return (
                    <td
                      key={snap.id}
                      className={cn(
                        'px-4 py-2.5 text-right font-mono tabular-nums',
                        isLiability && val > 0 && 'text-red-400/80'
                      )}
                    >
                      {isCrypto && qty != null && qty > 0 ? (
                        <div>
                          <div className="text-[11px] text-amber-400/60">
                            {qty.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 4,
                            })}{' '}
                            {cat.ticker}
                          </div>
                          <div>{formatCurrency(val)}</div>
                        </div>
                      ) : val === 0 ? (
                        <span className="text-white/20">$0</span>
                      ) : (
                        formatCurrency(isLiability ? -val : val)
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {/* Total row */}
          <tr className="border-t-2 border-primary/30 bg-white/[0.03]">
            <td className="sticky left-0 z-20 bg-card px-4 py-3 font-bold text-foreground">
              Total
            </td>
            {snapshots.map((snap) => {
              const { total } = computeSnapshotTotals(snap);
              return (
                <td
                  key={snap.id}
                  className="px-4 py-3 text-right font-mono font-bold tabular-nums text-foreground"
                >
                  {formatCurrency(total)}
                </td>
              );
            })}
          </tr>
          {/* Starting Liquidity */}
          <tr className="border-b border-white/5">
            <td className="sticky left-0 z-20 bg-card px-4 py-2 text-muted-foreground text-sm">
              Starting Liquidity
            </td>
            {snapshots.map((snap) => (
              <td
                key={snap.id}
                className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground"
              >
                {formatCurrency(STARTING_LIQUIDITY)}
              </td>
            ))}
          </tr>
          {/* Gain in Liquidity */}
          <tr className="border-b border-white/5">
            <td className="sticky left-0 z-20 bg-card px-4 py-2 font-semibold text-green-400">
              Gain in Liquidity
            </td>
            {snapshots.map((snap) => {
              const { gain } = computeSnapshotTotals(snap);
              return (
                <td
                  key={snap.id}
                  className={cn(
                    'px-4 py-2 text-right font-mono font-semibold tabular-nums',
                    gain >= 0 ? 'text-green-400' : 'text-red-400'
                  )}
                >
                  {formatCurrency(gain)}
                </td>
              );
            })}
          </tr>
          {/* Daily Profit Avg */}
          <tr>
            <td className="sticky left-0 z-20 bg-card px-4 py-2 text-muted-foreground text-sm">
              Daily Profit Avg
            </td>
            {snapshots.map((snap) => {
              const { dailyAvg } = computeSnapshotTotals(snap);
              return (
                <td
                  key={snap.id}
                  className="px-4 py-2 text-right font-mono tabular-nums text-muted-foreground"
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
