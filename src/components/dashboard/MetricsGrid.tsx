import React from 'react';
import { ArrowUpRight, ArrowDownRight, DollarSign, TrendingUp, Users, ShoppingBag, Bitcoin, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface MetricCardProps {
  title: string;
  value: string;
  trend?: number;
  trendLabel?: string;
  icon: React.ReactNode;
  className?: string;
  delay?: number;
}

function MetricCard({ title, value, trend, trendLabel, icon, className, delay = 0 }: MetricCardProps) {
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
        <div className="text-2xl font-bold font-mono text-foreground mb-1">{value}</div>
        {trend !== undefined && (
          <div className="flex items-center text-xs">
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

interface MetricsGridProps {
  totalSales?: number;
  totalFees?: number;
  totalOperatorFees?: number;
  totalBitcoinSent?: number;
}

export function MetricsGrid({ 
  totalSales = 0, 
  totalFees = 0, 
  totalOperatorFees = 0, 
  totalBitcoinSent = 0 
}: MetricsGridProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Total Sales"
        value={formatCurrency(totalSales)}
        icon={<DollarSign className="w-4 h-4" />}
        delay={0}
        className="lg:col-span-2"
      />
      <MetricCard
        title="Total Fees"
        value={formatCurrency(totalFees)}
        icon={<CreditCard className="w-4 h-4" />}
        delay={100}
      />
      <MetricCard
        title="Operator Fees"
        value={formatCurrency(totalOperatorFees)}
        icon={<ShoppingBag className="w-4 h-4" />}
        delay={200}
      />
      <MetricCard
        title="Bitcoin Sent"
        value={formatCurrency(totalBitcoinSent)}
        icon={<Bitcoin className="w-4 h-4" />}
        delay={300}
        className="lg:col-span-4"
      />
    </div>
  );
}
