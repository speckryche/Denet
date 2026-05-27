-- Phase 2c: drop the deprecated platform_switch_date column.
-- Replaced by the multi-row atm_profiles model (each profile row is one
-- platform period, bounded by installed_date / removed_date). All values
-- were nulled out during Phase 1; Phase 2a removed every code reference;
-- this migration drops the column itself. Applied via Supabase MCP — this
-- file keeps the local migration history in sync.
ALTER TABLE atm_profiles DROP COLUMN platform_switch_date;
