-- Add location_name column to transactions table to capture location at time of transaction
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS location_name TEXT;

-- Create an index on location_name for faster filtering/reporting
CREATE INDEX IF NOT EXISTS idx_transactions_location_name ON transactions(location_name);
