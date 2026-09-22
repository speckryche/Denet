// Connection status for the Settings UI. Admin only.
//
// Returns only non-sensitive fields. Tokens never leave the server — that is
// the whole reason qbo_connection is service_role-only and the app talks to it
// through a function rather than reading the table.

import { corsHeaders } from '../_shared/utils.ts';
import { AuthError, json, requireAdmin, serviceClient } from '../_shared/qbo.ts';

// Warn before a long-idle connection dies: Intuit refresh tokens last ~100
// days, and nothing refreshes them if nobody opens the app.
const REFRESH_WARN_DAYS = 21;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });

  const supabase = serviceClient();
  try {
    await requireAdmin(req, supabase);

    const { data, error } = await supabase.rpc('qbo_get_connection');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;

    if (!row) return json({ connected: false, status: 'not_connected' });

    const refreshExpiresAt = row.refresh_token_expires_at as string | null;
    const expiringSoon =
      refreshExpiresAt != null &&
      Date.parse(refreshExpiresAt) - Date.now() < REFRESH_WARN_DAYS * 86_400_000;

    return json({
      connected: row.status === 'connected',
      status: row.status,
      realmId: row.realm_id,
      companyName: row.company_name,
      environment: row.environment,
      accessTokenExpiresAt: row.access_token_expires_at,
      refreshTokenExpiresAt: refreshExpiresAt,
      refreshTokenExpiringSoon: expiringSoon,
      lastError: row.last_error,
      lastRefreshedAt: row.last_refreshed_at,
      connectedBy: row.connected_by,
      connectedAt: row.connected_at,
    });
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    console.error('qbo-status failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
