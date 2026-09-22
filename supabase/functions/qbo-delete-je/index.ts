// Delete a journal entry in QuickBooks. SANDBOX ONLY. Admin only.
//
// This is the only function that destroys anything in QuickBooks, and it exists
// solely so a sandbox test can be re-run from a clean state. It is fenced by
// assertSandbox(): QBO_ENV must be 'sandbox' AND the connected realm must be
// the sandbox realm. Against any other company it hard-refuses.
//
// The product NEVER calls this on its own. Nothing in the posting flow deletes
// or voids in QuickBooks — an entry posted in error is corrected by a human,
// there, deliberately.

import { corsHeaders } from '../_shared/utils.ts';
import {
  AuthError, NotConnectedError, NotSandboxError,
  assertSandbox, json, qboFetch, requireAdmin, serviceClient,
} from '../_shared/qbo.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    const admin = await requireAdmin(req, supabase);
    const { txnId, syncToken, alsoRemoveSnapshot } = (await req.json()) as {
      txnId: string; syncToken?: string; alsoRemoveSnapshot?: { month: string; jeType: string };
    };
    if (!txnId) return json({ error: 'txnId is required.' }, 400);

    const { data: connData, error: connError } = await supabase.rpc('qbo_get_connection');
    if (connError) throw connError;
    const conn = Array.isArray(connData) ? connData[0] : connData;
    if (!conn) return json({ error: 'QuickBooks is not connected.', code: 'not_connected' }, 409);

    assertSandbox(conn.realm_id, conn.company_name);

    // SyncToken is required by QBO for a delete; fetch the current one if the
    // caller did not supply it, so a stale token cannot cause a silent no-op.
    let token = syncToken;
    if (!token) {
      const cur = (await qboFetch(supabase, `/journalentry/${encodeURIComponent(txnId)}`)) as { JournalEntry?: { SyncToken?: string } };
      token = cur?.JournalEntry?.SyncToken;
      if (!token) return json({ error: `No journal entry ${txnId} found in QuickBooks.`, code: 'not_found' }, 404);
    }

    const res = (await qboFetch(supabase, '/journalentry', {
      method: 'POST',
      searchParams: { operation: 'delete' },
      body: JSON.stringify({ Id: txnId, SyncToken: token }),
    })) as { JournalEntry?: { Id?: string; status?: string } };

    let snapshotRemoved = false;
    if (alsoRemoveSnapshot) {
      // Deleted straight rather than through qbo_unmark_snapshot, which refuses
      // on a posted row by design — that guard protects production, and this is
      // the sandbox reset path that has just removed the entry it pointed at.
      const { error: delError } = await supabase
        .from('qbo_je_snapshots')
        .delete()
        .eq('month', alsoRemoveSnapshot.month)
        .eq('je_type', alsoRemoveSnapshot.jeType)
        .eq('qbo_realm_id', conn.realm_id);
      if (delError) throw delError;
      snapshotRemoved = true;
    }

    console.log(`SANDBOX delete of JE ${txnId} by ${admin.email ?? admin.id}`);
    return json({
      deleted: true, txnId, snapshotRemoved,
      realmId: conn.realm_id, status: res?.JournalEntry?.status ?? null,
    });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof NotSandboxError) return json({ error: e.message, code: e.code }, 403);
    if (e instanceof NotConnectedError) return json({ error: e.message, code: e.code }, 409);
    console.error('qbo-delete-je failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
