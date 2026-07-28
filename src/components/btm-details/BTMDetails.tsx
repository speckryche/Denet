import { useState, useEffect, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Pencil, History, Search, Download, Check, Plus, Monitor, RefreshCw, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import UpdateMachineStateModal from './UpdateMachineStateModal';
import ProfileTimeline from './ProfileTimeline';

interface SalesRep {
  id: string;
  name: string;
  active: boolean | null;
}

interface ATMProfile {
  id: string;
  atm_id: string | null;
  serial_number: string | null;
  location_name: string;
  platform: 'denet' | 'bitstop';
  active: boolean;
  status: 'Active' | 'Inactive' | 'Pending';
  monthly_rent: number;
  rent_payment_method: string;
  cash_management_rps: number;
  cash_management_rep: number;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  installed_date: string | null;
  removed_date: string | null;
  warehouse_location: string | null;
  on_bitstop: boolean;
  on_coinradar: boolean;
  sales_rep_id: string | null;
  notes: string | null;
}

// Formats a row's address as one muted line: "Street · City, State Zip".
// Any missing piece is dropped gracefully; returns '' when nothing is present.
const formatAddress = (p: ATMProfile): string => {
  const cityState = [p.city, p.state].filter(Boolean).join(', ');
  const cityStateZip = [cityState, p.zip_code].filter(Boolean).join(' ');
  return [p.street_address, cityStateZip].filter(Boolean).join(' · ');
};

export default function BTMDetails() {
  const [profiles, setProfiles] = useState<ATMProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ATMProfile>>({});
  const [historyModal, setHistoryModal] = useState<{ atmId: string; open: boolean }>({ atmId: '', open: false });
  const [historyData, setHistoryData] = useState<ATMProfile[]>([]);
  const [updateStateProfile, setUpdateStateProfile] = useState<ATMProfile | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [salesReps, setSalesReps] = useState<SalesRep[]>([]);
  const [addingNew, setAddingNew] = useState(false);
  const [newMachineForm, setNewMachineForm] = useState<Partial<ATMProfile>>({
    platform: 'denet',
    on_bitstop: false,
    on_coinradar: false,
    monthly_rent: 0,
    rent_payment_method: '',
    cash_management_rps: 0,
    cash_management_rep: 0,
    sales_rep_id: null,
  });
  const [sortConfigActive, setSortConfigActive] = useState<{ key: keyof ATMProfile | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
  const [sortConfigInactive, setSortConfigInactive] = useState<{ key: keyof ATMProfile | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
  const [sortConfigWarehouse, setSortConfigWarehouse] = useState<{ key: keyof ATMProfile | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
  const { toast } = useToast();
  const { role } = useAuth();

  const isAdmin = role === 'admin';

  useEffect(() => {
    fetchProfiles();
    fetchSalesReps();
  }, []);

  const fetchSalesReps = async () => {
    const { data } = await supabase
      .from('sales_reps')
      .select('id, name, active')
      .order('name');
    if (data) setSalesReps(data);
  };

  const fetchProfiles = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('atm_profiles')
      .select('*')
      .order('atm_id');

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      const profilesWithStatus = (data || []).map(profile => {
        let status: 'Active' | 'Inactive' | 'Pending' = 'Pending';
        
        if (profile.removed_date) {
          status = 'Inactive';
        } else if (profile.installed_date && profile.atm_id) {
          status = 'Active';
        }
        
        return {
          ...profile,
          status,
          active: status === 'Active'
        };
      });
      setProfiles(profilesWithStatus);
    }
    setLoading(false);
  };

  // "Latest profile per atm_id" — one row per ATM, picking the most
  // recently installed. The BTM Details page surfaces retired machines too
  // (their last-known profile shows up in the Inactive section), so an
  // active-only filter would empty out that section entirely. Placeholders
  // (rows without an atm_id) are passed through individually.
  //
  // The earlier Phase 2a rewrite tightened this to active=true; that was
  // wrong for this page. The Phase 2a invariants (one active per atm_id,
  // non-overlapping windows) still hold — "latest installed" and "active"
  // agree for any ATM that hasn't been retired.
  const getLatestProfiles = () => {
    const byAtmId = new Map<string, ATMProfile>();
    const placeholders: ATMProfile[] = [];
    for (const p of profiles) {
      if (!p.atm_id) {
        placeholders.push(p);
        continue;
      }
      const existing = byAtmId.get(p.atm_id);
      if (!existing || (p.installed_date || '') > (existing.installed_date || '')) {
        byAtmId.set(p.atm_id, p);
      }
    }
    return [...byAtmId.values(), ...placeholders];
  };

  const hasHistory = (atmId: string | null) => {
    if (!atmId) return false;
    return profiles.filter(p => p.atm_id === atmId).length > 1;
  };

  const showHistory = async (atmId: string) => {
    const history = profiles
      .filter(p => p.atm_id === atmId)
      .sort((a, b) => new Date(b.installed_date || 0).getTime() - new Date(a.installed_date || 0).getTime());
    setHistoryData(history);
    setHistoryModal({ atmId, open: true });
  };

  const startEdit = (profile: ATMProfile) => {
    setEditingId(profile.id);
    setEditForm(profile);
  };

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (!editingId) return;

    // Remove computed fields from the update
    const { status, active, ...updateData } = editForm;

    // Calculate active status based on installed_date, atm_id, and removed_date
    const updatedData = {
      ...updateData,
      active: !!(updateData.installed_date && updateData.atm_id && !updateData.removed_date),
    };

    const { error } = await supabase
      .from('atm_profiles')
      .update(updatedData)
      .eq('id', editingId);

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Success', description: 'ATM updated successfully' });
      fetchProfiles();
      cancelEdit();
    }
  };

  const saveNewMachine = async () => {
    console.log('saveNewMachine called with form:', newMachineForm);
    
    if (!newMachineForm.location_name) {
      console.log('Validation failed: location_name missing');
      toast({ title: 'Error', description: 'Location Name is required', variant: 'destructive' });
      return;
    }

    // If machine is going active (has installed_date and not in warehouse), require ATM ID
    if (newMachineForm.installed_date && !newMachineForm.warehouse_location && !newMachineForm.atm_id) {
      toast({ title: 'Error', description: 'ATM ID is required for machines with an install date', variant: 'destructive' });
      return;
    }
    // Clean up empty date strings - convert to null for database
    const cleanedForm = {
      ...newMachineForm,
      installed_date: newMachineForm.installed_date || null,
      removed_date: newMachineForm.removed_date || null,
    };

    try {
      const { data, error } = await supabase
        .from('atm_profiles')
        .insert([{
          ...cleanedForm,
          active: !!(cleanedForm.installed_date && cleanedForm.atm_id && !cleanedForm.removed_date),
        }])
        .select();

      console.log('Insert result:', { data, error });

      if (error) {
        console.error('Insert error:', error);
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'Success', description: 'New machine added successfully' });
        fetchProfiles();
        setAddingNew(false);
        setNewMachineForm({
          platform: 'denet',
          on_bitstop: false,
          on_coinradar: false,
          monthly_rent: 0,
          rent_payment_method: '',
          cash_management_rps: 0,
          cash_management_rep: 0,
          sales_rep_id: null,
        });
      }
    } catch (err) {
      console.error('Caught error:', err);
      toast({ title: 'Error', description: 'Failed to save machine', variant: 'destructive' });
    }
  };

  const exportToCSV = (data: ATMProfile[], filename: string) => {
    const headers = ['Status', 'Platform', 'ATM ID', 'Serial Number', 'On Bitstop', 'On CoinRadar', 'Location Name', 'Monthly Rent', 'Rent Paid', 'Mgmt - RPS', 'Mgmt - Rep', 'Street', 'City', 'State', 'Zip', 'Installed', 'Removed', 'Warehouse', 'Notes'];
    const rows = data.map(p => [
      p.status,
      p.platform,
      p.atm_id || 'N/A',
      p.serial_number || 'N/A',
      p.on_bitstop ? 'Yes' : 'No',
      p.on_coinradar ? 'Yes' : 'No',
      p.location_name,
      p.monthly_rent,
      p.rent_payment_method,
      p.cash_management_rps,
      p.cash_management_rep,
      p.street_address || '',
      p.city || '',
      p.state || '',
      p.zip_code || '',
      p.installed_date || '',
      p.removed_date || '',
      p.warehouse_location || '',
      p.notes || ''
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  };

  const renderTable = (data: ATMProfile[], title: string) => {
    // Determine which sort config to use based on the table
    let sortConfig, setSortConfig;
    if (title === 'Active - Denet') {
      sortConfig = sortConfigActive;
      setSortConfig = setSortConfigActive;
    } else if (title === 'Active - Bitstop') {
      sortConfig = sortConfigInactive;
      setSortConfig = setSortConfigInactive;
    } else if (title === 'Pending') {
      sortConfig = sortConfigWarehouse;
      setSortConfig = setSortConfigWarehouse;
    } else {
      sortConfig = sortConfigInactive;
      setSortConfig = setSortConfigInactive;
    }

    const filtered = data.filter(p => 
      searchTerm === '' || 
      p.atm_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.location_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const sorted = [...filtered].sort((a, b) => {
      if (!sortConfig.key) return 0;
      
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];
      
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        // For ATM ID, try numeric comparison if both are numeric strings
        if (sortConfig.key === 'atm_id') {
          const aNum = parseInt(aValue);
          const bNum = parseInt(bValue);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
          }
        }
        const cmp = sortConfig.direction === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
        if (cmp !== 0) return cmp;
        // Secondary sort by location_name when primary sort values are equal
        if (sortConfig.key === 'rent_payment_method') {
          return (a.location_name || '').localeCompare(b.location_name || '');
        }
        return 0;
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    const handleSort = (key: keyof ATMProfile) => {
      setSortConfig(prev => ({
        key,
        direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
      }));
    };

    const getSortIcon = (key: keyof ATMProfile) => {
      if (sortConfig.key !== key) return '↕';
      return sortConfig.direction === 'asc' ? '↑' : '↓';
    };

    // Inactive table gets an extra "Removed" column; drives colSpan for the
    // full-width edit form and drawer rows.
    const isInactive = title === 'Inactive';
    const colCount = isInactive ? 9 : 8;

    return (
      <Card className="p-6 mb-8 bg-[#1a1f2e] border-[#2a3142]">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-[#F5F1E8]">{title}</h2>
          <Button
            onClick={() => exportToCSV(sorted, `${title.replace(/ /g, '_')}.csv`)}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3142] text-xs uppercase tracking-wide text-gray-500">
                <th
                  className="text-left px-3 py-2 font-mono font-normal cursor-pointer hover:text-[#0066FF]"
                  onClick={() => handleSort('atm_id')}
                >
                  Machine {getSortIcon('atm_id')}
                </th>
                <th
                  className="text-left px-3 py-2 font-mono font-normal cursor-pointer hover:text-[#0066FF]"
                  onClick={() => handleSort('location_name')}
                >
                  Location {getSortIcon('location_name')}
                </th>
                <th className="text-center px-3 py-2 font-mono font-normal">Listed</th>
                <th className="text-right px-3 py-2 font-mono font-normal">Rent</th>
                <th className="text-right px-3 py-2 font-mono font-normal">Mgmt</th>
                <th
                  className="text-left px-3 py-2 font-mono font-normal cursor-pointer hover:text-[#0066FF]"
                  onClick={() => handleSort('rent_payment_method')}
                >
                  Pay {getSortIcon('rent_payment_method')}
                </th>
                <th className="text-left px-3 py-2 font-mono font-normal">Installed</th>
                {isInactive && <th className="text-left px-3 py-2 font-mono font-normal">Removed</th>}
                <th className="w-10 px-3 py-2" aria-label="Expand" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((profile, idx) => {
                const isExpanded = expandedId === profile.id;
                const address = formatAddress(profile);

                if (editingId === profile.id) {
                  return (
                    <Fragment key={profile.id}>
                      <tr className="bg-[#0F1419] border-b border-[#2a3142]">
                        <td colSpan={colCount} className="p-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">ATM ID</label>
                              <Input
                                value={editForm.atm_id || ''}
                                onChange={(e) => setEditForm({ ...editForm, atm_id: e.target.value })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                                placeholder="ATM ID"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Serial #</label>
                              <Input
                                value={editForm.serial_number || ''}
                                onChange={(e) => setEditForm({ ...editForm, serial_number: e.target.value })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs text-gray-400 mb-1">Location Name</label>
                              <Input
                                value={editForm.location_name || ''}
                                onChange={(e) => setEditForm({ ...editForm, location_name: e.target.value })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Monthly Rent ($)</label>
                              <Input
                                type="number"
                                value={editForm.monthly_rent || 0}
                                onChange={(e) => setEditForm({ ...editForm, monthly_rent: parseFloat(e.target.value) })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Rent Payment Method</label>
                              <Select
                                value={editForm.rent_payment_method || ''}
                                onValueChange={(value) => setEditForm({ ...editForm, rent_payment_method: value })}
                              >
                                <SelectTrigger className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]">
                                  <SelectValue placeholder="Select..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="ACH">ACH</SelectItem>
                                  <SelectItem value="Bill Pay">Bill Pay</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Mgmt - RPS ($)</label>
                              <Input
                                type="number"
                                value={editForm.cash_management_rps || 0}
                                onChange={(e) => setEditForm({ ...editForm, cash_management_rps: parseFloat(e.target.value) })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Mgmt - Rep ($)</label>
                              <Input
                                type="number"
                                value={editForm.cash_management_rep || 0}
                                onChange={(e) => setEditForm({ ...editForm, cash_management_rep: parseFloat(e.target.value) })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs text-gray-400 mb-1">Street Address</label>
                              <Input
                                value={editForm.street_address || ''}
                                onChange={(e) => setEditForm({ ...editForm, street_address: e.target.value })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">City</label>
                              <Input
                                value={editForm.city || ''}
                                onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">State</label>
                              <Input
                                value={editForm.state || ''}
                                onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Zip</label>
                              <Input
                                value={editForm.zip_code || ''}
                                onChange={(e) => setEditForm({ ...editForm, zip_code: e.target.value })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Installed Date</label>
                              <Input
                                type="date"
                                value={editForm.installed_date || ''}
                                onChange={(e) => setEditForm({ ...editForm, installed_date: e.target.value })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-gray-400 mb-1">Removed Date</label>
                              <Input
                                type="date"
                                value={editForm.removed_date || ''}
                                onChange={(e) => setEditForm({ ...editForm, removed_date: e.target.value })}
                                className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                              />
                            </div>
                            {isInactive && (
                              <div>
                                <label className="block text-xs text-gray-400 mb-1">Warehouse</label>
                                <Select
                                  value={editForm.warehouse_location || ''}
                                  onValueChange={(value) => setEditForm({ ...editForm, warehouse_location: value })}
                                >
                                  <SelectTrigger className="h-8 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]">
                                    <SelectValue placeholder="Select..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="Arizona (Steven)">Arizona (Steven)</SelectItem>
                                    <SelectItem value="Oregon (RPS)">Oregon (RPS)</SelectItem>
                                    <SelectItem value="Oregon (Portland)">Oregon (Portland)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            <div className="flex items-end gap-4 pb-1">
                              <label className="flex items-center gap-2 text-sm text-[#F5F1E8]">
                                <input
                                  type="checkbox"
                                  checked={editForm.on_bitstop || false}
                                  onChange={(e) => setEditForm({ ...editForm, on_bitstop: e.target.checked })}
                                  className="w-4 h-4"
                                />
                                On Bitstop
                              </label>
                              <label className="flex items-center gap-2 text-sm text-[#F5F1E8]">
                                <input
                                  type="checkbox"
                                  checked={editForm.on_coinradar || false}
                                  onChange={(e) => setEditForm({ ...editForm, on_coinradar: e.target.checked })}
                                  className="w-4 h-4"
                                />
                                On CoinRadar
                              </label>
                            </div>
                            <div className="col-span-2 md:col-span-4">
                              <label className="block text-xs text-gray-400 mb-1">Notes</label>
                              <Textarea
                                value={editForm.notes || ''}
                                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                                className="bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
                                rows={2}
                              />
                            </div>
                          </div>
                          <div className="flex gap-2 mt-4">
                            <Button size="sm" onClick={saveEdit}>Save</Button>
                            <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                          </div>
                        </td>
                      </tr>
                    </Fragment>
                  );
                }

                return (
                  <Fragment key={profile.id}>
                    <tr
                      onClick={() => toggleExpand(profile.id)}
                      className={cn(
                        'border-b border-[#2a3142]/60 cursor-pointer transition-colors hover:bg-[#252b3d]',
                        idx % 2 === 1 && !isExpanded && 'bg-white/[0.02]',
                        isExpanded && 'bg-[#252b3d]'
                      )}
                    >
                      {/* Machine */}
                      <td className="px-3 py-3 align-top">
                        <div className="font-mono font-bold text-[#F5F1E8]">{profile.atm_id || 'N/A'}</div>
                        <div className="font-mono text-xs text-gray-500">{profile.serial_number || 'N/A'}</div>
                      </td>
                      {/* Location */}
                      <td className="px-3 py-3 align-top">
                        <div className="font-semibold text-[#F5F1E8]">{profile.location_name}</div>
                        <div className="text-xs text-gray-500">{address || '—'}</div>
                      </td>
                      {/* Listed (Bitstop OR CoinRadar) */}
                      <td className="px-3 py-3 text-center align-top">
                        {profile.on_bitstop || profile.on_coinradar ? (
                          <Check className="w-4 h-4 text-green-500 inline" />
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      {/* Rent */}
                      <td className="px-3 py-3 text-right align-top font-mono tabular-nums text-[#F5F1E8]">
                        ${profile.monthly_rent}
                      </td>
                      {/* Mgmt (RPS | Rep) */}
                      <td className="px-3 py-3 text-right align-top font-mono tabular-nums text-[#F5F1E8] whitespace-nowrap">
                        ${profile.cash_management_rps} | ${profile.cash_management_rep}
                      </td>
                      {/* Pay */}
                      <td className="px-3 py-3 align-top">
                        {profile.rent_payment_method ? (
                          <span className="inline-flex items-center rounded-md border border-[#2a3142] bg-[#0F1419] px-2 py-0.5 text-xs font-medium text-gray-300">
                            {profile.rent_payment_method}
                          </span>
                        ) : (
                          <span className="text-gray-600">—</span>
                        )}
                      </td>
                      {/* Installed */}
                      <td className="px-3 py-3 align-top font-mono tabular-nums text-gray-400">
                        {profile.installed_date || '—'}
                      </td>
                      {/* Removed (Inactive only) */}
                      {isInactive && (
                        <td className="px-3 py-3 align-top font-mono tabular-nums text-gray-400">
                          {profile.removed_date || '—'}
                        </td>
                      )}
                      {/* Chevron */}
                      <td className="px-3 py-3 text-right align-top">
                        <ChevronDown
                          className={cn(
                            'w-4 h-4 text-gray-500 transition-transform inline',
                            isExpanded && 'rotate-180'
                          )}
                        />
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-[#0F1419] border-b border-[#2a3142]">
                        <td colSpan={colCount} className="px-6 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5 text-sm">
                              <div>
                                <span className="text-gray-500">Address: </span>
                                <span className="text-[#F5F1E8]">{address || '—'}</span>
                              </div>
                              <div>
                                <span className="text-gray-500">Bitstop listed: </span>
                                <span className="text-[#F5F1E8]">{profile.on_bitstop ? 'Yes' : 'No'}</span>
                              </div>
                              <div>
                                <span className="text-gray-500">CoinRadar listed: </span>
                                <span className="text-[#F5F1E8]">{profile.on_coinradar ? 'Yes' : 'No'}</span>
                              </div>
                              {profile.warehouse_location && (
                                <div>
                                  <span className="text-gray-500">Warehouse: </span>
                                  <span className="text-[#F5F1E8]">{profile.warehouse_location}</span>
                                </div>
                              )}
                            </div>
                            <div className="text-sm">
                              <div className="text-gray-500 mb-1">Notes</div>
                              <div className="text-[#F5F1E8] whitespace-pre-wrap">{profile.notes || '—'}</div>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#2a3142]">
                            {isAdmin && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={() => startEdit(profile)}
                              >
                                <Pencil className="w-3.5 h-3.5" /> Edit
                              </Button>
                            )}
                            {isAdmin && profile.active && profile.atm_id && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={() => setUpdateStateProfile(profile)}
                              >
                                <RefreshCw className="w-3.5 h-3.5" /> Relocate / Convert / Retire
                              </Button>
                            )}
                            {hasHistory(profile.atm_id) && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={() => showHistory(profile.atm_id!)}
                              >
                                <History className="w-3.5 h-3.5" /> History
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };

  const latestProfiles = getLatestProfiles();
  const activeDenet = latestProfiles.filter(p => p.status === 'Active' && p.platform === 'denet');
  const activeBitstop = latestProfiles.filter(p => p.status === 'Active' && p.platform === 'bitstop');
  const pending = latestProfiles.filter(p => p.status === 'Pending');
  const inactive = latestProfiles.filter(p => p.status === 'Inactive');
  const pendingDenet = pending.filter(p => p.platform === 'denet');
  const pendingBitstop = pending.filter(p => p.platform === 'bitstop');
  const inactiveDenet = inactive.filter(p => p.platform === 'denet');
  const inactiveBitstop = inactive.filter(p => p.platform === 'bitstop');

  // Calculate total rent by platform
  const totalRentDenet = activeDenet.reduce((sum, p) => sum + (p.monthly_rent || 0), 0);
  const totalRentBitstop = activeBitstop.reduce((sum, p) => sum + (p.monthly_rent || 0), 0);

  // Calculate total management costs by platform (Mgmt RPS + Mgmt Rep)
  const totalMgmtDenet = activeDenet.reduce((sum, p) => sum + (p.cash_management_rps || 0) + (p.cash_management_rep || 0), 0);
  const totalMgmtBitstop = activeBitstop.reduce((sum, p) => sum + (p.cash_management_rps || 0) + (p.cash_management_rep || 0), 0);

  // Calculate rent payment method counts by platform
  const rentPaidDenet = {
    ach: activeDenet.filter(p => p.rent_payment_method === 'ACH').length,
    billPay: activeDenet.filter(p => p.rent_payment_method === 'Bill Pay').length,
  };
  const rentPaidBitstop = {
    ach: activeBitstop.filter(p => p.rent_payment_method === 'ACH').length,
    billPay: activeBitstop.filter(p => p.rent_payment_method === 'Bill Pay').length,
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-[#0F1419] p-8">
      <div className="max-w-[1800px] mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold text-[#F5F1E8]">BTM Machine Details</h1>
          <div className="flex gap-4 items-center">
            {isAdmin && (
              <Button 
                onClick={() => setAddingNew(!addingNew)}
                className="bg-[#0066FF] hover:bg-[#0052CC]"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add New Machine
              </Button>
            )}
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <Input
                placeholder="Search ATM ID or Location..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-[#1a1f2e] border-[#2a3142] text-[#F5F1E8]"
              />
            </div>
          </div>
        </div>

        {/* Scorecards - Two Platform Sections Side by Side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Denet Section */}
          <div className="border border-green-500/30 rounded-lg p-4 bg-green-500/5 animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards" style={{ animationDelay: '0ms' }}>
            <h3 className="text-lg font-semibold text-green-500 mb-4 flex items-center gap-2">
              <Monitor className="w-5 h-5" /> Denet
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Status Card */}
              <Card className={cn("bg-card border-white/5 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,102,255,0.15)] group")}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground text-center">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 divide-x divide-white/10">
                    <div className="text-center pr-2">
                      <div className="text-xs text-green-400 mb-1">Active</div>
                      <div className="text-xl font-bold font-mono text-green-400">{activeDenet.length}</div>
                    </div>
                    <div className="text-center px-2">
                      <div className="text-xs text-amber-500 mb-1">Pending</div>
                      <div className="text-xl font-bold font-mono text-amber-500">{pendingDenet.length}</div>
                    </div>
                    <div className="text-center pl-2">
                      <div className="text-xs text-red-500 mb-1">Inactive</div>
                      <div className="text-xl font-bold font-mono text-red-500">{inactiveDenet.length}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Costs Card */}
              <Card className={cn("bg-card border-white/5 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,102,255,0.15)] group")}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground text-center">Costs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 divide-x divide-white/10">
                    <div className="text-center pr-2">
                      <div className="text-xs text-muted-foreground mb-1">Total Rent</div>
                      <div className="text-xl font-bold font-mono">${totalRentDenet.toLocaleString()}</div>
                    </div>
                    <div className="text-center pl-2">
                      <div className="text-xs text-muted-foreground mb-1">Management</div>
                      <div className="text-xl font-bold font-mono">${totalMgmtDenet.toLocaleString()}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Rent Method Card */}
              <Card className={cn("bg-card border-white/5 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,102,255,0.15)] group")}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground text-center">Rent Method</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 divide-x divide-white/10">
                    <div className="text-center pr-2">
                      <div className="text-xs text-green-400 mb-1">ACH</div>
                      <div className="text-xl font-bold font-mono">{rentPaidDenet.ach}</div>
                    </div>
                    <div className="text-center pl-2">
                      <div className="text-xs text-blue-400 mb-1">Bill Pay</div>
                      <div className="text-xl font-bold font-mono">{rentPaidDenet.billPay}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Bitstop Section */}
          <div className="border border-blue-500/30 rounded-lg p-4 bg-blue-500/5 animate-in fade-in slide-in-from-bottom-4 fill-mode-backwards" style={{ animationDelay: '100ms' }}>
            <h3 className="text-lg font-semibold text-blue-500 mb-4 flex items-center gap-2">
              <Monitor className="w-5 h-5" /> Bitstop
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Status Card */}
              <Card className={cn("bg-card border-white/5 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,102,255,0.15)] group")}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground text-center">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 divide-x divide-white/10">
                    <div className="text-center pr-2">
                      <div className="text-xs text-green-400 mb-1">Active</div>
                      <div className="text-xl font-bold font-mono text-green-400">{activeBitstop.length}</div>
                    </div>
                    <div className="text-center px-2">
                      <div className="text-xs text-amber-500 mb-1">Pending</div>
                      <div className="text-xl font-bold font-mono text-amber-500">{pendingBitstop.length}</div>
                    </div>
                    <div className="text-center pl-2">
                      <div className="text-xs text-red-500 mb-1">Inactive</div>
                      <div className="text-xl font-bold font-mono text-red-500">{inactiveBitstop.length}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Costs Card */}
              <Card className={cn("bg-card border-white/5 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,102,255,0.15)] group")}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground text-center">Costs</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 divide-x divide-white/10">
                    <div className="text-center pr-2">
                      <div className="text-xs text-muted-foreground mb-1">Total Rent</div>
                      <div className="text-xl font-bold font-mono">${totalRentBitstop.toLocaleString()}</div>
                    </div>
                    <div className="text-center pl-2">
                      <div className="text-xs text-muted-foreground mb-1">Management</div>
                      <div className="text-xl font-bold font-mono">${totalMgmtBitstop.toLocaleString()}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Rent Method Card */}
              <Card className={cn("bg-card border-white/5 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,102,255,0.15)] group")}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground text-center">Rent Method</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 divide-x divide-white/10">
                    <div className="text-center pr-2">
                      <div className="text-xs text-green-400 mb-1">ACH</div>
                      <div className="text-xl font-bold font-mono">{rentPaidBitstop.ach}</div>
                    </div>
                    <div className="text-center pl-2">
                      <div className="text-xs text-blue-400 mb-1">Bill Pay</div>
                      <div className="text-xl font-bold font-mono">{rentPaidBitstop.billPay}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {addingNew && (
          <Card className="bg-[#1a1f2e] border-[#2a3142] mb-8 p-6">
            <h2 className="text-2xl font-bold text-[#F5F1E8] mb-4">Add New Machine</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">ATM ID {newMachineForm.installed_date && !newMachineForm.warehouse_location && '*'}</label>
                <Input
                  value={newMachineForm.atm_id || ''}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, atm_id: e.target.value })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                  placeholder="e.g., ATM-001"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Serial Number</label>
                <Input
                  value={newMachineForm.serial_number || ''}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, serial_number: e.target.value })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                  placeholder="e.g., SN123456"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Location Name *</label>
                <Input
                  value={newMachineForm.location_name || ''}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, location_name: e.target.value })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                  placeholder="e.g., Downtown Store"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Platform</label>
                <Select
                  value={newMachineForm.platform || 'denet'}
                  onValueChange={(value: 'denet' | 'bitstop') => setNewMachineForm({ ...newMachineForm, platform: value })}
                >
                  <SelectTrigger className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="denet">Denet</SelectItem>
                    <SelectItem value="bitstop">Bitstop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Sales Rep</label>
                <Select
                  value={newMachineForm.sales_rep_id || ''}
                  onValueChange={(value) => setNewMachineForm({ ...newMachineForm, sales_rep_id: value || null })}
                >
                  <SelectTrigger className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]">
                    <SelectValue placeholder="Select sales rep..." />
                  </SelectTrigger>
                  <SelectContent>
                    {salesReps.filter(r => r.active).map((rep) => (
                      <SelectItem key={rep.id} value={rep.id}>
                        {rep.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Installed Date</label>
                <Input
                  type="date"
                  value={newMachineForm.installed_date || ''}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, installed_date: e.target.value })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Warehouse Location</label>
                <Select
                  value={newMachineForm.warehouse_location || ''}
                  onValueChange={(value) => setNewMachineForm({ ...newMachineForm, warehouse_location: value })}
                >
                  <SelectTrigger className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]">
                    <SelectValue placeholder="Select warehouse..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Arizona (Steven)">Arizona (Steven)</SelectItem>
                    <SelectItem value="Oregon (RPS)">Oregon (RPS)</SelectItem>
                    <SelectItem value="Oregon (Portland)">Oregon (Portland)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-[#F5F1E8]">
                  <input
                    type="checkbox"
                    checked={newMachineForm.on_bitstop || false}
                    onChange={(e) => setNewMachineForm({ ...newMachineForm, on_bitstop: e.target.checked })}
                    className="w-4 h-4"
                  />
                  On Bitstop
                </label>
                <label className="flex items-center gap-2 text-sm text-[#F5F1E8]">
                  <input
                    type="checkbox"
                    checked={newMachineForm.on_coinradar || false}
                    onChange={(e) => setNewMachineForm({ ...newMachineForm, on_coinradar: e.target.checked })}
                    className="w-4 h-4"
                  />
                  On CoinRadar
                </label>
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Street Address</label>
                <Input
                  value={newMachineForm.street_address || ''}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, street_address: e.target.value })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">City</label>
                <Input
                  value={newMachineForm.city || ''}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, city: e.target.value })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">State</label>
                <Input
                  value={newMachineForm.state || ''}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, state: e.target.value })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Zip Code</label>
                <Input
                  value={newMachineForm.zip_code || ''}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, zip_code: e.target.value })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Monthly Rent ($)</label>
                <Input
                  type="number"
                  value={newMachineForm.monthly_rent || 0}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, monthly_rent: parseFloat(e.target.value) })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Rent Payment Method</label>
                <Select
                  value={newMachineForm.rent_payment_method || ''}
                  onValueChange={(value) => setNewMachineForm({ ...newMachineForm, rent_payment_method: value })}
                >
                  <SelectTrigger className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]">
                    <SelectValue placeholder="Select payment method..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACH">ACH</SelectItem>
                    <SelectItem value="Bill Pay">Bill Pay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Cash Mgmt - RPS ($)</label>
                <Input
                  type="number"
                  value={newMachineForm.cash_management_rps || 0}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, cash_management_rps: parseFloat(e.target.value) })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                />
              </div>
              <div>
                <label className="text-sm text-[#F5F1E8] mb-1 block">Cash Mgmt - Rep ($)</label>
                <Input
                  type="number"
                  value={newMachineForm.cash_management_rep || 0}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, cash_management_rep: parseFloat(e.target.value) })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                />
              </div>
              <div className="col-span-2">
                <label className="text-sm text-[#F5F1E8] mb-1 block">Notes</label>
                <Textarea
                  value={newMachineForm.notes || ''}
                  onChange={(e) => setNewMachineForm({ ...newMachineForm, notes: e.target.value })}
                  className="bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]"
                  rows={3}
                />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button onClick={saveNewMachine} className="bg-[#0066FF] hover:bg-[#0052CC]">
                Save Machine
              </Button>
              <Button onClick={() => setAddingNew(false)} variant="outline">
                Cancel
              </Button>
            </div>
          </Card>
        )}

        {renderTable(activeDenet, 'Active - Denet')}
        {renderTable(activeBitstop, 'Active - Bitstop')}
        {renderTable(pending, 'Pending')}
        {renderTable(inactive, 'Inactive')}

        <Dialog open={historyModal.open} onOpenChange={(open) => setHistoryModal({ ...historyModal, open })}>
          <DialogContent className="max-w-3xl bg-[#1a1f2e] text-[#F5F1E8] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Machine History — {historyModal.atmId}</DialogTitle>
            </DialogHeader>
            <ProfileTimeline profiles={historyData} />
          </DialogContent>
        </Dialog>

        <UpdateMachineStateModal
          profile={updateStateProfile}
          open={!!updateStateProfile}
          onOpenChange={(o) => {
            if (!o) setUpdateStateProfile(null);
          }}
          onSuccess={() => fetchProfiles()}
        />
      </div>
    </div>
  );
}
