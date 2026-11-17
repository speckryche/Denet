import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PlatformMetrics {
  totalSales: number;
  totalFees: number;
  totalOperatorFees: number;
  totalBitcoinSent: number;
  activeATMCount: number;
}

interface MetricsGridProps {
  denetMetrics: PlatformMetrics;
  bitstopMetrics: PlatformMetrics;
  // Optional 4th card: actionable pending-resolution count (usePendingCount).
  // null = unknown/loading; the card is hidden rather than showing "0".
  pendingCount?: number | null;
}

export function KpiCard({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        'rounded-[14px] border border-border bg-card px-[18px] py-4 shadow-sm',
        className
      )}
    >
      <div className="text-xs font-semibold tracking-[0.02em] text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight tabular-nums text-card-foreground">
        {value}
      </div>
      {sub && <div className="mt-1.5 text-xs font-medium text-dim">{sub}</div>}
    </article>
  );
}

export function MetricsGrid({ denetMetrics, bitstopMetrics, pendingCount }: MetricsGridProps) {
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  const formatPercent = (value: number) => `${value.toFixed(2)}%`;

  // Same gross-profit definition as before: fees minus Bitstop (operator) fees.
  const grossProfit = (m: PlatformMetrics) => m.totalFees - m.totalOperatorFees;

  // Combined totals
  const combined: PlatformMetrics = {
    totalSales: denetMetrics.totalSales + bitstopMetrics.totalSales,
    totalFees: denetMetrics.totalFees + bitstopMetrics.totalFees,
    totalOperatorFees: denetMetrics.totalOperatorFees + bitstopMetrics.totalOperatorFees,
    totalBitcoinSent: denetMetrics.totalBitcoinSent + bitstopMetrics.totalBitcoinSent,
    activeATMCount: denetMetrics.activeATMCount + bitstopMetrics.activeATMCount,
  };

  const combinedGP = grossProfit(combined);
  const gpPercent = combined.totalSales > 0 ? (combinedGP / combined.totalSales) * 100 : 0;
  const feesPercent = combined.totalSales > 0 ? (combined.totalFees / combined.totalSales) * 100 : 0;
  const showPending = pendingCount != null;

  return (
    <section
      className={cn(
        'grid grid-cols-1 gap-3.5 sm:grid-cols-2',
        showPending ? 'xl:grid-cols-4' : 'xl:grid-cols-3'
      )}
    >
      <KpiCard
        label="Total sales"
        value={formatCurrency(combined.totalSales)}
        sub={
          <>
            <span className="block">
              Denet {formatCurrency(denetMetrics.totalSales)} · Bitstop {formatCurrency(bitstopMetrics.totalSales)}
            </span>
            <span className="block">
              Fees {formatCurrency(combined.totalFees)} ({formatPercent(feesPercent)}) · Bitstop fees{' '}
              {formatCurrency(combined.totalOperatorFees)}
            </span>
          </>
        }
      />
      <KpiCard
        label="Gross profit"
        value={
          <span className={cn(combinedGP < 0 && 'text-danger')}>{formatCurrency(combinedGP)}</span>
        }
        sub={
          <>
            <span className="block">{formatPercent(gpPercent)} of sales</span>
            <span className="block">
              Denet {formatCurrency(grossProfit(denetMetrics))} · Bitstop {formatCurrency(grossProfit(bitstopMetrics))}
            </span>
          </>
        }
      />
      <KpiCard
        label="Active BTMs"
        value={combined.activeATMCount.toLocaleString('en-US')}
        sub={
          <>
            {denetMetrics.activeATMCount} Denet · {bitstopMetrics.activeATMCount} Bitstop
          </>
        }
      />
      {pendingCount != null && (
        <KpiCard
          label="Awaiting resolution"
          value={pendingCount.toLocaleString('en-US')}
          sub="Pending · all dates & platforms"
        />
      )}
    </section>
  );
}
