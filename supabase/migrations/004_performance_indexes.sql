-- Performance indexes for common filter/join patterns
CREATE INDEX IF NOT EXISTS idx_vca_community_id ON vendor_community_assignments(community_id);
CREATE INDEX IF NOT EXISTS idx_snap_scores_vendor_id ON snapshot_score_results(vendor_id);
CREATE INDEX IF NOT EXISTS idx_builder_feedback_submitted_at ON builder_feedback(submitted_at DESC);
