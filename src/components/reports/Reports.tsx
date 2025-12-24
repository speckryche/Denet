import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, TrendingUp, DollarSign, BarChart3, Calendar } from 'lucide-react';
import MonthlySalesSummary from './MonthlySalesSummary';
import ATMProfitLoss from './ATMProfitLoss';
import ATMSalesSummary from './ATMSalesSummary';
import ATMMonthlySales from './ATMMonthlySales';

export default function Reports() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('monthly-sales');

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Header */}
      <header className="border-b border-white/10 bg-background/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[95%] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="font-display font-bold text-xl tracking-tight">
              Reports & Analytics
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-[95%] mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:w-[800px]">
            <TabsTrigger value="monthly-sales" className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              <span className="hidden sm:inline">Sales - Totals</span>
              <span className="sm:hidden">Totals</span>
            </TabsTrigger>
            <TabsTrigger value="atm-monthly" className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Sales - by ATM</span>
              <span className="sm:hidden">ATM</span>
            </TabsTrigger>
            <TabsTrigger value="atm-pl" className="flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              <span className="hidden sm:inline">ATM P&L</span>
              <span className="sm:hidden">P&L</span>
            </TabsTrigger>
            <TabsTrigger value="atm-summary" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              <span className="hidden sm:inline">ATM Summary</span>
              <span className="sm:hidden">Summary</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="monthly-sales" className="space-y-4">
            <MonthlySalesSummary />
          </TabsContent>

          <TabsContent value="atm-monthly" className="space-y-4">
            <ATMMonthlySales />
          </TabsContent>

          <TabsContent value="atm-pl" className="space-y-4">
            <ATMProfitLoss />
          </TabsContent>

          <TabsContent value="atm-summary" className="space-y-4">
            <ATMSalesSummary />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
