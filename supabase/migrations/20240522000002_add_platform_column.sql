-- Add platform column to transactions table
alter table public.transactions add column if not exists platform text default 'denet';

-- Update existing records to have 'denet' as platform
update public.transactions set platform = 'denet' where platform is null;
