-- 013_perf_indexes_cleanup.sql
-- Performance: cover the one hot-path foreign key still missing an index and
-- drop a duplicate index flagged by the Supabase performance advisor.

-- VendorReportCard filters vendor_brand_references by vendor_id on every open,
-- but the table only had indexes on (id) and (brand, jc_vendor_id) — so that
-- lookup was a sequential scan.
CREATE INDEX IF NOT EXISTS idx_vendor_brand_refs_vendor_id
  ON public.vendor_brand_references USING btree (vendor_id);

-- builder_feedback had two identical indexes on submitted_at DESC
-- (idx_builder_feedback_submitted_at and idx_feedback_submitted). Keep one.
DROP INDEX IF EXISTS public.idx_feedback_submitted;
