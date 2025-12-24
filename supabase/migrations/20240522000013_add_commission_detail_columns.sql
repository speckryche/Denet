-- Add new columns to commission_details table
ALTER TABLE commission_details
ADD COLUMN IF NOT EXISTS total_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS cash_management_rps DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS cash_management_rep DECIMAL(12,2) NOT NULL DEFAULT 0;
