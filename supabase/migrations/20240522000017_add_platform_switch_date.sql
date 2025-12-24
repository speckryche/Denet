-- Add platform_switch_date column to atm_profiles table
ALTER TABLE atm_profiles
ADD COLUMN IF NOT EXISTS platform_switch_date DATE;

-- Add comment to explain the column
COMMENT ON COLUMN atm_profiles.platform_switch_date IS 'Date when ATM switched from one platform to another (e.g., Denet to Bitstop in August 2025)';

-- Set the switch date for the 13 ATMs that moved from Denet to Bitstop in August 2025
UPDATE atm_profiles
SET platform_switch_date = '2025-08-01'
WHERE atm_id IN ('83', '733', '960', '981', '1041', '2189', '2202', '2206', '2238', '3998', '4000', '4002', '4085');
