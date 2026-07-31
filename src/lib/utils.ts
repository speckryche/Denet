import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers — TIMEZONE-SAFE BY CONSTRUCTION.
//
// transactions.date is `timestamp without time zone`; PostgREST returns it as
// "2026-06-17T18:07:24" with no offset — the machine's local wall clock. The
// rule everywhere below: slice the YYYY-MM-DD prefix as TEXT and never let a
// Date object interpret the value. `new Date("2026-06-17")` parses as UTC
// midnight and renders as the 16th in Pacific; textual math cannot drift.
// ─────────────────────────────────────────────────────────────────────────────

// "Today" in the operating timezone (all machines are US/Pacific). 'en-CA'
// formats as YYYY-MM-DD, so this is directly comparable to a date prefix.
export const getPacificDateString = (): string =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

// The YYYY-MM-DD prefix of a timestamp string, or null if unparseable.
export const toDateOnly = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const prefix = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(prefix) ? prefix : null;
};

// Whole days between two YYYY-MM-DD strings. Both sides are anchored to UTC
// midnight, so the subtraction is an exact multiple of 86.4e6 ms — no DST
// hour to round away, no local-timezone offset in play.
export const daysBetween = (fromDate: string, toDate: string): number =>
  Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000,
  );

// Age in whole days from a transaction timestamp to today (Pacific). Returns
// null when the timestamp is missing or malformed, so callers render '—'
// rather than a nonsense age.
export const ageInDays = (value: string | null | undefined): number | null => {
  const day = toDateOnly(value);
  return day === null ? null : daysBetween(day, getPacificDateString());
};

// MM/DD/YYYY for display, from the text prefix — never via Date.
export const formatDateOnly = (value: string | null | undefined): string => {
  const day = toDateOnly(value);
  if (!day) return '—';
  const [y, m, d] = day.split('-');
  return `${m}/${d}/${y}`;
};
