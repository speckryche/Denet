import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw, Upload } from 'lucide-react';
import { formatDateOnly, toDateOnly } from '@/lib/utils';
import type { PendingRow } from './types';

interface RecheckPanelProps {
  actionableRows: PendingRow[];
}

const PLATFORM_LABELS: Record<string, string> = {
  bitstop: 'Bitstop',
  denet: 'Denet',
};

// The AUTO path. CSV pulls are forward-only, which is the whole reason rows get
// stuck — so the fix is to pull a BACKDATED CSV that re-includes them. There is
// no new import logic here: the existing upload already upserts on the
// transaction hash and writes `status` on every row, so any transaction that
// has since resolved is corrected by a normal upload. This panel's only job is
// to tell you which date to pull from, per platform.
export function RecheckPanel({ actionableRows }: RecheckPanelProps) {
  const navigate = useNavigate();

  // Oldest pending transaction date per platform — the earliest date a re-pull
  // must reach back to in order to cover everything still outstanding.
  const oldestByPlatform = new Map<string, string>();
  actionableRows.forEach((row) => {
    const day = toDateOnly(row.date);
    if (!day) return;
    const platform = row.platform || 'unknown';
    const current = oldestByPlatform.get(platform);
    if (!current || day < current) oldestByPlatform.set(platform, day);
  });

  const platforms = Array.from(oldestByPlatform.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Card className="bg-card/30 border-white/10">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="w-4 h-4 text-primary" />
          Re-check via CSV
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {platforms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing pending — no re-check needed.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Pull a backdated CSV covering these dates and upload it normally. Any
              transaction that has since resolved is updated automatically by the
              existing upsert; anything still pending stays on this page.
            </p>

            <div className="space-y-2">
              {platforms.map(([platform, oldest]) => (
                <div
                  key={platform}
                  className="flex items-center justify-between gap-4 rounded-md border border-white/10 bg-secondary/10 px-3 py-2"
                >
                  <span className="text-sm">
                    Oldest pending{' '}
                    <span className="font-semibold">
                      {PLATFORM_LABELS[platform] || platform}
                    </span>
                    :{' '}
                    <span className="font-mono">{formatDateOnly(oldest)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    pull from at least <span className="font-mono">{oldest}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/[0.07] px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-200/90">
                A backdated CSV can trigger a spurious &ldquo;Platform conversion
                detected&rdquo; dialog for a machine that has since switched platforms.
                The importer&rsquo;s flip-flop guard suppresses most of these, but if one
                appears during a re-check upload, <strong>cancel it</strong> — the
                machine has not converted again.
              </p>
            </div>

            <Button variant="outline" size="sm" onClick={() => navigate('/csv-uploads')}>
              <Upload className="w-4 h-4 mr-2" />
              Go to CSV Uploads
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
