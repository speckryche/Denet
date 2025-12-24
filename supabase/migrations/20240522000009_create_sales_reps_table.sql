CREATE TABLE IF NOT EXISTS sales_reps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  commission_percentage DECIMAL(5,2) NOT NULL DEFAULT 0,
  flat_monthly_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sales_reps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on sales_reps" ON sales_reps;
CREATE POLICY "Allow all operations on sales_reps" ON sales_reps FOR ALL USING (true) WITH CHECK (true);
