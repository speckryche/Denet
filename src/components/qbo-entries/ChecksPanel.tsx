// Check list for one month. BLOCK entries gate "Mark as entered in QBO";
// WARN and INFO are advisory.

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { Check } from '@/lib/qbo/types';

const STYLES = {
  BLOCK: {
    icon: XCircle,
    row: 'border-red-500/30 bg-red-500/10',
    text: 'text-red-400',
    label: 'BLOCK',
  },
  WARN: {
    icon: AlertTriangle,
    row: 'border-amber-500/30 bg-amber-500/10',
    text: 'text-amber-400',
    label: 'WARN',
  },
  INFO: {
    icon: Info,
    row: 'border-blue-500/30 bg-blue-500/10',
    text: 'text-blue-300',
    label: 'INFO',
  },
} as const;

export function ChecksPanel({ checks }: { checks: Check[] }) {
  if (checks.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-green-400">
        <CheckCircle2 className="w-4 h-4" />
        <span className="text-sm font-medium">All checks passed.</span>
      </div>
    );
  }

  // Most severe first, so a blocker is never buried under INFO rows.
  const order = { BLOCK: 0, WARN: 1, INFO: 2 } as const;
  const sorted = [...checks].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <div className="space-y-2">
      {sorted.map((check) => {
        const style = STYLES[check.severity];
        const Icon = style.icon;
        return (
          <div key={check.id} className={`rounded-md border px-3 py-2 ${style.row}`}>
            <div className={`flex items-start gap-2 ${style.text}`}>
              <Icon className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  <span className="font-mono text-xs mr-2 opacity-70">{style.label}</span>
                  {check.message}
                </div>
                {check.detail && (
                  <div className="text-xs mt-0.5 opacity-80 break-words">{check.detail}</div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
