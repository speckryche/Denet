-- Add platform column to atm_profiles table
ALTER TABLE atm_profiles
ADD COLUMN IF NOT EXISTS platform TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN atm_profiles.platform IS 'The platform this ATM belongs to (bitstop or denet)';
