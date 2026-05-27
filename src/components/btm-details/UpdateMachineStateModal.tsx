import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import {
  MapPin,
  RefreshCw,
  Combine,
  Archive,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Mode = 'relocate' | 'convert' | 'both' | 'retire';

interface ActiveProfile {
  id: string;
  atm_id: string | null;
  location_name: string;
  platform: 'denet' | 'bitstop';
  monthly_rent: number;
  cash_management_rps: number;
  cash_management_rep: number;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  installed_date: string | null;
}

interface Props {
  profile: ActiveProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const todayLocalISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDate = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

const addDays = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const MODE_OPTIONS: Array<{
  mode: Mode;
  label: string;
  icon: typeof MapPin;
  blurb: string;
}> = [
  { mode: 'relocate', label: 'Relocating', icon: MapPin, blurb: 'Same platform, new address.' },
  { mode: 'convert', label: 'Converting platform', icon: RefreshCw, blurb: 'Same location, different platform.' },
  { mode: 'both', label: 'Both', icon: Combine, blurb: 'New location AND new platform.' },
  { mode: 'retire', label: 'Retiring', icon: Archive, blurb: 'Machine taken out of service.' },
];

export default function UpdateMachineStateModal({
  profile,
  open,
  onOpenChange,
  onSuccess,
}: Props) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('relocate');
  const [effectiveDate, setEffectiveDate] = useState<string>(todayLocalISO());

  // Relocate / both fields
  const [locationName, setLocationName] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateField, setStateField] = useState('');
  const [zipCode, setZipCode] = useState('');

  // Convert / both fields
  const [newPlatform, setNewPlatform] = useState<'denet' | 'bitstop'>('bitstop');

  // Cost fields (shared by relocate / convert / both)
  const [monthlyRent, setMonthlyRent] = useState('');
  const [mgmtRps, setMgmtRps] = useState('');
  const [mgmtRep, setMgmtRep] = useState('');

  // Retire fields
  const [retireNotes, setRetireNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Reset form whenever the dialog opens for a (possibly different) profile.
  useEffect(() => {
    if (!open || !profile) return;
    setMode('relocate');
    setEffectiveDate(todayLocalISO());
    setLocationName(profile.location_name || '');
    setStreetAddress(profile.street_address || '');
    setCity(profile.city || '');
    setStateField(profile.state || '');
    setZipCode(profile.zip_code || '');
    setNewPlatform(profile.platform === 'denet' ? 'bitstop' : 'denet');
    setMonthlyRent(String(profile.monthly_rent ?? 0));
    setMgmtRps(String(profile.cash_management_rps ?? 0));
    setMgmtRep(String(profile.cash_management_rep ?? 0));
    setRetireNotes('');
    setErrorMsg(null);
  }, [open, profile]);

  const showRelocateFields = mode === 'relocate' || mode === 'both';
  const showConvertFields = mode === 'convert' || mode === 'both';
  const showCostFields = mode !== 'retire';
  const showRetireFields = mode === 'retire';

  const whatThisDoesCopy = useMemo(() => {
    if (!profile) return '';
    const currentPlatform = capitalize(profile.platform);
    const currentLocation = profile.location_name || profile.atm_id || 'this machine';
    const eff = effectiveDate ? formatDate(effectiveDate) : '<date>';
    const dayBefore = effectiveDate ? formatDate(addDays(effectiveDate, -1)) : '<date>';
    const targetPlatform = showConvertFields
      ? capitalize(newPlatform)
      : currentPlatform;
    const targetLocation = showRelocateFields
      ? (locationName.trim() || '<new location>')
      : currentLocation;

    if (mode === 'retire') {
      return `Closes the current ${currentPlatform} profile at ${currentLocation} on ${eff}. No new profile is created. The machine will appear as retired.`;
    }
    return [
      `Closes the current ${currentPlatform} profile at ${currentLocation} on ${dayBefore}.`,
      `Creates a new ${targetPlatform} profile at ${targetLocation} starting ${eff}.`,
      `Historical transactions remain attached to the original profile.`,
    ].join(' ');
  }, [profile, effectiveDate, mode, newPlatform, locationName, showConvertFields, showRelocateFields]);

  const validate = (): string | null => {
    if (!profile || !profile.atm_id) return 'No active machine selected.';
    if (!effectiveDate) return 'Effective date is required.';
    if (profile.installed_date && effectiveDate <= profile.installed_date) {
      return `Effective date must be after the current profile's install date (${formatDate(profile.installed_date)}).`;
    }
    if (showRelocateFields && !locationName.trim()) {
      return 'Location name is required when relocating.';
    }
    if (showConvertFields && newPlatform === profile.platform) {
      return 'New platform must differ from the current platform.';
    }
    return null;
  };

  const handleSubmit = async () => {
    if (!profile || !profile.atm_id) return;
    const v = validate();
    if (v) {
      setErrorMsg(v);
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);

    const parseNum = (s: string): number | null => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };

    const payload: Record<string, unknown> = {
      p_atm_id: profile.atm_id,
      p_effective_date: effectiveDate,
      p_action: mode,
    };

    if (showRelocateFields) {
      payload.p_location_name = locationName.trim();
      payload.p_street_address = streetAddress.trim() || null;
      payload.p_city = city.trim() || null;
      payload.p_state = stateField.trim() || null;
      payload.p_zip_code = zipCode.trim() || null;
    }
    if (showConvertFields) {
      payload.p_platform = newPlatform;
    }
    if (showCostFields) {
      payload.p_monthly_rent = parseNum(monthlyRent);
      payload.p_cash_management_rps = parseNum(mgmtRps);
      payload.p_cash_management_rep = parseNum(mgmtRep);
    }
    if (showRetireFields && retireNotes.trim()) {
      payload.p_notes = retireNotes.trim();
    }

    const { error } = await supabase.rpc('update_atm_state', payload as any);

    if (error) {
      setErrorMsg(error.message);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    onOpenChange(false);
    toast({
      title: 'Machine state updated',
      description: `ATM ${profile.atm_id} — ${capitalize(mode)} effective ${formatDate(effectiveDate)}.`,
    });
    onSuccess();
  };

  if (!profile) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Update Machine State</DialogTitle>
          <DialogDescription>
            ATM <span className="font-mono">{profile.atm_id}</span> · currently{' '}
            <span className="font-medium text-foreground">{capitalize(profile.platform)}</span> at{' '}
            <span className="font-medium text-foreground">{profile.location_name || '—'}</span>
          </DialogDescription>
        </DialogHeader>

        {errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded border border-red-400/30 bg-red-500/10 text-sm text-red-300">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="break-words">{errorMsg}</span>
          </div>
        )}

        {/* Mode selector */}
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">What's changing?</Label>
          <div className="grid grid-cols-2 gap-2">
            {MODE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const selected = mode === opt.mode;
              return (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setMode(opt.mode)}
                  className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary/10'
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]',
                  )}
                >
                  <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
                  <div>
                    <div className={cn('text-sm font-medium', selected ? 'text-foreground' : 'text-foreground/80')}>
                      {opt.label}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{opt.blurb}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Effective date */}
        <div className="space-y-2">
          <Label htmlFor="effective-date">Effective date</Label>
          <Input
            id="effective-date"
            type="date"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            className="w-[200px]"
          />
          <p className="text-xs text-muted-foreground">
            Must be after the current profile's install date
            {profile.installed_date ? ` (${formatDate(profile.installed_date)})` : ''}.
          </p>
        </div>

        {/* Convert fields */}
        {showConvertFields && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">New platform</Label>
            <div className="flex gap-2">
              {(['denet', 'bitstop'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setNewPlatform(p)}
                  disabled={p === profile.platform}
                  className={cn(
                    'flex-1 px-3 py-2 rounded border text-sm transition-colors',
                    p === profile.platform
                      ? 'border-white/10 bg-white/[0.02] text-muted-foreground/50 cursor-not-allowed'
                      : newPlatform === p
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]',
                  )}
                >
                  {capitalize(p)}
                  {p === profile.platform && (
                    <span className="ml-1 text-[10px] text-muted-foreground">(current)</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Relocate fields */}
        {showRelocateFields && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="loc-name">Location name</Label>
              <Input
                id="loc-name"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g., Mo Smoke - Chandler"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="loc-street">Street address</Label>
              <Input
                id="loc-street"
                value={streetAddress}
                onChange={(e) => setStreetAddress(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="loc-city">City</Label>
                <Input id="loc-city" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="loc-state">State</Label>
                <Input
                  id="loc-state"
                  value={stateField}
                  onChange={(e) => setStateField(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="loc-zip">Zip</Label>
                <Input id="loc-zip" value={zipCode} onChange={(e) => setZipCode(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* Cost fields */}
        {showCostFields && (
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="rent">Monthly rent</Label>
              <Input
                id="rent"
                type="number"
                step="0.01"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rps">Mgmt RPS</Label>
              <Input
                id="rps"
                type="number"
                step="0.01"
                value={mgmtRps}
                onChange={(e) => setMgmtRps(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rep">Mgmt Rep</Label>
              <Input
                id="rep"
                type="number"
                step="0.01"
                value={mgmtRep}
                onChange={(e) => setMgmtRep(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Retire fields */}
        {showRetireFields && (
          <div className="space-y-1">
            <Label htmlFor="retire-notes">Notes (optional)</Label>
            <Textarea
              id="retire-notes"
              value={retireNotes}
              onChange={(e) => setRetireNotes(e.target.value)}
              placeholder="Reason for retirement, future plans, etc."
              rows={3}
            />
          </div>
        )}

        {/* What this does */}
        <div className="border-l-2 border-primary bg-white/[0.03] px-3 py-2.5 text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            What this does
          </div>
          <div className="text-foreground/90">{whatThisDoesCopy}</div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirm Change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
