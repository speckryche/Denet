-- ============================================================================
-- BACKFILL: Bitstop spread and fee recalculation
--
-- This migration backfills bitstop_spread and recalculates fee for all
-- historical Bitstop transactions using the new formula:
--   bitstop_spread = sale - sent
--   fee = bitstop_spread * 0.56 (commission rate from app_settings)
--
-- Manual fee corrections in bitstop_fee_overrides are NOT touched.
-- The P&L display will continue to prefer override values where they exist.
--
-- DO NOT run this migration automatically. Follow these steps:
-- 1. Run the PREVIEW QUERY below and review the output
-- 2. If the numbers look correct, run the BACKFILL block
-- ============================================================================


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ STEP 1: PREVIEW QUERY — Run this first, review output before backfill  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Run this SELECT to preview what will change:

SELECT
  -- 1. Rows that will have bitstop_spread set
  COUNT(*) FILTER (WHERE platform = 'bitstop' AND bitstop_spread IS NULL)
    AS rows_getting_spread_set,

  -- 2. Total Bitstop rows that will have fee recalculated
  COUNT(*) FILTER (WHERE platform = 'bitstop')
    AS rows_getting_fee_recalculated,

  -- 3. Sum of old fee vs sum of new fee
  ROUND(SUM(fee) FILTER (WHERE platform = 'bitstop'), 2)
    AS old_fee_sum,
  ROUND(SUM((sale - sent) * 0.56) FILTER (WHERE platform = 'bitstop'), 2)
    AS new_fee_sum,

  -- 4. Count of rows with negative or zero spread
  COUNT(*) FILTER (WHERE platform = 'bitstop' AND (sale - sent) <= 0)
    AS negative_or_zero_spread_count,

  -- 5. Count of existing bitstop_fee_overrides (for awareness)
  (SELECT COUNT(*) FROM bitstop_fee_overrides)
    AS existing_override_count

FROM transactions;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ STEP 2: BACKFILL — Uncomment and run after reviewing preview           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Backfill bitstop_spread for all Bitstop rows where it's not yet set:

-- BEGIN;
-- UPDATE transactions
-- SET bitstop_spread = sale - sent
-- WHERE platform = 'bitstop'
--   AND bitstop_spread IS NULL;
-- COMMIT;


-- Recalculate fee for ALL Bitstop rows using the new formula:
-- (Uses 0.56 as the commission rate — verify this matches app_settings)

-- BEGIN;
-- UPDATE transactions
-- SET fee = ROUND((sale - sent) * 0.56, 2)
-- WHERE platform = 'bitstop';
-- COMMIT;
