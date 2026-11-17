import { TickerMappings } from './TickerMappings';
import { ATMManagement } from './ATMManagement';
import { BulkPlatformConversion } from './BulkPlatformConversion';
import { ReconciliationReport } from './ReconciliationReport';
import { PnLReconciliation } from './PnLReconciliation';
import { PeopleManagement } from './PeopleManagement';
import { UserManagement } from './UserManagement';
import QboConnection from './QboConnection';
import { QboSettings } from './QboSettings';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';

export default function Settings() {
  // Bulk Platform Conversion has no read-only mode; it is an admin tool.
  const isAdmin = useAuth().role === 'admin';
  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <PageHeader title="Settings" />

      <main className="w-full min-w-0 px-4 py-5 xl:px-6 xl:py-6 space-y-8">
        <UserManagement />
        <ATMManagement />
        {isAdmin && <BulkPlatformConversion />}
        <ReconciliationReport />
        <PnLReconciliation />
        <PeopleManagement />
        <TickerMappings />
        <QboConnection />
        <QboSettings />
      </main>
    </div>
  );
}
