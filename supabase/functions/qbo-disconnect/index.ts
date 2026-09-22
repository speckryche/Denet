// Forget the stored QuickBooks tokens. Admin only.
//
// Local only: this does NOT revoke the grant at Intuit, and it deliberately
// touches nothing in QuickBooks. Any journal entries already posted stay
// exactly where they are — disconnecting is not an undo.
//
// Account Ids in qbo_account_map / crypto_assets are left in place too. They
// are still correct for their realm, and re-connecting the same company should
// not require a re-sync. The realm recorded alongside them is what guards
// against using them against a different company file.

import { corsHeaders } from '../_shared/utils.ts';
import { AuthError, json, requireAdmin, serviceClient } from '../_shared/qbo.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    const admin = await requireAdmin(req, supabase);

    const { error } = await supabase.from('qbo_connection').delete().eq('id', 1);
    if (error) throw error;

    console.log(`QBO connection cleared by ${admin.email ?? admin.id}`);
    return json({ disconnected: true });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    console.error('qbo-disconnect failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
