-- ============================================================
-- RESET: Drop all VTC Scorecard objects before re-creating
-- Run this FIRST, then run 001_initial_schema.sql
-- ============================================================

-- Drop storage policies (bucket itself must be deleted via Storage API/dashboard, not SQL)
DROP POLICY IF EXISTS storage_uploads_insert ON storage.objects;
DROP POLICY IF EXISTS storage_uploads_select ON storage.objects;

-- Drop scoring function
DROP FUNCTION IF EXISTS calculate_scores(DATE, DATE);

-- Drop RLS policies
DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_update_self ON profiles;
DROP POLICY IF EXISTS profiles_update_admin ON profiles;
DROP POLICY IF EXISTS cat_select ON vendor_categories;
DROP POLICY IF EXISTS vendors_select ON vendors;
DROP POLICY IF EXISTS aliases_select ON vendor_aliases;
DROP POLICY IF EXISTS communities_select ON communities;
DROP POLICY IF EXISTS files_select ON uploaded_files;
DROP POLICY IF EXISTS batches_select ON import_batches;
DROP POLICY IF EXISTS raw_select ON raw_import_rows;
DROP POLICY IF EXISTS schedule_select ON schedule_records;
DROP POLICY IF EXISTS safety_select ON safety_records;
DROP POLICY IF EXISTS rework_select ON rework_records;
DROP POLICY IF EXISTS safety_rules_select ON safety_severity_rules;
DROP POLICY IF EXISTS rework_rules_select ON rework_severity_rules;
DROP POLICY IF EXISTS feedback_rules_select ON feedback_point_rules;
DROP POLICY IF EXISTS config_select ON system_config;
DROP POLICY IF EXISTS weights_select ON score_weights;
DROP POLICY IF EXISTS scores_select ON score_results;
DROP POLICY IF EXISTS snapshots_select ON snapshots;
DROP POLICY IF EXISTS snap_scores_select ON snapshot_score_results;
DROP POLICY IF EXISTS snap_weights_select ON snapshot_weights;
DROP POLICY IF EXISTS snap_files_select ON snapshot_file_refs;
DROP POLICY IF EXISTS activity_select ON activity_log;
DROP POLICY IF EXISTS vendors_insert ON vendors;
DROP POLICY IF EXISTS vendors_update ON vendors;
DROP POLICY IF EXISTS vendors_delete ON vendors;
DROP POLICY IF EXISTS aliases_insert ON vendor_aliases;
DROP POLICY IF EXISTS aliases_upsert ON vendor_aliases;
DROP POLICY IF EXISTS communities_insert ON communities;
DROP POLICY IF EXISTS communities_update ON communities;
DROP POLICY IF EXISTS files_insert ON uploaded_files;
DROP POLICY IF EXISTS batches_insert ON import_batches;
DROP POLICY IF EXISTS batches_update ON import_batches;
DROP POLICY IF EXISTS raw_insert ON raw_import_rows;
DROP POLICY IF EXISTS schedule_insert ON schedule_records;
DROP POLICY IF EXISTS safety_insert ON safety_records;
DROP POLICY IF EXISTS rework_insert ON rework_records;
DROP POLICY IF EXISTS weights_update ON score_weights;
DROP POLICY IF EXISTS scores_all ON score_results;
DROP POLICY IF EXISTS snapshots_insert ON snapshots;
DROP POLICY IF EXISTS snapshots_delete ON snapshots;
DROP POLICY IF EXISTS snap_scores_insert ON snapshot_score_results;
DROP POLICY IF EXISTS snap_weights_insert ON snapshot_weights;
DROP POLICY IF EXISTS snap_files_insert ON snapshot_file_refs;
DROP POLICY IF EXISTS activity_insert ON activity_log;
DROP POLICY IF EXISTS safety_rules_modify ON safety_severity_rules;
DROP POLICY IF EXISTS rework_rules_modify ON rework_severity_rules;
DROP POLICY IF EXISTS feedback_rules_modify ON feedback_point_rules;
DROP POLICY IF EXISTS config_modify ON system_config;
DROP POLICY IF EXISTS cat_modify ON vendor_categories;
DROP POLICY IF EXISTS feedback_builder_insert ON builder_feedback;
DROP POLICY IF EXISTS feedback_builder_select ON builder_feedback;
DROP POLICY IF EXISTS feedback_staff_update ON builder_feedback;

-- Drop helper functions
DROP FUNCTION IF EXISTS get_user_role();
DROP FUNCTION IF EXISTS is_admin();

-- Drop trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user();

-- Drop tables in dependency order
DROP TABLE IF EXISTS snapshot_file_refs CASCADE;
DROP TABLE IF EXISTS snapshot_weights CASCADE;
DROP TABLE IF EXISTS snapshot_score_results CASCADE;
DROP TABLE IF EXISTS snapshots CASCADE;
DROP TABLE IF EXISTS activity_log CASCADE;
DROP TABLE IF EXISTS score_results CASCADE;
DROP TABLE IF EXISTS score_weights CASCADE;
DROP TABLE IF EXISTS system_config CASCADE;
DROP TABLE IF EXISTS feedback_point_rules CASCADE;
DROP TABLE IF EXISTS rework_severity_rules CASCADE;
DROP TABLE IF EXISTS safety_severity_rules CASCADE;
DROP TABLE IF EXISTS builder_feedback CASCADE;
DROP TABLE IF EXISTS rework_records CASCADE;
DROP TABLE IF EXISTS safety_records CASCADE;
DROP TABLE IF EXISTS schedule_records CASCADE;
DROP TABLE IF EXISTS raw_import_rows CASCADE;
DROP TABLE IF EXISTS import_batches CASCADE;
DROP TABLE IF EXISTS uploaded_files CASCADE;
DROP TABLE IF EXISTS communities CASCADE;
DROP TABLE IF EXISTS vendor_aliases CASCADE;
DROP TABLE IF EXISTS vendors CASCADE;
DROP TABLE IF EXISTS vendor_categories CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Drop enum types
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS upload_file_type CASCADE;
DROP TYPE IF EXISTS import_status CASCADE;
DROP TYPE IF EXISTS feedback_category CASCADE;
DROP TYPE IF EXISTS feedback_severity CASCADE;
DROP TYPE IF EXISTS safety_severity_type CASCADE;
DROP TYPE IF EXISTS rework_severity_type CASCADE;
