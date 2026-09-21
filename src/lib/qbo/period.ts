// Month/period helpers for the QBO module.
//
// A "month" is always a 'YYYY-MM' string, matching the convention used by the
// P&L reports (src/lib/pnl.ts monthRange) and bitstop_fee_overrides.year_month.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const isValidMonth = (ym: string): boolean => /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);

// 'YYYY-MM' -> "August 2026" (the JE description month text).
export const monthText = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
};

// Last calendar day of the month -> 'YYYY-MM-DD'. Both JEs are dated here.
export const monthEndDate = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(day).padStart(2, '0')}`;
};

export const monthStartDate = (ym: string): string => `${ym}-01`;

// Inclusive list of months from `from` to `to`, oldest first.
export const monthsBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
};

export const currentMonth = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// Month of a `transactions.date` value, by the date as recorded (local time in
// the source CSV — the column is `timestamp without time zone`, so no shifting).
export const monthOfTxDate = (date: string | null): string | null => {
  if (!date) return null;
  const ym = date.slice(0, 7);
  return isValidMonth(ym) ? ym : null;
};

// Month of a Coinbase row, by UTC date. Coinbase reports every timestamp in UTC
// and the statement window in the filename is UTC, so bucketing by UTC is what
// keeps the JE consistent with the asset_balances tie-out.
export const monthOfUtcIso = (iso: string): string => iso.slice(0, 7);

export const dateOfUtcIso = (iso: string): string => iso.slice(0, 10);
