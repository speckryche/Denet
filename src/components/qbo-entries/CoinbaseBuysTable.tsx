// The month's USD-side buy rows, with a per-buy inventory/investment toggle.
// The toggle writes to coinbase_buy_treatment immediately; clearing it back to
// the asset default is done by picking the default value again.
//
// Treatment is the one field here a person actually decides, and getting it
// wrong sends a purchase to the wrong balance-sheet account — so the two
// options are made distinguishable without reading: inventory is neutral,
// investment is amber and tints its whole row. The account-number hint beside
// the dropdown shows where the money is actually going, so the consequence of
// the choice is visible in the row rather than only in the JE below.

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
import { Package, TrendingUp } from 'lucide-react';
import { fmtAmount, fmtQuantity } from '@/lib/qbo/money';
import type { CoinbaseBuy, CryptoAsset, Treatment } from '@/lib/qbo/types';

// Account names are stored with the number leading, e.g.
// "1100 Bitcoin S/T Holdings" or "1605 Long-term Investments:Bitcoin (BTC)".
// Not every account is numbered though — Solana's inventory account is plain
// "Inventory - Solana" — so this returns null rather than guessing, and the
// hint is simply omitted for those.
const accountNumber = (accountName: string | undefined): string | null => {
  if (!accountName) return null;
  const m = accountName.trim().match(/^(\d[\d.\-]*)\b/);
  return m ? m[1] : null;
};

// THEMING NOTE. `dark:` variants do nothing in this app: tailwind.config sets
// darkMode:["class"], but nothing ever puts `dark` on <html>, and index.css
// paints the dark ground directly — :root still holds the LIGHT token values
// (--background: 0 0% 100%) while the body renders rgb(15,20,25). So a
// `text-slate-700 dark:text-slate-300` pair silently resolves to slate-700, a
// dark grey on near-black, which is how the first cut of this came out washed
// out and unreadable.
//
// Two consequences, both applied below:
//   * inventory uses `text-foreground`, a semantic token that tracks whatever
//     palette is active, so it stays correct if the theme is ever wired up;
//   * investment uses amber-400, matching the amber the rest of this page
//     already uses (STATUS_STYLES, DriftBanner) rather than inventing a shade.
// The alpha fills and borders read correctly on either ground regardless.
const TREATMENT_STYLES: Record<Treatment, string> = {
  inventory: 'border-slate-400/30 bg-slate-500/15 text-foreground',
  investment: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
};

export function CoinbaseBuysTable({
  buys,
  assets,
  readOnly,
  onChangeTreatment,
}: {
  buys: CoinbaseBuy[];
  assets: CryptoAsset[];
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

  const assetBySymbol = new Map(assets.map((a) => [a.symbol.toUpperCase(), a]));

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
            <TableHead className="font-bold text-foreground w-[230px]">Treatment</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {buys.map((buy) => {
            const key = `${buy.activityId}|${buy.coin}`;
            const isInvestment = buy.treatment === 'investment';
            const asset = assetBySymbol.get(buy.coin);
            const destination = accountNumber(
              isInvestment ? asset?.investment_account_name : asset?.inventory_account_name,
            );
            return (
              <TableRow
                key={key}
                // Tinting the whole row makes investment buys countable at a
                // glance in a month that is mostly inventory.
                className={`border-white/5 ${isInvestment ? 'bg-amber-500/[0.07]' : ''}`}
              >
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
                  <div className="flex items-center gap-2">
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
                      {/* No icon here: SelectValue renders the selected
                          SelectItem's children, which already carry one.
                          Adding another produced "[icon][icon] Inventory". */}
                      <SelectTrigger className={`h-8 w-[150px] ${TREATMENT_STYLES[buy.treatment]}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inventory">
                          <span className="flex items-center gap-1.5">
                            <Package className="w-3.5 h-3.5 shrink-0" />
                            Inventory
                          </span>
                        </SelectItem>
                        <SelectItem value="investment">
                          <span className="flex items-center gap-1.5 text-amber-400">
                            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                            Investment
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {destination && (
                      <span
                        className="text-xs text-muted-foreground font-mono whitespace-nowrap"
                        title={
                          isInvestment
                            ? asset?.investment_account_name
                            : asset?.inventory_account_name
                        }
                      >
                        → {destination}
                      </span>
                    )}
                  </div>
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
