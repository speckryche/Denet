import type { TxStatus } from '@/lib/transaction-status';

// The manual-resolution write, extracted from the page so it can be executed
// directly by a test harness with a recording client — the targeting behavior
// is provable, not merely reviewable.

export interface ResolveTarget {
  id: string;
  status: string;
}

export type ResolveKind = 'ok' | 'error' | 'no-match' | 'identity-mismatch';

// Deliberately a single flat shape rather than a discriminated union: the
// project compiles with "strict": false, and without strictNullChecks TS will
// not narrow `if (!result.ok)` on a literal discriminant. A flat result stays
// correct under the compiler settings this repo actually uses.
export interface ResolveResult {
  ok: boolean;
  kind: ResolveKind;
  // Operator-facing explanation; empty string when ok.
  message: string;
  // The row as the database echoed it back; null on any failure.
  applied: { id: string; status: string } | null;
}

// Minimal structural shape of the supabase client this function needs. Keeping
// it structural (rather than importing SupabaseClient) lets the harness pass a
// recording fake with no casts.
export interface ResolveClient {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          select(columns: string): Promise<{
            data: Array<{ id: string; status: string }> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
}

// Writes `target` onto exactly ONE transaction: the row identified by its
// primary key AND still carrying the status the operator was shown.
//
// Three independent guards, because this is a money-affecting write:
//  1. .eq('id', row.id)          — primary key. The row, and only the row.
//  2. .eq('status', row.status)  — optimistic concurrency. The write can only
//     land on a row still in the state displayed at click time, so a click on a
//     FROZEN row is incapable of touching an under_review row whatever id it
//     carries.
//  3. identity echo              — the DB must report back the same id we aimed
//     at, or we refuse to call it success.
// An empty result is a HARD ERROR: PostgREST returns 200 [] for both "RLS
// denied" and "no row matched", so silence must never read as success.
export async function resolveTransactionStatus(
  client: ResolveClient,
  row: ResolveTarget,
  target: TxStatus,
): Promise<ResolveResult> {
  const { data, error } = await client
    .from('transactions')
    .update({ status: target })
    .eq('id', row.id)
    .eq('status', row.status)
    .select('id, status');

  if (error) {
    return {
      ok: false,
      kind: 'error',
      message: `Could not update transaction ${row.id}: ${error.message}`,
      applied: null,
    };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      kind: 'no-match',
      message:
        `Update did not apply — no row matched id ${row.id} with status "${row.status}". ` +
        `Nothing was changed. Either the row no longer exists, its status changed since ` +
        `this page loaded (refresh and retry), or the database rejected the write.`,
      applied: null,
    };
  }

  const applied = data[0];
  if (applied.id !== row.id) {
    return {
      ok: false,
      kind: 'identity-mismatch',
      message:
        `TARGETING ERROR — intended ${row.id} but the database reports it updated ` +
        `${applied.id}. Verify both records immediately.`,
      applied: null,
    };
  }

  return { ok: true, kind: 'ok', message: '', applied };
}
