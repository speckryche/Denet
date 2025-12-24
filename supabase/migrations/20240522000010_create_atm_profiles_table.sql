CREATE TABLE IF NOT EXISTS atm_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  atm_id TEXT UNIQUE NOT NULL,
  location_name TEXT,
  sales_rep_id UUID REFERENCES sales_reps(id) ON DELETE SET NULL,
  monthly_rent DECIMAL(10,2) NOT NULL DEFAULT 0,
  monthly_cash_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE atm_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on atm_profiles" ON atm_profiles;
CREATE POLICY "Allow all operations on atm_profiles" ON atm_profiles FOR ALL USING (true) WITH CHECK (true);
