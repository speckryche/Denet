// Clear snapshots left behind by sandbox testing. SANDBOX ONLY. Admin only.
//
// WHY THIS IS NEEDED BEFORE GO-LIVE
// qbo_je_snapshots is keyed on (month, je_type) with no realm in the key. A
// sandbox test post for 2026-08 therefore occupies the same row production
// would need: once connected to the real company, that month reads as already
// posted (qbo_txn_id set, post_state 'posted') and the claim refuses it. The
// sandbox test would silently block the real posting.
//
// WHAT IT WILL NOT TOUCH — the guards matter more than the feature:
//   * 'manual' rows. Those record months a human keyed into the REAL
//     QuickBooks; they carry no realm and deleting one would re-expose the
//     duplicate-posting bug that 20260922015839 was written to close.
//   * any row whose qbo_realm_id is not the sandbox realm — including NULL,
//     which is what every pre-API row has.
// Both conditions are enforced in the query, not in a caller.

import { corsHeaders } from '../_shared/utils.ts';
import {
  AuthError, NotConnectedError, NotSandboxError,
  SANDBOX_REALM_ID, assertSandbox, json, requireAdmin, serviceClient,
} from '../_shared/qbo.ts';

// Deliberately excludes 'manual' and 'posting'. 'posting' is left alone because
// a lease may still be live and something may be in flight.
const CLEARABLE = ['posted', 'idle', 'failed'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    const admin = await requireAdmin(req, supabase);
    const { dryRun } = (await req.json().catch(() => ({}))) as { dryRun?: boolean };

    const { data: connData, error: connError } = await supabase.rpc('qbo_get_connection');
    if (connError) throw connError;
    const conn = Array.isArray(connData) ? connData[0] : connData;
    if (!conn) return json({ error: 'QuickBooks is not connected.', code: 'not_connected' }, 409);

    assertSandbox(conn.realm_id, conn.company_name);

    // Realm equality is an explicit filter, so a NULL realm (every pre-API row)
    // can never match: NULL = 'x' is not true in SQL.
    const selector = supabase
      .from('qbo_je_snapshots')
      .select('id, month, je_type, post_state, qbo_txn_id, qbo_realm_id')
      .eq('qbo_realm_id', SANDBOX_REALM_ID)
      .in('post_state', CLEARABLE);

    const { data: candidates, error: selError } = await selector;
    if (selError) throw selError;

    if (dryRun) {
      return json({ dryRun: true, wouldRemove: candidates ?? [], count: candidates?.length ?? 0 });
    }

    const { data: removed, error: delError } = await supabase
      .from('qbo_je_snapshots')
      .delete()
      .eq('qbo_realm_id', SANDBOX_REALM_ID)
      .in('post_state', CLEARABLE)
      .select('month, je_type, post_state, qbo_txn_id');
    if (delError) throw delError;

    console.log(`SANDBOX snapshot reset by ${admin.email ?? admin.id}: ${removed?.length ?? 0} row(s)`);
    return json({
      removed: removed ?? [],
      count: removed?.length ?? 0,
      realmId: conn.realm_id,
      note: "'manual' rows and any row from another realm are never touched. This does not delete anything in QuickBooks.",
    });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof NotSandboxError) return json({ error: e.message, code: e.code }, 403);
    if (e instanceof NotConnectedError) return json({ error: e.message, code: e.code }, 409);
    console.error('qbo-reset-test-posts failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
