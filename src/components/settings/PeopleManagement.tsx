import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Edit, Trash2, UserCheck, UserX } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';

interface Person {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export function PeopleManagement() {
  const [people, setPeople] = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    active: true,
  });

  useEffect(() => {
    fetchPeople();
  }, []);

  const fetchPeople = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('people')
        .select('*')
        .order('name');

      if (error) throw error;
      setPeople(data || []);
    } catch (error) {
      console.error('Error fetching people:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Submitting person:', formData);

    try {
      const payload = {
        name: formData.name.trim(),
        active: formData.active,
      };

      if (editingId) {
        console.log('Updating person:', editingId);
        const { error } = await supabase
          .from('people')
          .update(payload)
          .eq('id', editingId);

        if (error) throw error;
        console.log('Person updated successfully');
      } else {
        console.log('Inserting new person:', payload);
        const { error } = await supabase
          .from('people')
          .insert([payload]);

        if (error) throw error;
        console.log('Person inserted successfully');
      }

      setIsDialogOpen(false);
      resetForm();
      await fetchPeople();
    } catch (error: any) {
      console.error('Error saving person:', error);
      if (error.code === '23505') {
        alert('A person with this name already exists.');
      } else {
        alert(`Error: ${error.message || 'Failed to save person'}`);
      }
    }
  };

  const handleEdit = (person: Person) => {
    setEditingId(person.id);
    setFormData({
      name: person.name,
      active: person.active,
    });
    setIsDialogOpen(true);
  };

  const handleToggleActive = async (person: Person) => {
    try {
      const { error } = await supabase
        .from('people')
        .update({ active: !person.active })
        .eq('id', person.id);

      if (error) throw error;
      fetchPeople();
    } catch (error) {
      console.error('Error toggling person status:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this person? This will fail if they have any cash pickups or deposits.')) return;

    try {
      const { error } = await supabase
        .from('people')
        .delete()
        .eq('id', id);

      if (error) {
        if (error.code === '23503') {
          alert('Cannot delete this person because they have associated cash pickups or deposits. Deactivate them instead.');
        } else {
          throw error;
        }
      } else {
        fetchPeople();
      }
    } catch (error) {
      console.error('Error deleting person:', error);
    }
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      name: '',
      active: true,
    });
  };

  return (
    <Card className="bg-card/30 border-white/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>People Management</CardTitle>
            <CardDescription>
              Manage employees who handle cash pickups and deposits
            </CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Person
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? 'Edit' : 'Add'} Person</DialogTitle>
                <DialogDescription>
                  Add or edit a person who handles cash
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Enter name"
                    required
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="active"
                    checked={formData.active}
                    onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                    className="rounded border-gray-300"
                  />
                  <Label htmlFor="active" className="cursor-pointer">
                    Active (can be assigned to new pickups/deposits)
                  </Label>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit">
                    {editingId ? 'Update' : 'Add'} Person
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border border-white/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : people.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No people found
                  </TableCell>
                </TableRow>
              ) : (
                people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="font-medium">{person.name}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs ${
                        person.active
                          ? 'bg-green-500/20 text-green-300'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}>
                        {person.active ? (
                          <>
                            <UserCheck className="w-3 h-3" />
                            Active
                          </>
                        ) : (
                          <>
                            <UserX className="w-3 h-3" />
                            Inactive
                          </>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{new Date(person.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(person)}
                          title={person.active ? 'Deactivate' : 'Activate'}
                        >
                          {person.active ? (
                            <UserX className="w-4 h-4" />
                          ) : (
                            <UserCheck className="w-4 h-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(person)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDelete(person.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
