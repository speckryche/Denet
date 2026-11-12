// User role management. Admin only.
//
// POST { action: 'list' }
//   → { users: [{ id, email, role, lastSignInAt, createdAt }] }
// POST { action: 'set-role', userId, role: 'admin' | 'standard' }
//   → { user: { id, email, role } }
//
// The role lives in auth.users app_metadata, which only the admin API can
// write; that is why this runs here with the service role and not in the
// browser. The database's RLS policies (public.is_admin()) read the role from
// the caller's JWT, so a change takes effect on the target user's next token
// refresh (up to an hour) or next sign-in. This function's own admin check
// uses getUser() and so sees the new role immediately.

import { corsHeaders } from '../_shared/utils.ts';
import { AuthError, json, requireAdmin, serviceClient } from '../_shared/qbo.ts';

type Role = 'admin' | 'standard';
const isRole = (v: unknown): v is Role => v === 'admin' || v === 'standard';

// Anything other than an explicit 'admin' is standard — same rule as the
// frontend and public.is_admin().
const roleOf = (appMetadata: Record<string, unknown> | null | undefined): Role =>
  appMetadata?.role === 'admin' ? 'admin' : 'standard';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders, status: 200 });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabase = serviceClient();
  try {
    const caller = await requireAdmin(req, supabase);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Body must be JSON.' }, 400);
    }

    if (body.action === 'list') {
      // A handful of users; one page of 1000 is the whole table.
      const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      const users = data.users
        .map((u) => ({
          id: u.id,
          email: u.email ?? null,
          role: roleOf(u.app_metadata),
          lastSignInAt: u.last_sign_in_at ?? null,
          createdAt: u.created_at,
        }))
        .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''));
      return json({ users });
    }

    if (body.action === 'set-role') {
      const { userId, role } = body;
      if (typeof userId !== 'string' || !userId) return json({ error: 'userId is required.' }, 400);
      if (!isRole(role)) return json({ error: "role must be 'admin' or 'standard'." }, 400);

      // Changing your own role is refused outright: demoting yourself is the
      // only way this screen can leave the app with no admin, and promoting
      // yourself is meaningless (you are already admin to get here).
      if (userId === caller.id) {
        return json({ error: 'You cannot change your own role.', code: 'self_change' }, 400);
      }

      const { data: existing, error: getErr } = await supabase.auth.admin.getUserById(userId);
      if (getErr || !existing?.user) return json({ error: 'User not found.' }, 404);

      // Merge, don't replace: app_metadata also carries provider/providers.
      const { data, error } = await supabase.auth.admin.updateUserById(userId, {
        app_metadata: { ...existing.user.app_metadata, role },
      });
      if (error) throw error;

      console.log(`admin-users: ${caller.email ?? caller.id} set ${data.user.email ?? userId} to ${role}`);
      return json({
        user: { id: data.user.id, email: data.user.email ?? null, role: roleOf(data.user.app_metadata) },
      });
    }

    return json({ error: "action must be 'list' or 'set-role'." }, 400);
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message, code: e.code }, e.status);
    console.error('admin-users failed:', e);
    return json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
