import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, ShieldAlert, Info, User } from 'lucide-react';

export function UserManagement() {
  const { user, role } = useAuth();

  // Only admins can access this page
  if (role !== 'admin') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
          <CardDescription>Manage user roles and permissions</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert className="bg-red-500/10 border-red-500/20 text-red-500">
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription>
              <strong>Access Denied</strong> - Only administrators can access user management.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>User Management</CardTitle>
            <CardDescription>
              Manage user roles and permissions
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current User Info */}
        <div className="p-4 rounded-md bg-green-500/10 border border-green-500/20">
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-green-400" />
            <div>
              <h4 className="text-sm font-semibold text-green-400">Currently Logged In</h4>
              <p className="text-sm text-green-300 mt-1">
                <strong>{user?.email}</strong> - <span className="inline-flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Admin
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Role Permissions Info */}
        <div className="p-4 rounded-md bg-blue-500/10 border border-blue-500/20">
          <h4 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Role Permissions
          </h4>
          <div className="space-y-2 text-sm text-blue-300">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
              <div>
                <strong className="text-yellow-400">Admin:</strong> Full access to all features including Settings modifications
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div>
                <strong className="text-blue-400">Standard:</strong> Can view all features but cannot modify anything in Settings
              </div>
            </div>
          </div>
        </div>

        {/* Instructions for Adding/Managing Users */}
        <div className="p-4 rounded-md bg-purple-500/10 border border-purple-500/20">
          <h4 className="text-sm font-semibold text-purple-400 mb-3">How to Add & Manage Users</h4>
          <div className="text-sm text-purple-300 space-y-3">
            <div>
              <strong className="text-purple-200">Step 1: Add a New User in Supabase</strong>
              <ol className="list-decimal list-inside ml-2 mt-1 space-y-1 text-purple-300/90">
                <li>Go to Supabase Dashboard → <strong>Authentication</strong> → <strong>Users</strong></li>
                <li>Click <strong>"Invite User"</strong> or <strong>"Add User"</strong></li>
                <li>Enter their email address</li>
                <li>Click <strong>"Send Invite"</strong> or <strong>"Create User"</strong></li>
              </ol>
            </div>

            <div>
              <strong className="text-purple-200">Step 2: Assign Role Using SQL Editor</strong>
              <ol className="list-decimal list-inside ml-2 mt-1 space-y-1 text-purple-300/90">
                <li>Go to Supabase Dashboard → <strong>SQL Editor</strong></li>
                <li>Click <strong>"New Query"</strong></li>
                <li>Paste one of the commands below</li>
                <li>Click <strong>"Run"</strong></li>
              </ol>
            </div>

            <div className="bg-black/30 p-3 rounded-md font-mono text-xs space-y-2">
              <div>
                <div className="text-yellow-400 mb-1">-- To make a user an Admin:</div>
                <div className="text-green-400 whitespace-pre-wrap">
                  {`UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data || '{"role": "admin"}'::jsonb
WHERE email = 'user@example.com';`}
                </div>
              </div>
              <div>
                <div className="text-yellow-400 mb-1">-- To make a user Standard:</div>
                <div className="text-blue-400 whitespace-pre-wrap">
                  {`UPDATE auth.users
SET raw_user_meta_data = raw_user_meta_data || '{"role": "standard"}'::jsonb
WHERE email = 'user@example.com';`}
                </div>
              </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 p-2 rounded text-yellow-200 text-xs">
              <strong>Note:</strong> Replace 'user@example.com' with the actual user's email address
            </div>
          </div>
        </div>

        {/* Current System Status */}
        <div className="p-4 rounded-md bg-green-500/10 border border-green-500/20">
          <h4 className="text-sm font-semibold text-green-400 mb-2">✅ Role System Active</h4>
          <p className="text-sm text-green-300">
            The role-based access control system is now active. All Settings pages are protected and will show as "View Only" for Standard users.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
