-- ============================================================
-- VENDOR MERGE
-- Lets admins/managers fold a duplicate vendor (e.g. the same
-- company registered separately under two builder brands) into
-- a single surviving vendor: repoints all historical records,
-- seeds an alias so future imports auto-match, and recalculates
-- scores in one transaction.
-- ============================================================

ALTER TABLE vendors ADD COLUMN merged_into UUID REFERENCES vendors(id);

CREATE OR REPLACE FUNCTION merge_vendors(p_duplicate_id UUID, p_survivor_id UUID)
RETURNS void AS $$
DECLARE
  v_duplicate vendors;
  v_survivor vendors;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() IS NULL OR get_user_role() NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Not authorized to merge vendors';
  END IF;

  IF p_duplicate_id = p_survivor_id THEN
    RAISE EXCEPTION 'Cannot merge a vendor into itself';
  END IF;

  SELECT * INTO v_duplicate FROM vendors WHERE id = p_duplicate_id;
  SELECT * INTO v_survivor FROM vendors WHERE id = p_survivor_id;

  IF v_duplicate IS NULL OR v_survivor IS NULL THEN
    RAISE EXCEPTION 'Vendor not found';
  END IF;

  -- Repoint all historical records onto the survivor
  UPDATE schedule_records SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;
  UPDATE safety_records SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;
  UPDATE rework_records SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;
  UPDATE builder_feedback SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;

  -- Repoint any existing aliases that pointed at the duplicate
  UPDATE vendor_aliases SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;

  -- Seed an alias for the duplicate's own name so future imports
  -- using that exact string auto-match to the survivor.
  INSERT INTO vendor_aliases (alias_name, vendor_id, created_by)
  VALUES (v_duplicate.name, p_survivor_id, v_survivor.created_by)
  ON CONFLICT (alias_name) DO UPDATE SET vendor_id = p_survivor_id;

  -- Retire the duplicate. Renaming frees its old name from ever
  -- winning the matcher's exact-name step again (alias lookup
  -- runs first, but this closes the gap if it's ever bypassed).
  UPDATE vendors
  SET name = v_duplicate.name || ' (merged into ' || v_survivor.name || ')',
      is_active = false,
      merged_into = p_survivor_id,
      updated_at = now()
  WHERE id = p_duplicate_id;

  PERFORM calculate_scores();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION merge_vendors(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION merge_vendors(UUID, UUID) TO authenticated;
