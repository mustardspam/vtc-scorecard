-- Merge JC-import duplicate communities (full column header stored as code)
-- into canonical short-code rows created by community reference / corrected JC imports.

CREATE TEMP TABLE community_dup_map ON COMMIT DROP AS
SELECT
  dup.id AS dup_id,
  canon.id AS canonical_id
FROM communities dup
JOIN communities canon ON canon.code = split_part(dup.code, ' ', 1)
WHERE dup.code = dup.name
  AND dup.code LIKE '% %'
  AND NOT (canon.code = canon.name AND canon.code LIKE '% %');

-- Preserve map config from duplicates when canonical row lacks it
UPDATE communities canon
SET
  lat = COALESCE(canon.lat, dup.lat),
  lng = COALESCE(canon.lng, dup.lng),
  area_manager_id = COALESCE(canon.area_manager_id, dup.area_manager_id)
FROM community_dup_map m
JOIN communities dup ON dup.id = m.dup_id
WHERE canon.id = m.canonical_id;

-- vendor_community_assignments: drop dup rows that already exist on canonical community
DELETE FROM vendor_community_assignments vca_dup
USING community_dup_map m,
      vendor_community_assignments vca_canon
WHERE vca_dup.community_id = m.dup_id
  AND vca_canon.community_id = m.canonical_id
  AND vca_dup.vendor_id = vca_canon.vendor_id
  AND vca_dup.cost_code = vca_canon.cost_code;

UPDATE vendor_community_assignments vca
SET community_id = m.canonical_id
FROM community_dup_map m
WHERE vca.community_id = m.dup_id;

UPDATE builder_feedback bf
SET community_id = m.canonical_id
FROM community_dup_map m
WHERE bf.community_id = m.dup_id;

UPDATE schedule_records sr
SET community_id = m.canonical_id
FROM community_dup_map m
WHERE sr.community_id = m.dup_id;

UPDATE safety_records sr
SET community_id = m.canonical_id
FROM community_dup_map m
WHERE sr.community_id = m.dup_id;

UPDATE rework_records rr
SET community_id = m.canonical_id
FROM community_dup_map m
WHERE rr.community_id = m.dup_id;

DELETE FROM communities c
USING community_dup_map m
WHERE c.id = m.dup_id;
