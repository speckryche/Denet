import { cn } from '@/lib/utils';
import { CheckCircle2, Archive, History as HistoryIcon } from 'lucide-react';

interface TimelineProfile {
  id: string;
  atm_id: string | null;
  location_name: string;
  platform: 'denet' | 'bitstop';
  active: boolean;
  monthly_rent: number;
  cash_management_rps: number;
  cash_management_rep: number;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  installed_date: string | null;
  removed_date: string | null;
  notes: string | null;
}

interface Props {
  profiles: TimelineProfile[];
}

const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

// Compact "Ny Nmo" duration. Uses local-date math; ignores days.
const formatDuration = (start: string | null, end: string | null): string => {
  if (!start) return '';
  const [sy, sm, sd] = start.split('-').map(Number);
  if (!sy || !sm || !sd) return '';
  const startDate = new Date(sy, sm - 1, sd);
  let endDate: Date;
  if (end) {
    const [ey, em, ed] = end.split('-').map(Number);
    if (!ey || !em || !ed) return '';
    endDate = new Date(ey, em - 1, ed);
  } else {
    endDate = new Date();
  }
  let months =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth());
  if (endDate.getDate() < startDate.getDate()) months -= 1;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years === 0 && remMonths === 0) return '< 1 mo';
  if (years === 0) return `${remMonths}mo`;
  if (remMonths === 0) return `${years}y`;
  return `${years}y ${remMonths}mo`;
};

const platformBadge = (platform: 'denet' | 'bitstop') => {
  if (platform === 'denet') {
    return (
      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border border-green-400/30 bg-green-400/10 text-green-300">
        Denet
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border border-blue-400/30 bg-blue-400/10 text-blue-300">
      Bitstop
    </span>
  );
};

const statusBadge = (profile: TimelineProfile) => {
  if (profile.active) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
        <CheckCircle2 className="w-3 h-3" />
        Current
      </span>
    );
  }
  // Retired = inactive AND no later profile (i.e., this is the last row for this atm).
  // We can't determine that from a single profile object here; defer the "Retired"
  // distinction to whoever passes the data. Keep this component simple: anything
  // with active=false is "Historical".
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border border-white/15 bg-white/[0.04] text-muted-foreground">
      <HistoryIcon className="w-3 h-3" />
      Historical
    </span>
  );
};

const formatAddress = (p: TimelineProfile): string => {
  const parts = [p.street_address, p.city, p.state, p.zip_code].filter(Boolean);
  return parts.join(', ');
};

export default function ProfileTimeline({ profiles }: Props) {
  if (!profiles || profiles.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No profile history available.
      </div>
    );
  }

  // Newest first by installed_date (then by id as a tiebreaker). The active
  // row floats to the top either way since its window extends to "now".
  const sorted = [...profiles].sort((a, b) => {
    const ai = a.installed_date || '';
    const bi = b.installed_date || '';
    if (ai !== bi) return ai < bi ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  // The last entry chronologically that's inactive AND has no successor is
  // a "Retired" terminal state. Detect by: the most recent profile is
  // inactive (no active row exists for this atm). When the active row IS
  // present, no retirement; when absent, the newest-by-installed row is the
  // retirement row.
  const hasActive = sorted.some((p) => p.active);
  const retiredId = !hasActive && sorted.length > 0 ? sorted[0].id : null;

  return (
    <div className="space-y-3">
      {sorted.map((p) => {
        const isActive = p.active;
        const isRetired = p.id === retiredId;
        const dateRange = `${formatDate(p.installed_date)} — ${
          p.removed_date ? formatDate(p.removed_date) : 'Present'
        }`;
        const duration = formatDuration(p.installed_date, p.removed_date);
        const address = formatAddress(p);

        return (
          <div
            key={p.id}
            className={cn(
              'rounded-lg border p-4 transition-colors',
              isActive
                ? 'border-primary/30 bg-primary/[0.04] shadow-sm'
                : 'border-white/10 bg-white/[0.02]',
            )}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                {isRetired ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border border-amber-400/30 bg-amber-400/10 text-amber-300">
                    <Archive className="w-3 h-3" />
                    Retired
                  </span>
                ) : (
                  statusBadge(p)
                )}
                {platformBadge(p.platform)}
              </div>
              <div className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                {dateRange}
                {duration && <span className="ml-2 text-muted-foreground/70">· {duration}</span>}
              </div>
            </div>

            <div className="text-sm font-medium">{p.location_name || '—'}</div>
            {address && (
              <div className="text-xs text-muted-foreground mt-0.5">{address}</div>
            )}

            <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
              <div>
                <span className="uppercase tracking-wider text-[10px]">Rent</span>{' '}
                <span className="font-mono text-foreground/90">{formatCurrency(p.monthly_rent || 0)}</span>
              </div>
              <div>
                <span className="uppercase tracking-wider text-[10px]">Mgmt RPS</span>{' '}
                <span className="font-mono text-foreground/90">{formatCurrency(p.cash_management_rps || 0)}</span>
              </div>
              <div>
                <span className="uppercase tracking-wider text-[10px]">Mgmt Rep</span>{' '}
                <span className="font-mono text-foreground/90">{formatCurrency(p.cash_management_rep || 0)}</span>
              </div>
            </div>

            {p.notes && (
              <div className="mt-3 text-xs italic text-muted-foreground border-l-2 border-white/10 pl-2">
                {p.notes}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
