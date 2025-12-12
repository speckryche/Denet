-- Create transactions table
create table if not exists public.transactions (
  id text primary key, -- Maps to CSV "ID"
  customer_id text,
  customer_first_name text, -- Maps to "customer.first_name"
  customer_last_name text, -- Maps to "customer.last_name"
  customer_city text, -- Maps to "customer.city"
  customer_state text, -- Maps to "customer.state"
  atm_id text, -- Maps to "atm.id"
  atm_name text, -- Maps to "atm.name"
  ticker text,
  fee numeric,
  enviando numeric,
  fiat numeric,
  operator_fee_usd numeric,
  created_at_transaction_local timestamp without time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.transactions enable row level security;

-- Create a policy that allows all operations for now (since we don't have auth set up yet)
-- In a real app, you'd want to restrict this
create policy "Enable all access for all users" on public.transactions
  for all using (true) with check (true);
