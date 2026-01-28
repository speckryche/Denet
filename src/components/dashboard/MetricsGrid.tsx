import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

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
}

function StatBar({
  label,
  labelColor,
  metrics,
  className,
}: {
  label: string;
  labelColor: string;
  metrics: { label: string; value: string; sub?: string; highlight?: boolean }[];
  className?: string;
}) {
  return (
    <div className={cn('space-y-3', className)}>
      <h3 className={cn('text-lg font-semibold', labelColor)}>{label}</h3>
      <Card className="bg-card border-white/5">
        <CardContent className="p-0">
          <div className="flex divide-x divide-white/5">
            {metrics.map((m) => (
              <div
                key={m.label}
                className={cn(
                  'flex-1 px-5 py-4 text-center',
                  m.highlight && 'bg-green-500/5'
                )}
              >
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  {m.label}
                </div>
                <div
                  className={cn(
                    'text-xl font-bold font-mono',
                    m.highlight ? 'text-green-400' : 'text-foreground'
                  )}
                >
                  {m.value}
                </div>
                {m.sub && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {m.sub}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function MetricsGrid({ denetMetrics, bitstopMetrics }: MetricsGridProps) {
  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);

  const formatPercent = (value: number) => `${value.toFixed(2)}%`;

  const buildMetrics = (m: PlatformMetrics) => {
    const grossProfit = m.totalFees - m.totalOperatorFees;
    const feesP = m.totalSales > 0 ? (m.totalFees / m.totalSales) * 100 : 0;
    const opP = m.totalSales > 0 ? (m.totalOperatorFees / m.totalSales) * 100 : 0;
    const gpP = m.totalSales > 0 ? (grossProfit / m.totalSales) * 100 : 0;

    return [
      { label: 'Active BTMs', value: m.activeATMCount.toString() },
      { label: 'Total Sales', value: formatCurrency(m.totalSales) },
      { label: 'Total Fees', value: formatCurrency(m.totalFees), sub: formatPercent(feesP) },
      { label: 'Bitstop Fees', value: formatCurrency(m.totalOperatorFees), sub: formatPercent(opP) },
      { label: 'Gross Profit', value: formatCurrency(grossProfit), sub: formatPercent(gpP), highlight: true },
    ];
  };

  // Combined totals
  const combined: PlatformMetrics = {
    totalSales: denetMetrics.totalSales + bitstopMetrics.totalSales,
    totalFees: denetMetrics.totalFees + bitstopMetrics.totalFees,
    totalOperatorFees: denetMetrics.totalOperatorFees + bitstopMetrics.totalOperatorFees,
    totalBitcoinSent: denetMetrics.totalBitcoinSent + bitstopMetrics.totalBitcoinSent,
    activeATMCount: denetMetrics.activeATMCount + bitstopMetrics.activeATMCount,
  };

  return (
    <div className="space-y-6">
      <StatBar label="Denet Platform" labelColor="text-primary" metrics={buildMetrics(denetMetrics)} />
      <StatBar label="Bitstop Platform" labelColor="text-orange-400" metrics={buildMetrics(bitstopMetrics)} />
      <StatBar
        label="Total (Both Platforms)"
        labelColor="text-green-400"
        metrics={buildMetrics(combined)}
        className="pt-6 border-t-2 border-primary/30"
      />
    </div>
  );
}
