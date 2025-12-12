-- Ensure RLS is enabled
alter table public.transactions enable row level security;

-- Drop existing policy if it exists to avoid conflicts
drop policy if exists "Enable all access for all users" on public.transactions;

-- Recreate the policy
create policy "Enable all access for all users" on public.transactions
  for all using (true) with check (true);
