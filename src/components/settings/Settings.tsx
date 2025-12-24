import { useNavigate } from 'react-router-dom';
import { TickerMappings } from './TickerMappings';
import { ATMManagement } from './ATMManagement';
import { PeopleManagement } from './PeopleManagement';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export default function Settings() {
  const navigate = useNavigate();

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
              Settings
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-[95%] mx-auto px-6 py-8 space-y-8">
        <ATMManagement />
        <PeopleManagement />
        <TickerMappings />
      </main>
    </div>
  );
}
