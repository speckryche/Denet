import { cn } from '@/lib/utils';
import btcLogo from '@/assets/crypto/btc.svg';
import solLogo from '@/assets/crypto/sol.svg';

/** Known coins, keyed by ticker symbol. Logos are local SVG assets. */
const COINS: Record<string, { name: string; logo: string; onDark?: boolean }> = {
  BTC: { name: 'Bitcoin', logo: btcLogo },
  SOL: { name: 'Solana', logo: solLogo, onDark: true },
};

interface CoinIdentityProps {
  /** Ticker symbol (e.g. BTC, SOL). Lookups are case-insensitive. */
  symbol: string;
  className?: string;
}

/**
 * Coin logo + full name over ticker for the Holdings table.
 * Known symbols get a bundled official-style mark; anything else falls back
 * to a letter avatar so a future coin still has a consistent identity.
 */
export function CoinIdentity({ symbol, className }: CoinIdentityProps) {
  const ticker = symbol.trim().toUpperCase() || '?';
  const meta = COINS[ticker];

  return (
    <div className={cn('flex items-center gap-2.5 min-w-0', className)}>
      {meta ? (
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full',
            meta.onDark && 'bg-black p-[5px] dark:ring-1 dark:ring-white/15',
          )}
        >
          <img
            src={meta.logo}
            alt=""
            className={cn('object-contain', meta.onDark ? 'h-full w-full' : 'h-7 w-7')}
          />
        </span>
      ) : (
        <span
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
        >
          {ticker.slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13px] font-semibold tracking-tight text-foreground">
          {meta?.name ?? ticker}
        </span>
        <span className="block text-[11px] font-medium tracking-[0.04em] text-muted-foreground">
          {ticker}
        </span>
      </span>
    </div>
  );
}
