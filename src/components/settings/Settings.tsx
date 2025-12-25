import { TickerMappings } from './TickerMappings';
import { ATMManagement } from './ATMManagement';
import { PeopleManagement } from './PeopleManagement';
import { UserManagement } from './UserManagement';
import { PageHeader } from '@/components/layout/PageHeader';

export default function Settings() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <PageHeader title="Settings" />

      <main className="max-w-[95%] mx-auto px-6 py-8 space-y-8">
        <UserManagement />
        <ATMManagement />
        <PeopleManagement />
        <TickerMappings />
      </main>
    </div>
  );
}
