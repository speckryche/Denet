// Disconnect QuickBooks. Admin only.
//
// First revokes the grant at Intuit using the stored refresh token, then
// forgets the stored tokens. If the revoke fails (Intuit down, token already
// dead, network), the failure is logged and returned as revokeError, and the
// local tokens are deleted anyway: a disconnect the admin asked for should
// never leave working tokens behind in our database.
//
// It deliberately touches nothing in QuickBooks. Any journal entries already
// posted stay exactly where they are — disconnecting is not an undo.
//
// Account Ids in qbo_account_map / crypto_assets are left in place too. They
// are still correct for their realm, and re-connecting the same company should
// not require a re-sync. The realm recorded alongside them is what guards
// against using them against a different company file.

import { corsHeaders } from '../_shared/utils.ts';
import { AuthError, json, requireAdmin, revokeGrant, serviceClient } from '../_shared/qbo.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    const admin = await requireAdmin(req, supabase);

    const { data: conn, error: readError } = await supabase
      .from('qbo_connection')
      .select('refresh_token')
      .eq('id', 1)
      .maybeSingle();
    if (readError) throw readError;

    let revoked = false;
    let revokeError: string | null = null;
    if (conn?.refresh_token) {
      const result = await revokeGrant(conn.refresh_token);
      if (result.ok) {
        revoked = true;
      } else {
        revokeError = result.reason;
        console.error(`QBO revoke failed, deleting local tokens anyway: ${result.reason}`);
      }
    }

    const { error } = await supabase.from('qbo_connection').delete().eq('id', 1);
    if (error) throw error;

    console.log(
      `QBO connection cleared by ${admin.email ?? admin.id} ` +
        `(${revoked ? 'revoked at Intuit' : conn ? 'Intuit revoke failed' : 'no stored tokens'})`,
    );
    return json({ disconnected: true, revoked, revokeError });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    console.error('qbo-disconnect failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
