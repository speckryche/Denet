-- Add bitstop_fees column to commissions table
ALTER TABLE commissions
ADD COLUMN IF NOT EXISTS bitstop_fees DECIMAL(12,2) NOT NULL DEFAULT 0;
