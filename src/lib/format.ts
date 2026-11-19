// Shared display formatting.
//
// Currency goes through Intl so the sign is placed before the symbol:
// "-$5,459", never "$-5,459" (which is what `$${n.toLocaleString()}` gives for
// a negative n). Use this instead of hand-building "$" + number strings.

const formatters = new Map<number, Intl.NumberFormat>();

const usd = (decimals: number): Intl.NumberFormat => {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    formatters.set(decimals, f);
  }
  return f;
};

/**
 * USD for display: formatCurrency(-5459.4) → "-$5,459"; formatCurrency(12.5, 2) → "$12.50".
 * Whole dollars by default. Values that round to zero print as "$0", not "-$0".
 */
export const formatCurrency = (value: number | null | undefined, decimals = 0): string => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return usd(decimals).format(0);
  // Round first, then normalise -0 so a small negative never shows as "-$0".
  const rounded = Number(n.toFixed(decimals));
  return usd(decimals).format(rounded === 0 ? 0 : rounded);
};
