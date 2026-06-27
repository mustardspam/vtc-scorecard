-- Repoint JC brand references left on merged (inactive) vendors onto their survivor.
-- This happens when AW/SL duplicates were consolidated outside merge_vendors(),
-- leaving Starlight IDs on the retired row while Ashton Woods IDs stay on the survivor.

UPDATE vendor_brand_references vbr
SET vendor_id = v.merged_into
FROM vendors v
WHERE vbr.vendor_id = v.id
  AND v.merged_into IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vendor_brand_references existing
    WHERE existing.vendor_id = v.merged_into
      AND existing.brand = vbr.brand
      AND existing.jc_vendor_id = vbr.jc_vendor_id
  );

-- Drop redundant refs on merged vendors when the survivor already has the same brand + JC ID.
DELETE FROM vendor_brand_references vbr
USING vendors v
WHERE vbr.vendor_id = v.id
  AND v.merged_into IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM vendor_brand_references existing
    WHERE existing.vendor_id = v.merged_into
      AND existing.brand = vbr.brand
      AND existing.jc_vendor_id = vbr.jc_vendor_id
  );
