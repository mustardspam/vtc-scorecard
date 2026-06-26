-- Fix merge_vendors: repoint JC data, avoid rename collisions on vendors_name_key

CREATE OR REPLACE FUNCTION merge_vendors(p_duplicate_id UUID, p_survivor_id UUID)
RETURNS void AS $$
DECLARE
  v_duplicate vendors;
  v_survivor vendors;
  v_retired_name TEXT;
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

  UPDATE schedule_records SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;
  UPDATE safety_records SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;
  UPDATE rework_records SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;
  UPDATE builder_feedback SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;

  UPDATE vendor_aliases SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;

  -- Repoint JC brand refs; drop rows that would duplicate survivor's existing refs
  DELETE FROM vendor_brand_references dup
  WHERE dup.vendor_id = p_duplicate_id
    AND EXISTS (
      SELECT 1 FROM vendor_brand_references existing
      WHERE existing.vendor_id = p_survivor_id
        AND existing.brand = dup.brand
        AND existing.jc_vendor_id = dup.jc_vendor_id
    );
  UPDATE vendor_brand_references SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;

  -- Repoint community assignments; drop rows the survivor already has
  DELETE FROM vendor_community_assignments dup
  WHERE dup.vendor_id = p_duplicate_id
    AND EXISTS (
      SELECT 1 FROM vendor_community_assignments existing
      WHERE existing.vendor_id = p_survivor_id
        AND existing.community_id = dup.community_id
        AND existing.cost_code = dup.cost_code
    );
  UPDATE vendor_community_assignments SET vendor_id = p_survivor_id WHERE vendor_id = p_duplicate_id;

  INSERT INTO vendor_aliases (alias_name, vendor_id, created_by)
  VALUES (v_duplicate.name, p_survivor_id, v_survivor.created_by)
  ON CONFLICT (alias_name) DO UPDATE SET vendor_id = p_survivor_id;

  -- Use a UUID fragment so repeated merges into the same survivor never collide
  v_retired_name := left(v_duplicate.name, 200) || ' [merged ' || left(p_duplicate_id::text, 8) || ']';
  IF EXISTS (SELECT 1 FROM vendors WHERE name = v_retired_name AND id <> p_duplicate_id) THEN
    v_retired_name := left(v_duplicate.name, 180) || ' [merged ' || left(p_duplicate_id::text, 13) || ']';
  END IF;

  UPDATE vendors
  SET name = v_retired_name,
      is_active = false,
      merged_into = p_survivor_id,
      updated_at = now()
  WHERE id = p_duplicate_id;

  PERFORM calculate_scores();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION merge_vendors(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION merge_vendors(UUID, UUID) TO authenticated;
