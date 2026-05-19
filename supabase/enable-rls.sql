-- Enable Row Level Security (RLS) on all tables
-- Run this script in the Supabase SQL Editor (Dashboard > SQL Editor)
--
-- This ensures only authenticated users can access data via the REST API.
-- The anon key alone (without a valid auth session) will be blocked.

BEGIN;

-- 1. Enable RLS on all 12 tables
ALTER TABLE atm_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_reps ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_pickup_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticker_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bitstop_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

-- 2. Drop old permissive policies that granted public/anon access
DROP POLICY IF EXISTS "Allow all operations on atm_profiles" ON atm_profiles;
DROP POLICY IF EXISTS "Enable all access for all users" ON atm_profiles;
DROP POLICY IF EXISTS "Allow all operations on commission_details" ON commission_details;
DROP POLICY IF EXISTS "Allow all operations on commissions" ON commissions;
DROP POLICY IF EXISTS "Allow all for anon" ON deposit_pickup_links;
DROP POLICY IF EXISTS "Allow all operations on sales_reps" ON sales_reps;
DROP POLICY IF EXISTS "Enable all access for all users" ON ticker_mappings;
DROP POLICY IF EXISTS "Enable all access for all users" ON transactions;
DROP POLICY IF EXISTS "Enable all access for all users" ON uploads;

-- 3. Create policies allowing full access for authenticated users only
-- Each policy uses auth.role() = 'authenticated' to gate access.

CREATE POLICY "Authenticated users full access" ON atm_profiles
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON sales_reps
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON people
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON transactions
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON commissions
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON commission_details
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON deposits
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON cash_pickups
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON deposit_pickup_links
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON ticker_mappings
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON bitstop_commissions
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users full access" ON uploads
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

COMMIT;
