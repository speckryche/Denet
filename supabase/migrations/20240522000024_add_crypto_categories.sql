-- Add crypto category support

-- Add coin_id and ticker columns, expand type check
ALTER TABLE liquidity_categories DROP CONSTRAINT IF EXISTS liquidity_categories_type_check;
ALTER TABLE liquidity_categories ADD CONSTRAINT liquidity_categories_type_check CHECK (type IN ('asset', 'liability', 'crypto'));
ALTER TABLE liquidity_categories ADD COLUMN IF NOT EXISTS coin_id TEXT;
ALTER TABLE liquidity_categories ADD COLUMN IF NOT EXISTS ticker TEXT;

-- Add quantity column to snapshot values for crypto categories
ALTER TABLE liquidity_snapshot_values ADD COLUMN IF NOT EXISTS quantity DECIMAL(18, 4);

-- Update existing crypto categories
UPDATE liquidity_categories SET type = 'crypto', coin_id = 'bitcoin', ticker = 'BTC' WHERE name = 'BTC - Ledger';
UPDATE liquidity_categories SET type = 'crypto', coin_id = 'bitcoin', ticker = 'BTC' WHERE name = 'BTC - Nonce';
UPDATE liquidity_categories SET type = 'crypto', coin_id = 'bitcoin', ticker = 'BTC' WHERE name = 'BTC / Crypto - Coinbase';

-- Add SOL - Ledger
INSERT INTO liquidity_categories (name, type, display_order, coin_id, ticker) VALUES
  ('SOL - Ledger', 'crypto', 10, 'solana', 'SOL');
