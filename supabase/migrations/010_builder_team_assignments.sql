-- Builder team assignments: ACM hierarchy + builder ↔ community links

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS acm_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_builder BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_acm_id ON profiles(acm_id) WHERE acm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_is_builder ON profiles(is_builder) WHERE is_builder = true;

CREATE TABLE IF NOT EXISTS builder_community_assignments (
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  community_id UUID NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  assignment_type TEXT NOT NULL DEFAULT 'primary'
    CHECK (assignment_type IN ('primary', 'secondary')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, community_id)
);

CREATE INDEX IF NOT EXISTS idx_bca_community_id ON builder_community_assignments(community_id);
CREATE INDEX IF NOT EXISTS idx_bca_profile_id ON builder_community_assignments(profile_id);

ALTER TABLE builder_community_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY bca_select ON builder_community_assignments
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY bca_insert_admin ON builder_community_assignments
  FOR INSERT WITH CHECK (is_admin());

CREATE POLICY bca_update_admin ON builder_community_assignments
  FOR UPDATE USING (is_admin());

CREATE POLICY bca_delete_admin ON builder_community_assignments
  FOR DELETE USING (is_admin());
