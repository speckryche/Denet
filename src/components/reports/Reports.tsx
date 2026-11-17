import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import MonthlySalesSummary from './MonthlySalesSummary';
import ATMProfitLoss from './ATMProfitLoss';
import FleetMonthlyPnL from './FleetMonthlyPnL';
import PerMachineMonthlyPnL from './PerMachineMonthlyPnL';
import ATMSalesSummary from './ATMSalesSummary';
import ATMMonthlySales from './ATMMonthlySales';
import ATMTransactions from './ATMTransactions';
import CTRReport from './CTRReport';
import PlatformComparison from './PlatformComparison';

const TABS = [
  { key: 'monthly-sales', label: 'Sales — totals' },
  { key: 'atm-monthly', label: 'Sales — by ATM' },
  { key: 'atm-pl', label: 'ATM P&L' },
  { key: 'fleet-pl', label: 'Fleet P&L' },
  { key: 'per-machine-pl', label: 'Per-machine P&L' },
  { key: 'atm-summary', label: 'ATM summary' },
  { key: 'atm-transactions', label: 'Transactions' },
  { key: 'ctr-filings', label: 'CTR filings' },
  { key: 'platform-comparison', label: 'Platform comparison' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const DEFAULT_TAB: TabKey = 'monthly-sales';

const isTabKey = (value: string | null): value is TabKey =>
  TABS.some((t) => t.key === value);

const TAB_CONTENT: Record<TabKey, React.FC> = {
  'monthly-sales': MonthlySalesSummary,
  'atm-monthly': ATMMonthlySales,
  'atm-pl': ATMProfitLoss,
  'fleet-pl': FleetMonthlyPnL,
  'per-machine-pl': PerMachineMonthlyPnL,
  'atm-summary': ATMSalesSummary,
  'atm-transactions': ATMTransactions,
  'ctr-filings': CTRReport,
  'platform-comparison': PlatformComparison,
};

export default function Reports() {
  // The URL is the single source of truth for the active tab, so deep links
  // (e.g. the Dashboard CTR banner -> ?tab=ctr-filings) and shared URLs work,
  // and back/forward moves between tabs.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : DEFAULT_TAB;
  const ActiveContent = TAB_CONTENT[activeTab];

  const selectTab = (key: TabKey) => {
    if (key === activeTab) return;
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader title="Reports" subtitle="Sales, P&L, CTR, and platform comparison" />

      <main className="px-6 pb-8 pt-2 lg:px-7 space-y-[18px] overflow-x-hidden">
        <div
          role="tablist"
          aria-label="Report"
          className="flex flex-wrap gap-1 border-b border-border"
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => selectTab(tab.key)}
                className={cn(
                  "-mb-px border-b-2 px-3 pb-3 pt-2.5 text-[13px] transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive
                    ? "border-primary font-semibold text-foreground"
                    : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel">
          <ActiveContent />
        </div>
      </main>
    </div>
  );
}
