-- 002_remove_builder_role.sql
-- The "builder" role has been retired. Viewers now have read-only access to
-- everything except the Admin panel, and can submit their own feedback.
--
-- Run this in the Supabase SQL editor. It reassigns any existing builder
-- accounts to "viewer". We intentionally do NOT drop the 'builder' enum value
-- from user_role — removing an enum value in Postgres requires recreating the
-- type and all dependent columns/policies, which is risky. Leaving the unused
-- value in place is harmless; the application no longer assigns or checks it.

UPDATE profiles SET role = 'viewer' WHERE role = 'builder';

-- The feedback_builder_select RLS policy still references the 'builder' role.
-- It is now a dead branch (no users have that role) but remains valid SQL, so
-- no policy change is required. Viewers already match the admin/manager/viewer
-- branch of that policy and can read all feedback.
