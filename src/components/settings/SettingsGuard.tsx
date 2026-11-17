import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Lock } from 'lucide-react';

interface SettingsGuardProps {
  children: React.ReactNode;
}

export function SettingsGuard({ children }: SettingsGuardProps) {
  const { role } = useAuth();

  return (
    <div className="space-y-4">
      {role !== 'admin' && (
        <Alert variant="info">
          <Lock className="h-4 w-4" />
          <AlertDescription>
            <strong>View Only Mode</strong> - Admin access required to make changes
          </AlertDescription>
        </Alert>
      )}
      {children}
    </div>
  );
}
