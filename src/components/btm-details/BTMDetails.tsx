import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { Pencil, History, Search, Download, X, Check, Plus, Monitor, DollarSign, CreditCard } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

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
  notes: string | null;
}

export default function BTMDetails() {
  const [profiles, setProfiles] = useState<ATMProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ATMProfile>>({});
  const [historyModal, setHistoryModal] = useState<{ atmId: string; open: boolean }>({ atmId: '', open: false });
  const [historyData, setHistoryData] = useState<ATMProfile[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newMachineForm, setNewMachineForm] = useState<Partial<ATMProfile>>({
    platform: 'denet',
    on_bitstop: false,
    on_coinradar: false,
    monthly_rent: 0,
    rent_payment_method: '',
    cash_management_rps: 0,
    cash_management_rep: 0,
  });
  const [sortConfigActive, setSortConfigActive] = useState<{ key: keyof ATMProfile | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
  const [sortConfigInactive, setSortConfigInactive] = useState<{ key: keyof ATMProfile | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
  const [sortConfigWarehouse, setSortConfigWarehouse] = useState<{ key: keyof ATMProfile | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
  const { toast } = useToast();
  const { role } = useAuth();

  const isAdmin = role === 'admin';

  useEffect(() => {
    fetchProfiles();
  }, []);

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

  const getLatestProfiles = () => {
    const latest = new Map<string, ATMProfile>();
    profiles.forEach(profile => {
      const key = profile.atm_id || profile.id;
      const existing = latest.get(key);
      if (!existing || new Date(profile.installed_date || 0) > new Date(existing.installed_date || 0)) {
        latest.set(key, profile);
      }
    });
    return Array.from(latest.values());
  };

  const hasHistory = (atmId: string) => {
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
      platform_switch_date: newMachineForm.platform_switch_date || null,
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

  const renderTable = (data: ATMProfile[], title: string, showWarehouse = false) => {
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
        return sortConfig.direction === 'asc' 
          ? aValue.localeCompare(bValue) 
          : bValue.localeCompare(aValue);
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
              <tr className="border-b border-[#2a3142]">
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Status</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Platform</th>
                <th 
                  className="text-left p-2 text-[#F5F1E8] font-mono cursor-pointer hover:text-[#0066FF]" 
                  onClick={() => handleSort('atm_id')}
                >
                  ATM ID {getSortIcon('atm_id')}
                </th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Serial #</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Bitstop</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">CoinRadar</th>
                <th 
                  className="text-left p-2 text-[#F5F1E8] font-mono cursor-pointer hover:text-[#0066FF]" 
                  onClick={() => handleSort('location_name')}
                >
                  Location {getSortIcon('location_name')}
                </th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Rent</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Rent Paid</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Mgmt RPS</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Mgmt Rep</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Street</th>
                <th 
                  className="text-left p-2 text-[#F5F1E8] font-mono cursor-pointer hover:text-[#0066FF]" 
                  onClick={() => handleSort('city')}
                >
                  City {getSortIcon('city')}
                </th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">State</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Zip</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Installed</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Removed</th>
                {showWarehouse && <th className="text-left p-2 text-[#F5F1E8] font-mono">Warehouse</th>}
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Notes</th>
                <th className="text-left p-2 text-[#F5F1E8] font-mono">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(profile => (
                <tr key={profile.id} className="border-b border-[#2a3142] hover:bg-[#252b3d]">
                  {editingId === profile.id ? (
                    <>
                      <td className="p-2 text-[#F5F1E8]">{profile.status}</td>
                      <td className="p-2 text-[#F5F1E8]">{profile.platform}</td>
                      <td className="p-2">
                        <Input
                          value={editForm.atm_id || ''}
                          onChange={(e) => setEditForm({ ...editForm, atm_id: e.target.value })}
                          className="w-28 h-8"
                          placeholder="ATM ID"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={editForm.serial_number || ''}
                          onChange={(e) => setEditForm({ ...editForm, serial_number: e.target.value })}
                          className="w-28 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={editForm.on_bitstop || false}
                          onChange={(e) => setEditForm({ ...editForm, on_bitstop: e.target.checked })}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={editForm.on_coinradar || false}
                          onChange={(e) => setEditForm({ ...editForm, on_coinradar: e.target.checked })}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={editForm.location_name || ''}
                          onChange={(e) => setEditForm({ ...editForm, location_name: e.target.value })}
                          className="w-32 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={editForm.monthly_rent || 0}
                          onChange={(e) => setEditForm({ ...editForm, monthly_rent: parseFloat(e.target.value) })}
                          className="w-24 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <Select
                          value={editForm.rent_payment_method || ''}
                          onValueChange={(value) => setEditForm({ ...editForm, rent_payment_method: value })}
                        >
                          <SelectTrigger className="w-32 h-8 bg-[#0F1419] border-[#2a3142] text-[#F5F1E8]">
                            <SelectValue placeholder="Select..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ACH">ACH</SelectItem>
                            <SelectItem value="Bill Pay">Bill Pay</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={editForm.cash_management_rps || 0}
                          onChange={(e) => setEditForm({ ...editForm, cash_management_rps: parseFloat(e.target.value) })}
                          className="w-24 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={editForm.cash_management_rep || 0}
                          onChange={(e) => setEditForm({ ...editForm, cash_management_rep: parseFloat(e.target.value) })}
                          className="w-24 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={editForm.street_address || ''}
                          onChange={(e) => setEditForm({ ...editForm, street_address: e.target.value })}
                          className="w-32 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={editForm.city || ''}
                          onChange={(e) => setEditForm({ ...editForm, city: e.target.value })}
                          className="w-24 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={editForm.state || ''}
                          onChange={(e) => setEditForm({ ...editForm, state: e.target.value })}
                          className="w-16 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          value={editForm.zip_code || ''}
                          onChange={(e) => setEditForm({ ...editForm, zip_code: e.target.value })}
                          className="w-24 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="date"
                          value={editForm.installed_date || ''}
                          onChange={(e) => setEditForm({ ...editForm, installed_date: e.target.value })}
                          className="w-32 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="date"
                          value={editForm.removed_date || ''}
                          onChange={(e) => setEditForm({ ...editForm, removed_date: e.target.value })}
                          className="w-32 h-8"
                        />
                      </td>
                      {showWarehouse && (
                        <td className="p-2">
                          <Select
                            value={editForm.warehouse_location || ''}
                            onValueChange={(value) => setEditForm({ ...editForm, warehouse_location: value })}
                          >
                            <SelectTrigger className="w-40 h-8">
                              <SelectValue placeholder="Select..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Arizona (Steven)">Arizona (Steven)</SelectItem>
                              <SelectItem value="Oregon (RPS)">Oregon (RPS)</SelectItem>
                              <SelectItem value="Oregon (Portland)">Oregon (Portland)</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                      )}
                      <td className="p-2">
                        <Textarea
                          value={editForm.notes || ''}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                          className="w-32 h-8"
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          <Button size="sm" onClick={saveEdit}>Save</Button>
                          <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-2 text-[#F5F1E8]">{profile.status}</td>
                      <td className="p-2 text-[#F5F1E8]">{profile.platform}</td>
                      <td className="p-2 text-[#F5F1E8] font-mono">{profile.atm_id || 'N/A'}</td>
                      <td className="p-2 text-[#F5F1E8] font-mono">{profile.serial_number || 'N/A'}</td>
                      <td className="p-2">
                        {profile.on_bitstop ? (
                          <Check className="w-5 h-5 text-green-500" />
                        ) : (
                          <X className="w-5 h-5 text-red-500" />
                        )}
                      </td>
                      <td className="p-2">
                        {profile.on_coinradar ? (
                          <Check className="w-5 h-5 text-green-500" />
                        ) : (
                          <X className="w-5 h-5 text-red-500" />
                        )}
                      </td>
                      <td className="p-2 text-[#F5F1E8]">{profile.location_name}</td>
                      <td className="p-2 text-[#F5F1E8] font-mono">${profile.monthly_rent}</td>
                      <td className="p-2 text-[#F5F1E8]">{profile.rent_payment_method}</td>
                      <td className="p-2 text-[#F5F1E8] font-mono">${profile.cash_management_rps}</td>
                      <td className="p-2 text-[#F5F1E8] font-mono">${profile.cash_management_rep}</td>
                      <td className="p-2 text-[#F5F1E8]">{profile.street_address || '-'}</td>
                      <td className="p-2 text-[#F5F1E8]">{profile.city || '-'}</td>
                      <td className="p-2 text-[#F5F1E8]">{profile.state || '-'}</td>
                      <td className="p-2 text-[#F5F1E8]">{profile.zip_code || '-'}</td>
                      <td className="p-2 text-[#F5F1E8] font-mono">{profile.installed_date || '-'}</td>
                      <td className="p-2 text-[#F5F1E8] font-mono">{profile.removed_date || '-'}</td>
                      {showWarehouse && <td className="p-2 text-[#F5F1E8]">{profile.warehouse_location || '-'}</td>}
                      <td className="p-2 text-[#F5F1E8] text-xs truncate max-w-[100px]">{profile.notes || '-'}</td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          {isAdmin && (
                            <Button size="sm" variant="ghost" onClick={() => startEdit(profile)}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                          )}
                          {hasHistory(profile.atm_id) && (
                            <Button size="sm" variant="ghost" onClick={() => showHistory(profile.atm_id)}>
                              <History className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  };

  const latestProfiles = getLatestProfiles();
  const activeDenet = latestProfiles.filter(p => p.status === 'Active' && p.platform === 'denet');
  const activeBitstop = latestProfiles.filter(p => p.status === 'Active' && p.platform === 'bitstop');
  const pendingDenet = latestProfiles.filter(p => p.status === 'Pending' && p.platform === 'denet');
  const pendingBitstop = latestProfiles.filter(p => p.status === 'Pending' && p.platform === 'bitstop');
  const inactiveDenet = latestProfiles.filter(p => p.status === 'Inactive' && p.platform === 'denet');
  const inactiveBitstop = latestProfiles.filter(p => p.status === 'Inactive' && p.platform === 'bitstop');

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
        {renderTable(inactive, 'Inactive', true)}

        <Dialog open={historyModal.open} onOpenChange={(open) => setHistoryModal({ ...historyModal, open })}>
          <DialogContent className="max-w-4xl bg-[#1a1f2e] text-[#F5F1E8]">
            <DialogHeader>
              <DialogTitle>Location History - {historyModal.atmId}</DialogTitle>
            </DialogHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#2a3142]">
                    <th className="text-left p-2 font-mono">Location</th>
                    <th className="text-left p-2 font-mono">Platform</th>
                    <th className="text-left p-2 font-mono">Installed</th>
                    <th className="text-left p-2 font-mono">Removed</th>
                    <th className="text-left p-2 font-mono">City</th>
                    <th className="text-left p-2 font-mono">State</th>
                  </tr>
                </thead>
                <tbody>
                  {historyData.map((item, idx) => (
                    <tr key={idx} className="border-b border-[#2a3142]">
                      <td className="p-2">{item.location_name}</td>
                      <td className="p-2">{item.platform}</td>
                      <td className="p-2 font-mono">{item.installed_date || '-'}</td>
                      <td className="p-2 font-mono">{item.removed_date || '-'}</td>
                      <td className="p-2">{item.city || '-'}</td>
                      <td className="p-2">{item.state || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
