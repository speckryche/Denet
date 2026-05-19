-- Add bitstop_spread column to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS bitstop_spread NUMERIC;

-- Create app_settings key/value table
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  data_type TEXT NOT NULL DEFAULT 'string' CHECK (data_type IN ('string', 'number', 'boolean')),
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON app_settings FOR ALL USING (true) WITH CHECK (true);

-- Seed default Bitstop commission rate
INSERT INTO app_settings (key, value, data_type, description) VALUES
  ('bitstop_commission_rate', '0.56', 'number', 'Bitstop affiliate commission rate as decimal (0.56 = 56%)');
