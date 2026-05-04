-- Add customer address and zipcode to transactions
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS customer_address TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS customer_zipcode TEXT;
