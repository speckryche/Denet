// Begin the QuickBooks authorization round trip. Admin only.
//
// Mints a single-use `state`, records it server-side with the return URL, and
// hands back the Intuit authorize URL. The browser navigates there; Intuit
// later redirects to qbo-oauth-callback.
//
// The return URL is validated against the allowlist HERE, at mint time, and
// stored. The callback looks it up rather than reading it from its own request,
// so there is no point at which a crafted URL can redirect the OAuth code
// somewhere it should not go.

import { corsHeaders } from '../_shared/utils.ts';
import {
  ACCOUNTING_SCOPE, AUTHORIZE_URL, AuthError, allowReturnUrl,
  json, qboEnv, requireAdmin, serviceClient,
} from '../_shared/qbo.ts';

const STATE_TTL_MINUTES = 10;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    const admin = await requireAdmin(req, supabase);
    const { returnUrl } = (await req.json().catch(() => ({}))) as { returnUrl?: string };

    const allowed = allowReturnUrl(returnUrl);
    if (!allowed) {
      return json(
        {
          error: 'That return URL is not allowed. Connect from the dashboard or from localhost:5174.',
          code: 'return_url_not_allowed',
        },
        400,
      );
    }

    const env = qboEnv();
    // crypto.randomUUID twice: 32 hex chars of entropy is ample for a 10-minute
    // single-use CSRF token, and avoids pulling in a random-bytes helper.
    const state = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');

    const { error } = await supabase.from('qbo_oauth_state').insert({
      state,
      return_url: allowed,
      environment: env,
      created_by: admin.email,
      expires_at: new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString(),
    });
    if (error) throw error;

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', Deno.env.get('QBO_CLIENT_ID')!);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', ACCOUNTING_SCOPE);
    url.searchParams.set('redirect_uri', Deno.env.get('QBO_REDIRECT_URI')!);
    url.searchParams.set('state', state);

    return json({ authorizeUrl: url.toString(), environment: env });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    console.error('qbo-oauth-start failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
