-- Liquidity tracking tables

-- Asset/liability categories
CREATE TABLE liquidity_categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability')),
  display_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE liquidity_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON liquidity_categories FOR ALL USING (true) WITH CHECK (true);

-- Seed initial categories
INSERT INTO liquidity_categories (name, type, display_order) VALUES
  ('Cash - Peoples', 'asset', 1),
  ('Cash - BTMs', 'asset', 2),
  ('Cash - In Transit', 'asset', 3),
  ('Cash - Coinbase (exchange)', 'asset', 4),
  ('BTC - Ledger', 'asset', 5),
  ('BTC - Nonce', 'asset', 6),
  ('BTC / Crypto - Coinbase', 'asset', 7),
  ('Owed to Tom', 'liability', 8),
  ('Owed to Speck', 'liability', 9);

-- Point-in-time liquidity snapshots
CREATE TABLE liquidity_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,
  bitcoin_price DECIMAL(12, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE liquidity_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON liquidity_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_liquidity_snapshots_date ON liquidity_snapshots(snapshot_date DESC);

-- Per-category values for each snapshot
CREATE TABLE liquidity_snapshot_values (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_id UUID NOT NULL REFERENCES liquidity_snapshots(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES liquidity_categories(id) ON DELETE RESTRICT,
  value DECIMAL(14, 2) NOT NULL DEFAULT 0,
  UNIQUE(snapshot_id, category_id)
);
ALTER TABLE liquidity_snapshot_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON liquidity_snapshot_values FOR ALL USING (true) WITH CHECK (true);
CREATE INDEX idx_snapshot_values_snapshot ON liquidity_snapshot_values(snapshot_id);
CREATE INDEX idx_snapshot_values_category ON liquidity_snapshot_values(category_id);

-- Current crypto investment holdings
CREATE TABLE crypto_investments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  as_of_date DATE NOT NULL,
  crypto_name TEXT NOT NULL,
  quantity DECIMAL(18, 8) NOT NULL DEFAULT 0,
  total_cost DECIMAL(14, 2) NOT NULL DEFAULT 0,
  current_value DECIMAL(14, 2) NOT NULL DEFAULT 0,
  realized_gain DECIMAL(14, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE crypto_investments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all" ON crypto_investments FOR ALL USING (true) WITH CHECK (true);
