// The month's USD-side buy rows, with a per-buy inventory/investment toggle.
// The toggle writes to coinbase_buy_treatment immediately; clearing it back to
// the asset default is done by picking the default value again.

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { fmtAmount, fmtQuantity } from '@/lib/qbo/money';
import type { CoinbaseBuy, Treatment } from '@/lib/qbo/types';

export function CoinbaseBuysTable({
  buys,
  readOnly,
  onChangeTreatment,
}: {
  buys: CoinbaseBuy[];
  readOnly: boolean;
  onChangeTreatment: (buy: CoinbaseBuy, treatment: Treatment) => Promise<void>;
}) {
  const [savingKey, setSavingKey] = useState<string | null>(null);

  if (buys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No Coinbase buys in this month's statement.
      </p>
    );
  }

  const totalAmount = buys.reduce((s, b) => s + b.amount, 0);
  const totalFee = buys.reduce((s, b) => s + b.fee, 0);

  // Quantity totals are per coin: adding BTC to SOL would be a meaningless
  // number, so the footer shows "0.76 BTC · 12.5 SOL" rather than one sum.
  const qtyByCoin = new Map<string, number>();
  for (const b of buys) {
    if (b.quantity == null) continue;
    qtyByCoin.set(b.coin, (qtyByCoin.get(b.coin) ?? 0) + b.quantity);
  }
  const quantityTotals = [...qtyByCoin.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([coin, qty]) => `${fmtQuantity(qty)} ${coin}`)
    .join(' · ');

  return (
    <div className="rounded-md border border-white/10 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-white/10 hover:bg-transparent">
            <TableHead className="font-bold text-foreground w-[120px]">Date</TableHead>
            <TableHead className="font-bold text-foreground w-[80px]">Coin</TableHead>
            <TableHead className="font-bold text-foreground text-right w-[140px]">Quantity</TableHead>
            <TableHead className="font-bold text-foreground text-right w-[140px]">USD amount</TableHead>
            <TableHead className="font-bold text-foreground text-right w-[110px]">Fee</TableHead>
            <TableHead className="font-bold text-foreground w-[90px]">Status</TableHead>
            <TableHead className="font-bold text-foreground w-[180px]">Treatment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {buys.map((buy) => {
            const key = `${buy.activityId}|${buy.coin}`;
            return (
              <TableRow key={key} className="border-white/5">
                <TableCell className="font-mono text-sm">{buy.dateCompleted.slice(0, 10)}</TableCell>
                <TableCell className="font-semibold">{buy.coin}</TableCell>
                <TableCell className="text-right font-mono">{fmtQuantity(buy.quantity)}</TableCell>
                <TableCell className="text-right font-mono">{fmtAmount(buy.amount)}</TableCell>
                <TableCell className="text-right font-mono">{fmtAmount(buy.fee)}</TableCell>
                <TableCell>
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      buy.status.toUpperCase() === 'FILLED'
                        ? 'bg-green-500/20 text-green-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {buy.status || '—'}
                  </span>
                </TableCell>
                <TableCell>
                  <Select
                    value={buy.treatment}
                    disabled={readOnly || savingKey === key}
                    onValueChange={async (v) => {
                      setSavingKey(key);
                      try {
                        await onChangeTreatment(buy, v as Treatment);
                      } finally {
                        setSavingKey(null);
                      }
                    }}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inventory">Inventory</SelectItem>
                      <SelectItem value="investment">Investment</SelectItem>
                    </SelectContent>
                  </Select>
                  {buy.treatmentIsOverride && (
                    <span className="text-[10px] text-muted-foreground">overridden</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="border-t-2 border-white/20 font-bold hover:bg-transparent">
            <TableCell colSpan={2}>{buys.length} buys</TableCell>
            <TableCell className="text-right font-mono text-xs whitespace-nowrap">
              {quantityTotals || '—'}
            </TableCell>
            <TableCell className="text-right font-mono">{fmtAmount(totalAmount)}</TableCell>
            <TableCell className="text-right font-mono">{fmtAmount(totalFee)}</TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
