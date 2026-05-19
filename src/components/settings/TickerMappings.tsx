import React, { useState, useEffect } from 'react';
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
import { Save, RefreshCw, Database } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface TickerMapping {
  id: string;
  original_value: string;
  display_value: string | null;
}

export function TickerMappings() {
  const { role } = useAuth();
  const isReadOnly = role === 'standard';
  const [mappings, setMappings] = useState<TickerMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMappings = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('ticker_mappings')
        .select('id, original_value, display_value')
        .order('original_value', { ascending: true });

      if (error) throw error;
      setMappings(data || []);
    } catch (err) {
      console.error('Error fetching ticker mappings:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch ticker mappings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMappings();
  }, []);

  const handleDisplayValueChange = (id: string, value: string) => {
    setMappings(prev =>
      prev.map(mapping =>
        mapping.id === id
          ? { ...mapping, display_value: value || null }
          : mapping
      )
    );
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSuccessMessage(null);

      const updates = mappings.map(mapping => ({
        id: mapping.id,
        original_value: mapping.original_value,
        display_value: mapping.display_value || null,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase
        .from('ticker_mappings')
        .upsert(updates);

      if (error) throw error;

      setSuccessMessage('Ticker mappings saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error saving ticker mappings:', err);
      setError(err instanceof Error ? err.message : 'Failed to save ticker mappings');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefreshTransactions = async () => {
    try {
      setIsRefreshing(true);
      setError(null);
      setSuccessMessage(null);

      const { data: transactions, error: fetchError } = await supabase
        .from('transactions')
        .select('id, ticker');

      if (fetchError) throw fetchError;

      if (!transactions || transactions.length === 0) {
        setSuccessMessage('No transactions to update.');
        setTimeout(() => setSuccessMessage(null), 3000);
        return;
      }

      const mappingMap = new Map(
        mappings.map(m => [m.original_value, m.display_value || m.original_value])
      );

      let updatedCount = 0;
      const updates = [];

      for (const transaction of transactions) {
        if (transaction.ticker) {
          const mappingEntry = mappings.find(m =>
            m.display_value === transaction.ticker || m.original_value === transaction.ticker
          );

          if (mappingEntry) {
            const newTickerValue = mappingEntry.display_value || mappingEntry.original_value;
            if (newTickerValue !== transaction.ticker) {
              updates.push({
                id: transaction.id,
                ticker: newTickerValue
              });
              updatedCount++;
            }
          }
        }
      }

      if (updates.length > 0) {
        const chunkSize = 100;
        for (let i = 0; i < updates.length; i += chunkSize) {
          const chunk = updates.slice(i, i + chunkSize);
          const { error: updateError } = await supabase
            .from('transactions')
            .upsert(chunk);

          if (updateError) throw updateError;
        }

        setSuccessMessage(`Successfully updated ${updatedCount} transactions!`);
      } else {
        setSuccessMessage('All transactions are already up to date.');
      }

      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error('Error refreshing transactions:', err);
      setError(err instanceof Error ? err.message : 'Failed to refresh transactions');
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ticker Mappings</CardTitle>
          <CardDescription>Loading...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <SettingsGuard>
    <div className={isReadOnly ? '[&_input]:read-only [&_select]:pointer-events-none [&_textarea]:read-only' : ''}>
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Ticker Mappings</CardTitle>
            <CardDescription>
              Customize how ticker values are displayed. Leave blank to show original value.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchMappings}
              disabled={isLoading}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshTransactions}
              disabled={isRefreshing || isReadOnly}
            >
              <Database className="w-4 h-4 mr-2" />
              {isRefreshing ? 'Updating...' : 'Update Transactions'}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving || isReadOnly}
            >
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {successMessage && (
          <Alert className="mb-4 bg-green-500/10 border-green-500/20 text-green-500">
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert className="mb-4 bg-red-500/10 border-red-500/20 text-red-500">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {mappings.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No ticker values found yet.</p>
            <p className="text-sm mt-2">Ticker values will appear here automatically when you upload CSV files.</p>
          </div>
        ) : (
          <div className="rounded-md border border-white/10">
            <Table>
              <TableHeader className="bg-white/5">
                <TableRow className="border-white/10">
                  <TableHead className="text-muted-foreground font-display">
                    Original Value (from CSV)
                  </TableHead>
                  <TableHead className="text-muted-foreground font-display">
                    Display Value (custom rename)
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.map((mapping) => (
                  <TableRow key={mapping.id} className="border-white/5">
                    <TableCell className="font-mono text-sm">
                      {mapping.original_value}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={mapping.display_value || ''}
                        onChange={(e) => handleDisplayValueChange(mapping.id, e.target.value)}
                        placeholder={mapping.original_value}
                        className="max-w-xs bg-card border-white/10"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="mt-4 text-sm text-muted-foreground">
          <p><strong>How it works:</strong></p>
          <ul className="list-disc list-inside mt-2 space-y-1">
            <li>Ticker values are automatically captured when you upload CSV files</li>
            <li>Enter a custom display value to rename how it appears in the table</li>
            <li>Leave blank to keep the original value</li>
            <li>Click "Save Changes" to save your mappings</li>
            <li><strong>Click "Update Transactions"</strong> to apply mappings to existing data in the transactions table</li>
            <li>Example: "bitcoin" → "BTC", "ethereum" → "ETH"</li>
          </ul>
        </div>
      </CardContent>
    </Card>
    </div>
    </SettingsGuard>
  );
}
