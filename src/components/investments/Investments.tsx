import { useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { InvestmentTransactions } from './InvestmentTransactions';

// Today in Pacific time, e.g. "November 20, 2026" (the app's business timezone).
const todayLabel = () =>
  new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

export default function Investments() {
  const [count, setCount] = useState<number | null>(null);

  const subtitle =
    count == null
      ? `As of ${todayLabel()}`
      : `As of ${todayLabel()} · ${count} transaction${count === 1 ? '' : 's'}`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader title="Investments" subtitle={subtitle} />
      <main className="w-full min-w-0 px-4 py-3 min-[1440px]:px-6 min-[1440px]:py-6">
        <InvestmentTransactions onCountChange={setCount} />
      </main>
    </div>
  );
}
