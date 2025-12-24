-- Create ticker_mappings table
CREATE TABLE ticker_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_value TEXT NOT NULL UNIQUE,
  display_value TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE ticker_mappings ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all access (you can customize this later)
CREATE POLICY "Enable all access for all users" ON ticker_mappings
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON ticker_mappings TO anon, authenticated, service_role;

-- Create index for faster lookups
CREATE INDEX idx_ticker_mappings_original ON ticker_mappings(original_value);
