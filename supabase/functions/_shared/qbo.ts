// Shared Intuit/QuickBooks plumbing for the qbo-* edge functions.
//
// Three concerns live here because all four functions need them and getting any
// of them subtly wrong is expensive: auth, token refresh, and the Intuit fetch.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from './utils.ts';

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });

export const serviceClient = (): SupabaseClient =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

export type QboEnv = 'sandbox' | 'production';

export const qboEnv = (): QboEnv => {
  const v = (Deno.env.get('QBO_ENV') ?? 'sandbox').toLowerCase();
  if (v !== 'sandbox' && v !== 'production') {
    throw new Error(`QBO_ENV must be 'sandbox' or 'production', got '${v}'`);
  }
  return v;
};

export const apiBase = (env: QboEnv): string =>
  env === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';

// Intuit's OAuth endpoints are the same for both environments; only the API
// host differs. The sandbox/production split is a property of the company file,
// not of the authorization server.
export const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
export const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
export const ACCOUNTING_SCOPE = 'com.intuit.quickbooks.accounting';

// ---------------------------------------------------------------------------
// Return-URL allowlist
//
// Exact match, no wildcards, and deliberately NOT including *.vercel.app
// preview deployments: a preview URL is attacker-influencable (anyone who can
// open a PR gets one) and this value decides where an OAuth code is delivered.
// ---------------------------------------------------------------------------

export const ALLOWED_RETURN_ORIGINS = [
  'https://dashboard.denetllc.com',
  'http://localhost:5174',
] as const;

/** Returns the URL if its origin is allowlisted, else null. Never throws on bad input. */
export const allowReturnUrl = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  return (ALLOWED_RETURN_ORIGINS as readonly string[]).includes(parsed.origin) ? parsed.toString() : null;
};

// ---------------------------------------------------------------------------
// Admin verification
//
// WHY THE GATEWAY IS NOT ENOUGH. Supabase's verify_jwt only proves that SOME
// valid JWT was presented. This project still uses the legacy anon key, which
// IS a valid HS256 JWT signed with the project secret — so it sails through the
// gateway. Without the check below, "admin only" would mean "anyone with the
// key that ships in the client bundle".
//
// WHY app_metadata AND NOT user_metadata. user_metadata is writable by the user
// it describes (`supabase.auth.updateUser({ data: { role: 'admin' } })`).
// Supabase's linter flags depending on it at ERROR level. app_metadata is
// writable only via the admin API. Migration 20260922010000 moves the role.
//
// getUser() is the authoritative check rather than decoding the JWT ourselves:
// it validates the signature and expiry server-side and returns the current
// metadata, so a token issued before a demotion does not keep working.
// ---------------------------------------------------------------------------

export interface AdminCaller {
  id: string;
  email: string | null;
}

export class AuthError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export async function requireAdmin(req: Request, supabase: SupabaseClient): Promise<AdminCaller> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    throw new AuthError('Missing Authorization bearer token.', 401, 'no_token');
  }

  const { data, error } = await supabase.auth.getUser(token);
  // An anon key reaches here and yields no user — this is the branch that
  // closes the gateway gap described above.
  if (error || !data?.user) {
    throw new AuthError('Not signed in.', 401, 'not_authenticated');
  }

  const user = data.user;
  const role = (user.app_metadata as Record<string, unknown> | null)?.role;
  if (role !== 'admin') {
    throw new AuthError(
      'Admin role required. If you were just granted admin, sign out and back in so your session picks up the new role.',
      403,
      'not_admin',
    );
  }

  return { id: user.id, email: user.email ?? null };
}

// ---------------------------------------------------------------------------
// Connection + token refresh
// ---------------------------------------------------------------------------

export interface QboConnection {
  realm_id: string;
  company_name: string | null;
  environment: QboEnv;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string | null;
  status: 'connected' | 'needs_reconnect';
  last_error: string | null;
}

export class NotConnectedError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'NotConnectedError';
  }
}

// Refresh this far before actual expiry, so a token cannot lapse mid-request.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;
const LEASE_SECONDS = 60;
const LOSER_POLL_MS = 400;
const LOSER_POLL_TRIES = 5;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const readConnection = async (supabase: SupabaseClient): Promise<QboConnection | null> => {
  const { data, error } = await supabase.rpc('qbo_get_connection');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as QboConnection | undefined) ?? null;
};

const isFresh = (row: QboConnection): boolean => {
  const at = Date.parse(row.access_token_expires_at);
  return Number.isFinite(at) && at - EXPIRY_SKEW_MS > Date.now();
};

/**
 * A usable access token, refreshing if needed.
 *
 * REFRESH TOKEN ROTATION IS THE HAZARD. Intuit issues a new refresh token on
 * every refresh and invalidates the previous one, so two concurrent refreshes
 * brick the connection.
 *
 * A transaction-scoped advisory lock cannot guard this: the critical section
 * includes an HTTP call to Intuit, and the lock would release when the RPC
 * returned — before that call is even made. Instead one caller claims a lease
 * (atomic conditional UPDATE); the loser polls until the winner publishes.
 * The commit is itself conditional on still holding the lease, so a slow winner
 * cannot overwrite a newer token.
 */
export async function getAccessToken(
  supabase: SupabaseClient,
): Promise<{ token: string; connection: QboConnection }> {
  let row = await readConnection(supabase);
  if (!row) {
    throw new NotConnectedError('QuickBooks is not connected. Connect it in Settings.', 'not_connected');
  }
  if (row.status === 'needs_reconnect') {
    throw new NotConnectedError(
      `The QuickBooks connection needs to be re-authorised${row.last_error ? `: ${row.last_error}` : '.'}`,
      'needs_reconnect',
    );
  }
  if (isFresh(row)) return { token: row.access_token, connection: row };

  const { data: leaseData, error: leaseError } = await supabase.rpc('qbo_begin_refresh', {
    p_lease_seconds: LEASE_SECONDS,
  });
  if (leaseError) throw leaseError;
  const lease = (Array.isArray(leaseData) ? leaseData[0] : leaseData) as
    | { lease_id: string; refresh_token: string; previous_refresh_token: string | null; previous_refresh_rotated_at: string | null }
    | undefined;

  if (!lease) {
    // Someone else is refreshing. Wait for them to publish rather than sending
    // the same refresh token in parallel and invalidating both.
    for (let i = 0; i < LOSER_POLL_TRIES; i++) {
      await sleep(LOSER_POLL_MS);
      row = await readConnection(supabase);
      if (row && row.status === 'needs_reconnect') {
        throw new NotConnectedError('The QuickBooks connection needs to be re-authorised.', 'needs_reconnect');
      }
      if (row && isFresh(row)) return { token: row.access_token, connection: row };
    }
    throw new NotConnectedError(
      'A QuickBooks token refresh is already in progress. Try again in a moment.',
      'token_refresh_busy',
    );
  }

  return await performRefresh(supabase, row, lease);
}

async function callTokenEndpoint(refreshToken: string): Promise<Response> {
  const basic = btoa(`${Deno.env.get('QBO_CLIENT_ID')!}:${Deno.env.get('QBO_CLIENT_SECRET')!}`);
  return await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    signal: AbortSignal.timeout(20_000),
  });
}

// A refresh that rotated in Intuit but crashed before we persisted the new
// token leaves us holding a dead one. Retrying with the immediately-previous
// token recovers that case; older than this and it is genuinely gone.
const PREVIOUS_TOKEN_GRACE_MS = 5 * 60 * 1000;

async function performRefresh(
  supabase: SupabaseClient,
  row: QboConnection,
  lease: { lease_id: string; refresh_token: string; previous_refresh_token: string | null; previous_refresh_rotated_at: string | null },
): Promise<{ token: string; connection: QboConnection }> {
  let res: Response;
  try {
    res = await callTokenEndpoint(lease.refresh_token);
  } catch (e) {
    // Network failure or timeout — transient. Release the lease but do NOT
    // force a reconnect; Intuit being briefly unreachable is not a revocation.
    await supabase.rpc('qbo_fail_refresh', {
      p_lease_id: lease.lease_id,
      p_error: `Token refresh network error: ${e instanceof Error ? e.message : String(e)}`,
      p_terminal: false,
    });
    throw new NotConnectedError('Could not reach QuickBooks to refresh the token. Try again.', 'refresh_failed');
  }

  let text = await res.text();

  // invalid_grant with a recently-rotated previous token means we probably
  // crashed mid-rotation. One retry with that token turns the classic bricking
  // bug into a recovery.
  if (!res.ok && (res.status === 400 || res.status === 401) && lease.previous_refresh_token) {
    const rotatedAt = lease.previous_refresh_rotated_at ? Date.parse(lease.previous_refresh_rotated_at) : NaN;
    if (Number.isFinite(rotatedAt) && Date.now() - rotatedAt < PREVIOUS_TOKEN_GRACE_MS) {
      try {
        const retry = await callTokenEndpoint(lease.previous_refresh_token);
        const retryText = await retry.text();
        if (retry.ok) {
          res = retry;
          text = retryText;
        }
      } catch {
        // Fall through to the terminal path below.
      }
    }
  }

  if (!res.ok) {
    const terminal = res.status === 400 || res.status === 401;
    await supabase.rpc('qbo_fail_refresh', {
      p_lease_id: lease.lease_id,
      p_error: `Token refresh failed (${res.status}): ${text.slice(0, 300)}`,
      p_terminal: terminal,
    });
    throw new NotConnectedError(
      terminal
        ? 'The QuickBooks connection expired or was revoked. Reconnect it in Settings.'
        : `Could not refresh the QuickBooks token (${res.status}).`,
      terminal ? 'needs_reconnect' : 'refresh_failed',
    );
  }

  const body = JSON.parse(text) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in?: number;
  };

  const now = Date.now();
  const accessExpiresAt = new Date(now + body.expires_in * 1000).toISOString();
  const refreshExpiresAt = body.x_refresh_token_expires_in
    ? new Date(now + body.x_refresh_token_expires_in * 1000).toISOString()
    : null;

  const { data: committed, error: commitError } = await supabase.rpc('qbo_commit_refresh', {
    p_lease_id: lease.lease_id,
    p_access_token: body.access_token,
    // Always write the returned refresh token back, even if byte-identical.
    p_refresh_token: body.refresh_token,
    p_access_expires_at: accessExpiresAt,
    p_refresh_expires_at: refreshExpiresAt,
  });
  if (commitError) throw commitError;

  if (committed === false) {
    // Our lease expired while Intuit was responding, and someone else has since
    // refreshed. Discarding our result is the correct move — writing it would
    // overwrite a newer token with an older one, which bricks the connection
    // just as surely as a failed refresh.
    const fresh = await readConnection(supabase);
    if (fresh && isFresh(fresh)) return { token: fresh.access_token, connection: fresh };
    throw new NotConnectedError('Token refresh raced and could not be confirmed. Try again.', 'refresh_failed');
  }

  return {
    token: body.access_token,
    connection: {
      ...row,
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      access_token_expires_at: accessExpiresAt,
      refresh_token_expires_at: refreshExpiresAt ?? row.refresh_token_expires_at,
      status: 'connected',
      last_error: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Intuit API fetch
// ---------------------------------------------------------------------------

/** minorversion pins the response shape; bump deliberately, never implicitly. */
export const MINOR_VERSION = '75';

export async function qboFetch(
  supabase: SupabaseClient,
  path: string,
  init: RequestInit & { searchParams?: Record<string, string> } = {},
): Promise<unknown> {
  const { token, connection } = await getAccessToken(supabase);
  const url = new URL(`${apiBase(connection.environment)}/v3/company/${connection.realm_id}${path}`);
  url.searchParams.set('minorversion', MINOR_VERSION);
  for (const [k, v] of Object.entries(init.searchParams ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await res.text();
  if (!res.ok) {
    // Intuit's error bodies are deeply nested and inconsistent; the raw text is
    // more useful to a human than a half-parsed shape.
    throw new Error(`QuickBooks API ${res.status} on ${path}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Sandbox fence
//
// Guards the two functions that DESTROY things — deleting journal entries in
// QuickBooks, and clearing test snapshots. Both checks must pass:
//
//   1. QBO_ENV === 'sandbox'   what we believe we are pointed at
//   2. realm === the sandbox realm   what we are ACTUALLY connected to
//
// Either alone is insufficient. A stale secret paired with a production
// connection would satisfy (1) while pointing at the real books; (2) is the
// check that catches it. Journal entries deleted in QuickBooks cannot be
// recovered from here.
// ---------------------------------------------------------------------------

export const SANDBOX_REALM_ID = '9341457959689478';

export class NotSandboxError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'NotSandboxError';
  }
}

export function assertSandbox(realmId: string | null | undefined, companyName?: string | null): void {
  const env = (Deno.env.get('QBO_ENV') ?? '').toLowerCase();
  if (env !== 'sandbox') {
    throw new NotSandboxError(
      `Refusing: QBO_ENV is '${env || 'unset'}', not 'sandbox'. This action only ever runs against the sandbox company.`,
      'not_sandbox_env',
    );
  }
  if (realmId !== SANDBOX_REALM_ID) {
    throw new NotSandboxError(
      `Refusing: connected to realm ${realmId ?? 'none'}${companyName ? ` (${companyName})` : ''}, ` +
        `which is not the sandbox realm ${SANDBOX_REALM_ID}.`,
      'not_sandbox_realm',
    );
  }
}
