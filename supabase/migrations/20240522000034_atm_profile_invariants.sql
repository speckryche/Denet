-- Phase 2a: data-shape invariants for the multi-row atm_profiles model.
-- Each atm_id can have multiple profile rows representing distinct periods.
-- These constraints enforce:
--   1. At most one active=true row per atm_id (the "current state").
--   2. Non-overlapping [installed_date, removed_date] windows for the same
--      atm_id (so a tx date attaches to exactly one profile).
--
-- Pre-check the data with the diagnostic queries documented alongside the
-- Phase 2a refactor BEFORE applying — the constraints are EXCLUDE-style and
-- will reject the entire migration if any pair of rows conflicts.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- (1) One currently-active profile per atm_id.
CREATE UNIQUE INDEX IF NOT EXISTS atm_profiles_one_active_per_atm
  ON atm_profiles (atm_id) WHERE active = true;

-- (2) Non-overlapping windows for the same atm_id.
-- Rows with NULL installed_date (placeholders for future installs) are
-- exempted via WHERE clause — those rows have no defined window and the
-- application code (profilesForWindow, findProfileForTx) filters them out.
ALTER TABLE atm_profiles
  ADD CONSTRAINT atm_profiles_no_window_overlap
  EXCLUDE USING gist (
    atm_id WITH =,
    daterange(installed_date, removed_date, '[]') WITH &&
  ) WHERE (installed_date IS NOT NULL);
