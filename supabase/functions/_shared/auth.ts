// Caller verification shared by every Edge Function that acts with the
// service role.
//
// WHY THE GATEWAY IS NOT ENOUGH. Supabase's verify_jwt only proves that SOME
// valid JWT was presented. This project still uses the legacy anon key, which
// IS a valid HS256 JWT signed with the project secret — so it sails through the
// gateway. Without these checks, "signed-in only" would mean "anyone with the
// key that ships in the client bundle".
//
// WHY app_metadata AND NOT user_metadata. user_metadata is writable by the user
// it describes (`supabase.auth.updateUser({ data: { role: 'admin' } })`).
// app_metadata is writable only via the admin API (see admin-users).
//
// getUser() is the authoritative check rather than decoding the JWT ourselves:
// it validates the signature and expiry server-side and returns the CURRENT
// metadata, so a token issued before a demotion stops passing requireAdmin
// immediately. (Postgres RLS reads the JWT claims instead, so it lags by up to
// one token refresh.)

import type { SupabaseClient, User } from 'https://esm.sh/@supabase/supabase-js@2';

export class AuthError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AdminCaller {
  id: string;
  email: string | null;
}

/** Any signed-in user. Rejects the anon key and missing/expired tokens. */
export async function requireUser(req: Request, supabase: SupabaseClient): Promise<User> {
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
  return data.user;
}

/** A signed-in user whose app_metadata.role is 'admin'. */
export async function requireAdmin(req: Request, supabase: SupabaseClient): Promise<AdminCaller> {
  const user = await requireUser(req, supabase);
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
