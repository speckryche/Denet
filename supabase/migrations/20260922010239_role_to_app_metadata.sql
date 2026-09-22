-- Move the admin role from user_metadata to app_metadata.
--
-- WHY THIS IS A SECURITY FIX, NOT A REFACTOR
-- `role` currently lives in auth.users.raw_user_meta_data. That field is
-- writable by the user it belongs to: supabase-js exposes
-- `supabase.auth.updateUser({ data: { role: 'admin' } })`, which needs nothing
-- but the user's own session. Supabase's database linter flags this at ERROR
-- level (0015_rls_references_user_metadata): "A security policy references
-- user_metadata, which end users can freely modify, allowing them to bypass
-- access controls."
--
-- raw_app_meta_data is the counterpart field, writable only through the admin
-- API (service_role). Supabase's own guidance names this exact use:
-- user_metadata is "metadata that the user can update", app_metadata is
-- "metadata that the user should NOT be able to update (e.g. pricing plan,
-- access control roles)".
--
-- Until now the role only gated UI, so the exposure was cosmetic: a
-- self-promoted user saw admin screens but RLS still governed the data. That
-- changes with the QBO API work, where an edge function must decide
-- server-side whether the caller may post a journal entry into the company's
-- accounting system. A check against user_metadata there would be security
-- theatre — the attacker controls the input.
--
-- WHAT THIS DOES NOT DO
-- It does not remove role from raw_user_meta_data. Both are populated for a
-- transition period so a client running the old code keeps working while the
-- new client is deployed. Dropping the old copy is a follow-up, once every
-- session has been refreshed.
--
-- AFTER APPLYING: each user must sign out and back in (or have their session
-- refreshed) before the new claim appears in their JWT. Until then the app
-- falls back to user_metadata, so nobody is locked out mid-deploy.

BEGIN;

UPDATE auth.users
SET raw_app_meta_data =
      COALESCE(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', raw_user_meta_data->>'role')
WHERE raw_user_meta_data ? 'role'
  AND raw_user_meta_data->>'role' IS NOT NULL
  -- Idempotent: skip rows already carrying the same role in app_metadata, so
  -- re-running this never churns updated_at or clobbers a later change.
  AND COALESCE(raw_app_meta_data->>'role', '') IS DISTINCT FROM raw_user_meta_data->>'role';

COMMIT;
