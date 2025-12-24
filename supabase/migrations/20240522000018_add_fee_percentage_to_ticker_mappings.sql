-- Add fee_percentage column to ticker_mappings table
ALTER TABLE ticker_mappings
ADD COLUMN fee_percentage DECIMAL(5,4) DEFAULT 0.10;

-- Update existing rows to have default 10% fee
UPDATE ticker_mappings
SET fee_percentage = 0.10
WHERE fee_percentage IS NULL;
