-- 014_rls_performance.sql
-- Performance-only RLS rewrite. NO change to who-can-do-what — only how the
-- policy expressions are evaluated. Addresses two Supabase performance advisors:
--
--   1. auth_rls_initplan (29 policies): `auth.uid()` (and the STABLE helpers
--      is_admin()/get_user_role()) were re-evaluated once PER ROW. Wrapping them
--      in a scalar subquery — (select auth.uid()) — makes Postgres evaluate them
--      ONCE per statement as an InitPlan. Identical result, far less work.
--
--   2. multiple_permissive_policies (37 findings): every table that had a broad
--      `FOR ALL` write policy plus a dedicated `FOR SELECT` policy was running
--      BOTH permissive policies on every SELECT. Splitting the ALL policy into
--      command-specific INSERT/UPDATE/DELETE policies removes the redundant
--      SELECT branch. Staff/admins still read through the dedicated select
--      policy (they are authenticated), so visibility is unchanged. The two
--      profiles UPDATE policies are merged into one OR'd policy.
--
-- Semantics check for splitting `FOR ALL ... USING (X)` with no WITH CHECK:
--   Postgres uses USING as the INSERT/UPDATE check when WITH CHECK is omitted,
--   so the split is:  INSERT WITH CHECK (X) / UPDATE USING (X) WITH CHECK (X) /
--   DELETE USING (X). This reproduces the ALL policy exactly for writes.

-- ============================================================================
-- PART A — init-plan fix for standalone SELECT/INSERT policies (wrap only)
-- ============================================================================

DROP POLICY IF EXISTS activity_select ON public.activity_log;
CREATE POLICY activity_select ON public.activity_log
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS activity_insert ON public.activity_log;
CREATE POLICY activity_insert ON public.activity_log
  FOR INSERT TO public WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS bca_select ON public.builder_community_assignments;
CREATE POLICY bca_select ON public.builder_community_assignments
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS feedback_builder_insert ON public.builder_feedback;
CREATE POLICY feedback_builder_insert ON public.builder_feedback
  FOR INSERT TO public WITH CHECK ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS feedback_builder_select ON public.builder_feedback;
CREATE POLICY feedback_builder_select ON public.builder_feedback
  FOR SELECT TO public USING (
    ((select get_user_role()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'viewer'::user_role]))
    OR (((select get_user_role()) = 'builder'::user_role) AND (submitted_by = (select auth.uid())))
  );

DROP POLICY IF EXISTS communities_select ON public.communities;
CREATE POLICY communities_select ON public.communities
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS batches_select ON public.import_batches;
CREATE POLICY batches_select ON public.import_batches
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS raw_select ON public.raw_import_rows;
CREATE POLICY raw_select ON public.raw_import_rows
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS rework_select ON public.rework_records;
CREATE POLICY rework_select ON public.rework_records
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS safety_select ON public.safety_records;
CREATE POLICY safety_select ON public.safety_records
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS schedule_select ON public.schedule_records;
CREATE POLICY schedule_select ON public.schedule_records
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS weights_select ON public.score_weights;
CREATE POLICY weights_select ON public.score_weights
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS snap_files_select ON public.snapshot_file_refs;
CREATE POLICY snap_files_select ON public.snapshot_file_refs
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS snap_scores_select ON public.snapshot_score_results;
CREATE POLICY snap_scores_select ON public.snapshot_score_results
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS snap_weights_select ON public.snapshot_weights;
CREATE POLICY snap_weights_select ON public.snapshot_weights
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS snapshots_select ON public.snapshots;
CREATE POLICY snapshots_select ON public.snapshots
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS files_select ON public.uploaded_files;
CREATE POLICY files_select ON public.uploaded_files
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS aliases_select ON public.vendor_aliases;
CREATE POLICY aliases_select ON public.vendor_aliases
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS vendors_select ON public.vendors;
CREATE POLICY vendors_select ON public.vendors
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

-- ============================================================================
-- PART B — profiles: init-plan fix + merge two UPDATE policies into one
-- ============================================================================

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);

-- Was: profiles_update_self USING (id = auth.uid())
--      profiles_update_admin USING (is_admin())  -> two permissive UPDATE policies
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO public
  USING ((id = (select auth.uid())) OR (select is_admin()));

-- ============================================================================
-- PART C — split FOR ALL write policies (removes the SELECT-overlap finding).
--           The dedicated *_select policy above remains the only SELECT policy.
-- ============================================================================

-- feedback_point_rules (was feedback_rules_modify FOR ALL is_admin())
DROP POLICY IF EXISTS feedback_rules_select ON public.feedback_point_rules;
CREATE POLICY feedback_rules_select ON public.feedback_point_rules
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS feedback_rules_modify ON public.feedback_point_rules;
CREATE POLICY feedback_rules_insert ON public.feedback_point_rules
  FOR INSERT TO public WITH CHECK ((select is_admin()));
CREATE POLICY feedback_rules_update ON public.feedback_point_rules
  FOR UPDATE TO public USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY feedback_rules_delete ON public.feedback_point_rules
  FOR DELETE TO public USING ((select is_admin()));

-- rework_severity_rules (was rework_rules_modify FOR ALL is_admin())
DROP POLICY IF EXISTS rework_rules_select ON public.rework_severity_rules;
CREATE POLICY rework_rules_select ON public.rework_severity_rules
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS rework_rules_modify ON public.rework_severity_rules;
CREATE POLICY rework_rules_insert ON public.rework_severity_rules
  FOR INSERT TO public WITH CHECK ((select is_admin()));
CREATE POLICY rework_rules_update ON public.rework_severity_rules
  FOR UPDATE TO public USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY rework_rules_delete ON public.rework_severity_rules
  FOR DELETE TO public USING ((select is_admin()));

-- safety_severity_rules (was safety_rules_modify FOR ALL is_admin())
DROP POLICY IF EXISTS safety_rules_select ON public.safety_severity_rules;
CREATE POLICY safety_rules_select ON public.safety_severity_rules
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS safety_rules_modify ON public.safety_severity_rules;
CREATE POLICY safety_rules_insert ON public.safety_severity_rules
  FOR INSERT TO public WITH CHECK ((select is_admin()));
CREATE POLICY safety_rules_update ON public.safety_severity_rules
  FOR UPDATE TO public USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY safety_rules_delete ON public.safety_severity_rules
  FOR DELETE TO public USING ((select is_admin()));

-- system_config (was config_modify FOR ALL is_admin())
DROP POLICY IF EXISTS config_select ON public.system_config;
CREATE POLICY config_select ON public.system_config
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS config_modify ON public.system_config;
CREATE POLICY config_insert ON public.system_config
  FOR INSERT TO public WITH CHECK ((select is_admin()));
CREATE POLICY config_update ON public.system_config
  FOR UPDATE TO public USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY config_delete ON public.system_config
  FOR DELETE TO public USING ((select is_admin()));

-- vendor_categories (was cat_modify FOR ALL is_admin())
DROP POLICY IF EXISTS cat_select ON public.vendor_categories;
CREATE POLICY cat_select ON public.vendor_categories
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS cat_modify ON public.vendor_categories;
CREATE POLICY cat_insert ON public.vendor_categories
  FOR INSERT TO public WITH CHECK ((select is_admin()));
CREATE POLICY cat_update ON public.vendor_categories
  FOR UPDATE TO public USING ((select is_admin())) WITH CHECK ((select is_admin()));
CREATE POLICY cat_delete ON public.vendor_categories
  FOR DELETE TO public USING ((select is_admin()));

-- score_results (was scores_all FOR ALL staff)
DROP POLICY IF EXISTS scores_select ON public.score_results;
CREATE POLICY scores_select ON public.score_results
  FOR SELECT TO public USING ((select auth.uid()) IS NOT NULL);
DROP POLICY IF EXISTS scores_all ON public.score_results;
CREATE POLICY scores_insert ON public.score_results
  FOR INSERT TO public
  WITH CHECK ((select get_user_role()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role]));
CREATE POLICY scores_update ON public.score_results
  FOR UPDATE TO public
  USING ((select get_user_role()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role]))
  WITH CHECK ((select get_user_role()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role]));
CREATE POLICY scores_delete ON public.score_results
  FOR DELETE TO public
  USING ((select get_user_role()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role]));

-- vendor_brand_references (keep "auth read"; split "auth write" FOR ALL staff)
DROP POLICY IF EXISTS "auth write vendor_brand_references" ON public.vendor_brand_references;
CREATE POLICY vbr_insert ON public.vendor_brand_references
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles
    WHERE profiles.id = (select auth.uid())
      AND profiles.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role])));
CREATE POLICY vbr_update ON public.vendor_brand_references
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles
    WHERE profiles.id = (select auth.uid())
      AND profiles.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles
    WHERE profiles.id = (select auth.uid())
      AND profiles.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role])));
CREATE POLICY vbr_delete ON public.vendor_brand_references
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles
    WHERE profiles.id = (select auth.uid())
      AND profiles.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role])));

-- vendor_community_assignments (keep "auth read"; split "auth write" FOR ALL staff)
DROP POLICY IF EXISTS "auth write vendor_community_assignments" ON public.vendor_community_assignments;
CREATE POLICY vca_insert ON public.vendor_community_assignments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles
    WHERE profiles.id = (select auth.uid())
      AND profiles.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role])));
CREATE POLICY vca_update ON public.vendor_community_assignments
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles
    WHERE profiles.id = (select auth.uid())
      AND profiles.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role])))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles
    WHERE profiles.id = (select auth.uid())
      AND profiles.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role])));
CREATE POLICY vca_delete ON public.vendor_community_assignments
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles
    WHERE profiles.id = (select auth.uid())
      AND profiles.role = ANY (ARRAY['admin'::user_role, 'manager'::user_role])));
