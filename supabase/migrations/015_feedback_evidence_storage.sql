-- ============================================================
-- 015: Storage DELETE policy for builder-feedback evidence
-- ============================================================
-- Builder feedback can now carry photo/PDF evidence, uploaded to the
-- private `uploads` bucket under `feedback/<user_id>/...`. The submit flow
-- cleans up already-uploaded files if the feedback insert fails, so the
-- uploader needs permission to delete their own objects. INSERT + SELECT
-- policies already exist (001_initial_schema.sql); this adds DELETE, scoped
-- to objects the user owns within the feedback/ prefix.

DROP POLICY IF EXISTS storage_uploads_delete_own_feedback ON storage.objects;

CREATE POLICY storage_uploads_delete_own_feedback ON storage.objects FOR DELETE USING (
  bucket_id = 'uploads'
  AND owner = auth.uid()
  AND name LIKE 'feedback/' || auth.uid()::text || '/%'
);
