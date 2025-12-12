-- Grant permissions on uploads table
grant all on table public.uploads to anon, authenticated, service_role;

-- Ensure RLS policy is correct (re-creating it just in case, though the previous one should work)
drop policy if exists "Enable all access for all users" on public.uploads;
create policy "Enable all access for all users" on public.uploads
  for all using (true) with check (true);
