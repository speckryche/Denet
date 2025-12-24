import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Save, RefreshCw, Database, Calculator } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TickerMapping {
  id: string;
  original_value: string;
  display_value: string | null;
  fee_percentage: number;
}

export function TickerMappings() {
  const [mappings, setMappings] = useState<TickerMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [showRecalculateDialog, setShowRecalculateDialog] = useState(false);
  const [bitstopTransactionCount, setBitstopTransactionCount] = useState(0);
  const [editingFeeId, setEditingFeeId] = useState<string | null>(null);
  const [editingFeeValue, setEditingFeeValue] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchMappings = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('ticker_mappings')
        .select('*')
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

  const handleFeePercentageFocus = (id: string, currentValue: number) => {
    setEditingFeeId(id);
    setEditingFeeValue((currentValue * 100).toFixed(2));
  };

  const handleFeePercentageChange = (value: string) => {
    setEditingFeeValue(value);
  };

  const handleFeePercentageBlur = (id: string) => {
    const numValue = parseFloat(editingFeeValue);

    if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) {
      // Convert percentage to decimal (e.g., 14 -> 0.14)
      const decimalValue = numValue / 100;

      setMappings(prev =>
        prev.map(mapping =>
          mapping.id === id
            ? { ...mapping, fee_percentage: decimalValue }
            : mapping
        )
      );
    }

    setEditingFeeId(null);
    setEditingFeeValue('');
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Update all mappings
      const updates = mappings.map(mapping => ({
        id: mapping.id,
        original_value: mapping.original_value,
        display_value: mapping.display_value || null,
        fee_percentage: mapping.fee_percentage,
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

      // Fetch all transactions
      const { data: transactions, error: fetchError } = await supabase
        .from('transactions')
        .select('id, ticker');

      if (fetchError) throw fetchError;

      if (!transactions || transactions.length === 0) {
        setSuccessMessage('No transactions to update.');
        setTimeout(() => setSuccessMessage(null), 3000);
        return;
      }

      // Create a map of original values to display values
      const mappingMap = new Map(
        mappings.map(m => [m.original_value, m.display_value || m.original_value])
      );

      // Update transactions that have mappings
      let updatedCount = 0;
      const updates = [];

      for (const transaction of transactions) {
        if (transaction.ticker) {
          // Check all mappings to see if current ticker matches any display_value
          // If so, we need to update it
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
        // Batch update in chunks of 100
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

  const handleRecalculateFeesClick = async () => {
    try {
      // Get count of Bitstop transactions
      const { count, error: countError } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('platform', 'bitstop');

      if (countError) throw countError;

      setBitstopTransactionCount(count || 0);
      setShowRecalculateDialog(true);
    } catch (err) {
      console.error('Error fetching Bitstop transaction count:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch transaction count');
    }
  };

  const handleRecalculateFees = async () => {
    try {
      setIsRecalculating(true);
      setError(null);
      setSuccessMessage(null);
      setShowRecalculateDialog(false);

      // Fetch all Bitstop transactions
      const { data: transactions, error: fetchError } = await supabase
        .from('transactions')
        .select('id, ticker, sale')
        .eq('platform', 'bitstop');

      if (fetchError) throw fetchError;

      if (!transactions || transactions.length === 0) {
        setSuccessMessage('No Bitstop transactions to recalculate.');
        setTimeout(() => setSuccessMessage(null), 3000);
        return;
      }

      // Create a map of tickers to fee percentages
      const feeMap = new Map(
        mappings.map(m => [
          m.display_value || m.original_value,
          m.fee_percentage
        ])
      );

      // Recalculate fees
      const updates = [];
      let updatedCount = 0;

      for (const transaction of transactions) {
        if (transaction.ticker && transaction.sale) {
          const feePercentage = feeMap.get(transaction.ticker);
          if (feePercentage !== undefined) {
            const newFee = parseFloat((transaction.sale * feePercentage).toFixed(2));
            updates.push({
              id: transaction.id,
              fee: newFee
            });
            updatedCount++;
          }
        }
      }

      if (updates.length > 0) {
        // Batch update in chunks of 100
        const chunkSize = 100;
        for (let i = 0; i < updates.length; i += chunkSize) {
          const chunk = updates.slice(i, i + chunkSize);
          const { error: updateError } = await supabase
            .from('transactions')
            .upsert(chunk);

          if (updateError) throw updateError;
        }

        setSuccessMessage(`Successfully recalculated fees for ${updatedCount} Bitstop transactions!`);
      } else {
        setSuccessMessage('No transactions needed fee recalculation.');
      }

      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error('Error recalculating fees:', err);
      setError(err instanceof Error ? err.message : 'Failed to recalculate fees');
    } finally {
      setIsRecalculating(false);
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
              disabled={isRefreshing}
            >
              <Database className="w-4 h-4 mr-2" />
              {isRefreshing ? 'Updating...' : 'Update Transactions'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecalculateFeesClick}
              disabled={isRecalculating}
              className="bg-purple-500/10 border-purple-500/20 text-purple-400 hover:bg-purple-500/20"
            >
              <Calculator className="w-4 h-4 mr-2" />
              {isRecalculating ? 'Recalculating...' : 'Recalculate Bitstop Fees'}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
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
                  <TableHead className="text-muted-foreground font-display">
                    Fee % (Bitstop)
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
                    <TableCell>
                      <div className="relative max-w-[120px]">
                        <Input
                          type="text"
                          value={editingFeeId === mapping.id ? editingFeeValue : (mapping.fee_percentage * 100).toFixed(2)}
                          onChange={(e) => handleFeePercentageChange(e.target.value)}
                          onFocus={(e) => {
                            handleFeePercentageFocus(mapping.id, mapping.fee_percentage);
                            e.target.select();
                          }}
                          onBlur={() => handleFeePercentageBlur(mapping.id)}
                          className="pr-8 bg-card border-white/10"
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">%</span>
                      </div>
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
            <li>Set the Fee % (Bitstop) for each ticker to calculate fees on Bitstop CSV imports</li>
            <li>Leave blank to keep the original value</li>
            <li>Click "Save Changes" to save your mappings</li>
            <li><strong>Click "Update Transactions"</strong> to apply mappings to existing data in the transactions table</li>
            <li><strong>Click "Recalculate Bitstop Fees"</strong> to recalculate all Bitstop transaction fees using the fee percentages</li>
            <li>Example: "bitcoin" → "BTC", "ethereum" → "ETH"</li>
          </ul>
        </div>
      </CardContent>

      {/* Recalculate Fees Confirmation Dialog */}
      <AlertDialog open={showRecalculateDialog} onOpenChange={setShowRecalculateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Recalculate All Bitstop Fees?</AlertDialogTitle>
            <AlertDialogDescription>
              This will recalculate fees for <strong>{bitstopTransactionCount.toLocaleString()}</strong> Bitstop transactions using the current fee percentages you've set for each ticker.
              <br /><br />
              Make sure you've saved your fee percentage changes before proceeding.
              <br /><br />
              This action cannot be undone. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRecalculateFees} className="bg-purple-500 hover:bg-purple-600">
              Recalculate Fees
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
