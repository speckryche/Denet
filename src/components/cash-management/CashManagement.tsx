import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { DollarSign, Scale } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { CashPickups } from './CashPickups';
import { Deposits } from './Deposits';
import { Adjustments } from './Adjustments';
import AdjustBalanceModal from './AdjustBalanceModal';

interface CashInTransit {
  person_id: string;
  person_name: string;
  amount: number;
}

export default function CashManagement() {
  const [cashInTransit, setCashInTransit] = useState<CashInTransit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustModalPerson, setAdjustModalPerson] = useState<{
    id: string;
    name: string;
    currentBalance: number;
  } | null>(null);

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

      // Get all pickups with their linked deposit amounts
      const { data: pickups, error: pickupsError } = await supabase
        .from('cash_pickups')
        .select('id, person_id, amount');

      if (pickupsError) throw pickupsError;

      // Get all deposit links to calculate deposited amounts per pickup
      const { data: links, error: linksError } = await supabase
        .from('deposit_pickup_links')
        .select('pickup_id, amount');

      if (linksError) throw linksError;

      // Get balance adjustments effective as of today. Adjustments are not
      // floored at zero — a net-negative tracked balance is a meaningful
      // signal that physical cash and records are diverging.
      const todayISO = new Date().toISOString().slice(0, 10);
      const { data: adjustments, error: adjustmentsError } = await supabase
        .from('balance_adjustments')
        .select('person_id, delta_amount')
        .lte('effective_date', todayISO);

      if (adjustmentsError) throw adjustmentsError;

      // Calculate total deposited per pickup
      const depositedByPickup = new Map<string, number>();
      links?.forEach(link => {
        const current = depositedByPickup.get(link.pickup_id) || 0;
        depositedByPickup.set(link.pickup_id, current + parseFloat(link.amount.toString()));
      });

      // Calculate remaining balance per person (pickup amount - deposited amount).
      // Per-pickup remainder is floored at 0 (an over-allocated pickup contributes
      // 0, not a negative; that's a deposit-side reconciliation problem, not cash).
      const transitMap = new Map<string, number>();
      pickups?.forEach(pickup => {
        const pickupAmount = parseFloat(pickup.amount.toString());
        const depositedAmount = depositedByPickup.get(pickup.id) || 0;
        const remainingBalance = pickupAmount - depositedAmount;

        if (remainingBalance > 0) {
          const current = transitMap.get(pickup.person_id) || 0;
          transitMap.set(pickup.person_id, current + remainingBalance);
        }
      });

      // Sum adjustments per person (signed; can be negative)
      const adjustmentsByPerson = new Map<string, number>();
      adjustments?.forEach(adj => {
        const current = adjustmentsByPerson.get(adj.person_id) || 0;
        adjustmentsByPerson.set(adj.person_id, current + Number(adj.delta_amount));
      });

      // Build result array — pickup-derived balance plus signed adjustment total
      const result: CashInTransit[] = people?.map(person => ({
        person_id: person.id,
        person_name: person.name,
        amount: (transitMap.get(person.id) || 0) + (adjustmentsByPerson.get(person.id) || 0),
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
                <div
                  key={person.person_id}
                  className="relative text-center p-4 rounded-lg bg-slate-700/30 border border-slate-600/20"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 right-1 h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setAdjustModalPerson({
                        id: person.person_id,
                        name: person.person_name,
                        currentBalance: person.amount,
                      });
                      setAdjustModalOpen(true);
                    }}
                    title="Adjust balance"
                  >
                    <Scale className="w-4 h-4" />
                  </Button>
                  <div className="text-sm font-semibold text-muted-foreground mb-1">
                    {person.person_name}
                  </div>
                  <div className={`text-2xl font-bold ${person.amount > 0 ? 'text-green-500' : person.amount < 0 ? 'text-red-500' : 'text-foreground'}`}>
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
            <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
          </TabsList>

          <TabsContent value="pickups" className="space-y-4">
            <CashPickups onUpdate={handleRefresh} />
          </TabsContent>

          <TabsContent value="deposits" className="space-y-4">
            <Deposits onUpdate={handleRefresh} />
          </TabsContent>

          <TabsContent value="adjustments" className="space-y-4">
            <Adjustments onUpdate={handleRefresh} />
          </TabsContent>
        </Tabs>
      </div>

      <AdjustBalanceModal
        open={adjustModalOpen}
        onOpenChange={setAdjustModalOpen}
        onSuccess={handleRefresh}
        person={adjustModalPerson}
      />
    </div>
  );
}
