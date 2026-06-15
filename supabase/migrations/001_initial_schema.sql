-- ============================================================
-- VTC SCORECARD — FULL DATABASE SCHEMA
-- Run this in the Supabase SQL Editor
-- ============================================================

-- ENUM TYPES
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'viewer', 'builder');
CREATE TYPE upload_file_type AS ENUM ('schedule', 'safety', 'rework', 'vendor_master', 'community_reference', 'other');
CREATE TYPE import_status AS ENUM ('pending', 'mapped', 'previewed', 'approved', 'rejected');
CREATE TYPE feedback_category AS ENUM ('kudos', 'complaint');
CREATE TYPE feedback_severity AS ENUM ('minor', 'major', 'critical');
CREATE TYPE safety_severity_type AS ENUM ('equipment', 'ppe', 'near_miss', 'first_aid', 'recordable', 'lost_time');
CREATE TYPE rework_severity_type AS ENUM ('reinspect', 'low', 'medium', 'high');

-- PROFILES
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role user_role NOT NULL DEFAULT 'viewer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_role ON profiles(role);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'viewer');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- VENDOR CATEGORIES
CREATE TABLE vendor_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO vendor_categories (name, sort_order) VALUES
  ('Painter', 1), ('Service', 2), ('SWPPP', 3), ('Grading', 4),
  ('Electrician', 5), ('HVAC', 6), ('Plumber', 7), ('Framer', 8),
  ('Insulation', 9), ('Fence', 10), ('Mirror/Glass', 11), ('Bricker', 12),
  ('Concrete', 13), ('Landscape', 14), ('Garage Door', 15), ('Cleaner', 16),
  ('Trash', 17), ('Drywall', 18), ('Roofer', 19), ('Flooring', 20),
  ('Countertops', 21), ('Cabinets', 22), ('Supplier', 23), ('Trim Carpenter', 24);

-- VENDORS
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id_legacy INTEGER,
  name TEXT NOT NULL UNIQUE,
  category_id UUID NOT NULL REFERENCES vendor_categories(id),
  is_trade BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  blacklisted BOOLEAN NOT NULL DEFAULT false,
  blacklist_reason TEXT,
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vendors_category ON vendors(category_id);
CREATE INDEX idx_vendors_active ON vendors(is_active);

-- VENDOR ALIASES (for fuzzy matching memory)
CREATE TABLE vendor_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_name TEXT NOT NULL UNIQUE,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- COMMUNITIES
CREATE TABLE communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- FILE UPLOADS
CREATE TABLE uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_type upload_file_type NOT NULL,
  file_size_bytes BIGINT,
  mime_type TEXT,
  uploaded_by UUID NOT NULL REFERENCES profiles(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_uploaded_files_type ON uploaded_files(file_type);

-- IMPORT BATCHES
CREATE TABLE import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_file_id UUID NOT NULL REFERENCES uploaded_files(id),
  file_type upload_file_type NOT NULL,
  status import_status NOT NULL DEFAULT 'pending',
  column_mapping JSONB,
  row_count INTEGER,
  valid_row_count INTEGER,
  error_row_count INTEGER,
  validation_errors JSONB,
  vendor_match_log JSONB,
  imported_by UUID NOT NULL REFERENCES profiles(id),
  approved_by UUID REFERENCES profiles(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_import_batches_status ON import_batches(status);

-- RAW IMPORT ROWS
CREATE TABLE raw_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw_data JSONB NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  validation_errors JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_raw_rows_batch ON raw_import_rows(batch_id);

-- SCHEDULE RECORDS
CREATE TABLE schedule_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id),
  vendor_id UUID REFERENCES vendors(id),
  vendor_name_raw TEXT,
  community_id UUID REFERENCES communities(id),
  period_month DATE NOT NULL,
  total_jobs INTEGER NOT NULL,
  no_shows INTEGER NOT NULL DEFAULT 0,
  adherence_pct NUMERIC(5,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_schedule_vendor ON schedule_records(vendor_id);
CREATE INDEX idx_schedule_period ON schedule_records(period_month);

-- SAFETY RECORDS
CREATE TABLE safety_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id),
  vendor_id UUID REFERENCES vendors(id),
  vendor_name_raw TEXT,
  community_id UUID REFERENCES communities(id),
  incident_date DATE,
  incident_type TEXT,
  severity TEXT NOT NULL,
  severity_points INTEGER NOT NULL,
  record_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_safety_vendor ON safety_records(vendor_id);
CREATE INDEX idx_safety_date ON safety_records(record_date);

-- REWORK RECORDS
CREATE TABLE rework_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id),
  vendor_id UUID REFERENCES vendors(id),
  vendor_name_raw TEXT,
  community_id UUID REFERENCES communities(id),
  rework_date DATE,
  description TEXT,
  cost NUMERIC(12,2) NOT NULL,
  severity TEXT NOT NULL,
  penalty_points INTEGER NOT NULL,
  lot_or_address TEXT,
  record_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rework_vendor ON rework_records(vendor_id);
CREATE INDEX idx_rework_date ON rework_records(record_date);

-- BUILDER FEEDBACK
CREATE TABLE builder_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_by UUID NOT NULL REFERENCES profiles(id),
  vendor_id UUID REFERENCES vendors(id),
  vendor_name_raw TEXT,
  community_id UUID REFERENCES communities(id),
  lot_or_address TEXT,
  category feedback_category NOT NULL,
  severity feedback_severity,
  points NUMERIC(5,2) NOT NULL,
  subject TEXT,
  description TEXT NOT NULL,
  evidence_photos JSONB,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  is_approved BOOLEAN NOT NULL DEFAULT false,
  review_notes TEXT
);
CREATE INDEX idx_feedback_vendor ON builder_feedback(vendor_id);
CREATE INDEX idx_feedback_submitted ON builder_feedback(submitted_at DESC);
CREATE INDEX idx_feedback_approved ON builder_feedback(is_approved);
CREATE INDEX idx_feedback_submitted_by ON builder_feedback(submitted_by);

-- SCORING RULES
CREATE TABLE safety_severity_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity TEXT NOT NULL UNIQUE,
  points INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO safety_severity_rules (severity, points, sort_order) VALUES
  ('equipment', 1, 1), ('ppe', 2, 2), ('near_miss', 5, 3),
  ('first_aid', 10, 4), ('recordable', 25, 5), ('lost_time', 50, 6);

CREATE TABLE rework_severity_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity TEXT NOT NULL UNIQUE,
  penalty_points INTEGER NOT NULL,
  cost_threshold_low NUMERIC(12,2),
  cost_threshold_high NUMERIC(12,2),
  sort_order INTEGER NOT NULL,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO rework_severity_rules (severity, penalty_points, cost_threshold_low, cost_threshold_high, sort_order) VALUES
  ('reinspect', 1, 0, 0, 1), ('low', 2, 0.01, 100.00, 2),
  ('medium', 5, 100.01, 250.00, 3), ('high', 10, 250.01, NULL, 4);

CREATE TABLE feedback_point_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category feedback_category NOT NULL,
  severity feedback_severity,
  points NUMERIC(5,2) NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(category, severity)
);

INSERT INTO feedback_point_rules (category, severity, points, label, sort_order) VALUES
  ('kudos', NULL, 100, 'Kudos', 1),
  ('complaint', 'minor', 85, 'Complaint - Minor', 2),
  ('complaint', 'major', 70, 'Complaint - Major', 3),
  ('complaint', 'critical', 50, 'Complaint - Critical', 4);

-- SYSTEM CONFIG
CREATE TABLE system_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_config (key, value, description) VALUES
  ('safety_multiplier', '10', 'Severity points multiplied by this before deducting from 100'),
  ('rework_multiplier', '5', 'Penalty points multiplied by this before deducting from 100');

-- SCORE WEIGHTS
CREATE TABLE score_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'current',
  safety_weight NUMERIC(5,3) NOT NULL DEFAULT 0.250,
  schedule_weight NUMERIC(5,3) NOT NULL DEFAULT 0.250,
  inspections_weight NUMERIC(5,3) NOT NULL DEFAULT 0.000,
  rework_weight NUMERIC(5,3) NOT NULL DEFAULT 0.125,
  warranty_weight NUMERIC(5,3) NOT NULL DEFAULT 0.000,
  feedback_weight NUMERIC(5,3) NOT NULL DEFAULT 0.375,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO score_weights (name, is_default, is_current, safety_weight, schedule_weight, inspections_weight, rework_weight, warranty_weight, feedback_weight)
VALUES ('Default (from Excel)', true, true, 0.250, 0.250, 0.000, 0.125, 0.000, 0.375);

-- SCORE RESULTS
CREATE TABLE score_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  category_id UUID REFERENCES vendor_categories(id),
  period_start DATE,
  period_end DATE,
  safety_score NUMERIC(5,2),
  schedule_score NUMERIC(5,2),
  inspections_score NUMERIC(5,2),
  rework_score NUMERIC(5,2),
  feedback_score NUMERIC(5,2),
  safety_incident_count INTEGER DEFAULT 0,
  schedule_total_jobs INTEGER DEFAULT 0,
  schedule_no_shows INTEGER DEFAULT 0,
  rework_count INTEGER DEFAULT 0,
  feedback_count INTEGER DEFAULT 0,
  weighted_total NUMERIC(5,2),
  overall_rank INTEGER,
  category_rank INTEGER,
  category_percentile NUMERIC(5,4),
  overall_percentile NUMERIC(5,4),
  weight_config_id UUID REFERENCES score_weights(id),
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  calculated_by UUID REFERENCES profiles(id)
);
CREATE INDEX idx_scores_vendor ON score_results(vendor_id);
CREATE INDEX idx_scores_total ON score_results(weighted_total DESC);

-- SNAPSHOTS
CREATE TABLE snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  period_start DATE,
  period_end DATE,
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_locked BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE snapshot_score_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id),
  vendor_name TEXT NOT NULL,
  category_name TEXT,
  safety_score NUMERIC(5,2),
  schedule_score NUMERIC(5,2),
  inspections_score NUMERIC(5,2),
  rework_score NUMERIC(5,2),
  feedback_score NUMERIC(5,2),
  safety_incident_count INTEGER DEFAULT 0,
  schedule_total_jobs INTEGER DEFAULT 0,
  schedule_no_shows INTEGER DEFAULT 0,
  rework_count INTEGER DEFAULT 0,
  feedback_count INTEGER DEFAULT 0,
  weighted_total NUMERIC(5,2),
  overall_rank INTEGER,
  category_rank INTEGER
);
CREATE INDEX idx_snap_scores ON snapshot_score_results(snapshot_id);

CREATE TABLE snapshot_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  safety_weight NUMERIC(5,3) NOT NULL,
  schedule_weight NUMERIC(5,3) NOT NULL,
  inspections_weight NUMERIC(5,3) NOT NULL,
  rework_weight NUMERIC(5,3) NOT NULL,
  warranty_weight NUMERIC(5,3) NOT NULL,
  feedback_weight NUMERIC(5,3) NOT NULL
);

CREATE TABLE snapshot_file_refs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  uploaded_file_id UUID NOT NULL REFERENCES uploaded_files(id),
  file_type upload_file_type,
  original_filename TEXT
);

-- ACTIVITY LOG
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_created ON activity_log(created_at DESC);
CREATE INDEX idx_activity_action ON activity_log(action_type);

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Helper functions
CREATE OR REPLACE FUNCTION get_user_role() RETURNS user_role AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  SELECT role = 'admin' FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_severity_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rework_severity_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_point_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_score_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_file_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY profiles_select ON profiles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY profiles_update_self ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY profiles_update_admin ON profiles FOR UPDATE USING (is_admin());

-- Read-all tables (authenticated users can read)
CREATE POLICY cat_select ON vendor_categories FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY vendors_select ON vendors FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY aliases_select ON vendor_aliases FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY communities_select ON communities FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY files_select ON uploaded_files FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY batches_select ON import_batches FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY raw_select ON raw_import_rows FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY schedule_select ON schedule_records FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY safety_select ON safety_records FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY rework_select ON rework_records FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY safety_rules_select ON safety_severity_rules FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY rework_rules_select ON rework_severity_rules FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY feedback_rules_select ON feedback_point_rules FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY config_select ON system_config FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY weights_select ON score_weights FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY scores_select ON score_results FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY snapshots_select ON snapshots FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY snap_scores_select ON snapshot_score_results FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY snap_weights_select ON snapshot_weights FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY snap_files_select ON snapshot_file_refs FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY activity_select ON activity_log FOR SELECT USING (auth.uid() IS NOT NULL);

-- Write policies: admin + manager
CREATE POLICY vendors_insert ON vendors FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY vendors_update ON vendors FOR UPDATE USING (get_user_role() IN ('admin', 'manager'));
CREATE POLICY vendors_delete ON vendors FOR DELETE USING (is_admin());
CREATE POLICY aliases_insert ON vendor_aliases FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY aliases_upsert ON vendor_aliases FOR UPDATE USING (get_user_role() IN ('admin', 'manager'));
CREATE POLICY communities_insert ON communities FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY communities_update ON communities FOR UPDATE USING (get_user_role() IN ('admin', 'manager'));
CREATE POLICY files_insert ON uploaded_files FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY batches_insert ON import_batches FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY batches_update ON import_batches FOR UPDATE USING (get_user_role() IN ('admin', 'manager'));
CREATE POLICY raw_insert ON raw_import_rows FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY schedule_insert ON schedule_records FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY safety_insert ON safety_records FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY rework_insert ON rework_records FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY weights_update ON score_weights FOR UPDATE USING (get_user_role() IN ('admin', 'manager'));
CREATE POLICY scores_all ON score_results FOR ALL USING (get_user_role() IN ('admin', 'manager'));
CREATE POLICY snapshots_insert ON snapshots FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY snapshots_delete ON snapshots FOR DELETE USING (is_admin());
CREATE POLICY snap_scores_insert ON snapshot_score_results FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY snap_weights_insert ON snapshot_weights FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY snap_files_insert ON snapshot_file_refs FOR INSERT WITH CHECK (get_user_role() IN ('admin', 'manager'));
CREATE POLICY activity_insert ON activity_log FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Admin-only tables
CREATE POLICY safety_rules_modify ON safety_severity_rules FOR ALL USING (is_admin());
CREATE POLICY rework_rules_modify ON rework_severity_rules FOR ALL USING (is_admin());
CREATE POLICY feedback_rules_modify ON feedback_point_rules FOR ALL USING (is_admin());
CREATE POLICY config_modify ON system_config FOR ALL USING (is_admin());
CREATE POLICY cat_modify ON vendor_categories FOR ALL USING (is_admin());

-- Builder feedback: builders can insert + read own, staff can manage all
CREATE POLICY feedback_builder_insert ON builder_feedback FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY feedback_builder_select ON builder_feedback FOR SELECT USING (
  get_user_role() IN ('admin', 'manager', 'viewer')
  OR (get_user_role() = 'builder' AND submitted_by = auth.uid())
);
CREATE POLICY feedback_staff_update ON builder_feedback FOR UPDATE USING (get_user_role() IN ('admin', 'manager'));

-- ============================================================
-- SCORING FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION calculate_scores(
  p_period_start DATE DEFAULT NULL,
  p_period_end DATE DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_weights RECORD;
  v_safety_mult NUMERIC;
  v_rework_mult NUMERIC;
BEGIN
  SELECT * INTO v_weights FROM score_weights WHERE is_current = true LIMIT 1;
  v_safety_mult := COALESCE((SELECT (value#>>'{}')::numeric FROM system_config WHERE key = 'safety_multiplier'), 10);
  v_rework_mult := COALESCE((SELECT (value#>>'{}')::numeric FROM system_config WHERE key = 'rework_multiplier'), 5);

  TRUNCATE TABLE score_results;

  INSERT INTO score_results (
    vendor_id, category_id, period_start, period_end,
    safety_score, schedule_score, rework_score, feedback_score,
    safety_incident_count, schedule_total_jobs, schedule_no_shows,
    rework_count, feedback_count, weight_config_id, calculated_at
  )
  SELECT
    v.id, v.category_id, p_period_start, p_period_end,
    CASE WHEN s.vendor_id IS NULL THEN NULL
         WHEN s.total_severity = 0 THEN 100
         ELSE GREATEST(0, 100 - (s.total_severity * v_safety_mult))
    END,
    CASE WHEN sc.avg_adherence IS NULL THEN 100
         ELSE ROUND(sc.avg_adherence * 100, 2)
    END,
    CASE WHEN r.total_penalty IS NULL THEN NULL
         ELSE GREATEST(0, 100 - (r.total_penalty * v_rework_mult))
    END,
    f.avg_points,
    COALESCE(s.cnt, 0), COALESCE(sc.total_jobs, 0), COALESCE(sc.total_noshows, 0),
    COALESCE(r.cnt, 0), COALESCE(f.cnt, 0),
    v_weights.id, now()
  FROM vendors v
  LEFT JOIN (
    SELECT vendor_id, SUM(severity_points) total_severity, COUNT(*) cnt
    FROM safety_records
    WHERE (p_period_start IS NULL OR record_date >= p_period_start)
      AND (p_period_end IS NULL OR record_date <= p_period_end)
    GROUP BY vendor_id
  ) s ON s.vendor_id = v.id
  LEFT JOIN (
    SELECT vendor_id, AVG(adherence_pct) avg_adherence, SUM(total_jobs) total_jobs, SUM(no_shows) total_noshows
    FROM schedule_records
    WHERE (p_period_start IS NULL OR period_month >= p_period_start)
      AND (p_period_end IS NULL OR period_month <= p_period_end)
    GROUP BY vendor_id
  ) sc ON sc.vendor_id = v.id
  LEFT JOIN (
    SELECT vendor_id, SUM(penalty_points) total_penalty, COUNT(*) cnt
    FROM rework_records
    WHERE (p_period_start IS NULL OR record_date >= p_period_start)
      AND (p_period_end IS NULL OR record_date <= p_period_end)
    GROUP BY vendor_id
  ) r ON r.vendor_id = v.id
  LEFT JOIN (
    SELECT vendor_id, AVG(points) avg_points, COUNT(*) cnt
    FROM builder_feedback
    WHERE is_approved = true
      AND (p_period_start IS NULL OR submitted_at::date >= p_period_start)
      AND (p_period_end IS NULL OR submitted_at::date <= p_period_end)
    GROUP BY vendor_id
  ) f ON f.vendor_id = v.id
  WHERE v.is_active = true;

  -- Weighted total with dynamic denominator
  UPDATE score_results SET weighted_total = ROUND((
    (COALESCE(CASE WHEN safety_score IS NOT NULL THEN safety_score * v_weights.safety_weight END, 0)
   + COALESCE(CASE WHEN schedule_score IS NOT NULL THEN schedule_score * v_weights.schedule_weight END, 0)
   + COALESCE(CASE WHEN rework_score IS NOT NULL THEN rework_score * v_weights.rework_weight END, 0)
   + COALESCE(CASE WHEN feedback_score IS NOT NULL THEN feedback_score * v_weights.feedback_weight END, 0))
   / NULLIF(
      (CASE WHEN safety_score IS NOT NULL THEN v_weights.safety_weight ELSE 0 END
     + CASE WHEN schedule_score IS NOT NULL THEN v_weights.schedule_weight ELSE 0 END
     + CASE WHEN rework_score IS NOT NULL THEN v_weights.rework_weight ELSE 0 END
     + CASE WHEN feedback_score IS NOT NULL THEN v_weights.feedback_weight ELSE 0 END), 0)
  ), 2)
  WHERE id IS NOT NULL;

  -- Rankings
  WITH ranked AS (
    SELECT id,
      RANK() OVER (ORDER BY weighted_total DESC NULLS LAST) o_rank,
      RANK() OVER (PARTITION BY category_id ORDER BY weighted_total DESC NULLS LAST) c_rank
    FROM score_results WHERE weighted_total IS NOT NULL
  )
  UPDATE score_results sr SET overall_rank = ranked.o_rank, category_rank = ranked.c_rank
  FROM ranked WHERE sr.id = ranked.id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- STORAGE BUCKET
-- ============================================================
-- Run in Supabase dashboard: create a public bucket called 'uploads'
-- Or use the SQL below:
INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', false) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS storage_uploads_insert ON storage.objects;
DROP POLICY IF EXISTS storage_uploads_select ON storage.objects;

CREATE POLICY storage_uploads_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'uploads' AND auth.uid() IS NOT NULL
);
CREATE POLICY storage_uploads_select ON storage.objects FOR SELECT USING (
  bucket_id = 'uploads' AND auth.uid() IS NOT NULL
);
