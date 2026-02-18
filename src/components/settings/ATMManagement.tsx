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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Save, RefreshCw, Plus, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';

interface SalesRep {
  id: string;
  name: string;
  email: string | null;
  commission_percentage: number;
  flat_monthly_fee: number;
  active: boolean | null;
}

interface ATMProfile {
  id: string;
  atm_id: string;
  serial_number: string | null;
  location_name: string | null;
  city: string | null;
  state: string | null;
  platform: string | null;
  platform_switch_date: string | null;
  sales_rep_id: string | null;
  monthly_rent: number;
  cash_management_rps: number;
  cash_management_rep: number;
  rent_payment_method: string | null;
  installed_date: string | null;
  removed_date: string | null;
  active: boolean | null;
  notes: string | null;
}

export function ATMManagement() {
  const { role } = useAuth();
  const isReadOnly = role === 'standard';
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [profiles, setProfiles] = useState<ATMProfile[]>([]);
  const [originalProfiles, setOriginalProfiles] = useState<ATMProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('sales-reps');
  const [atmSortOrder, setAtmSortOrder] = useState<'asc' | 'desc'>('asc');
  const [atmSortField, setAtmSortField] = useState<'atm_id' | 'location_name'>('atm_id');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [platformFilter, setPlatformFilter] = useState<'all' | 'bitstop' | 'denet'>('all');

  // New Sales Rep Dialog
  const [isAddRepOpen, setIsAddRepOpen] = useState(false);
  const [newRep, setNewRep] = useState({
    name: '',
    email: '',
    commission_percentage: 0,
    flat_monthly_fee: 0
  });

  // New ATM Dialog
  const [isAddATMOpen, setIsAddATMOpen] = useState(false);

  // Delete ATM Dialog
  const [isDeleteATMOpen, setIsDeleteATMOpen] = useState(false);
  const [atmToDelete, setAtmToDelete] = useState<ATMProfile | null>(null);
  const [deleteCheckLoading, setDeleteCheckLoading] = useState(false);
  const [hasSalesHistory, setHasSalesHistory] = useState(false);

  const [newATM, setNewATM] = useState({
    atm_id: '',
    serial_number: '',
    location_name: '',
    city: '',
    state: '',
    platform: null as string | null,
    sales_rep_id: null as string | null,
    monthly_rent: 0,
    cash_management_rps: 0,
    cash_management_rep: 0,
    rent_payment_method: null as string | null,
    installed_date: null as string | null,
    notes: ''
  });

  const fetchData = async () => {
    try {
      setIsLoading(true);
      
      const [repsResult, profilesResult] = await Promise.all([
        supabase.from('sales_reps').select('*').order('name', { ascending: true }),
        supabase.from('atm_profiles').select('*').order('atm_id', { ascending: true })
      ]);

      if (repsResult.error) throw repsResult.error;
      if (profilesResult.error) throw profilesResult.error;

      setSalesReps(repsResult.data || []);

      // Sort profiles by ATM ID numerically (smallest to largest) - default ascending
      const sortedProfiles = (profilesResult.data || []).sort((a, b) => {
        const aNum = parseInt(a.atm_id) || 0;
        const bNum = parseInt(b.atm_id) || 0;
        return aNum - bNum;
      });

      setProfiles(sortedProfiles);
      setOriginalProfiles(JSON.parse(JSON.stringify(sortedProfiles))); // Deep copy for comparison
      setHasUnsavedChanges(false);
      setAtmSortOrder('asc'); // Reset to default ascending order
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Warn user before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleRepFieldChange = (id: string, field: keyof SalesRep, value: string | number | boolean) => {
    setSalesReps(prev =>
      prev.map(rep =>
        rep.id === id ? { ...rep, [field]: value } : rep
      )
    );
  };

  const handleATMFieldChange = (id: string, field: keyof ATMProfile, value: string | number | null | boolean) => {
    setProfiles(prev =>
      prev.map(profile => {
        if (profile.id !== id) return profile;

        // Automatically sync Status based on Removed date
        if (field === 'removed_date') {
          return {
            ...profile,
            [field]: value,
            active: value ? false : true  // If removed_date exists, set inactive; otherwise active
          };
        }

        // Automatically clear Removed date if Status is set to Active
        if (field === 'active' && value === true) {
          return {
            ...profile,
            [field]: value,
            removed_date: null  // Clear removed_date when setting to Active
          };
        }

        return { ...profile, [field]: value };
      })
    );

    // Mark as having unsaved changes
    setHasUnsavedChanges(true);
  };

  // Sort ATM profiles by field
  const toggleAtmSort = (field: 'atm_id' | 'location_name') => {
    const newOrder = atmSortField === field && atmSortOrder === 'asc' ? 'desc' : 'asc';
    setAtmSortOrder(newOrder);
    setAtmSortField(field);

    setProfiles(prev => {
      const sorted = [...prev].sort((a, b) => {
        if (field === 'atm_id') {
          const aNum = parseInt(a.atm_id) || 0;
          const bNum = parseInt(b.atm_id) || 0;
          return newOrder === 'asc' ? aNum - bNum : bNum - aNum;
        } else {
          const aName = (a.location_name || '').toLowerCase();
          const bName = (b.location_name || '').toLowerCase();
          return newOrder === 'asc' ? aName.localeCompare(bName) : bName.localeCompare(aName);
        }
      });
      return sorted;
    });
  };

  // Handle tab change with unsaved changes warning
  const handleTabChange = (newTab: string) => {
    if (activeTab === 'atms' && hasUnsavedChanges) {
      const confirmLeave = window.confirm(
        'You have unsaved changes on the ATM Profiles page. Are you sure you want to leave without saving?'
      );
      if (!confirmLeave) {
        return;
      }
    }
    setActiveTab(newTab);
  };

  const handleAddRep = async () => {
    try {
      setError(null);
      const { error } = await supabase.from('sales_reps').insert([{
        name: newRep.name,
        email: newRep.email || null,
        commission_percentage: newRep.commission_percentage,
        flat_monthly_fee: newRep.flat_monthly_fee,
        active: true
      }]);

      if (error) throw error;

      setSuccessMessage('Sales rep added successfully!');
      setIsAddRepOpen(false);
      setNewRep({ name: '', email: '', commission_percentage: 0, flat_monthly_fee: 0 });
      fetchData();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error adding sales rep:', err);
      setError(err instanceof Error ? err.message : 'Failed to add sales rep');
    }
  };

  const handleAddATM = async () => {
    try {
      setError(null);

      // Validate required fields
      if (!newATM.atm_id.trim()) {
        setError('ATM ID is required');
        return;
      }

      // Check for existing profiles with the same ATM ID
      const { data: existingProfiles } = await supabase
        .from('atm_profiles')
        .select('*')
        .eq('atm_id', newATM.atm_id.trim());

      if (existingProfiles && existingProfiles.length > 0) {
        // Check if there's already an active profile (no removal date)
        const activeProfile = existingProfiles.find(p => !p.removed_date);
        if (activeProfile) {
          setError(`ATM ID ${newATM.atm_id} is already active at ${activeProfile.location_name || 'another location'}. Please set a removal date on the existing profile first.`);
          return;
        }

        // If user is adding with an install date, check for date range overlaps
        if (newATM.installed_date) {
          const newInstallDate = new Date(newATM.installed_date);

          for (const profile of existingProfiles) {
            const existingInstallDate = profile.installed_date ? new Date(profile.installed_date) : null;
            const existingRemovalDate = profile.removed_date ? new Date(profile.removed_date) : null;

            // Check if new install date is before a previous removal date
            if (existingRemovalDate && newInstallDate < existingRemovalDate) {
              setError(`Install date ${newATM.installed_date} overlaps with existing profile at ${profile.location_name || 'another location'} (removed ${profile.removed_date}). Install date must be after the removal date.`);
              return;
            }
          }
        }
      }

      const { error } = await supabase.from('atm_profiles').insert([{
        atm_id: newATM.atm_id.trim(),
        serial_number: newATM.serial_number || null,
        location_name: newATM.location_name || null,
        city: newATM.city || null,
        state: newATM.state || null,
        platform: newATM.platform,
        sales_rep_id: newATM.sales_rep_id,
        monthly_rent: newATM.monthly_rent,
        cash_management_rps: newATM.cash_management_rps,
        cash_management_rep: newATM.cash_management_rep,
        rent_payment_method: newATM.rent_payment_method,
        installed_date: newATM.installed_date,
        removed_date: null,
        active: true,
        notes: newATM.notes || null
      }]);

      if (error) throw error;

      setSuccessMessage('ATM added successfully!');
      setIsAddATMOpen(false);
      setNewATM({
        atm_id: '',
        serial_number: '',
        location_name: '',
        city: '',
        state: '',
        platform: null,
        sales_rep_id: null,
        monthly_rent: 0,
        cash_management_rps: 0,
        cash_management_rep: 0,
        rent_payment_method: null,
        installed_date: null,
        notes: ''
      });
      fetchData();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error adding ATM:', err);
      setError(err instanceof Error ? err.message : 'Failed to add ATM');
    }
  };

  const handleDeleteRep = async (id: string) => {
    if (!confirm('Are you sure you want to delete this sales rep? This will unassign them from all ATMs.')) return;

    try {
      const { error } = await supabase.from('sales_reps').delete().eq('id', id);
      if (error) throw error;

      setSuccessMessage('Sales rep deleted successfully!');
      fetchData();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error deleting sales rep:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete sales rep');
    }
  };

  // Open delete confirmation for ATM - check for sales history first
  const handleDeleteATMClick = async (profile: ATMProfile) => {
    setAtmToDelete(profile);
    setDeleteCheckLoading(true);
    setHasSalesHistory(false);
    setIsDeleteATMOpen(true);

    try {
      // Check for transactions linked to this ATM ID
      const { count: transactionCount, error: txError } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('atm_id', profile.atm_id);

      if (txError) throw txError;

      // Check for cash pickups linked to this ATM profile ID
      const { count: pickupCount, error: pickupError } = await supabase
        .from('cash_pickups')
        .select('*', { count: 'exact', head: true })
        .eq('atm_profile_id', profile.id);

      if (pickupError) throw pickupError;

      const hasHistory = (transactionCount || 0) > 0 || (pickupCount || 0) > 0;
      setHasSalesHistory(hasHistory);
    } catch (err) {
      console.error('Error checking sales history:', err);
      // If we can't check, assume there's history to be safe
      setHasSalesHistory(true);
    } finally {
      setDeleteCheckLoading(false);
    }
  };

  // Actually delete the ATM
  const handleConfirmDeleteATM = async () => {
    if (!atmToDelete || hasSalesHistory) return;

    try {
      const { error } = await supabase
        .from('atm_profiles')
        .delete()
        .eq('id', atmToDelete.id);

      if (error) throw error;

      setSuccessMessage(`ATM ${atmToDelete.atm_id} deleted successfully!`);
      setIsDeleteATMOpen(false);
      setAtmToDelete(null);
      fetchData();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error deleting ATM:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete ATM');
    }
  };

  const handleSaveReps = async () => {
    try {
      setIsSaving(true);
      setError(null);

      const updates = salesReps.map(rep => ({
        id: rep.id,
        name: rep.name,
        email: rep.email,
        commission_percentage: rep.commission_percentage,
        flat_monthly_fee: rep.flat_monthly_fee,
        active: rep.active,
        updated_at: new Date().toISOString()
      }));

      const { error } = await supabase.from('sales_reps').upsert(updates);
      if (error) throw error;

      setSuccessMessage('Sales reps saved successfully!');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Error saving sales reps:', err);
      setError(err instanceof Error ? err.message : 'Failed to save sales reps');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveATMs = async () => {
    try {
      setIsSaving(true);
      setError(null);

      // Validate date range overlaps before saving
      const atmGroups = new Map<string, ATMProfile[]>();
      profiles.forEach(profile => {
        const existing = atmGroups.get(profile.atm_id) || [];
        atmGroups.set(profile.atm_id, [...existing, profile]);
      });

      // Check for overlaps within each ATM ID group
      for (const [atmId, groupProfiles] of atmGroups.entries()) {
        if (groupProfiles.length > 1) {
          // Check if there are multiple active profiles (no removal date)
          const activeProfiles = groupProfiles.filter(p => !p.removed_date);
          if (activeProfiles.length > 1) {
            setError(`ATM ID ${atmId} has multiple active profiles. Only one profile per ATM can be active at a time.`);
            setIsSaving(false);
            return;
          }

          // Check for date range overlaps
          for (let i = 0; i < groupProfiles.length; i++) {
            for (let j = i + 1; j < groupProfiles.length; j++) {
              const profile1 = groupProfiles[i];
              const profile2 = groupProfiles[j];

              const install1 = profile1.installed_date ? new Date(profile1.installed_date) : null;
              const removal1 = profile1.removed_date ? new Date(profile1.removed_date) : null;
              const install2 = profile2.installed_date ? new Date(profile2.installed_date) : null;
              const removal2 = profile2.removed_date ? new Date(profile2.removed_date) : null;

              // Check if install date is before a previous removal date
              if (install1 && removal2 && install1 < removal2) {
                setError(`ATM ID ${atmId}: Install date at ${profile1.location_name || 'location'} overlaps with removal date at ${profile2.location_name || 'another location'}.`);
                setIsSaving(false);
                return;
              }
              if (install2 && removal1 && install2 < removal1) {
                setError(`ATM ID ${atmId}: Install date at ${profile2.location_name || 'location'} overlaps with removal date at ${profile1.location_name || 'another location'}.`);
                setIsSaving(false);
                return;
              }
            }
          }
        }
      }

      const updates = profiles.map(profile => ({
        id: profile.id,
        atm_id: profile.atm_id,
        location_name: profile.location_name,
        city: profile.city,
        state: profile.state,
        platform: profile.platform,
        sales_rep_id: profile.sales_rep_id,
        monthly_rent: profile.monthly_rent,
        cash_management_rps: profile.cash_management_rps,
        cash_management_rep: profile.cash_management_rep,
        rent_payment_method: profile.rent_payment_method,
        installed_date: profile.installed_date,
        removed_date: profile.removed_date,
        active: profile.active,
        notes: profile.notes,
        updated_at: new Date().toISOString()
      }));

      console.log('Updating ATM profiles with data:', updates);
      const { error } = await supabase.from('atm_profiles').upsert(updates);

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      setSuccessMessage('ATM profiles saved successfully!');
      setHasUnsavedChanges(false);
      setTimeout(() => setSuccessMessage(null), 3000);
      await fetchData(); // Refresh data
    } catch (err: any) {
      console.error('Error saving ATM profiles:', err);
      const errorMessage = err?.message || err?.error_description || 'Failed to save ATM profiles';
      setError(`Error: ${errorMessage}`);
      alert(`Failed to save: ${errorMessage}`); // Show detailed error
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>ATM & Sales Rep Management</CardTitle>
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
        <CardTitle>ATM & Sales Rep Management</CardTitle>
        <CardDescription>
          Manage sales representatives and ATM profiles for commission calculations
        </CardDescription>
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

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="bg-white/5 border border-white/10">
            <TabsTrigger value="sales-reps">Sales Reps</TabsTrigger>
            <TabsTrigger value="atms">ATM Profiles</TabsTrigger>
          </TabsList>

          <TabsContent value="sales-reps" className="mt-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Sales Representatives</h3>
              <div className="flex gap-2">
                <Dialog open={isAddRepOpen} onOpenChange={setIsAddRepOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" disabled={isReadOnly}>
                      <Plus className="w-4 h-4 mr-2" />
                      Add Sales Rep
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add New Sales Rep</DialogTitle>
                      <DialogDescription>
                        Enter the details for the new sales representative
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Name *</Label>
                        <Input
                          id="name"
                          value={newRep.name}
                          onChange={(e) => setNewRep({ ...newRep, name: e.target.value })}
                          placeholder="John Doe"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          type="email"
                          value={newRep.email}
                          onChange={(e) => setNewRep({ ...newRep, email: e.target.value })}
                          placeholder="john@example.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="commission">Commission % *</Label>
                        <Input
                          id="commission"
                          type="number"
                          step="0.01"
                          value={newRep.commission_percentage}
                          onChange={(e) => setNewRep({ ...newRep, commission_percentage: parseFloat(e.target.value) || 0 })}
                          placeholder="10.00"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="flat-fee">Flat Monthly Fee per ATM ($) *</Label>
                        <Input
                          id="flat-fee"
                          type="number"
                          step="0.01"
                          value={newRep.flat_monthly_fee}
                          onChange={(e) => setNewRep({ ...newRep, flat_monthly_fee: parseFloat(e.target.value) || 0 })}
                          placeholder="50.00"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddRepOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleAddRep} disabled={!newRep.name}>
                        Add Sales Rep
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button size="sm" onClick={handleSaveReps} disabled={isSaving || isReadOnly}>
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>

            {salesReps.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No sales reps yet. Click "Add Sales Rep" to get started.</p>
              </div>
            ) : (
              <div className="rounded-md border border-white/10 overflow-x-auto">
                <Table>
                  <TableHeader className="bg-white/5">
                    <TableRow className="border-white/10">
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Commission %</TableHead>
                      <TableHead>Flat Monthly Fee</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salesReps.map((rep) => (
                      <TableRow key={rep.id} className="border-white/5">
                        <TableCell>
                          <Input
                            value={rep.name}
                            onChange={(e) => handleRepFieldChange(rep.id, 'name', e.target.value)}
                            className="bg-card border-white/10"
                            readOnly={isReadOnly}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="email"
                            value={rep.email || ''}
                            onChange={(e) => handleRepFieldChange(rep.id, 'email', e.target.value)}
                            placeholder="email@example.com"
                            className="bg-card border-white/10"
                            readOnly={isReadOnly}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={rep.commission_percentage}
                            onChange={(e) => handleRepFieldChange(rep.id, 'commission_percentage', parseFloat(e.target.value) || 0)}
                            className="bg-card border-white/10"
                            readOnly={isReadOnly}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={rep.flat_monthly_fee}
                            onChange={(e) => handleRepFieldChange(rep.id, 'flat_monthly_fee', parseFloat(e.target.value) || 0)}
                            className="bg-card border-white/10"
                            readOnly={isReadOnly}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={rep.active ? 'true' : 'false'}
                            onValueChange={(value) => handleRepFieldChange(rep.id, 'active', value === 'true')}
                            disabled={isReadOnly}
                          >
                            <SelectTrigger className="bg-card border-white/10">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="true">Active</SelectItem>
                              <SelectItem value="false">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteRep(rep.id)}
                            className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="atms" className="mt-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-4">
                <div>
                  <h3 className="text-lg font-semibold">ATM Profiles</h3>
                  {hasUnsavedChanges && (
                    <p className="text-xs text-yellow-500 mt-1">
                      ⚠ You have unsaved changes
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Platform:</span>
                  <Select value={platformFilter} onValueChange={(value: 'all' | 'bitstop' | 'denet') => setPlatformFilter(value)}>
                    <SelectTrigger className="w-32 bg-card border-white/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="bitstop">Bitstop</SelectItem>
                      <SelectItem value="denet">Denet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setIsAddATMOpen(true)} disabled={isReadOnly}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add ATM
                </Button>
                <Button size="sm" variant="outline" onClick={fetchData}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh
                </Button>
                <Button size="sm" onClick={handleSaveATMs} disabled={isSaving || isReadOnly}>
                  <Save className="w-4 h-4 mr-2" />
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>

            {profiles.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No ATMs found yet.</p>
                <p className="text-sm mt-2">ATM IDs will appear here automatically when you upload CSV files.</p>
              </div>
            ) : (
              <>
                {/* Active ATMs Section */}
                {profiles.filter(p => p.active !== false && (platformFilter === 'all' || p.platform === platformFilter)).length > 0 && (
                  <div className="mb-8">
                    <h4 className="text-md font-semibold text-green-500 mb-3">
                      Active ATMs ({profiles.filter(p => p.active !== false && (platformFilter === 'all' || p.platform === platformFilter)).length})
                    </h4>
                    <div className="rounded-md border border-white/10 overflow-x-auto">
                      <Table>
                        <TableHeader className="bg-white/5">
                          <TableRow className="border-white/10">
                            <TableHead className="min-w-[70px]">
                              <button
                                onClick={() => toggleAtmSort('atm_id')}
                                className="flex items-center gap-1 hover:text-foreground transition-colors"
                              >
                                ATM ID
                                {atmSortField === 'atm_id' && (atmSortOrder === 'asc' ? (
                                  <ArrowUp className="w-4 h-4" />
                                ) : (
                                  <ArrowDown className="w-4 h-4" />
                                ))}
                                {atmSortField !== 'atm_id' && <ArrowUpDown className="w-4 h-4 opacity-50" />}
                              </button>
                            </TableHead>
                            <TableHead className="min-w-[140px]">
                              <button
                                onClick={() => toggleAtmSort('location_name')}
                                className="flex items-center gap-1 hover:text-foreground transition-colors"
                              >
                                Location Name
                                {atmSortField === 'location_name' && (atmSortOrder === 'asc' ? (
                                  <ArrowUp className="w-4 h-4" />
                                ) : (
                                  <ArrowDown className="w-4 h-4" />
                                ))}
                                {atmSortField !== 'location_name' && <ArrowUpDown className="w-4 h-4 opacity-50" />}
                              </button>
                            </TableHead>
                            <TableHead className="min-w-[90px]">City</TableHead>
                            <TableHead className="min-w-[50px]">State</TableHead>
                            <TableHead className="min-w-[70px]">Platform</TableHead>
                            <TableHead className="min-w-[120px]">Sales Rep</TableHead>
                            <TableHead className="min-w-[100px]">Rent ($)</TableHead>
                            <TableHead className="min-w-[100px]">CM RPS ($)</TableHead>
                            <TableHead className="min-w-[100px]">CM Rep ($)</TableHead>
                            <TableHead className="min-w-[90px]">Rent Pymt</TableHead>
                            <TableHead className="min-w-[100px]">Installed</TableHead>
                            <TableHead className="min-w-[100px]">Removed</TableHead>
                            <TableHead className="min-w-[90px]">Status</TableHead>
                            <TableHead className="min-w-[200px]">Notes</TableHead>
                            <TableHead className="w-[60px]">Delete</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {profiles.filter(p => p.active !== false && (platformFilter === 'all' || p.platform === platformFilter)).map((profile) => (
                      <TableRow key={profile.id} className="border-white/5">
                        <TableCell className="font-mono text-sm">{profile.atm_id}</TableCell>
                        <TableCell>
                          <Input
                            value={profile.location_name || ''}
                            onChange={(e) => handleATMFieldChange(profile.id, 'location_name', e.target.value)}
                            placeholder="Location name"
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={profile.city || ''}
                            onChange={(e) => handleATMFieldChange(profile.id, 'city', e.target.value)}
                            placeholder="City"
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={profile.state || ''}
                            onChange={(e) => handleATMFieldChange(profile.id, 'state', e.target.value)}
                            placeholder="ST"
                            maxLength={2}
                            className="bg-card border-white/10 uppercase w-16"
                            style={{ textTransform: 'uppercase' }}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={profile.platform || 'none'}
                            onValueChange={(value) => handleATMFieldChange(profile.id, 'platform', value === 'none' ? null : value)}
                          >
                            <SelectTrigger className="bg-card border-white/10">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">-</SelectItem>
                              <SelectItem value="bitstop">Bitstop</SelectItem>
                              <SelectItem value="denet">Denet</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={profile.sales_rep_id || 'none'}
                            onValueChange={(value) => handleATMFieldChange(profile.id, 'sales_rep_id', value === 'none' ? null : value)}
                          >
                            <SelectTrigger className="bg-card border-white/10">
                              <SelectValue placeholder="No rep" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">No rep</SelectItem>
                              {salesReps.filter(r => r.active).map((rep) => (
                                <SelectItem key={rep.id} value={rep.id}>
                                  {rep.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={profile.monthly_rent}
                            onChange={(e) => handleATMFieldChange(profile.id, 'monthly_rent', parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={profile.cash_management_rps}
                            onChange={(e) => handleATMFieldChange(profile.id, 'cash_management_rps', parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={profile.cash_management_rep}
                            onChange={(e) => handleATMFieldChange(profile.id, 'cash_management_rep', parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={profile.rent_payment_method || 'none'}
                            onValueChange={(value) => handleATMFieldChange(profile.id, 'rent_payment_method', value === 'none' ? null : value)}
                          >
                            <SelectTrigger className={`bg-card border-white/10 ${
                              profile.rent_payment_method === 'Bill Pay' ? 'text-blue-400 font-semibold' :
                              profile.rent_payment_method === 'ACH' ? 'text-green-400 font-semibold' :
                              ''
                            }`}>
                              <SelectValue placeholder="-" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">-</SelectItem>
                              <SelectItem value="Bill Pay">Bill Pay</SelectItem>
                              <SelectItem value="ACH">ACH</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={profile.installed_date || ''}
                            onChange={(e) => handleATMFieldChange(profile.id, 'installed_date', e.target.value || null)}
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            value={profile.removed_date || ''}
                            onChange={(e) => handleATMFieldChange(profile.id, 'removed_date', e.target.value || null)}
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={profile.active === null ? 'active' : (profile.active ? 'active' : 'inactive')}
                            onValueChange={(value) => handleATMFieldChange(profile.id, 'active', value === 'active')}
                          >
                            <SelectTrigger className={`bg-card border-white/10 font-semibold ${
                              profile.active === false ? 'text-red-500' : 'text-green-500'
                            }`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active" className="text-green-500 font-semibold">Active</SelectItem>
                              <SelectItem value="inactive" className="text-red-500 font-semibold">Inactive</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={profile.notes || ''}
                            onChange={(e) => handleATMFieldChange(profile.id, 'notes', e.target.value || null)}
                            placeholder="Notes"
                            className="bg-card border-white/10"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteATMClick(profile)}
                            className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            disabled={isReadOnly}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {/* Inactive ATMs Section */}
              {profiles.filter(p => p.active === false && (platformFilter === 'all' || p.platform === platformFilter)).length > 0 && (
                <div className="mb-4">
                  <h4 className="text-md font-semibold text-red-500 mb-3">
                    Inactive ATMs ({profiles.filter(p => p.active === false && (platformFilter === 'all' || p.platform === platformFilter)).length})
                  </h4>
                  <div className="rounded-md border border-white/10 overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-white/5">
                        <TableRow className="border-white/10">
                          <TableHead className="min-w-[70px]">
                            <button
                              onClick={() => toggleAtmSort('atm_id')}
                              className="flex items-center gap-1 hover:text-foreground transition-colors"
                            >
                              ATM ID
                              {atmSortField === 'atm_id' && (atmSortOrder === 'asc' ? (
                                <ArrowUp className="w-4 h-4" />
                              ) : (
                                <ArrowDown className="w-4 h-4" />
                              ))}
                              {atmSortField !== 'atm_id' && <ArrowUpDown className="w-4 h-4 opacity-50" />}
                            </button>
                          </TableHead>
                          <TableHead className="min-w-[140px]">
                            <button
                              onClick={() => toggleAtmSort('location_name')}
                              className="flex items-center gap-1 hover:text-foreground transition-colors"
                            >
                              Location Name
                              {atmSortField === 'location_name' && (atmSortOrder === 'asc' ? (
                                <ArrowUp className="w-4 h-4" />
                              ) : (
                                <ArrowDown className="w-4 h-4" />
                              ))}
                              {atmSortField !== 'location_name' && <ArrowUpDown className="w-4 h-4 opacity-50" />}
                            </button>
                          </TableHead>
                          <TableHead className="min-w-[90px]">City</TableHead>
                          <TableHead className="min-w-[50px]">State</TableHead>
                          <TableHead className="min-w-[70px]">Platform</TableHead>
                          <TableHead className="min-w-[120px]">Sales Rep</TableHead>
                          <TableHead className="min-w-[60px]">Rent ($)</TableHead>
                          <TableHead className="min-w-[60px]">CM RPS ($)</TableHead>
                          <TableHead className="min-w-[60px]">CM Rep ($)</TableHead>
                          <TableHead className="min-w-[90px]">Rent Pymt</TableHead>
                          <TableHead className="min-w-[100px]">Installed</TableHead>
                          <TableHead className="min-w-[100px]">Removed</TableHead>
                          <TableHead className="min-w-[90px]">Status</TableHead>
                          <TableHead className="min-w-[200px]">Notes</TableHead>
                          <TableHead className="w-[60px]">Delete</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {profiles.filter(p => p.active === false && (platformFilter === 'all' || p.platform === platformFilter)).map((profile) => (
                          <TableRow key={profile.id} className="border-white/5">
                            <TableCell className="font-mono text-sm">{profile.atm_id}</TableCell>
                            <TableCell>
                              <Input
                                value={profile.location_name || ''}
                                onChange={(e) => handleATMFieldChange(profile.id, 'location_name', e.target.value)}
                                placeholder="Location name"
                                className="bg-card border-white/10"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={profile.city || ''}
                                onChange={(e) => handleATMFieldChange(profile.id, 'city', e.target.value)}
                                placeholder="City"
                                className="bg-card border-white/10"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={profile.state || ''}
                                onChange={(e) => handleATMFieldChange(profile.id, 'state', e.target.value)}
                                placeholder="ST"
                                maxLength={2}
                                className="bg-card border-white/10 uppercase w-16"
                                style={{ textTransform: 'uppercase' }}
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={profile.platform || 'none'}
                                onValueChange={(value) => handleATMFieldChange(profile.id, 'platform', value === 'none' ? null : value)}
                              >
                                <SelectTrigger className="bg-card border-white/10">
                                  <SelectValue placeholder="Select" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">-</SelectItem>
                                  <SelectItem value="bitstop">Bitstop</SelectItem>
                                  <SelectItem value="denet">Denet</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select
                                value={profile.sales_rep_id || 'none'}
                                onValueChange={(value) => handleATMFieldChange(profile.id, 'sales_rep_id', value === 'none' ? null : value)}
                              >
                                <SelectTrigger className="bg-card border-white/10">
                                  <SelectValue placeholder="No rep" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">No rep</SelectItem>
                                  {salesReps.filter(r => r.active).map((rep) => (
                                    <SelectItem key={rep.id} value={rep.id}>
                                      {rep.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                value={profile.monthly_rent}
                                onChange={(e) => handleATMFieldChange(profile.id, 'monthly_rent', parseFloat(e.target.value) || 0)}
                                placeholder="0.00"
                                className="bg-card border-white/10"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                value={profile.cash_management_rps}
                                onChange={(e) => handleATMFieldChange(profile.id, 'cash_management_rps', parseFloat(e.target.value) || 0)}
                                placeholder="0.00"
                                className="bg-card border-white/10"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                step="0.01"
                                value={profile.cash_management_rep}
                                onChange={(e) => handleATMFieldChange(profile.id, 'cash_management_rep', parseFloat(e.target.value) || 0)}
                                placeholder="0.00"
                                className="bg-card border-white/10"
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={profile.rent_payment_method || 'none'}
                                onValueChange={(value) => handleATMFieldChange(profile.id, 'rent_payment_method', value === 'none' ? null : value)}
                              >
                                <SelectTrigger className={`bg-card border-white/10 ${
                                  profile.rent_payment_method === 'Bill Pay' ? 'text-blue-400 font-semibold' :
                                  profile.rent_payment_method === 'ACH' ? 'text-green-400 font-semibold' :
                                  ''
                                }`}>
                                  <SelectValue placeholder="-" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">-</SelectItem>
                                  <SelectItem value="Bill Pay">Bill Pay</SelectItem>
                                  <SelectItem value="ACH">ACH</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                type="date"
                                value={profile.installed_date || ''}
                                onChange={(e) => handleATMFieldChange(profile.id, 'installed_date', e.target.value || null)}
                                className="bg-card border-white/10"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                type="date"
                                value={profile.removed_date || ''}
                                onChange={(e) => handleATMFieldChange(profile.id, 'removed_date', e.target.value || null)}
                                className="bg-card border-white/10"
                              />
                            </TableCell>
                            <TableCell>
                              <Select
                                value={profile.active === null ? 'active' : (profile.active ? 'active' : 'inactive')}
                                onValueChange={(value) => handleATMFieldChange(profile.id, 'active', value === 'active')}
                              >
                                <SelectTrigger className={`bg-card border-white/10 font-semibold ${
                                  profile.active === false ? 'text-red-500' : 'text-green-500'
                                }`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="active" className="text-green-500 font-semibold">Active</SelectItem>
                                  <SelectItem value="inactive" className="text-red-500 font-semibold">Inactive</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                value={profile.notes || ''}
                                onChange={(e) => handleATMFieldChange(profile.id, 'notes', e.target.value || null)}
                                placeholder="Notes"
                                className="bg-card border-white/10"
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteATMClick(profile)}
                                className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                                disabled={isReadOnly}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </>
          )}

            <div className="mt-4 text-sm text-muted-foreground">
              <p><strong>How it works:</strong></p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>ATM IDs are automatically captured when you upload CSV files</li>
                <li>Assign a sales rep to each ATM for commission tracking</li>
                <li>Enter monthly rent, Cash Management RPS, and Cash Management Rep for P&L calculations</li>
                <li>Commission formula: (Total Fees - Bitstop Fees - Rent - Cash Mgmt RPS - Cash Mgmt Rep) × Rep Commission %</li>
                <li>Plus flat monthly fee per ATM managed by the rep</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>

      {/* Add ATM Dialog */}
      <Dialog open={isAddATMOpen} onOpenChange={setIsAddATMOpen}>
        <DialogContent className="bg-card border-white/10">
          <DialogHeader>
            <DialogTitle>Add New ATM</DialogTitle>
            <DialogDescription>
              Manually add a new ATM to the profile list.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="atm_id">ATM ID *</Label>
                <Input
                  id="atm_id"
                  value={newATM.atm_id}
                  onChange={(e) => setNewATM({ ...newATM, atm_id: e.target.value })}
                  placeholder="Enter ATM ID"
                  className="bg-card border-white/10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="serial_number">Serial Number</Label>
                <Input
                  id="serial_number"
                  value={newATM.serial_number}
                  onChange={(e) => setNewATM({ ...newATM, serial_number: e.target.value })}
                  placeholder="Enter serial number"
                  className="bg-card border-white/10"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="location_name">Location Name</Label>
              <Input
                id="location_name"
                value={newATM.location_name}
                onChange={(e) => setNewATM({ ...newATM, location_name: e.target.value })}
                placeholder="Enter location name"
                className="bg-card border-white/10"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={newATM.city}
                  onChange={(e) => setNewATM({ ...newATM, city: e.target.value })}
                  placeholder="City"
                  className="bg-card border-white/10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={newATM.state}
                  onChange={(e) => setNewATM({ ...newATM, state: e.target.value.toUpperCase() })}
                  placeholder="ST"
                  maxLength={2}
                  className="bg-card border-white/10 uppercase"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="platform">Platform</Label>
              <Select
                value={newATM.platform || 'none'}
                onValueChange={(value) => setNewATM({ ...newATM, platform: value === 'none' ? null : value })}
              >
                <SelectTrigger className="bg-card border-white/10">
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-</SelectItem>
                  <SelectItem value="bitstop">Bitstop</SelectItem>
                  <SelectItem value="denet">Denet</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sales_rep">Sales Rep</Label>
              <Select
                value={newATM.sales_rep_id || 'none'}
                onValueChange={(value) => setNewATM({ ...newATM, sales_rep_id: value === 'none' ? null : value })}
              >
                <SelectTrigger className="bg-card border-white/10">
                  <SelectValue placeholder="Select sales rep" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No rep</SelectItem>
                  {salesReps.filter(r => r.active).map((rep) => (
                    <SelectItem key={rep.id} value={rep.id}>
                      {rep.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="monthly_rent">Monthly Rent ($)</Label>
                <Input
                  id="monthly_rent"
                  type="number"
                  step="0.01"
                  value={newATM.monthly_rent}
                  onChange={(e) => setNewATM({ ...newATM, monthly_rent: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="bg-card border-white/10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cm_rps">CM RPS ($)</Label>
                <Input
                  id="cm_rps"
                  type="number"
                  step="0.01"
                  value={newATM.cash_management_rps}
                  onChange={(e) => setNewATM({ ...newATM, cash_management_rps: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="bg-card border-white/10"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cm_rep">CM Rep ($)</Label>
                <Input
                  id="cm_rep"
                  type="number"
                  step="0.01"
                  value={newATM.cash_management_rep}
                  onChange={(e) => setNewATM({ ...newATM, cash_management_rep: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                  className="bg-card border-white/10"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="rent_payment">Rent Payment Method</Label>
                <Select
                  value={newATM.rent_payment_method || 'none'}
                  onValueChange={(value) => setNewATM({ ...newATM, rent_payment_method: value === 'none' ? null : value })}
                >
                  <SelectTrigger className="bg-card border-white/10">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">-</SelectItem>
                    <SelectItem value="Bill Pay">Bill Pay</SelectItem>
                    <SelectItem value="ACH">ACH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="installed_date">Installed Date</Label>
                <Input
                  id="installed_date"
                  type="date"
                  value={newATM.installed_date || ''}
                  onChange={(e) => setNewATM({ ...newATM, installed_date: e.target.value || null })}
                  className="bg-card border-white/10"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={newATM.notes}
                onChange={(e) => setNewATM({ ...newATM, notes: e.target.value })}
                placeholder="Optional notes"
                className="bg-card border-white/10"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddATMOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddATM}>
              Add ATM
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete ATM Confirmation Dialog */}
      <AlertDialog open={isDeleteATMOpen} onOpenChange={setIsDeleteATMOpen}>
        <AlertDialogContent className="bg-card border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteCheckLoading ? 'Checking...' : hasSalesHistory ? 'Cannot Delete ATM' : 'Delete ATM?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCheckLoading ? (
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Checking for sales history...
                </span>
              ) : hasSalesHistory ? (
                <span className="text-red-400">
                  This ATM (ID: {atmToDelete?.atm_id}) cannot be deleted because it has sales history
                  (transactions or cash pickups) associated with it. You can mark it as inactive instead.
                </span>
              ) : (
                <>
                  Are you sure you want to delete ATM <strong>{atmToDelete?.atm_id}</strong>
                  {atmToDelete?.location_name && <> at <strong>{atmToDelete.location_name}</strong></>}?
                  <br /><br />
                  This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setIsDeleteATMOpen(false);
              setAtmToDelete(null);
            }}>
              {hasSalesHistory ? 'Close' : 'Cancel'}
            </AlertDialogCancel>
            {!deleteCheckLoading && !hasSalesHistory && (
              <AlertDialogAction
                onClick={handleConfirmDeleteATM}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Delete ATM
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
    </div>
    </SettingsGuard>
  );
}
