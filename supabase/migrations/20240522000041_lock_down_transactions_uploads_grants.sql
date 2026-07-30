-- Close the anon read/write hole on transactions (and its cascade path, uploads).
--
-- BACKGROUND
-- supabase/enable-rls.sql was written to drop the original permissive policies
-- and replace them with authenticated-only ones. On the live DB the DROP never
-- took effect for `transactions` and `uploads`: both still carry the original
-- "Enable all access for all users" policy (USING true / WITH CHECK true) from
-- migrations 20240522000001 and 20240522000003, ALONGSIDE the intended
-- "Authenticated users full access" policy. Permissive policies are OR'd, so
-- the `true` policy wins and anyone holding the anon key (which ships in the
-- client bundle) can read, write, and delete production transaction data.
-- Verified live: an unauthenticated PATCH against /rest/v1/transactions
-- returned HTTP 200 with the affected row.
--
-- WHY `uploads` IS IN THE SAME MIGRATION
-- transactions.upload_id REFERENCES uploads(id) ON DELETE CASCADE. Foreign-key
-- cascades execute as a referential action (owner privileges, RLS not
-- re-checked on the referencing table), so an anon DELETE on `uploads` wipes
-- the matching transactions REGARDLESS of what policy protects `transactions`.
-- Fixing transactions alone would leave a full-destruction path wide open.
--
-- WHY GRANTS ARE REVOKED AND NOT JUST POLICIES
-- Both tables carry a blanket GRANT ALL to anon, which includes TRUNCATE.
-- RLS IS NOT ENFORCED FOR TRUNCATE — a policy cannot stop it. Dropping the
-- permissive policy without revoking the grant would still leave anon able to
-- empty either table. Grants are the backstop; policies are the filter.
--
-- The app authenticates via signInWithPassword (every route is behind
-- ProtectedRoute), so it operates as `authenticated` and is unaffected by the
-- anon revocations. The calculate-commissions edge function uses the
-- service_role key, which bypasses RLS and is left untouched below.

BEGIN;

-- 1. Remove the leftover wide-open policy on transactions. The
--    "Authenticated users full access" policy (auth.role() = 'authenticated')
--    remains and is what the logged-in app runs under.
DROP POLICY IF EXISTS "Enable all access for all users" ON public.transactions;

-- 2. Same leftover policy on uploads — closes the ON DELETE CASCADE path into
--    transactions described above.
DROP POLICY IF EXISTS "Enable all access for all users" ON public.uploads;

-- 3. Strip every privilege from anon on both tables (SELECT/INSERT/UPDATE/
--    DELETE/TRUNCATE/REFERENCES/TRIGGER). Nothing in the shipped app queries
--    either table before login, so anon needs no access at all.
REVOKE ALL PRIVILEGES ON public.transactions FROM anon;
REVOKE ALL PRIVILEGES ON public.uploads      FROM anon;

-- 4. Reset authenticated to an explicit minimal set rather than the inherited
--    GRANT ALL (which included TRUNCATE and REFERENCES the app never uses).
REVOKE ALL PRIVILEGES ON public.transactions FROM authenticated;
REVOKE ALL PRIVILEGES ON public.uploads      FROM authenticated;

-- 5. transactions: SELECT (every report), INSERT + UPDATE (the CSV upsert at
--    CsvUploads.tsx onConflict:'id', and the Stage 4 manual status writes).
--    DELETE is deliberately withheld — the app never deletes a transaction
--    directly; the only deletion path is the FK cascade from uploads, which
--    runs as a referential action and does not consult this grant.
GRANT SELECT, INSERT, UPDATE ON public.transactions TO authenticated;

-- 6. uploads: SELECT (UploadHistory list), INSERT (recorded per CSV import),
--    DELETE (UploadHistory's "delete this upload" button, which intentionally
--    cascades to that upload's transactions). No UPDATE — the app never
--    modifies an existing uploads row.
GRANT SELECT, INSERT, DELETE ON public.uploads TO authenticated;

COMMIT;
