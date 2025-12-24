import React from 'react';
import { Calendar } from 'lucide-react';

interface LastUploadDatesProps {
  denetFirstDate: string | null;
  denetLastDate: string | null;
  bitstopFirstDate: string | null;
  bitstopLastDate: string | null;
}

export function LastUploadDates({
  denetFirstDate,
  denetLastDate,
  bitstopFirstDate,
  bitstopLastDate
}: LastUploadDatesProps) {
  return (
    <div className="rounded-lg border border-white/10 bg-card/30 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Transaction Date Range</h3>
      </div>
      <div className="space-y-3">
        <div>
          <div className="text-xs font-semibold text-foreground mb-1.5">Denet</div>
          <div className="flex items-center justify-between pl-2">
            <span className="text-xs text-muted-foreground">First:</span>
            <span className="text-xs font-mono font-semibold text-foreground">
              {denetFirstDate || 'No data'}
            </span>
          </div>
          <div className="flex items-center justify-between pl-2">
            <span className="text-xs text-muted-foreground">Last:</span>
            <span className="text-xs font-mono font-semibold text-foreground">
              {denetLastDate || 'No data'}
            </span>
          </div>
        </div>
        <div className="border-t border-white/10 pt-2">
          <div className="text-xs font-semibold text-foreground mb-1.5">Bitstop</div>
          <div className="flex items-center justify-between pl-2">
            <span className="text-xs text-muted-foreground">First:</span>
            <span className="text-xs font-mono font-semibold text-foreground">
              {bitstopFirstDate || 'No data'}
            </span>
          </div>
          <div className="flex items-center justify-between pl-2">
            <span className="text-xs text-muted-foreground">Last:</span>
            <span className="text-xs font-mono font-semibold text-foreground">
              {bitstopLastDate || 'No data'}
            </span>
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-white/10">
        Upload CSVs starting from the day after the last dates
      </p>
    </div>
  );
}
