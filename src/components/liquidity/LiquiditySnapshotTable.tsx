import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2 } from 'lucide-react';
import { formatCurrency as formatUSD } from '@/lib/format';

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

interface LiquiditySnapshotTableProps {
  snapshots: LiquiditySnapshot[];
  categories: LiquidityCategory[];
  onEdit: (snapshot: LiquiditySnapshot) => void;
  onDelete: (snapshotId: string) => void;
}

const STARTING_LIQUIDITY = 150_000;
const DENET_START_DATE = new Date('2022-05-01');

// Whole dollars with Intl's half-away-from-zero rounding, as this file always used.
const formatCurrency = (value: number) => formatUSD(value, 0, { halfAwayFromZero: true });

const formatSigned = (value: number) =>
  `${value > 0 ? '+' : ''}${formatCurrency(value)}`;

const formatDate = (dateStr: string): string => {
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}/${year.slice(2)}`;
};

const stickyHead =
  'sticky left-0 z-20 bg-table-header-bg text-table-header-fg';
const stickyCell = 'sticky left-0 z-20 bg-card';
const stickyFoot = 'sticky left-0 z-20 bg-card';
const colRule = 'border-l border-border';
const cell = 'px-2 py-1 min-[1440px]:py-1.5';

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
    const val = Number(snapVal?.value) || 0;
    const qty = Number(snapVal?.quantity) || 0;
    const isLiability = cat.type === 'liability';
    const isCrypto = cat.type === 'crypto';

    return (
      <td
        key={snap.id}
        className={cn(
          cell,
          colRule,
          'text-right tabular-nums text-[12.5px] bg-card border-b border-table-row-border group-hover/row:bg-surface-2',
          isLiability && val > 0 && 'text-danger'
        )}
      >
        {isCrypto ? (
          <div className="leading-tight">
            <div className="text-[10.5px] text-dim font-medium mb-0.5">
              {qty.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 4,
              })}{' '}
              {cat.ticker}
            </div>
            <div>{formatCurrency(val)}</div>
          </div>
        ) : (
          formatCurrency(isLiability && val > 0 ? -val : val)
        )}
      </td>
    );
  };

  const renderSectionHeader = (label: string) => (
    <tr>
      <td
        className={cn(
          stickyHead,
          'px-2 py-1 text-[10.5px] font-bold uppercase tracking-[0.08em]'
        )}
      >
        {label}
      </td>
      {snapshots.map((snap) => (
        <td
          key={snap.id}
          className="bg-table-header-bg py-1"
        />
      ))}
    </tr>
  );

  const renderCategoryRow = (cat: LiquidityCategory) => {
    return (
      <tr key={cat.id} className="group/row">
        <td
          className={cn(
            stickyCell,
            cell,
            'font-medium whitespace-nowrap text-[12.5px] text-foreground border-b border-table-row-border group-hover/row:bg-surface-2'
          )}
        >
          {cat.name}
        </td>
        {snapshots.map((snap) => renderValueCell(snap, cat))}
      </tr>
    );
  };

  return (
    <div className="min-w-0 w-full overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-[12.5px]">
        <colgroup>
          <col style={{ width: '158px' }} />
          {snapshots.map((snap) => (
            <col key={snap.id} />
          ))}
        </colgroup>

        <thead>
          <tr className="bg-table-header-bg text-table-header-fg">
            <th
              className={cn(
                stickyHead,
                'px-2 py-1 min-[1440px]:py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.08em]'
              )}
            >
              Asset
            </th>
            {snapshots.map((snap) => (
              <th
                key={snap.id}
                className="px-2 py-1 min-[1440px]:py-1.5 text-center text-table-header-fg border-l border-table-header-fg/20"
              >
                <div className="font-bold tabular-nums text-xs">
                  {formatDate(snap.snapshot_date)}
                </div>
                <div className="mt-0.5 flex items-center justify-center gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-table-header-fg/70 hover:bg-table-header-fg/10 hover:text-table-header-fg"
                    onClick={() => onEdit(snap)}
                    title="Edit snapshot"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-table-header-fg/70 hover:bg-table-header-fg/10 hover:text-danger"
                    onClick={() => onDelete(snap.id)}
                    title="Delete snapshot"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          <tr>
            <td
              className={cn(
                stickyCell,
                'px-2 py-1 text-[12px] font-medium text-dim border-b border-table-row-border'
              )}
            >
              Bitcoin price
            </td>
            {snapshots.map((snap) => (
              <td
                key={snap.id}
                className={cn(
                  'px-2 py-1 text-right text-[12px] tabular-nums text-muted-foreground bg-card border-b border-table-row-border',
                  colRule
                )}
              >
                {formatCurrency(snap.bitcoin_price)}
              </td>
            ))}
          </tr>
          <tr>
            <td
              className={cn(
                stickyCell,
                'px-2 py-1 text-[12px] font-medium text-dim border-b border-table-row-border'
              )}
            >
              Solana price
            </td>
            {snapshots.map((snap) => (
              <td
                key={snap.id}
                className={cn(
                  'px-2 py-1 text-right text-[12px] tabular-nums text-muted-foreground bg-card border-b border-table-row-border',
                  colRule
                )}
              >
                {formatCurrency(snap.solana_price)}
              </td>
            ))}
          </tr>

          {assets.length > 0 && renderSectionHeader('Cash assets')}
          {assets.map((cat) => renderCategoryRow(cat))}

          {cryptos.length > 0 && renderSectionHeader('Crypto assets')}
          {cryptos.map((cat) => renderCategoryRow(cat))}

          {liabilities.length > 0 && renderSectionHeader('Liabilities')}
          {liabilities.map((cat) => renderCategoryRow(cat))}
        </tbody>

        <tfoot>
          <tr>
            <td
              className={cn(
                'sticky left-0 z-20 bg-surface-2 px-2 py-1.5 min-[1440px]:py-2 font-bold text-foreground text-[13.5px] border-t-2 border-table-row-border'
              )}
            >
              Total
            </td>
            {snapshots.map((snap) => {
              const { total } = computeSnapshotTotals(snap);
              return (
                <td
                  key={snap.id}
                  className={cn(
                    'px-2 py-1.5 min-[1440px]:py-2 text-right tabular-nums font-bold text-foreground text-[13.5px] bg-surface-2 border-t-2 border-table-row-border',
                    colRule
                  )}
                >
                  {formatCurrency(total)}
                </td>
              );
            })}
          </tr>
          <tr>
            <td
              className={cn(
                stickyFoot,
                cell,
                'text-muted-foreground text-[12.5px] border-b border-table-row-border'
              )}
            >
              Starting liquidity
            </td>
            {snapshots.map((snap) => (
              <td
                key={snap.id}
                className={cn(
                  cell,
                  colRule,
                  'text-right tabular-nums text-muted-foreground text-[12.5px] bg-card border-b border-table-row-border'
                )}
              >
                {formatCurrency(STARTING_LIQUIDITY)}
              </td>
            ))}
          </tr>
          <tr>
            <td
              className={cn(
                stickyFoot,
                cell,
                'font-semibold text-[12.5px] text-foreground border-b border-table-row-border'
              )}
            >
              Gain in liquidity
            </td>
            {snapshots.map((snap) => {
              const { gain } = computeSnapshotTotals(snap);
              return (
                <td
                  key={snap.id}
                  className={cn(
                    cell,
                    colRule,
                    'text-right tabular-nums font-semibold text-[12.5px] bg-card border-b border-table-row-border',
                    gain >= 0 ? 'text-success' : 'text-danger'
                  )}
                >
                  {formatSigned(gain)}
                </td>
              );
            })}
          </tr>
          <tr>
            <td
              className={cn(
                stickyFoot,
                cell,
                'text-muted-foreground text-[12.5px]'
              )}
            >
              Daily profit avg
            </td>
            {snapshots.map((snap) => {
              const { dailyAvg } = computeSnapshotTotals(snap);
              return (
                <td
                  key={snap.id}
                  className={cn(
                    cell,
                    colRule,
                    'text-right tabular-nums text-muted-foreground text-[12.5px] bg-card'
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
