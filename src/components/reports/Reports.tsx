import { useState } from 'react';
import { TrendingUp, DollarSign, BarChart3, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import MonthlySalesSummary from './MonthlySalesSummary';
import ATMProfitLoss from './ATMProfitLoss';
import ATMSalesSummary from './ATMSalesSummary';
import ATMMonthlySales from './ATMMonthlySales';

const TABS = [
  { key: 'monthly-sales', label: 'Sales - Totals', icon: TrendingUp },
  { key: 'atm-monthly', label: 'Sales - by ATM', icon: Calendar },
  { key: 'atm-pl', label: 'ATM P&L', icon: DollarSign },
  { key: 'atm-summary', label: 'ATM Summary', icon: BarChart3 },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const TAB_CONTENT: Record<TabKey, React.FC> = {
  'monthly-sales': MonthlySalesSummary,
  'atm-monthly': ATMMonthlySales,
  'atm-pl': ATMProfitLoss,
  'atm-summary': ATMSalesSummary,
};

export default function Reports() {
  const [activeTab, setActiveTab] = useState<TabKey>('monthly-sales');
  const ActiveContent = TAB_CONTENT[activeTab];

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <PageHeader title="Reports & Analytics" />

      <main className="max-w-[95%] mx-auto px-6 py-8 space-y-6 overflow-x-hidden">
        {/* Executive Dashboard nav: large icon+label buttons */}
        <div className="flex gap-3 max-w-[800px]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "h-20 flex-1 flex flex-col items-center justify-center gap-1.5 rounded-lg border transition-colors",
                  isActive
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-white/[0.02] border-white/10 text-muted-foreground hover:bg-white/5"
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-xs font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <ActiveContent />
      </main>
    </div>
  );
}
