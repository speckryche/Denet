-- Add observed Bitstop affiliate platform spread rate to app_settings.
-- Default is 0.245 (24.5% of sales), derived from 10 months of actual
-- Bitstop platform operations (Jul 2025 – Apr 2026).
-- Used by the Platform Comparison report's flat-benchmark projection:
--   projected_commission = total_sales * spread_rate * commission_rate

INSERT INTO app_settings (key, value, data_type, description) VALUES
  ('bitstop_average_spread_rate', '0.245', 'number',
   'Observed average Bitstop affiliate platform spread as a decimal (0.245 = 24.5% of sales)')
ON CONFLICT (key) DO NOTHING;
