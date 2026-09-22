// Read one JournalEntry back from QuickBooks by DocNumber. Admin only.
//
// READ-ONLY. Exists so a posted entry can be verified against what the app
// computed — comparing our own snapshot to itself proves nothing about what
// actually landed in QuickBooks. Also backs the "view in QBO" affordance and
// the manual re-check on an 'unknown' post.

import { corsHeaders } from '../_shared/utils.ts';
import { AuthError, NotConnectedError, json, qboFetch, requireAdmin, serviceClient } from '../_shared/qbo.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    await requireAdmin(req, supabase);
    const { docNumber, txnId } = (await req.json()) as { docNumber?: string; txnId?: string };
    if (!docNumber && !txnId) return json({ error: 'docNumber or txnId is required.' }, 400);

    if (txnId) {
      const res = (await qboFetch(supabase, `/journalentry/${encodeURIComponent(txnId)}`)) as { JournalEntry?: unknown };
      return json({ entry: res?.JournalEntry ?? null });
    }

    const res = (await qboFetch(supabase, '/query', {
      searchParams: {
        query: `SELECT * FROM JournalEntry WHERE DocNumber = '${String(docNumber).replace(/'/g, "''")}'`,
      },
    })) as { QueryResponse?: { JournalEntry?: unknown[] } };
    const entries = res?.QueryResponse?.JournalEntry ?? [];
    // More than one means QuickBooks holds duplicates under the same DocNumber
    // — which it permits. Surfaced rather than silently taking the first.
    return json({ entry: entries[0] ?? null, count: entries.length, entries });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof NotConnectedError) return json({ error: e.message, code: e.code }, 409);
    console.error('qbo-get-je failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
