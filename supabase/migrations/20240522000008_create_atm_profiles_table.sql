-- Create atm_profiles table
CREATE TABLE atm_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atm_id TEXT NOT NULL UNIQUE,
  atm_name TEXT,
  city TEXT,
  state TEXT,
  rent DECIMAL(10, 2),
  cash_fee DECIMAL(10, 2),
  seo DECIMAL(10, 2),
  commissions DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE atm_profiles ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all access
CREATE POLICY "Enable all access for all users" ON atm_profiles
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON atm_profiles TO anon, authenticated, service_role;

-- Create index for faster lookups
CREATE INDEX idx_atm_profiles_atm_id ON atm_profiles(atm_id);

-- Add comment for documentation
COMMENT ON TABLE atm_profiles IS 'Stores ATM profile data including location and monthly expense information for P&L calculations';
COMMENT ON COLUMN atm_profiles.atm_id IS 'Unique ATM identifier, links to transactions.atm_id';
COMMENT ON COLUMN atm_profiles.atm_name IS 'Custom display name for the ATM';
COMMENT ON COLUMN atm_profiles.rent IS 'Monthly rent expense in USD';
COMMENT ON COLUMN atm_profiles.cash_fee IS 'Monthly cash handling fee in USD';
COMMENT ON COLUMN atm_profiles.seo IS 'Monthly SEO/marketing expense in USD';
COMMENT ON COLUMN atm_profiles.commissions IS 'Monthly commission expense in USD';
