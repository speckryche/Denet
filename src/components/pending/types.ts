// Shared row shape for the Pending Resolution tracker. Mirrors exactly the
// columns selected in PendingResolution.tsx's query — keep the two in sync.
export interface PendingRow {
  id: string;
  date: string | null;
  created_at: string | null;
  status: string;
  platform: string | null;
  atm_id: string | null;
  atm_name: string | null;
  sale: number | null;
}

// Rows at or past this age are flagged red — stale, needs chasing. One line to
// change the policy.
export const STALE_AFTER_DAYS = 30;
