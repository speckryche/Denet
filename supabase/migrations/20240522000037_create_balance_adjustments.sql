-- Manual balance adjustments for per-person cash on hand.
-- Used in the rare case where a person's tracked balance diverges from physical cash.
-- Adjustments are first-class rows (not synthetic pickups/deposits), editable and hard-deletable.
-- A trigger-driven history table preserves snapshots across insert/update/delete for compliance audit.

-- ---------------------------------------------------------------------------
-- 1. balance_adjustments — live table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS balance_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id       UUID NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  delta_amount    NUMERIC(12,2) NOT NULL CHECK (delta_amount <> 0),
  reason          TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  effective_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_adjustments_person_id      ON balance_adjustments(person_id);
CREATE INDEX IF NOT EXISTS idx_balance_adjustments_effective_date ON balance_adjustments(effective_date);

ALTER TABLE balance_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON balance_adjustments FOR ALL USING (true);

-- ---------------------------------------------------------------------------
-- 2. balance_adjustment_history — audit table
-- ON DELETE SET NULL on adjustment_id: when an adjustment is hard-deleted,
-- prior history rows survive with adjustment_id = NULL. The snapshot fields
-- preserve the full record content for compliance, even though FK lookups
-- against the deleted parent no longer resolve.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS balance_adjustment_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id   UUID REFERENCES balance_adjustments(id) ON DELETE SET NULL,
  person_id       UUID NOT NULL,
  delta_amount    NUMERIC(12,2) NOT NULL,
  reason          TEXT NOT NULL,
  effective_date  DATE NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by      UUID
);

CREATE INDEX IF NOT EXISTS idx_balance_adjustment_history_adjustment_id ON balance_adjustment_history(adjustment_id);
CREATE INDEX IF NOT EXISTS idx_balance_adjustment_history_person_id     ON balance_adjustment_history(person_id);
CREATE INDEX IF NOT EXISTS idx_balance_adjustment_history_changed_at    ON balance_adjustment_history(changed_at);

ALTER TABLE balance_adjustment_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON balance_adjustment_history FOR ALL USING (true);

-- ---------------------------------------------------------------------------
-- 3. Trigger function — snapshot every change into history
-- INSERT/UPDATE write NEW values (forward timeline reconstruction).
-- DELETE writes OLD values tagged 'delete' as a final snapshot.
-- Note: BEFORE DELETE runs before ON DELETE SET NULL fires on prior history
-- rows, so the new 'delete' row is inserted while adjustment_id still resolves;
-- the SET NULL then sweeps ALL history rows for that adjustment (including the
-- new one) to NULL. That's the intended behavior — content preserved, FK gone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_balance_adjustment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO balance_adjustment_history (
      adjustment_id, person_id, delta_amount, reason, effective_date, action, changed_by
    ) VALUES (
      NEW.id, NEW.person_id, NEW.delta_amount, NEW.reason, NEW.effective_date, 'insert', auth.uid()
    );
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    NEW.updated_at := NOW();
    INSERT INTO balance_adjustment_history (
      adjustment_id, person_id, delta_amount, reason, effective_date, action, changed_by
    ) VALUES (
      NEW.id, NEW.person_id, NEW.delta_amount, NEW.reason, NEW.effective_date, 'update', auth.uid()
    );
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO balance_adjustment_history (
      adjustment_id, person_id, delta_amount, reason, effective_date, action, changed_by
    ) VALUES (
      OLD.id, OLD.person_id, OLD.delta_amount, OLD.reason, OLD.effective_date, 'delete', auth.uid()
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_balance_adjustments_after_insert
  AFTER INSERT ON balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION log_balance_adjustment_change();

CREATE TRIGGER trg_balance_adjustments_before_update
  BEFORE UPDATE ON balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION log_balance_adjustment_change();

CREATE TRIGGER trg_balance_adjustments_before_delete
  BEFORE DELETE ON balance_adjustments
  FOR EACH ROW EXECUTE FUNCTION log_balance_adjustment_change();

-- ---------------------------------------------------------------------------
-- 4. apply_target_adjustment — atomic target→delta resolution
-- The form accepts a target total. To avoid a read-then-write race where a
-- pickup or deposit lands between snapshot and insert, we re-read the live
-- balance inside the transaction and resolve delta atomically.
-- A row-level lock on people serializes concurrent target adjustments for the
-- same person; pickups/deposits being inserted in parallel transactions will
-- not be visible in this snapshot (READ COMMITTED), but the resulting delta
-- always reflects a self-consistent committed view at write time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_target_adjustment(
  p_person_id      UUID,
  p_target_total   NUMERIC,
  p_reason         TEXT,
  p_effective_date DATE DEFAULT CURRENT_DATE
)
RETURNS balance_adjustments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pickup_balance NUMERIC := 0;
  v_adj_total      NUMERIC := 0;
  v_current        NUMERIC := 0;
  v_delta          NUMERIC;
  v_row            balance_adjustments;
BEGIN
  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'person_id is required';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;
  IF p_target_total IS NULL THEN
    RAISE EXCEPTION 'target_total is required';
  END IF;

  -- Serialize concurrent target adjustments for the same person
  PERFORM 1 FROM people WHERE id = p_person_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'person % not found', p_person_id;
  END IF;

  -- Mirror fetchCashInTransit: sum per-pickup remainder, floor each at 0
  SELECT COALESCE(SUM(GREATEST(0, p.amount - COALESCE(linked.total, 0))), 0)
    INTO v_pickup_balance
    FROM cash_pickups p
    LEFT JOIN (
      SELECT pickup_id, SUM(amount) AS total
        FROM deposit_pickup_links
        GROUP BY pickup_id
    ) linked ON linked.pickup_id = p.id
   WHERE p.person_id = p_person_id;

  -- Existing adjustments effective as of today (matches the UI's "current balance" semantics).
  -- The new adjustment's own effective_date does not affect this resolution — delta is
  -- computed against the balance the user is looking at right now.
  SELECT COALESCE(SUM(delta_amount), 0)
    INTO v_adj_total
    FROM balance_adjustments
   WHERE person_id = p_person_id
     AND effective_date <= CURRENT_DATE;

  v_current := v_pickup_balance + v_adj_total;
  v_delta   := ROUND((p_target_total - v_current)::numeric, 2);

  IF ABS(v_delta) < 0.005 THEN
    RAISE EXCEPTION 'Target balance ($%) equals current balance ($%) — no adjustment needed',
      p_target_total, v_current
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO balance_adjustments (person_id, delta_amount, reason, effective_date)
  VALUES (p_person_id, v_delta, p_reason, p_effective_date)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION apply_target_adjustment(UUID, NUMERIC, TEXT, DATE) TO authenticated;
