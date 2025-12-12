-- Create uploads table
create table if not exists public.uploads (
  id uuid default gen_random_uuid() primary key,
  filename text not null,
  platform text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  record_count integer default 0,
  status text default 'completed'
);

-- Enable RLS on uploads
alter table public.uploads enable row level security;

-- Create policy for uploads
create policy "Enable all access for all users" on public.uploads
  for all using (true) with check (true);

-- Add upload_id to transactions
alter table public.transactions add column if not exists upload_id uuid references public.uploads(id) on delete cascade;
