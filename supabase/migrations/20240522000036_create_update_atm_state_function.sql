-- Phase 3: atomic state-change RPC for the multi-row atm_profiles model.
-- Closes the currently-active profile (with FOR UPDATE lock) and inserts a
-- new one in a single transaction, so the EXCLUDE constraint never sees a
-- half-applied state. For 'retire', no new row is created.

CREATE OR REPLACE FUNCTION update_atm_state(
  p_atm_id text,
  p_effective_date date,
  p_action text,                              -- 'relocate' | 'convert' | 'both' | 'retire'
  p_location_name text DEFAULT NULL,
  p_street_address text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_zip_code text DEFAULT NULL,
  p_platform text DEFAULT NULL,
  p_monthly_rent numeric DEFAULT NULL,
  p_cash_management_rps numeric DEFAULT NULL,
  p_cash_management_rep numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current atm_profiles%ROWTYPE;
  v_new_id  uuid;
BEGIN
  IF p_atm_id IS NULL OR TRIM(p_atm_id) = '' THEN
    RAISE EXCEPTION 'atm_id is required';
  END IF;

  IF p_action NOT IN ('relocate', 'convert', 'both', 'retire') THEN
    RAISE EXCEPTION 'invalid action: %', p_action;
  END IF;

  -- Lock the current active profile
  SELECT * INTO v_current
  FROM atm_profiles
  WHERE atm_id = p_atm_id AND active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active profile for atm_id %', p_atm_id;
  END IF;

  IF v_current.installed_date IS NOT NULL AND p_effective_date <= v_current.installed_date THEN
    RAISE EXCEPTION 'effective_date (%) must be after current profile installed_date (%)',
      p_effective_date, v_current.installed_date;
  END IF;

  IF p_action IN ('convert', 'both') THEN
    IF p_platform IS NULL OR p_platform NOT IN ('denet', 'bitstop') THEN
      RAISE EXCEPTION 'platform must be ''denet'' or ''bitstop'' for convert/both';
    END IF;
    IF p_platform = v_current.platform THEN
      RAISE EXCEPTION 'new platform (%) must differ from current (%)', p_platform, v_current.platform;
    END IF;
  END IF;

  IF p_action IN ('relocate', 'both') THEN
    IF p_location_name IS NULL OR TRIM(p_location_name) = '' THEN
      RAISE EXCEPTION 'location_name is required for relocate/both';
    END IF;
  END IF;

  -- Retire: close current row only; no new profile.
  -- Notes (if provided) go onto the closed profile as the "last word".
  IF p_action = 'retire' THEN
    UPDATE atm_profiles
       SET removed_date = p_effective_date,
           active = false,
           notes = COALESCE(p_notes, notes),
           updated_at = NOW()
     WHERE id = v_current.id;

    RETURN jsonb_build_object(
      'closed_profile_id', v_current.id,
      'new_profile_id', NULL
    );
  END IF;

  -- Non-retire: close current profile (removed_date = day before new
  -- profile's installed_date, preserving the EXCLUDE no-overlap invariant).
  UPDATE atm_profiles
     SET removed_date = p_effective_date - INTERVAL '1 day',
         active = false,
         updated_at = NOW()
   WHERE id = v_current.id;

  -- Insert the new profile, inheriting from the closed one unless overridden.
  -- Notes (if provided) go onto the NEW profile as forward-looking context.
  INSERT INTO atm_profiles (
    atm_id, serial_number, location_name, platform, active,
    monthly_rent, rent_payment_method, cash_management_rps, cash_management_rep,
    street_address, city, state, zip_code,
    installed_date, warehouse_location,
    on_bitstop, on_coinradar, sales_rep_id, notes
  ) VALUES (
    v_current.atm_id,
    v_current.serial_number,
    COALESCE(p_location_name, v_current.location_name),
    COALESCE(p_platform, v_current.platform),
    true,
    COALESCE(p_monthly_rent, v_current.monthly_rent),
    v_current.rent_payment_method,
    COALESCE(p_cash_management_rps, v_current.cash_management_rps),
    COALESCE(p_cash_management_rep, v_current.cash_management_rep),
    COALESCE(p_street_address, v_current.street_address),
    COALESCE(p_city, v_current.city),
    COALESCE(p_state, v_current.state),
    COALESCE(p_zip_code, v_current.zip_code),
    p_effective_date,
    v_current.warehouse_location,
    v_current.on_bitstop,
    v_current.on_coinradar,
    v_current.sales_rep_id,
    p_notes
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'closed_profile_id', v_current.id,
    'new_profile_id', v_new_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION update_atm_state(
  text, date, text, text, text, text, text, text, text, numeric, numeric, numeric, text
) TO authenticated;
