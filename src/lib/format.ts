// Shared display formatting.
//
// Currency goes through Intl so the sign is placed before the symbol:
// "-$5,459", never "$-5,459" (which is what `$${n.toLocaleString()}` gives for
// a negative n). Use this instead of hand-building "$" + number strings.
//
// Rounding deliberately matches the hand-rolled code this replaced, so swapping
// a call site changes nothing but the sign position:
//   * whole dollars: Math.round first (as `Math.round(v).toLocaleString()` did);
//   * cents: Intl rounds (as `v.toLocaleString({ maximumFractionDigits: 2 })` did).
// A value that rounds to zero never carries a sign: -0.4 shows "$0", not "-$0".

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

export interface FormatCurrencyOptions {
  /**
   * Whole dollars only. Round half away from zero (Intl's rule: -1234.5 → "-$1,235")
   * instead of Math.round (-1234.5 → "-$1,234"). Set by the call sites that used to
   * call Intl.NumberFormat directly, so their output is unchanged.
   */
  halfAwayFromZero?: boolean;
}

/**
 * USD for display: formatCurrency(-5459.4) → "-$5,459"; formatCurrency(12.5, 2) → "$12.50".
 * Whole dollars by default. null / undefined / NaN print as zero.
 */
export const formatCurrency = (
  value: number | null | undefined,
  decimals = 0,
  opts: FormatCurrencyOptions = {},
): string => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return usd(decimals).format(0);
  const x = decimals === 0 && !opts.halfAwayFromZero ? Math.round(n) : n;
  const s = usd(decimals).format(x);
  // "-$0" / "-$0.00": a negative that rounded to zero. Drop the sign.
  return /^-\$0(\.0+)?$/.test(s) ? s.slice(1) : s;
};

/**
 * Display-only calendar date as MM/DD/YYYY.
 * YYYY-MM-DD (optionally followed by a time) is parsed as a calendar date,
 * not a UTC instant, so the day does not shift in US time zones.
 */
export const formatDisplayDate = (value: string | null | undefined): string => {
  if (value == null || String(value).trim() === '') return '—';
  const raw = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${month}/${day}/${d.getFullYear()}`;
};
