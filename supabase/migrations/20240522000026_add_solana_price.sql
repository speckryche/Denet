-- Add Solana price column to liquidity_snapshots
ALTER TABLE liquidity_snapshots
  ADD COLUMN solana_price DECIMAL(12, 2) NOT NULL DEFAULT 0;
