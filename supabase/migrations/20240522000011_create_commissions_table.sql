CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_rep_id UUID NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
  month_year DATE NOT NULL,
  total_net_profit DECIMAL(12,2) NOT NULL DEFAULT 0,
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  flat_fee_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_commission DECIMAL(12,2) NOT NULL DEFAULT 0,
  atm_count INTEGER NOT NULL DEFAULT 0,
  paid BOOLEAN DEFAULT false,
  paid_date TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sales_rep_id, month_year)
);

CREATE TABLE IF NOT EXISTS commission_details (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_id UUID NOT NULL REFERENCES commissions(id) ON DELETE CASCADE,
  atm_id TEXT NOT NULL,
  total_fees DECIMAL(12,2) NOT NULL DEFAULT 0,
  bitstop_fees DECIMAL(12,2) NOT NULL DEFAULT 0,
  rent DECIMAL(12,2) NOT NULL DEFAULT 0,
  cash_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_profit DECIMAL(12,2) NOT NULL DEFAULT 0,
  commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all operations on commissions" ON commissions;
CREATE POLICY "Allow all operations on commissions" ON commissions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all operations on commission_details" ON commission_details;
CREATE POLICY "Allow all operations on commission_details" ON commission_details FOR ALL USING (true) WITH CHECK (true);
