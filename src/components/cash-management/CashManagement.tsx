import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DollarSign } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { CashPickups } from './CashPickups';
import { Deposits } from './Deposits';

interface CashInTransit {
  person_id: string;
  person_name: string;
  amount: number;
}

export default function CashManagement() {
  const [cashInTransit, setCashInTransit] = useState<CashInTransit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetchCashInTransit();
  }, [refreshKey]);

  const fetchCashInTransit = async () => {
    try {
      // Get all people
      const { data: people, error: peopleError } = await supabase
        .from('people')
        .select('*')
        .eq('active', true)
        .order('name');

      if (peopleError) throw peopleError;

      // Get all undeposited pickups grouped by person
      const { data: pickups, error: pickupsError } = await supabase
        .from('cash_pickups')
        .select('person_id, amount')
        .eq('deposited', false);

      if (pickupsError) throw pickupsError;

      // Calculate totals per person
      const transitMap = new Map<string, number>();
      pickups?.forEach(pickup => {
        const current = transitMap.get(pickup.person_id) || 0;
        transitMap.set(pickup.person_id, current + parseFloat(pickup.amount.toString()));
      });

      // Build result array
      const result: CashInTransit[] = people?.map(person => ({
        person_id: person.id,
        person_name: person.name,
        amount: transitMap.get(person.id) || 0
      })) || [];

      setCashInTransit(result);
    } catch (error) {
      console.error('Error fetching cash in transit:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const totalInTransit = cashInTransit.reduce((sum, person) => sum + person.amount, 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PageHeader title="Cash Management" />

      <div className="max-w-[95%] mx-auto px-6 py-8 space-y-6">

        {/* Cash in Transit Dashboard */}
        <Card className="bg-card/30 border-white/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              Running Balance of Cash in Transit
            </CardTitle>
            <CardDescription>Current cash held by each person</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
              {cashInTransit.map(person => (
                <div key={person.person_id} className="text-center p-4 rounded-lg bg-slate-700/30 border border-slate-600/20">
                  <div className="text-sm font-semibold text-muted-foreground mb-1">
                    {person.person_name}
                  </div>
                  <div className={`text-2xl font-bold ${person.amount > 0 ? 'text-green-500' : 'text-foreground'}`}>
                    ${person.amount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                </div>
              ))}
              <div className="text-center p-4 rounded-lg bg-slate-600/30 border border-slate-500/30">
                <div className="text-sm font-semibold text-muted-foreground mb-1">
                  Total
                </div>
                <div className={`text-2xl font-bold ${totalInTransit > 0 ? 'text-green-500' : 'text-foreground'}`}>
                  ${totalInTransit.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs for Pickups and Deposits */}
        <Tabs defaultValue="pickups" className="space-y-4">
          <TabsList>
            <TabsTrigger value="pickups">Cash Pickups</TabsTrigger>
            <TabsTrigger value="deposits">Deposits</TabsTrigger>
          </TabsList>

          <TabsContent value="pickups" className="space-y-4">
            <CashPickups onUpdate={handleRefresh} />
          </TabsContent>

          <TabsContent value="deposits" className="space-y-4">
            <Deposits onUpdate={handleRefresh} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
