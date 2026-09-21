// QBO account + crypto asset mapping.
//
// Two inline-edit tables with a single Save, following the TickerMappings
// pattern (local edits, one upsert, inline Alert banners, SettingsGuard).
// The account names here are what appear on the journal entries, so a QBO
// rename is a settings change rather than a deploy.

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsGuard } from './SettingsGuard';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Save, Plus, BookOpen } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  ACCOUNT_LABELS,
  fetchAccountRows,
  fetchCryptoAssets,
  type AccountMapRow,
  type CryptoAssetRow,
} from '@/lib/qbo/data';
import type { AccountKey, Treatment } from '@/lib/qbo/types';

const emptyAsset = (): CryptoAssetRow => ({
  id: '',
  symbol: '',
  name: '',
  default_treatment: 'inventory',
  inventory_account_name: '',
  investment_account_name: '',
  qbo_inventory_account_id: null,
  qbo_investment_account_id: null,
  active: true,
});

export function QboSettings() {
  const { role } = useAuth();
  const isReadOnly = role === 'standard';

  const [accounts, setAccounts] = useState<AccountMapRow[]>([]);
  const [assets, setAssets] = useState<CryptoAssetRow[]>([]);
  const [newAsset, setNewAsset] = useState<CryptoAssetRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setIsLoading(true);
      const [accountRows, assetRows] = await Promise.all([fetchAccountRows(), fetchCryptoAssets()]);
      // Keep the fixed accounts in a meaningful order rather than insertion order.
      const order = Object.keys(ACCOUNT_LABELS);
      setAccounts([...accountRows].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)));
      setAssets(assetRows);
    } catch (err) {
      console.error('Error loading QBO settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to load QBO settings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const updateAccount = (key: string, field: 'account_name' | 'qbo_account_id', value: string) => {
    setAccounts((prev) =>
      prev.map((a) => (a.key === key ? { ...a, [field]: field === 'qbo_account_id' ? value || null : value } : a)),
    );
  };

  const updateAsset = (id: string, field: keyof CryptoAssetRow, value: string | boolean) => {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSuccessMessage(null);

      const { error: accountError } = await supabase.from('qbo_account_map').upsert(
        accounts.map((a) => ({
          key: a.key,
          account_name: a.account_name.trim(),
          qbo_account_id: a.qbo_account_id?.trim() || null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'key' },
      );
      if (accountError) throw accountError;

      const { error: assetError } = await supabase.from('crypto_assets').upsert(
        assets.map((a) => ({
          id: a.id,
          symbol: a.symbol.trim().toUpperCase(),
          name: a.name.trim(),
          default_treatment: a.default_treatment,
          inventory_account_name: a.inventory_account_name.trim(),
          investment_account_name: a.investment_account_name.trim(),
          qbo_inventory_account_id: a.qbo_inventory_account_id?.trim() || null,
          qbo_investment_account_id: a.qbo_investment_account_id?.trim() || null,
          active: a.active,
          updated_at: new Date().toISOString(),
        })),
      );
      if (assetError) throw assetError;

      setSuccessMessage('QBO mapping saved.');
      setTimeout(() => setSuccessMessage(null), 3000);
      await load();
    } catch (err) {
      console.error('Error saving QBO settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save QBO settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddAsset = async () => {
    if (!newAsset) return;
    const symbol = newAsset.symbol.trim().toUpperCase();
    if (!symbol) {
      setError('A ticker symbol is required (e.g. ETH).');
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      const { error: insertError } = await supabase.from('crypto_assets').insert([
        {
          symbol,
          name: newAsset.name.trim() || symbol,
          default_treatment: newAsset.default_treatment,
          inventory_account_name: newAsset.inventory_account_name.trim() || `Inventory - ${symbol}`,
          investment_account_name:
            newAsset.investment_account_name.trim() || `Long-term Investments:${symbol}`,
          active: true,
        },
      ]);
      if (insertError) throw insertError;
      setNewAsset(null);
      setSuccessMessage(`${symbol} added.`);
      setTimeout(() => setSuccessMessage(null), 3000);
      await load();
    } catch (err) {
      console.error('Error adding asset:', err);
      setError(err instanceof Error ? err.message : 'Failed to add the asset');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-card/30 border-white/10">
        <CardHeader>
          <CardTitle>QBO Entries — Accounts & Assets</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <SettingsGuard>
      <div
        className={
          isReadOnly
            ? '[&_input]:read-only [&_button]:pointer-events-none [&_button]:opacity-50'
            : ''
        }
      >
        <Card className="bg-card/30 border-white/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5" />
                  QBO Entries — Accounts & Assets
                </CardTitle>
                <CardDescription>
                  Account names used on the monthly journal entries. QBO account IDs are optional
                  and only needed for direct posting later.
                </CardDescription>
              </div>
              <Button onClick={handleSave} disabled={isSaving}>
                <Save className="w-4 h-4 mr-2" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </CardHeader>

          <CardContent className="space-y-8">
            {successMessage && (
              <Alert className="bg-green-500/10 border-green-500/20 text-green-500">
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
            )}
            {error && (
              <Alert className="bg-red-500/10 border-red-500/20 text-red-500">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div>
              <h3 className="text-sm font-semibold mb-2">Fixed accounts</h3>
              <div className="rounded-md border border-white/10">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10">
                      <TableHead className="w-[280px]">Used for</TableHead>
                      <TableHead>QBO account name</TableHead>
                      <TableHead className="w-[200px]">QBO account ID (optional)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((account) => (
                      <TableRow key={account.key} className="border-white/5">
                        <TableCell className="text-muted-foreground">
                          {ACCOUNT_LABELS[account.key as AccountKey] || account.key}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={account.account_name}
                            onChange={(e) => updateAccount(account.key, 'account_name', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={account.qbo_account_id || ''}
                            placeholder="—"
                            onChange={(e) => updateAccount(account.key, 'qbo_account_id', e.target.value)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Crypto assets</h3>
                <Button variant="outline" size="sm" onClick={() => setNewAsset(emptyAsset())}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add asset
                </Button>
              </div>
              <div className="rounded-md border border-white/10">
                <Table>
                  <TableHeader>
                    <TableRow className="border-white/10">
                      <TableHead className="w-[90px]">Symbol</TableHead>
                      <TableHead className="w-[140px]">Name</TableHead>
                      <TableHead className="w-[150px]">Default treatment</TableHead>
                      <TableHead>Inventory account</TableHead>
                      <TableHead>Investment account</TableHead>
                      <TableHead className="w-[90px]">Active</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assets.map((asset) => (
                      <TableRow key={asset.id} className="border-white/5">
                        <TableCell className="font-mono font-semibold">{asset.symbol}</TableCell>
                        <TableCell>
                          <Input value={asset.name} onChange={(e) => updateAsset(asset.id, 'name', e.target.value)} />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={asset.default_treatment}
                            onValueChange={(v) => updateAsset(asset.id, 'default_treatment', v as Treatment)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inventory">Inventory</SelectItem>
                              <SelectItem value="investment">Investment</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={asset.inventory_account_name}
                            onChange={(e) => updateAsset(asset.id, 'inventory_account_name', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={asset.investment_account_name}
                            onChange={(e) => updateAsset(asset.id, 'investment_account_name', e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={asset.active}
                            onChange={(e) => updateAsset(asset.id, 'active', e.target.checked)}
                            className="h-4 w-4 accent-primary"
                          />
                        </TableCell>
                      </TableRow>
                    ))}

                    {newAsset && (
                      <TableRow className="border-white/5 bg-white/[0.03]">
                        <TableCell>
                          <Input
                            value={newAsset.symbol}
                            placeholder="ETH"
                            onChange={(e) => setNewAsset({ ...newAsset, symbol: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={newAsset.name}
                            placeholder="Ethereum"
                            onChange={(e) => setNewAsset({ ...newAsset, name: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={newAsset.default_treatment}
                            onValueChange={(v) => setNewAsset({ ...newAsset, default_treatment: v as Treatment })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inventory">Inventory</SelectItem>
                              <SelectItem value="investment">Investment</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={newAsset.inventory_account_name}
                            placeholder="Inventory - Ethereum"
                            onChange={(e) => setNewAsset({ ...newAsset, inventory_account_name: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={newAsset.investment_account_name}
                            placeholder="Long-term Investments:Ethereum"
                            onChange={(e) => setNewAsset({ ...newAsset, investment_account_name: e.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleAddAsset} disabled={isSaving}>
                              Add
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setNewAsset(null)}>
                              Cancel
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Machine sales always credit the inventory account. The default treatment applies to
                Coinbase purchases and can be overridden per buy on the QBO Entries page.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </SettingsGuard>
  );
}
