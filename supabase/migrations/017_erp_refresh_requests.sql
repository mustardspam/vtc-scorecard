-- ============================================================
-- 017_erp_refresh_requests.sql
-- "Refresh now" on the Uploads page. ResPlan only listens on the PC
-- that runs it, so a manager's browser can't start a pull itself.
-- Instead it queues a request here; the vtc-automation job on the
-- ResPlan PC checks every few minutes, runs the pulls as the
-- automation admin account and writes back the outcome.
--
-- Run in the Supabase SQL Editor (same as migrations 001-016).
-- ============================================================

CREATE TABLE erp_refresh_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID NOT NULL REFERENCES profiles(id) DEFAULT auth.uid(),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  categories TEXT[],                        -- NULL = all four
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'done', 'partial', 'failed')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  step TEXT,                                -- progress text while running
  result JSONB,                             -- per pull: category, brand, month, status, rows, error
  error TEXT
);
CREATE INDEX idx_erp_refresh_requests_open ON erp_refresh_requests(requested_at) WHERE status IN ('pending', 'running');

-- At most one open request at a time.
CREATE UNIQUE INDEX uq_erp_refresh_requests_one_open ON erp_refresh_requests((true)) WHERE status IN ('pending', 'running');

ALTER TABLE erp_refresh_requests ENABLE ROW LEVEL SECURITY;

-- Read: any signed-in user (so everyone sees when data was last refreshed).
CREATE POLICY refresh_requests_select ON erp_refresh_requests FOR SELECT
  USING ((select auth.uid()) IS NOT NULL);

-- Request: managers and admins, as themselves, as a new pending request.
CREATE POLICY refresh_requests_insert ON erp_refresh_requests FOR INSERT
  WITH CHECK (
    (select get_user_role()) IN ('admin', 'manager')
    AND requested_by = (select auth.uid())
    AND status = 'pending'
  );

-- Claim / complete: admins only (the vtc-automation account is an admin).
CREATE POLICY refresh_requests_update ON erp_refresh_requests FOR UPDATE
  USING ((select is_admin()))
  WITH CHECK ((select is_admin()));
