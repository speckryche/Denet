import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Shield, ShieldAlert, Info, Loader2, RefreshCw } from 'lucide-react';

type Role = 'admin' | 'standard';

interface ManagedUser {
  id: string;
  email: string | null;
  role: Role;
  lastSignInAt: string | null;
  createdAt: string;
}

// The role lives in auth.users app_metadata, which only the admin API can
// write, so every read and write goes through the admin-users Edge Function.
// FunctionsHttpError's own message is generic; the useful text is in the body.
const callAdminUsers = async (body: Record<string, unknown>): Promise<any> => {
  const res = await supabase.functions.invoke('admin-users', { body });
  if (res.error) {
    let parsed: any = null;
    try {
      parsed = await (res.error as any)?.context?.json?.();
    } catch {
      /* body was not JSON */
    }
    throw new Error(parsed?.error || res.error.message || 'admin-users failed');
  }
  return res.data;
};

const friendlyLoadError = (message: string) => {
  const m = message.toLowerCase();
  if (
    m.includes('not_found') ||
    m.includes('not found') ||
    m.includes('404') ||
    m.includes('failed to send') ||
    m.includes('failed to fetch')
  ) {
    return "Couldn't load the user list right now. Refresh to try again, or invite people from the Supabase dashboard if no one has been added yet.";
  }
  return message;
};

export function UserManagement() {
  const { user, role } = useAuth();
  const isAdmin = role === 'admin';

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callAdminUsers({ action: 'list' });
      setUsers(data.users ?? []);
    } catch (e) {
      setError(friendlyLoadError(e instanceof Error ? e.message : 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const changeRole = async (target: ManagedUser, next: Role) => {
    if (next === target.role) return;
    setSavingId(target.id);
    setError(null);
    setNotice(null);
    try {
      const data = await callAdminUsers({ action: 'set-role', userId: target.id, role: next });
      setUsers((prev) => prev.map((u) => (u.id === target.id ? { ...u, role: data.user.role } : u)));
      setNotice(
        `${target.email ?? 'User'} is now ${next === 'admin' ? 'an Admin' : 'Standard'}. ` +
          'The change applies when they sign out and back in (or within about an hour).',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change role');
    } finally {
      setSavingId(null);
    }
  };

  if (!isAdmin) {
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
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>User Management</CardTitle>
            <CardDescription>Manage user roles and permissions</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert className="bg-red-500/10 border-red-500/20 text-red-500">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert className="bg-green-500/10 border-green-500/20 text-green-400">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <div className="rounded-md border border-white/10">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-[30%]">Last sign-in</TableHead>
                <TableHead className="w-[18%]">Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    <Loader2 className="inline w-4 h-4 mr-2 animate-spin" />
                    Loading users…
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                    {error
                      ? 'The user list could not be loaded.'
                      : 'No users to show yet. Invite someone from the Supabase dashboard, then refresh this list.'}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => {
                  const isSelf = u.id === user?.id;
                  return (
                    <TableRow key={u.id} className="border-white/5">
                      <TableCell className="font-medium truncate" title={u.email ?? u.id}>
                        {u.email ?? u.id}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm truncate">
                        {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleString() : 'Never'}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.role}
                          onValueChange={(v) => changeRole(u, v as Role)}
                          // Changing your own role is refused server-side too: it is the
                          // only way to leave the app without an admin.
                          disabled={isSelf || savingId === u.id}
                        >
                          <SelectTrigger
                            className="dark:bg-card dark:border-white/10"
                            title={isSelf ? 'You cannot change your own role' : undefined}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="standard">Standard</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        <div className="p-4 rounded-md border border-border bg-surface-2 text-sm text-foreground">
          <strong>Role changes need a fresh sign-in.</strong> The user must sign out and back in for a
          new role to apply. Until then their session keeps its old permissions for up to an hour.
        </div>

        {/* Role Permissions Info */}
        <div className="p-4 rounded-md border border-border bg-muted/50">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Info className="w-4 h-4 text-muted-foreground" />
            Role Permissions
          </h4>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <strong className="text-foreground">Admin:</strong> Full access to every page and setting.
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <strong className="text-foreground">Standard:</strong> Full use of Home, CSV Uploads (no deleting uploads), Pending
                Resolution, Commissions, Cash Management and Liquidity. Everything else is view-only, and
                QBO Entries and Refunds are hidden.
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-md border border-border bg-muted/50 text-sm text-muted-foreground">
          <strong className="text-foreground">Adding a user:</strong> invite them from Supabase Dashboard →
          Authentication → Users. New users start as Standard; promote them here.
        </div>
      </CardContent>
    </Card>
  );
}
