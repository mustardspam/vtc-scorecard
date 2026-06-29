-- ============================================================
-- 015_permit_forecast.sql
-- Permit-volume forecasting. Monthly residential building-permit
-- counts act as a forward-looking demand signal for the trade base:
-- a permit pulled now becomes trade work over the following months.
-- Each monthly file carries a trailing ~24-month window; the most
-- recent import is treated as the source of truth for the displayed
-- series, older imports are retained for audit.
--
-- Run in the Supabase SQL Editor (same as migrations 001-014).
-- ============================================================

CREATE TYPE permit_scope_type AS ENUM ('total', 'region', 'builder');

-- One row per uploaded monthly file
CREATE TABLE permit_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename TEXT NOT NULL,
  source_label TEXT,                       -- e.g. "HPermits - April 2026"
  report_month DATE NOT NULL,              -- latest month present in the file (first-of-month)
  first_month DATE,                        -- earliest month present in the file
  row_count INTEGER NOT NULL DEFAULT 0,    -- number of permit_series rows written
  month_count INTEGER NOT NULL DEFAULT 0,  -- number of distinct months in the file
  notes TEXT,
  uploaded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_permit_imports_month ON permit_imports(report_month DESC);

-- Normalized monthly facts: one row per (entity, month)
CREATE TABLE permit_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES permit_imports(id) ON DELETE CASCADE,
  scope_type permit_scope_type NOT NULL,
  scope_name TEXT NOT NULL,                -- 'Grand Total' | region name | builder name
  period_month DATE NOT NULL,              -- first-of-month
  permits INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (import_id, scope_type, scope_name, period_month)
);
CREATE INDEX idx_permit_series_lookup ON permit_series(scope_type, scope_name, period_month);
CREATE INDEX idx_permit_series_import ON permit_series(import_id);

ALTER TABLE permit_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE permit_series ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (consistent with the rest of the schema)
CREATE POLICY permit_imports_select ON permit_imports FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY permit_series_select ON permit_series FOR SELECT USING (auth.uid() IS NOT NULL);

-- Write: admin + manager
CREATE POLICY permit_imports_write ON permit_imports FOR ALL
  USING (get_user_role() IN ('admin','manager'))
  WITH CHECK (get_user_role() IN ('admin','manager'));
CREATE POLICY permit_series_write ON permit_series FOR ALL
  USING (get_user_role() IN ('admin','manager'))
  WITH CHECK (get_user_role() IN ('admin','manager'));
