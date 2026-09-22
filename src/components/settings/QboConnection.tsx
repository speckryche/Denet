// QuickBooks connection + chart-of-accounts sync. Admin only.
//
// Tokens live in a service_role-only table and never reach the browser; this
// component talks to the qbo-* edge functions and only ever sees status fields.
//
// The sync writes Account **Ids** into qbo_account_map and crypto_assets. It
// never writes account_name — qbo_je_snapshots.lines freezes the resolved names
// of every entered month and detectDrift compares against them, so a rename
// would mark already-entered months as drifted.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, Link2, RefreshCw, Unlink, Loader2 } from 'lucide-react';
import { fetchAccountRows, fetchCryptoAssets, ACCOUNT_LABELS, type AccountMapRow, type CryptoAssetRow } from '@/lib/qbo/data';
import {
  matchAccounts, unresolvedTargets,
  type MappingTarget, type MatchResult, type QboAccount,
} from '@/lib/qbo/account-match';

interface Status {
  connected: boolean;
  status: string;
  realmId?: string;
  companyName?: string | null;
  environment?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string | null;
  refreshTokenExpiringSoon?: boolean;
  lastError?: string | null;
  connectedBy?: string | null;
}

// Reads the JSON body off a non-2xx edge-function response. FunctionsHttpError's
// own .message is the generic "non-2xx status code", so the useful text is only
// in the body — same pattern as CommissionCalculator.
const bodyOf = async (err: unknown): Promise<any> => {
  try {
    return await (err as any)?.context?.json?.();
  } catch {
    return null;
  }
};

const invoke = async (fn: string, body?: unknown) => {
  const res = await supabase.functions.invoke(fn, body ? { body } : {});
  if (res.error) {
    const parsed = await bodyOf(res.error);
    throw new Error(parsed?.error || res.error.message || `${fn} failed`);
  }
  return res.data as any;
};

export default function QboConnection() {
  const { role } = useAuth();
  const isAdmin = role === 'admin';

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<QboAccount[]>([]);
  const [match, setMatch] = useState<MatchResult | null>(null);
  const [rows, setRows] = useState<AccountMapRow[]>([]);
  const [assets, setAssets] = useState<CryptoAssetRow[]>([]);
  const [syncRealm, setSyncRealm] = useState<string | null>(null);
  const [manual, setManual] = useState<Record<string, string>>({});

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await invoke('qbo-status'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the QuickBooks status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    loadStatus();
  }, [isAdmin, loadStatus]);

  // The OAuth callback returns to ?qbo=connected or ?qbo=error&reason=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('qbo');
    if (!outcome) return;
    if (outcome === 'connected') setNotice('QuickBooks connected.');
    if (outcome === 'error') setError(`QuickBooks connection failed: ${params.get('reason') ?? 'unknown'}`);
    // Strip the params so a refresh does not replay the banner.
    params.delete('qbo'); params.delete('reason');
    const q = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
  }, []);

  const connect = async () => {
    setBusy('connect'); setError(null);
    try {
      const { authorizeUrl } = await invoke('qbo-oauth-start', {
        returnUrl: `${window.location.origin}/settings`,
      });
      window.location.href = authorizeUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the connection');
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (!window.confirm(
      'Forget the stored QuickBooks tokens?\n\nThis does not revoke access at Intuit and does not remove anything already posted to QuickBooks.',
    )) return;
    setBusy('disconnect'); setError(null);
    try {
      await invoke('qbo-disconnect');
      setMatch(null); setAccounts([]);
      setNotice('QuickBooks disconnected.');
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect');
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync'); setError(null); setNotice(null);
    try {
      const data = await invoke('qbo-sync-accounts');
      const [mapRows, assetRows] = await Promise.all([fetchAccountRows(), fetchCryptoAssets()]);
      setAccounts(data.accounts ?? []);
      setRows(mapRows);
      setAssets(assetRows);
      setSyncRealm(data.realmId ?? null);

      const targets: MappingTarget[] = [
        ...mapRows.map((r) => ({
          ref: `account_map:${r.key}`,
          label: ACCOUNT_LABELS[r.key as keyof typeof ACCOUNT_LABELS] ?? r.key,
          accountName: r.account_name,
          currentId: r.qbo_account_id,
        })),
        ...assetRows.flatMap((a) => [
          { ref: `asset_inv:${a.id}`, label: `${a.symbol} — inventory`, accountName: a.inventory_account_name, currentId: a.qbo_inventory_account_id },
          { ref: `asset_invest:${a.id}`, label: `${a.symbol} — investment`, accountName: a.investment_account_name, currentId: a.qbo_investment_account_id },
        ]),
      ];

      setMatch(matchAccounts(targets, data.accounts ?? []));
      setNotice(`Fetched ${data.accounts?.length ?? 0} accounts from ${data.companyName ?? 'QuickBooks'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(null);
    }
  };

  // Write the resolved Ids. Only Ids and the realm — never a name.
  const applyMatches = async () => {
    if (!match || !syncRealm) return;
    setBusy('apply'); setError(null);
    try {
      const now = new Date().toISOString();
      const pairs: Array<{ ref: string; id: string }> = [
        ...match.matched.filter((m) => !m.unchanged).map((m) => ({ ref: m.target.ref, id: m.account.Id })),
        ...Object.entries(manual).map(([ref, id]) => ({ ref, id })),
      ];

      for (const { ref, id } of pairs) {
        const [kind, key] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
        if (kind === 'account_map') {
          const { error: e } = await supabase.from('qbo_account_map')
            .update({ qbo_account_id: id, qbo_realm_id: syncRealm, qbo_synced_at: now, updated_at: now })
            .eq('key', key);
          if (e) throw e;
        } else {
          const col = kind === 'asset_inv' ? 'qbo_inventory_account_id' : 'qbo_investment_account_id';
          const { error: e } = await supabase.from('crypto_assets')
            .update({ [col]: id, qbo_realm_id: syncRealm, qbo_synced_at: now, updated_at: now })
            .eq('id', key);
          if (e) throw e;
        }
      }

      setNotice(`Saved ${pairs.length} account ID${pairs.length === 1 ? '' : 's'}. Account names were not modified.`);
      setManual({});
      await sync();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the account IDs');
    } finally {
      setBusy(null);
    }
  };

  if (!isAdmin) return null;

  const unresolved = match ? unresolvedTargets(match) : [];
  const toWrite = match
    ? match.matched.filter((m) => !m.unchanged).length + Object.keys(manual).length
    : 0;

  return (
    <Card className="bg-card/30 border-white/10">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="w-5 h-5" /> QuickBooks connection
            </CardTitle>
            <CardDescription>
              Connect the company file, then map our account names to QuickBooks account IDs.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {status?.connected && (
              <>
                <Button variant="outline" size="sm" onClick={sync} disabled={busy !== null}>
                  {busy === 'sync' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Sync from QBO
                </Button>
                <Button variant="outline" size="sm" onClick={disconnect} disabled={busy !== null}>
                  <Unlink className="w-4 h-4 mr-2" /> Disconnect
                </Button>
              </>
            )}
            {!status?.connected && (
              <Button size="sm" onClick={connect} disabled={busy !== null}>
                {busy === 'connect' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                Connect to QuickBooks
              </Button>
            )}
            {status?.status === 'needs_reconnect' && (
              <Button size="sm" onClick={connect} disabled={busy !== null}>Reconnect</Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>
        )}
        {notice && (
          <Alert className="bg-green-500/10 border-green-500/20 text-green-400">
            <CheckCircle2 className="h-4 w-4" /><AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !status?.realmId ? (
          <p className="text-sm text-muted-foreground">Not connected.</p>
        ) : (
          <div className="rounded-md border border-white/10 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Company</span>
              <span className="flex items-center gap-2">
                {status.companyName ?? '—'}
                <Badge className={status.environment === 'production'
                  ? 'bg-red-500/15 text-red-400 border-red-500/30'
                  : 'bg-blue-500/15 text-blue-300 border-blue-500/30'}>
                  {status.environment}
                </Badge>
              </span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Realm</span><span className="font-mono text-xs">{status.realmId}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Access token expires</span><span>{status.accessTokenExpiresAt?.slice(0, 19).replace('T', ' ') ?? '—'}</span></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Refresh token expires</span>
              <span className={status.refreshTokenExpiringSoon ? 'text-amber-400' : undefined}>
                {status.refreshTokenExpiresAt?.slice(0, 10) ?? '—'}
              </span>
            </div>
            {status.lastError && (
              <div className="text-amber-400 text-xs pt-1">Last error: {status.lastError}</div>
            )}
          </div>
        )}

        {status?.status === 'needs_reconnect' && (
          <Alert className="bg-amber-500/10 border-amber-500/30 text-amber-400">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Reconnect required</AlertTitle>
            <AlertDescription>
              The refresh token was rotated away, revoked, or expired. Posting is blocked until
              you reconnect. Nothing already posted to QuickBooks is affected.
            </AlertDescription>
          </Alert>
        )}

        {match && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {match.matched.length} matched · {match.ambiguous.length} ambiguous · {match.unmatched.length} unmatched
                {' — '}account names are never modified.
              </p>
              <Button size="sm" onClick={applyMatches} disabled={busy !== null || toWrite === 0}>
                {busy === 'apply' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Save {toWrite} ID{toWrite === 1 ? '' : 's'}
              </Button>
            </div>

            <div className="rounded-md border border-white/10 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="font-bold text-foreground">Used for</TableHead>
                    <TableHead className="font-bold text-foreground">Our account name</TableHead>
                    <TableHead className="font-bold text-foreground">QuickBooks account</TableHead>
                    <TableHead className="font-bold text-foreground w-[120px]">Match</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {match.matched.map((m) => (
                    <TableRow key={m.target.ref} className="border-white/5">
                      <TableCell>{m.target.label}</TableCell>
                      <TableCell className="font-mono text-xs">{m.target.accountName}</TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono">{m.account.AcctNum ?? '—'}</span>{' '}
                        {m.account.FullyQualifiedName ?? m.account.Name}{' '}
                        <span className="text-muted-foreground">#{m.account.Id}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={m.unchanged
                          ? 'bg-white/5 text-muted-foreground border-white/10'
                          : 'bg-green-500/15 text-green-400 border-green-500/30'}>
                          {m.unchanged ? 'already set' : m.method}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {unresolved.map((t) => {
                    const amb = match.ambiguous.find((a) => a.target.ref === t.ref);
                    const options = amb ? amb.candidates : accounts;
                    return (
                      <TableRow key={t.ref} className="border-white/5 bg-amber-500/[0.06]">
                        <TableCell>{t.label}</TableCell>
                        <TableCell className="font-mono text-xs">{t.accountName}</TableCell>
                        <TableCell>
                          <Select value={manual[t.ref] ?? ''} onValueChange={(v) => setManual((m) => ({ ...m, [t.ref]: v }))}>
                            <SelectTrigger className="h-8"><SelectValue placeholder="Pick an account…" /></SelectTrigger>
                            <SelectContent>
                              {options.map((a) => (
                                <SelectItem key={a.Id} value={a.Id}>
                                  {a.AcctNum ? `${a.AcctNum} ` : ''}{a.FullyQualifiedName ?? a.Name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30">
                            {amb ? 'ambiguous' : 'unmatched'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
