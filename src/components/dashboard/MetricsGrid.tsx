import React from 'react';
import { ArrowUpRight, ArrowDownRight, DollarSign, TrendingUp, Users, ShoppingBag, Bitcoin, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MetricCardProps {
  title: string;
  value: string;
  percentage?: string; // Optional percentage to show inline
  percentageValue?: number; // Numeric value to determine color
  trend?: number;
  trendLabel?: string;
  icon: React.ReactNode;
  className?: string;
  delay?: number;
}

function MetricCard({ title, value, percentage, percentageValue, trend, trendLabel, icon, className, delay = 0 }: MetricCardProps) {
  return (
    <Card
      className={cn(
        "bg-card border-white/5 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,102,255,0.15)] group animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground font-sans">
          {title}
        </CardTitle>
        <div className="text-muted-foreground group-hover:text-primary transition-colors duration-300">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold font-mono text-foreground">{value}</div>
          {percentage && (
            <div className={cn(
              "text-lg font-semibold",
              percentageValue !== undefined
                ? percentageValue >= 0 ? "text-green-500" : "text-red-500"
                : "text-muted-foreground"
            )}>
              ({percentage})
            </div>
          )}
        </div>
        {trend !== undefined && (
          <div className="flex items-center text-xs mt-1">
            <span className={cn(
              "flex items-center font-medium mr-2",
              trend >= 0 ? "text-green-500" : "text-red-500"
            )}>
              {trend >= 0 ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
              {Math.abs(trend)}%
            </span>
            <span className="text-muted-foreground">{trendLabel}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface PlatformMetrics {
  totalSales: number;
  totalFees: number;
  totalOperatorFees: number;
  totalBitcoinSent: number;
}

interface MetricsGridProps {
  denetMetrics: PlatformMetrics;
  bitstopMetrics: PlatformMetrics;
}

export function MetricsGrid({
  denetMetrics,
  bitstopMetrics
}: MetricsGridProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
  };

  // Calculate percentages for Denet
  const denetTotalFeesPercent = denetMetrics.totalSales > 0
    ? (denetMetrics.totalFees / denetMetrics.totalSales) * 100
    : 0;
  const denetBitstopFeesPercent = denetMetrics.totalSales > 0
    ? (denetMetrics.totalOperatorFees / denetMetrics.totalSales) * 100
    : 0;
  const denetGrossProfit = denetMetrics.totalFees - denetMetrics.totalOperatorFees;
  const denetGrossProfitPercent = denetMetrics.totalSales > 0
    ? (denetGrossProfit / denetMetrics.totalSales) * 100
    : 0;

  // Calculate percentages for Bitstop
  const bitstopTotalFeesPercent = bitstopMetrics.totalSales > 0
    ? (bitstopMetrics.totalFees / bitstopMetrics.totalSales) * 100
    : 0;
  const bitstopBitstopFeesPercent = bitstopMetrics.totalSales > 0
    ? (bitstopMetrics.totalOperatorFees / bitstopMetrics.totalSales) * 100
    : 0;
  const bitstopGrossProfit = bitstopMetrics.totalFees - bitstopMetrics.totalOperatorFees;
  const bitstopGrossProfitPercent = bitstopMetrics.totalSales > 0
    ? (bitstopGrossProfit / bitstopMetrics.totalSales) * 100
    : 0;

  // Calculate combined totals
  const totalSales = denetMetrics.totalSales + bitstopMetrics.totalSales;
  const totalBitcoinSent = denetMetrics.totalBitcoinSent + bitstopMetrics.totalBitcoinSent;
  const totalFees = denetMetrics.totalFees + bitstopMetrics.totalFees;
  const totalOperatorFees = denetMetrics.totalOperatorFees + bitstopMetrics.totalOperatorFees;
  const totalGrossProfit = totalFees - totalOperatorFees;

  const totalFeesPercent = totalSales > 0 ? (totalFees / totalSales) * 100 : 0;
  const totalOperatorFeesPercent = totalSales > 0 ? (totalOperatorFees / totalSales) * 100 : 0;
  const totalGrossProfitPercent = totalSales > 0 ? (totalGrossProfit / totalSales) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Denet Platform Metrics */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-primary">Denet Platform</h3>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MetricCard
            title="Total Sales"
            value={formatCurrency(denetMetrics.totalSales)}
            icon={<DollarSign className="w-4 h-4" />}
            delay={0}
          />
          <MetricCard
            title="Total Sent to Customers"
            value={formatCurrency(denetMetrics.totalBitcoinSent)}
            icon={<Bitcoin className="w-4 h-4" />}
            delay={50}
          />
          <MetricCard
            title="Total Fees"
            value={formatCurrency(denetMetrics.totalFees)}
            percentage={formatPercent(denetTotalFeesPercent)}
            percentageValue={denetTotalFeesPercent}
            icon={<CreditCard className="w-4 h-4" />}
            delay={100}
          />
          <MetricCard
            title="Bitstop Fees"
            value={formatCurrency(denetMetrics.totalOperatorFees)}
            percentage={formatPercent(denetBitstopFeesPercent)}
            percentageValue={denetBitstopFeesPercent}
            icon={<ShoppingBag className="w-4 h-4" />}
            delay={150}
          />
          <MetricCard
            title="Gross Profit $"
            value={formatCurrency(denetGrossProfit)}
            percentage={formatPercent(denetGrossProfitPercent)}
            percentageValue={denetGrossProfitPercent}
            icon={<TrendingUp className="w-4 h-4" />}
            className={denetGrossProfit >= 0 ? 'border-green-500/20' : 'border-red-500/20'}
            delay={200}
          />
        </div>
      </div>

      {/* Bitstop Platform Metrics */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-orange-400">Bitstop Platform</h3>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MetricCard
            title="Total Sales"
            value={formatCurrency(bitstopMetrics.totalSales)}
            icon={<DollarSign className="w-4 h-4" />}
            delay={0}
          />
          <MetricCard
            title="Total Sent to Customers"
            value={formatCurrency(bitstopMetrics.totalBitcoinSent)}
            icon={<Bitcoin className="w-4 h-4" />}
            delay={50}
          />
          <MetricCard
            title="Total Fees"
            value={formatCurrency(bitstopMetrics.totalFees)}
            percentage={formatPercent(bitstopTotalFeesPercent)}
            percentageValue={bitstopTotalFeesPercent}
            icon={<CreditCard className="w-4 h-4" />}
            delay={100}
          />
          <MetricCard
            title="Bitstop Fees"
            value={formatCurrency(bitstopMetrics.totalOperatorFees)}
            percentage={formatPercent(bitstopBitstopFeesPercent)}
            percentageValue={bitstopBitstopFeesPercent}
            icon={<ShoppingBag className="w-4 h-4" />}
            delay={150}
          />
          <MetricCard
            title="Gross Profit $"
            value={formatCurrency(bitstopGrossProfit)}
            percentage={formatPercent(bitstopGrossProfitPercent)}
            percentageValue={bitstopGrossProfitPercent}
            icon={<TrendingUp className="w-4 h-4" />}
            className={bitstopGrossProfit >= 0 ? 'border-green-500/20' : 'border-red-500/20'}
            delay={200}
          />
        </div>
      </div>

      {/* Combined Total Metrics - stands out with special styling */}
      <div className="space-y-3 pt-6 border-t-2 border-primary/30">
        <h3 className="text-lg font-semibold text-green-400">Total (Both Platforms)</h3>
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MetricCard
            title="Total Sales"
            value={formatCurrency(totalSales)}
            icon={<DollarSign className="w-4 h-4" />}
            className="bg-yellow-400/5 border-yellow-400/30 ring-1 ring-yellow-400/20"
            delay={0}
          />
          <MetricCard
            title="Total Sent to Customers"
            value={formatCurrency(totalBitcoinSent)}
            icon={<Bitcoin className="w-4 h-4" />}
            className="bg-yellow-400/5 border-yellow-400/30 ring-1 ring-yellow-400/20"
            delay={50}
          />
          <MetricCard
            title="Total Fees"
            value={formatCurrency(totalFees)}
            percentage={formatPercent(totalFeesPercent)}
            percentageValue={totalFeesPercent}
            icon={<CreditCard className="w-4 h-4" />}
            className="bg-yellow-400/5 border-yellow-400/30 ring-1 ring-yellow-400/20"
            delay={100}
          />
          <MetricCard
            title="Bitstop Fees"
            value={formatCurrency(totalOperatorFees)}
            percentage={formatPercent(totalOperatorFeesPercent)}
            percentageValue={totalOperatorFeesPercent}
            icon={<ShoppingBag className="w-4 h-4" />}
            className="bg-yellow-400/5 border-yellow-400/30 ring-1 ring-yellow-400/20"
            delay={150}
          />
          <MetricCard
            title="Gross Profit $"
            value={formatCurrency(totalGrossProfit)}
            percentage={formatPercent(totalGrossProfitPercent)}
            percentageValue={totalGrossProfitPercent}
            icon={<TrendingUp className="w-4 h-4" />}
            className={cn(
              "bg-yellow-400/5 border-yellow-400/30 ring-2",
              totalGrossProfit >= 0 ? 'ring-green-500/40' : 'ring-red-500/40'
            )}
            delay={200}
          />
        </div>
      </div>
    </div>
  );
}
