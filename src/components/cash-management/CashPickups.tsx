import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Edit, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
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

interface CashPickup {
  id: string;
  pickup_date: string;
  person_id: string;
  person_name: string;
  atm_id: string;
  atm_name: string;
  city: string;
  amount: number;
  deposited: boolean;
  deposit_id: string | null;
  deposit_date: string | null;
  notes: string | null;
  total_deposited: number;
  remaining_balance: number;
  deposit_status: 'undeposited' | 'partial' | 'full';
}

interface Person {
  id: string;
  name: string;
}

interface ATM {
  id: string; // UUID primary key for foreign key reference
  atm_id: string;
  atm_name: string;
  city: string | null;
  state: string | null;
}

interface CashPickupsProps {
  onUpdate: () => void;
}

export function CashPickups({ onUpdate }: CashPickupsProps) {
  const [pickups, setPickups] = useState<CashPickup[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [atms, setATMs] = useState<ATM[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterPerson, setFilterPerson] = useState<string>('all');
  const [filterDeposited, setFilterDeposited] = useState<string>('all');
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const getPacificDateString = () => {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  };

  const [formData, setFormData] = useState({
    pickup_date: getPacificDateString(),
    person_id: '',
    atm_id: '',
    city: '',
    amount: '',
    notes: '',
  });

  useEffect(() => {
    fetchData();
  }, [filterPerson, filterDeposited]);

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

      // Fetch ATMs - only active Denet ATMs
      const { data: atmsData, error: atmsError } = await supabase
        .from('atm_profiles')
        .select('id, atm_id, location_name, city, state')
        .eq('active', true)
        .eq('platform', 'denet')
        .order('location_name');

      if (atmsError) {
        console.error('Error fetching ATMs:', atmsError);
      }

      console.log('Fetched ATMs:', atmsData);

      // Use location_name as the display name
      const formattedATMs = atmsData?.map(atm => ({
        id: atm.id,
        atm_id: atm.atm_id,
        atm_name: atm.location_name || atm.atm_id,
        city: atm.city,
        state: atm.state
      })) || [];

      console.log('Formatted ATMs:', formattedATMs);
      setATMs(formattedATMs);

      // Fetch pickups with person names
      let query = supabase
        .from('cash_pickups')
        .select(`
          *,
          people!cash_pickups_person_id_fkey(name),
          atm_profiles!cash_pickups_atm_profile_id_fkey(location_name)
        `)
        .order('pickup_date', { ascending: false });

      if (filterPerson !== 'all') {
        query = query.eq('person_id', filterPerson);
      }

      const { data: pickupsData, error } = await query;

      if (error) throw error;

      // Fetch all deposit links to calculate deposited amounts
      const { data: linksData } = await supabase
        .from('deposit_pickup_links')
        .select('pickup_id, amount');

      // Calculate total deposited per pickup
      const depositedByPickup = new Map<string, number>();
      linksData?.forEach(link => {
        const current = depositedByPickup.get(link.pickup_id) || 0;
        depositedByPickup.set(link.pickup_id, current + parseFloat(link.amount.toString()));
      });

      let formattedPickups: CashPickup[] = pickupsData?.map((p: any) => {
        const amount = parseFloat(p.amount);
        const totalDeposited = depositedByPickup.get(p.id) || 0;
        const remainingBalance = amount - totalDeposited;
        let depositStatus: 'undeposited' | 'partial' | 'full';
        if (totalDeposited === 0) {
          depositStatus = 'undeposited';
        } else if (remainingBalance > 0.01) {
          depositStatus = 'partial';
        } else {
          depositStatus = 'full';
        }

        return {
          id: p.id,
          pickup_date: p.pickup_date,
          person_id: p.person_id,
          person_name: p.people?.name || 'Unknown',
          atm_id: p.atm_profile_id,
          atm_name: p.atm_profiles?.location_name || 'Unknown',
          city: p.city,
          amount: amount,
          deposited: p.deposited,
          deposit_id: p.deposit_id,
          deposit_date: p.deposit_date,
          notes: p.notes,
          total_deposited: totalDeposited,
          remaining_balance: remainingBalance,
          deposit_status: depositStatus,
        };
      }) || [];

      // Apply deposit status filter
      if (filterDeposited !== 'all') {
        formattedPickups = formattedPickups.filter(p => {
          if (filterDeposited === 'full') return p.deposit_status === 'full';
          if (filterDeposited === 'partial') return p.deposit_status === 'partial';
          if (filterDeposited === 'undeposited') return p.deposit_status === 'undeposited';
          return true;
        });
      }

      setPickups(formattedPickups);
    } catch (error) {
      console.error('Error fetching cash pickups:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required Select fields (native validation doesn't work with Radix Select)
    if (!formData.person_id) {
      alert('Please select a person');
      return;
    }
    if (!formData.atm_id) {
      alert('Please select an ATM');
      return;
    }

    try {
      const payload = {
        pickup_date: formData.pickup_date,
        person_id: formData.person_id,
        atm_profile_id: formData.atm_id,
        city: formData.city,
        amount: parseFloat(formData.amount),
        notes: formData.notes || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from('cash_pickups')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('cash_pickups')
          .insert([payload]);

        if (error) throw error;
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
      onUpdate();
    } catch (error) {
      console.error('Error saving cash pickup:', error);
    }
  };

  const handleEdit = (pickup: CashPickup) => {
    setEditingId(pickup.id);
    setFormData({
      pickup_date: pickup.pickup_date,
      person_id: pickup.person_id,
      atm_id: pickup.atm_id,
      city: pickup.city,
      amount: pickup.amount.toString(),
      notes: pickup.notes || '',
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this pickup?')) return;

    try {
      const { error } = await supabase
        .from('cash_pickups')
        .delete()
        .eq('id', id);

      if (error) throw error;

      fetchData();
      onUpdate();
    } catch (error) {
      console.error('Error deleting cash pickup:', error);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      pickup_date: getPacificDateString(),
      person_id: '',
      atm_id: '',
      city: '',
      amount: '',
      notes: '',
    });
  };

  const handleATMChange = (atmUuid: string) => {
    const selectedATM = atms.find(a => a.id === atmUuid);
    setFormData({
      ...formData,
      atm_id: atmUuid, // Store UUID for foreign key reference
      city: selectedATM?.city || '',
    });
  };

  // Group pickups by month
  const pickupsByMonth = pickups.reduce((acc, pickup) => {
    const date = new Date(pickup.pickup_date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!acc[monthKey]) {
      acc[monthKey] = [];
    }
    acc[monthKey].push(pickup);
    return acc;
  }, {} as Record<string, CashPickup[]>);

  const sortedMonthKeys = Object.keys(pickupsByMonth).sort((a, b) => b.localeCompare(a));

  // Auto-expand current month on initial load
  useEffect(() => {
    if (sortedMonthKeys.length > 0 && expandedMonths.size === 0) {
      const currentMonth = getPacificDateString().slice(0, 7);
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

  const getMonthTotal = (pickups: CashPickup[]) => {
    return pickups.reduce((sum, p) => sum + p.amount, 0);
  };

  return (
    <Card className="bg-card/30 border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Cash Pickups</CardTitle>
            <CardDescription>Track cash removed from ATMs</CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Pickup
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit' : 'Add'} Cash Pickup</DialogTitle>
                <DialogDescription>
                  Record a cash pickup from an ATM
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="pickup_date">Pickup Date</Label>
                    <Input
                      id="pickup_date"
                      type="date"
                      value={formData.pickup_date}
                      onChange={(e) => setFormData({ ...formData, pickup_date: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="person_id">Person</Label>
                    <Select value={formData.person_id} onValueChange={(value) => setFormData({ ...formData, person_id: value })}>
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
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="atm_id">ATM</Label>
                    <Select value={formData.atm_id} onValueChange={handleATMChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select ATM" />
                      </SelectTrigger>
                      <SelectContent>
                        {atms.map(atm => (
                          <SelectItem key={atm.id} value={atm.id}>
                            {atm.atm_name || atm.atm_id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={formData.city}
                      onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      required
                    />
                  </div>
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

                <div>
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Input
                    id="notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Any additional notes..."
                  />
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingId ? 'Update' : 'Add'} Pickup
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex gap-4 mb-4">
          <div className="w-48">
            <Select value={filterPerson} onValueChange={setFilterPerson}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All People</SelectItem>
                {people.map(person => (
                  <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Select value={filterDeposited} onValueChange={setFilterDeposited}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="full">Fully Deposited</SelectItem>
                <SelectItem value="partial">Partially Deposited</SelectItem>
                <SelectItem value="undeposited">Undeposited</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table with Month Grouping */}
        {isLoading ? (
          <div className="text-center text-muted-foreground py-8">
            Loading...
          </div>
        ) : pickups.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No pickups found
          </div>
        ) : (
          <div className="space-y-4">
            {sortedMonthKeys.map((monthKey) => {
              const monthPickups = pickupsByMonth[monthKey];
              const isExpanded = expandedMonths.has(monthKey);
              const monthTotal = getMonthTotal(monthPickups);

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
                        ({monthPickups.length} pickup{monthPickups.length !== 1 ? 's' : ''})
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
                          <TableHead>Person</TableHead>
                          <TableHead>ATM</TableHead>
                          <TableHead>City</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Deposited</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                          <TableHead>Notes</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {monthPickups.map((pickup) => (
                          <TableRow key={pickup.id}>
                            <TableCell>{new Date(pickup.pickup_date + 'T00:00:00').toLocaleDateString()}</TableCell>
                            <TableCell>{pickup.person_name}</TableCell>
                            <TableCell>{pickup.atm_name}</TableCell>
                            <TableCell>{pickup.city}</TableCell>
                            <TableCell className="text-right font-mono">
                              ${pickup.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className={`font-mono ${
                                pickup.deposit_status === 'full' ? 'text-green-500' :
                                pickup.deposit_status === 'partial' ? 'text-yellow-500' :
                                'text-muted-foreground'
                              }`}>
                                ${pickup.total_deposited.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                <span className="text-muted-foreground"> / </span>
                                ${pickup.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </span>
                            </TableCell>
                            <TableCell className={`text-right font-mono ${
                              pickup.remaining_balance > 0 ? 'text-orange-500' : 'text-green-500'
                            }`}>
                              ${pickup.remaining_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="max-w-xs truncate">{pickup.notes || '-'}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleEdit(pickup)}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleDelete(pickup.id)}
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
    </Card>
  );
}
