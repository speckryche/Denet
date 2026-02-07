-- Create junction table for deposit-pickup links to support partial deposits
CREATE TABLE IF NOT EXISTS deposit_pickup_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id UUID NOT NULL REFERENCES deposits(id) ON DELETE CASCADE,
  pickup_id UUID NOT NULL REFERENCES cash_pickups(id) ON DELETE CASCADE,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(deposit_id, pickup_id)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_deposit_pickup_links_deposit_id ON deposit_pickup_links(deposit_id);
CREATE INDEX IF NOT EXISTS idx_deposit_pickup_links_pickup_id ON deposit_pickup_links(pickup_id);

-- Enable RLS
ALTER TABLE deposit_pickup_links ENABLE ROW LEVEL SECURITY;

-- Create RLS policy (allow all for authenticated users, matching other tables)
CREATE POLICY "Allow all for anon" ON deposit_pickup_links FOR ALL USING (true);

-- Migrate existing data: for each pickup with deposited=true and deposit_id set,
-- create a link record with the full pickup amount
INSERT INTO deposit_pickup_links (deposit_id, pickup_id, amount)
SELECT
  d.id as deposit_id,
  cp.id as pickup_id,
  cp.amount
FROM cash_pickups cp
JOIN deposits d ON d.deposit_id = cp.deposit_id
WHERE cp.deposited = true
  AND cp.deposit_id IS NOT NULL
ON CONFLICT (deposit_id, pickup_id) DO NOTHING;
