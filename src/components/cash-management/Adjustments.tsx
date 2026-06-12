import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Edit, Trash2, ChevronDown, ChevronRight, Scale, Loader2, AlertCircle } from 'lucide-react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Adjustment {
  id: string;
  person_id: string;
  person_name: string;
  delta_amount: number;
  reason: string;
  effective_date: string;
  created_at: string;
}

interface Person {
  id: string;
  name: string;
}

interface AdjustmentsProps {
  onUpdate: () => void;
}

const fmtMoney = (n: number): string =>
  n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Signed display: +$835.00 / −$50.00 (uses a real minus sign for negatives)
const signedMoney = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}$${fmtMoney(Math.abs(n))}`;

export function Adjustments({ onUpdate }: AdjustmentsProps) {
  const { toast } = useToast();

  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterPerson, setFilterPerson] = useState<string>('all');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  // Edit dialog state
  const [editing, setEditing] = useState<Adjustment | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editReason, setEditReason] = useState('');
  const [editDate, setEditDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [filterPerson]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data: peopleData, error: peopleError } = await supabase
        .from('people')
        .select('id, name')
        .order('name');
      if (peopleError) throw peopleError;
      setPeople(peopleData || []);

      // Map names in JS rather than relying on a PostgREST embedded join — the
      // balance_adjustments table isn't in the generated types yet, so the
      // resource is accessed untyped (matches CashManagement's read path).
      const nameById = new Map((peopleData || []).map((p) => [p.id, p.name]));

      let query = supabase
        .from('balance_adjustments')
        .select('id, person_id, delta_amount, reason, effective_date, created_at');

      if (filterPerson !== 'all') {
        query = query.eq('person_id', filterPerson);
      }

      const { data, error } = await query
        .order('effective_date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rows: Adjustment[] = (data || []).map((a) => ({
        id: a.id,
        person_id: a.person_id,
        person_name: nameById.get(a.person_id) || 'Unknown',
        delta_amount: Number(a.delta_amount),
        reason: a.reason,
        effective_date: a.effective_date,
        created_at: a.created_at,
      }));

      setAdjustments(rows);
    } catch (error) {
      console.error('Error fetching balance adjustments:', error);
      toast({
        title: 'Failed to load adjustments',
        description: (error as any)?.message ?? String(error),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const openEdit = (adj: Adjustment) => {
    setEditing(adj);
    setEditAmount(adj.delta_amount.toString());
    setEditReason(adj.reason);
    setEditDate(adj.effective_date);
    setEditError(null);
    setSaving(false);
  };

  const parsedEditAmount = useMemo(() => {
    if (editAmount.trim() === '') return null;
    const n = parseFloat(editAmount);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }, [editAmount]);

  const canSaveEdit =
    !!editing &&
    parsedEditAmount !== null &&
    Math.abs(parsedEditAmount) >= 0.005 &&
    editReason.trim().length > 0 &&
    editDate.length > 0 &&
    !saving;

  const handleSaveEdit = async () => {
    if (!editing || parsedEditAmount === null) return;
    setSaving(true);
    setEditError(null);

    // Direct row update — the audit trigger writes an 'update' history snapshot.
    const { error } = await supabase
      .from('balance_adjustments')
      .update({
        delta_amount: parsedEditAmount,
        reason: editReason.trim(),
        effective_date: editDate,
      })
      .eq('id', editing.id);

    if (error) {
      setEditError(error.message);
      setSaving(false);
      return;
    }

    const personName = editing.person_name;
    setSaving(false);
    setEditing(null);
    toast({
      title: 'Adjustment updated',
      description: `${personName} — ${signedMoney(parsedEditAmount)}.`,
    });
    fetchData();
    onUpdate();
  };

  const handleDelete = async (adj: Adjustment) => {
    if (
      !confirm(
        `Delete this ${signedMoney(adj.delta_amount)} adjustment for ${adj.person_name}? This cannot be undone.`,
      )
    ) {
      return;
    }

    // Hard delete — the audit trigger writes a final 'delete' history snapshot
    // before the row is removed.
    const { error } = await supabase
      .from('balance_adjustments')
      .delete()
      .eq('id', adj.id);

    if (error) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
      return;
    }

    toast({
      title: 'Adjustment deleted',
      description: `${adj.person_name} — ${signedMoney(adj.delta_amount)} removed.`,
    });
    fetchData();
    onUpdate();
  };

  // Group by effective month (YYYY-MM). effective_date is a plain date string,
  // so slicing avoids any timezone drift from Date parsing.
  const byMonth = useMemo(() => {
    return adjustments.reduce((acc, a) => {
      const key = a.effective_date.slice(0, 7);
      (acc[key] ||= []).push(a);
      return acc;
    }, {} as Record<string, Adjustment[]>);
  }, [adjustments]);

  const sortedMonthKeys = useMemo(
    () => Object.keys(byMonth).sort((a, b) => b.localeCompare(a)),
    [byMonth],
  );

  // Auto-expand the most recent month with data on first load.
  useEffect(() => {
    if (sortedMonthKeys.length > 0 && expandedMonths.size === 0) {
      setExpandedMonths(new Set([sortedMonthKeys[0]]));
    }
  }, [sortedMonthKeys.length]);

  const toggleMonth = (monthKey: string) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  };

  const monthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  };

  const monthTotal = (rows: Adjustment[]) => rows.reduce((sum, a) => sum + a.delta_amount, 0);

  return (
    <Card className="bg-card/30 border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-primary" />
              Balance Adjustments
            </CardTitle>
            <CardDescription>
              Manual corrections recorded when tracked cash diverges from physical cash.
              Create one with the ⚖ icon on a person's tile above.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filter */}
        <div className="flex gap-4 mb-4">
          <div className="w-48">
            <Select value={filterPerson} onValueChange={setFilterPerson}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All People</SelectItem>
                {people.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center text-muted-foreground py-8">Loading...</div>
        ) : adjustments.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No balance adjustments recorded.
          </div>
        ) : (
          <div className="space-y-4">
            {sortedMonthKeys.map((monthKey) => {
              const rows = byMonth[monthKey];
              const isExpanded = expandedMonths.has(monthKey);
              const total = monthTotal(rows);

              return (
                <div key={monthKey} className="rounded-md border border-white/10 overflow-hidden">
                  {/* Month Header */}
                  <div
                    className="flex items-center justify-between p-4 bg-slate-700/40 cursor-pointer hover:bg-slate-600/50 transition-colors"
                    onClick={() => toggleMonth(monthKey)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-muted-foreground" />
                      )}
                      <span className="font-semibold text-lg">{monthLabel(monthKey)}</span>
                      <span className="text-sm text-muted-foreground">
                        ({rows.length} adjustment{rows.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                    <div
                      className={`text-lg font-mono font-semibold ${
                        total > 0 ? 'text-green-500' : total < 0 ? 'text-red-500' : 'text-foreground'
                      }`}
                    >
                      {signedMoney(total)}
                    </div>
                  </div>

                  {/* Month Content */}
                  {isExpanded && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Effective Date</TableHead>
                          <TableHead>Person</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Reason</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((adj) => (
                          <TableRow key={adj.id}>
                            <TableCell>
                              {new Date(adj.effective_date + 'T00:00:00').toLocaleDateString()}
                            </TableCell>
                            <TableCell>{adj.person_name}</TableCell>
                            <TableCell
                              className={`text-right font-mono ${
                                adj.delta_amount > 0
                                  ? 'text-green-500'
                                  : adj.delta_amount < 0
                                  ? 'text-red-500'
                                  : 'text-foreground'
                              }`}
                            >
                              {signedMoney(adj.delta_amount)}
                            </TableCell>
                            <TableCell className="max-w-md whitespace-pre-wrap break-words">
                              {adj.reason}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="sm" onClick={() => openEdit(adj)}>
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => handleDelete(adj)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Edit dialog */}
      <Dialog
        open={!!editing}
        onOpenChange={(o) => {
          if (!o && !saving) setEditing(null);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Edit Adjustment{editing ? ` — ${editing.person_name}` : ''}</DialogTitle>
            <DialogDescription>
              Editing the stored amount, date, or reason writes a new audit-history row.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="edit_amount">Adjustment amount</Label>
                <Input
                  id="edit_amount"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="font-mono"
                  autoFocus
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Signed — use a negative value to reduce the tracked balance.
                </p>
              </div>
              <div>
                <Label htmlFor="edit_date">Effective date</Label>
                <Input
                  id="edit_date"
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="edit_reason">Reason</Label>
              <Textarea
                id="edit_reason"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                rows={3}
              />
            </div>

            {parsedEditAmount !== null && Math.abs(parsedEditAmount) < 0.005 && (
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-400">
                Amount must be non-zero.
              </div>
            )}

            {editError && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm text-red-400">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>{editError}</div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSaveEdit} disabled={!canSaveEdit}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
