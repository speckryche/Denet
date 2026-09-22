// Intuit redirects here after the operator approves (or declines). NO JWT.
//
// verify_jwt is false for this function only (supabase/config.toml) because
// this is a plain browser navigation from appcenter.intuit.com carrying no
// Supabase session. Authentication is the one-time `state` row instead: it must
// exist, be unexpired, and be unused. The return URL comes from that row, never
// from the request.
//
// Responses are redirects, not JSON — a human is looking at this, not code.

import { corsHeaders } from '../_shared/utils.ts';
import { TOKEN_URL, apiBase, qboEnv, serviceClient } from '../_shared/qbo.ts';

const redirect = (to: string): Response =>
  new Response(null, { status: 302, headers: { ...corsHeaders, Location: to } });

// Failures go back to the app with a reason in the query string rather than
// rendering an error page here; the app already knows how to show a banner.
const fail = (base: string | null, reason: string): Response =>
  base
    ? redirect(`${base}${base.includes('?') ? '&' : '?'}qbo=error&reason=${encodeURIComponent(reason)}`)
    : new Response(`QuickBooks connection failed: ${reason}`, { status: 400, headers: corsHeaders });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  const url = new URL(req.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const realmId = url.searchParams.get('realmId');
  const intuitError = url.searchParams.get('error');

  let returnUrl: string | null = null;

  try {
    if (!state) return fail(null, 'missing_state');

    // Consume the state atomically: the UPDATE only matches an unused,
    // unexpired row, so a replayed callback matches nothing.
    const { data, error } = await supabase
      .from('qbo_oauth_state')
      .update({ used_at: new Date().toISOString() })
      .eq('state', state)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('return_url, environment')
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(null, 'state_invalid_or_expired');

    returnUrl = data.return_url as string;

    // The operator clicked Cancel on Intuit's consent screen.
    if (intuitError) return fail(returnUrl, intuitError);
    if (!code || !realmId) return fail(returnUrl, 'missing_code_or_realm');

    const basic = btoa(`${Deno.env.get('QBO_CLIENT_ID')!}:${Deno.env.get('QBO_CLIENT_SECRET')!}`);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: Deno.env.get('QBO_REDIRECT_URI')!,
      }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error('Token exchange failed:', res.status, text.slice(0, 500));
      return fail(returnUrl, `token_exchange_failed_${res.status}`);
    }

    const body = JSON.parse(text) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      x_refresh_token_expires_in?: number;
    };

    const env = (data.environment as 'sandbox' | 'production') ?? qboEnv();
    const now = Date.now();

    // Best-effort company name for the UI. A failure here must not fail the
    // connection — the tokens are valid either way.
    let companyName: string | null = null;
    try {
      const infoRes = await fetch(
        `${apiBase(env)}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=75`,
        { headers: { Authorization: `Bearer ${body.access_token}`, Accept: 'application/json' } },
      );
      if (infoRes.ok) {
        const info = await infoRes.json();
        companyName = info?.CompanyInfo?.CompanyName ?? null;
      }
    } catch {
      // Ignored deliberately.
    }

    const { error: upsertError } = await supabase.from('qbo_connection').upsert(
      {
        id: 1,
        realm_id: realmId,
        company_name: companyName,
        environment: env,
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        previous_refresh_token: null,
        previous_refresh_rotated_at: null,
        access_token_expires_at: new Date(now + body.expires_in * 1000).toISOString(),
        refresh_token_expires_at: body.x_refresh_token_expires_in
          ? new Date(now + body.x_refresh_token_expires_in * 1000).toISOString()
          : null,
        status: 'connected',
        last_error: null,
        refresh_lease_id: null,
        refresh_lease_expires_at: null,
        connected_by: (data as Record<string, unknown>).created_by as string ?? null,
        connected_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      },
      { onConflict: 'id' },
    );
    if (upsertError) throw upsertError;

    return redirect(`${returnUrl}${returnUrl.includes('?') ? '&' : '?'}qbo=connected`);
  } catch (e) {
    console.error('qbo-oauth-callback failed:', e);
    return fail(returnUrl, 'unexpected_error');
  }
});
