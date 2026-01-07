import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Edit, Trash2, AlertCircle, Link, ChevronDown, ChevronRight } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';

interface Deposit {
  id: string;
  deposit_date: string;
  deposit_id: string;
  person_id: string;
  person_name: string;
  amount: number;
  amount_above: number;
  difference: number;
  notes: string | null;
}

interface Person {
  id: string;
  name: string;
}

interface UndepositedPickup {
  id: string;
  pickup_date: string;
  person_id: string;
  person_name: string;
  atm_name: string;
  city: string;
  amount: number;
}

interface DepositsProps {
  onUpdate: () => void;
}

export function Deposits({ onUpdate }: DepositsProps) {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nextDepositId, setNextDepositId] = useState('D001');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  // Link Pickups Dialog
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [linkingDeposit, setLinkingDeposit] = useState<Deposit | null>(null);
  const [undepositedPickups, setUndepositedPickups] = useState<UndepositedPickup[]>([]);
  const [selectedPickupIds, setSelectedPickupIds] = useState<Set<string>>(new Set());

  const [formData, setFormData] = useState({
    deposit_date: new Date().toISOString().split('T')[0],
    deposit_id: '',
    person_id: '',
    amount: '',
    notes: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch people
      const { data: peopleData } = await supabase
        .from('people')
        .select('*')
        .eq('active', true)
        .order('name');
      setPeople(peopleData || []);

      // Fetch deposits with person names
      const { data: depositsData, error: depositsError } = await supabase
        .from('deposits')
        .select(`
          *,
          people!deposits_person_id_fkey(name)
        `)
        .order('deposit_date', { ascending: false });

      if (depositsError) throw depositsError;

      // For each deposit, calculate amount_above (sum of linked pickups)
      const depositsWithCalcs = await Promise.all(
        (depositsData || []).map(async (d: any) => {
          const { data: pickups } = await supabase
            .from('cash_pickups')
            .select('amount')
            .eq('deposit_id', d.deposit_id);

          const amountAbove = pickups?.reduce((sum, p) => sum + parseFloat(p.amount.toString()), 0) || 0;
          const depositAmount = parseFloat(d.amount.toString());
          const difference = depositAmount - amountAbove;

          return {
            id: d.id,
            deposit_date: d.deposit_date,
            deposit_id: d.deposit_id,
            person_id: d.person_id,
            person_name: d.people?.name || 'Unknown',
            amount: depositAmount,
            amount_above: amountAbove,
            difference: difference,
            notes: d.notes,
          };
        })
      );

      setDeposits(depositsWithCalcs);

      // Calculate next deposit ID - find the highest ID number
      if (depositsData && depositsData.length > 0) {
        let maxNum = 0;
        depositsData.forEach((d: any) => {
          const match = d.deposit_id.match(/D(\d+)/);
          if (match) {
            const num = parseInt(match[1]);
            if (num > maxNum) {
              maxNum = num;
            }
          }
        });
        const nextNum = maxNum + 1;
        setNextDepositId(`D${String(nextNum).padStart(3, '0')}`);
      }
    } catch (error) {
      console.error('Error fetching deposits:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const payload = {
        deposit_date: formData.deposit_date,
        deposit_id: formData.deposit_id,
        person_id: formData.person_id,
        amount: parseFloat(formData.amount),
        notes: formData.notes || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from('deposits')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('deposits')
          .insert([payload]);

        if (error) throw error;
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
      onUpdate();
    } catch (error: any) {
      console.error('Error saving deposit:', error);
      if (error.code === '23505') {
        alert('This Deposit ID already exists. Please use a different ID.');
      }
    }
  };

  const handleEdit = (deposit: Deposit) => {
    setEditingId(deposit.id);
    setFormData({
      deposit_date: deposit.deposit_date,
      deposit_id: deposit.deposit_id,
      person_id: deposit.person_id,
      amount: deposit.amount.toString(),
      notes: deposit.notes || '',
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this deposit?')) return;

    try {
      const { error } = await supabase
        .from('deposits')
        .delete()
        .eq('id', id);

      if (error) throw error;

      fetchData();
      onUpdate();
    } catch (error) {
      console.error('Error deleting deposit:', error);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      deposit_date: new Date().toISOString().split('T')[0],
      deposit_id: '',
      person_id: '',
      amount: '',
      notes: '',
    });
  };

  const openAddDialog = () => {
    setEditingId(null);
    setFormData({
      deposit_date: new Date().toISOString().split('T')[0],
      deposit_id: nextDepositId,
      person_id: '',
      amount: '',
      notes: '',
    });
    setIsDialogOpen(true);
  };

  const handleOpenLinkDialog = async (deposit: Deposit) => {
    setLinkingDeposit(deposit);
    setSelectedPickupIds(new Set());

    // Fetch all undeposited pickups
    try {
      const { data, error } = await supabase
        .from('cash_pickups')
        .select(`
          id,
          pickup_date,
          person_id,
          atm_profile_id,
          city,
          amount,
          people!cash_pickups_person_id_fkey(name),
          atm_profiles!cash_pickups_atm_profile_id_fkey(location_name)
        `)
        .eq('deposited', false)
        .order('person_id')
        .order('pickup_date', { ascending: false });

      if (error) throw error;

      const formattedPickups: UndepositedPickup[] = data?.map((p: any) => ({
        id: p.id,
        pickup_date: p.pickup_date,
        person_id: p.person_id,
        person_name: p.people?.name || 'Unknown',
        atm_name: p.atm_profiles?.location_name || 'Unknown',
        city: p.city || '',
        amount: parseFloat(p.amount),
      })) || [];

      setUndepositedPickups(formattedPickups);
      setIsLinkDialogOpen(true);
    } catch (error) {
      console.error('Error fetching undeposited pickups:', error);
      alert('Failed to load undeposited pickups');
    }
  };

  const handleTogglePickup = (pickupId: string) => {
    const newSelected = new Set(selectedPickupIds);
    if (newSelected.has(pickupId)) {
      newSelected.delete(pickupId);
    } else {
      newSelected.add(pickupId);
    }
    setSelectedPickupIds(newSelected);
  };

  const handleLinkPickups = async () => {
    if (!linkingDeposit || selectedPickupIds.size === 0) return;

    try {
      // Update all selected pickups with the deposit ID
      const pickupIds = Array.from(selectedPickupIds);
      const { error } = await supabase
        .from('cash_pickups')
        .update({
          deposited: true,
          deposit_id: linkingDeposit.deposit_id,
          deposit_date: linkingDeposit.deposit_date
        })
        .in('id', pickupIds);

      if (error) throw error;

      setIsLinkDialogOpen(false);
      setLinkingDeposit(null);
      setSelectedPickupIds(new Set());
      fetchData();
      onUpdate();
    } catch (error) {
      console.error('Error linking pickups:', error);
      alert('Failed to link pickups to deposit');
    }
  };

  // Calculate selected total
  const selectedTotal = undepositedPickups
    .filter(p => selectedPickupIds.has(p.id))
    .reduce((sum, p) => sum + p.amount, 0);

  const difference = linkingDeposit ? linkingDeposit.amount - selectedTotal : 0;

  // Group pickups by person
  const pickupsByPerson = undepositedPickups.reduce((acc, pickup) => {
    if (!acc[pickup.person_name]) {
      acc[pickup.person_name] = [];
    }
    acc[pickup.person_name].push(pickup);
    return acc;
  }, {} as Record<string, UndepositedPickup[]>);

  // Group deposits by month
  const depositsByMonth = deposits.reduce((acc, deposit) => {
    const date = new Date(deposit.deposit_date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!acc[monthKey]) {
      acc[monthKey] = [];
    }
    acc[monthKey].push(deposit);
    return acc;
  }, {} as Record<string, Deposit[]>);

  const sortedMonthKeys = Object.keys(depositsByMonth).sort((a, b) => b.localeCompare(a));

  // Auto-expand current month on initial load
  useEffect(() => {
    if (sortedMonthKeys.length > 0 && expandedMonths.size === 0) {
      const currentMonth = new Date().toISOString().slice(0, 7);
      setExpandedMonths(new Set([currentMonth]));
    }
  }, [sortedMonthKeys.length]);

  const toggleMonth = (monthKey: string) => {
    const newExpanded = new Set(expandedMonths);
    if (newExpanded.has(monthKey)) {
      newExpanded.delete(monthKey);
    } else {
      newExpanded.add(monthKey);
    }
    setExpandedMonths(newExpanded);
  };

  const getMonthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  const getMonthTotal = (deposits: Deposit[]) => {
    return deposits.reduce((sum, d) => sum + d.amount, 0);
  };

  return (
    <Card className="bg-card/30 border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Deposits</CardTitle>
            <CardDescription>Track bank deposits</CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button onClick={openAddDialog}>
                <Plus className="w-4 h-4 mr-2" />
                Add Deposit
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit' : 'Add'} Deposit</DialogTitle>
                <DialogDescription>
                  Record a bank deposit. After creating, assign this Deposit ID to the related cash pickups.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="deposit_date">Deposit Date</Label>
                    <Input
                      id="deposit_date"
                      type="date"
                      value={formData.deposit_date}
                      onChange={(e) => setFormData({ ...formData, deposit_date: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="deposit_id">Deposit ID</Label>
                    <Input
                      id="deposit_id"
                      value={formData.deposit_id}
                      onChange={(e) => setFormData({ ...formData, deposit_id: e.target.value })}
                      placeholder="e.g., D098"
                      required
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Suggested next: {nextDepositId}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="person_id">Person</Label>
                    <Select value={formData.person_id} onValueChange={(value) => setFormData({ ...formData, person_id: value })} required>
                      <SelectTrigger>
                        <SelectValue placeholder="Select person" />
                      </SelectTrigger>
                      <SelectContent>
                        {people.map(person => (
                          <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="amount">Amount</Label>
                    <Input
                      id="amount"
                      type="number"
                      step="0.01"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Which ATMs made up this deposit..."
                    rows={3}
                  />
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingId ? 'Update' : 'Add'} Deposit
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {/* Table with Month Grouping */}
        {isLoading ? (
          <div className="text-center text-muted-foreground py-8">
            Loading...
          </div>
        ) : deposits.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No deposits found
          </div>
        ) : (
          <div className="space-y-4">
            {sortedMonthKeys.map((monthKey) => {
              const monthDeposits = depositsByMonth[monthKey];
              const isExpanded = expandedMonths.has(monthKey);
              const monthTotal = getMonthTotal(monthDeposits);

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
                      <span className="font-semibold text-lg">{getMonthLabel(monthKey)}</span>
                      <span className="text-sm text-muted-foreground">
                        ({monthDeposits.length} deposit{monthDeposits.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                    <div className="text-lg font-mono font-semibold">
                      ${monthTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>

                  {/* Month Content */}
                  {isExpanded && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Deposit ID</TableHead>
                          <TableHead>Person</TableHead>
                          <TableHead className="text-right">Deposit Amount</TableHead>
                          <TableHead className="text-right">Linked Pickups</TableHead>
                          <TableHead className="text-right">Difference</TableHead>
                          <TableHead>Notes</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {monthDeposits.map((deposit) => (
                          <TableRow key={deposit.id}>
                            <TableCell>{new Date(deposit.deposit_date + 'T00:00:00').toLocaleDateString()}</TableCell>
                            <TableCell className="font-semibold">{deposit.deposit_id}</TableCell>
                            <TableCell>{deposit.person_name}</TableCell>
                            <TableCell className="text-right font-mono">
                              ${deposit.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              ${deposit.amount_above.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className={`text-right font-mono ${
                              deposit.difference === 0 ? 'text-green-500' : 'text-red-500 font-bold'
                            }`}>
                              {deposit.difference !== 0 && <AlertCircle className="w-4 h-4 inline mr-1" />}
                              ${deposit.difference.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="max-w-xs truncate">{deposit.notes || '-'}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleOpenLinkDialog(deposit)}
                                  title="Link Pickups"
                                >
                                  <Link className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEdit(deposit)}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(deposit.id)}
                                >
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

      {/* Link Pickups Dialog */}
      <Dialog open={isLinkDialogOpen} onOpenChange={setIsLinkDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Link Pickups to Deposit {linkingDeposit?.deposit_id}</DialogTitle>
            <DialogDescription>
              Select undeposited cash pickups to link to this deposit. Pickups can be from any person.
            </DialogDescription>
          </DialogHeader>

          {linkingDeposit && (
            <div className="space-y-4">
              {/* Summary Bar */}
              <div className="grid grid-cols-3 gap-4 p-4 bg-secondary/10 rounded-lg border border-white/10">
                <div>
                  <div className="text-xs text-muted-foreground">Deposit Amount</div>
                  <div className="text-lg font-bold">
                    ${linkingDeposit.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Selected Total</div>
                  <div className="text-lg font-bold text-blue-500">
                    ${selectedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Difference</div>
                  <div className={`text-lg font-bold ${difference === 0 ? 'text-green-500' : 'text-red-500'}`}>
                    ${Math.abs(difference).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    {difference !== 0 && (difference > 0 ? ' short' : ' over')}
                  </div>
                </div>
              </div>

              {/* Pickups by Person */}
              {undepositedPickups.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  No undeposited pickups available
                </div>
              ) : (
                <div className="space-y-6">
                  {Object.entries(pickupsByPerson).map(([personName, pickups]) => (
                    <div key={personName} className="space-y-2">
                      <div className="font-semibold text-sm text-primary">{personName}'s Pickups</div>
                      <div className="space-y-2">
                        {pickups.map((pickup) => (
                          <div
                            key={pickup.id}
                            className="flex items-center gap-3 p-3 rounded-lg bg-card/30 border border-white/5 hover:bg-card/50 cursor-pointer"
                            onClick={() => handleTogglePickup(pickup.id)}
                          >
                            <Checkbox
                              checked={selectedPickupIds.has(pickup.id)}
                              onCheckedChange={() => handleTogglePickup(pickup.id)}
                            />
                            <div className="flex-1 grid grid-cols-4 gap-4">
                              <div>
                                <div className="text-xs text-muted-foreground">Date</div>
                                <div className="text-sm">{new Date(pickup.pickup_date + 'T00:00:00').toLocaleDateString()}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">ATM</div>
                                <div className="text-sm">{pickup.atm_name}</div>
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">City</div>
                                <div className="text-sm">{pickup.city || '-'}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-muted-foreground">Amount</div>
                                <div className="text-sm font-mono font-semibold">
                                  ${pickup.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsLinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleLinkPickups}
              disabled={selectedPickupIds.size === 0}
            >
              Link {selectedPickupIds.size} Pickup{selectedPickupIds.size !== 1 ? 's' : ''} to {linkingDeposit?.deposit_id}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
