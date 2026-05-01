-- CTR (Cash Transaction Report) filings tracking
CREATE TABLE ctr_filings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  trigger_date DATE NOT NULL,
  total_amount DECIMAL(14, 2) NOT NULL,
  transaction_count INTEGER NOT NULL DEFAULT 1,
  filed BOOLEAN NOT NULL DEFAULT false,
  filed_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, trigger_date)
);

ALTER TABLE ctr_filings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users full access" ON ctr_filings
  FOR ALL USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
