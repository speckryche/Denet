ALTER TABLE atm_profiles 
  ADD COLUMN IF NOT EXISTS street_address TEXT,
  ADD COLUMN IF NOT EXISTS zip_code TEXT,
  ADD COLUMN IF NOT EXISTS warehouse_location TEXT CHECK (warehouse_location IN ('Arizona (Steven)', 'Oregon (RPS)', 'Oregon (Portland)')),
  ADD COLUMN IF NOT EXISTS on_bitstop BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS on_coinradar BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes TEXT;
