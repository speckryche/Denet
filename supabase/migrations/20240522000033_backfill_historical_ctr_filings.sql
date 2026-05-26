-- Backfill historical CTR-qualifying entries from Denet Platform data.
-- One row per (customer_id, trigger_date) where same-day Denet sales summed >= $10,001.
--
-- Grouping mirrors src/lib/ctr.ts (qualifyCtrGroups): bucket by (customer_id, trigger_date)
-- only. customer_name is denormalized separately via DISTINCT ON, picking the name from
-- the most recent transaction on the trigger date — matching the live CTRReport behavior,
-- which fetches ORDER BY date DESC and takes the first row per bucket. Grouping by name
-- would split same-customer name variants ("CHRISTA JEAN RUSSELL" vs "Christa Russell")
-- into separate buckets and could push otherwise-qualifying days below the threshold.
--
-- Idempotent via ctr_filings' UNIQUE(customer_id, trigger_date) + ON CONFLICT DO NOTHING:
-- existing 'current' entries from the live scan are preserved as-is. Re-running this
-- migration inserts zero rows.
WITH qualifying AS (
  SELECT
    customer_id,
    date::date                  AS trigger_date,
    SUM(sale)::decimal(14,2)    AS total_amount,
    COUNT(*)::int               AS transaction_count
  FROM transactions
  WHERE platform = 'denet'
    AND customer_id IS NOT NULL
  GROUP BY 1, 2
  HAVING SUM(sale) >= 10001
),
names AS (
  SELECT DISTINCT ON (customer_id, date::date)
    customer_id,
    date::date                  AS trigger_date,
    COALESCE(
      NULLIF(TRIM(CONCAT_WS(' ', customer_first_name, customer_last_name)), ''),
      'Unknown'
    )                           AS customer_name
  FROM transactions
  WHERE platform = 'denet'
    AND customer_id IS NOT NULL
  ORDER BY customer_id, date::date, date DESC
)
INSERT INTO ctr_filings (
  customer_id, customer_name, trigger_date,
  total_amount, transaction_count,
  filed, category, notes
)
SELECT
  q.customer_id,
  n.customer_name,
  q.trigger_date,
  q.total_amount,
  q.transaction_count,
  false,
  'historical',
  'Backfilled from historical Denet Platform data on ' || CURRENT_DATE
FROM qualifying q
JOIN names n
  ON  n.customer_id  = q.customer_id
  AND n.trigger_date = q.trigger_date
ON CONFLICT (customer_id, trigger_date) DO NOTHING;
