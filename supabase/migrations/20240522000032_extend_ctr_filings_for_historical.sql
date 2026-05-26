-- Extend ctr_filings to distinguish current (live-detected) from historical (backfilled) entries,
-- and to record a reason when an entry will not be filed.
ALTER TABLE ctr_filings
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'current';

ALTER TABLE ctr_filings
  ADD COLUMN IF NOT EXISTS wont_file_reason TEXT;

ALTER TABLE ctr_filings
  DROP CONSTRAINT IF EXISTS ctr_filings_category_check;

ALTER TABLE ctr_filings
  ADD CONSTRAINT ctr_filings_category_check
  CHECK (category IN ('current', 'historical'));
