-- ============================================================
-- 016_permit_region_builder.sql
-- Crossed region x builder permit facts, parsed from the workbook's
-- project-level tab (the only place the two dimensions are crossed).
-- Aggregated to (region, builder, month); covers the production /
-- "top builder" set (~77% of volume), which is exactly the segment the
-- peer-group filter targets. Each file carries ~12 months; history
-- accumulates across monthly imports.
--
-- Run in the Supabase SQL Editor (same as migrations 001-015).
-- ============================================================

CREATE TABLE permit_rb_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES permit_imports(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  builder TEXT NOT NULL,
  period_month DATE NOT NULL,
  permits INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (import_id, region, builder, period_month)
);
CREATE INDEX idx_permit_rb_lookup ON permit_rb_series(region, builder, period_month);
CREATE INDEX idx_permit_rb_import ON permit_rb_series(import_id);

ALTER TABLE permit_rb_series ENABLE ROW LEVEL SECURITY;

CREATE POLICY permit_rb_select ON permit_rb_series FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY permit_rb_write ON permit_rb_series FOR ALL
  USING (get_user_role() IN ('admin','manager'))
  WITH CHECK (get_user_role() IN ('admin','manager'));
