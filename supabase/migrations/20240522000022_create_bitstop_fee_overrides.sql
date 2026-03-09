CREATE TABLE bitstop_fee_overrides (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  atm_id TEXT NOT NULL,
  year_month TEXT NOT NULL,          -- e.g. '2026-03'
  actual_fees DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(atm_id, year_month)
);
ALTER TABLE bitstop_fee_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON bitstop_fee_overrides FOR ALL USING (true) WITH CHECK (true);
