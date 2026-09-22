// Money helpers shared by both journal entries.
//
// QBO amounts are 2-decimal. Sums are accumulated in full precision and rounded
// once, at the point a JE line is built — never per addend — so a month's lines
// always add up to the same total the tie-out checks compute.

// Tolerance for every amount comparison in this module. Matches the P&L
// reconciliation precedent (src/components/settings/PnLReconciliation.tsx).
export const TOL = 0.005;

// Round half away from zero at 2dp, avoiding the binary-float surprise where
// Math.round(1.005 * 100) lands on 100 instead of 101.
export const round2 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const scaled = value * 100;
  const rounded =
    scaled >= 0
      ? Math.round(scaled + Number.EPSILON * Math.abs(scaled))
      : -Math.round(-scaled + Number.EPSILON * Math.abs(scaled));
  // +0 rather than -0, so a zeroed line never renders as "-0.00".
  return (rounded === 0 ? 0 : rounded) / 100;
};

export const nearlyEqual = (a: number, b: number, tol: number = TOL): boolean =>
  Math.abs(a - b) <= tol;

// "1,234.56" — the copy-button value and the export format.
export const fmtAmount = (value: number): string =>
  round2(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Coinbase reports full-precision decimals as text ("69692.40456583720125") and
// notional USD with separators ("69,692.40"). Both parse through here.
export const parseDecimal = (raw: string | number | null | undefined): number => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (raw == null) return 0;
  const cleaned = String(raw).replace(/[$,\s]/g, '').trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Crypto quantity: up to 8 decimals, trailing zeros trimmed ("0.23", "12.5").
// Built from toFixed(8) rather than toString() because small amounts stringify
// in exponential notation (1e-7), which is unreadable in a table. Quantities
// are display-only, so this never feeds a JE amount.
export const fmtQuantity = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  const s = value.toFixed(8);
  if (!s.includes('.')) return s;
  const trimmed = s.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
};
