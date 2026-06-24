-- Risk (12mo) exposure metric — a display-only $ projection, NOT part of weighted_total.
-- Rework $ no longer uses rework_records.cost (that's backcharged/recouped); instead it's a
-- flat admin-overhead rate per instance (VPO write-up, re-inspection, resequencing, AP processing).
-- Safety $ is anchored to the 2026 OSHA penalty schedule per severity tier.
-- No-show $ is a flat estimated cost of a lost day.
-- Volume is projected using a recency-weighted trailing-12mo average (trend-adjusted), since
-- there are no forward bookings to project against. If fewer than min_risk_months of distinct
-- monthly history exist, the actual observed trailing volume is used as-is instead of
-- extrapolating an annual rate from too little data (flagged via risk_low_data).

ALTER TABLE safety_severity_rules ADD COLUMN dollar_value NUMERIC(12,2);

UPDATE safety_severity_rules SET dollar_value = CASE severity
  WHEN 'equipment'   THEN 1000
  WHEN 'ppe'         THEN 7093
  WHEN 'near_miss'   THEN 9457
  WHEN 'first_aid'   THEN 14187
  WHEN 'recordable'  THEN 16550
  WHEN 'lost_time'   THEN 165514
  ELSE 0
END;

ALTER TABLE safety_severity_rules ALTER COLUMN dollar_value SET NOT NULL;
ALTER TABLE safety_severity_rules ALTER COLUMN dollar_value SET DEFAULT 0;

INSERT INTO system_config (key, value, description) VALUES
  ('rework_overhead_dollar', '150', 'Flat admin overhead $ per rework/backcharge instance (VPO write-up, re-inspection, resequencing, AP processing) — rework material/labor cost itself is excluded since it is recouped via backcharge'),
  ('no_show_dollar', '300', 'Estimated $ cost per vendor no-show instance (lost day)'),
  ('min_risk_months', '3', 'Minimum distinct months of trailing schedule data required before Risk (12mo) annualizes a recency-weighted trend. Below this, the actual observed trailing volume is used as-is instead of extrapolating from too little history.')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE score_results
  ADD COLUMN risk_rework_count INTEGER DEFAULT 0,
  ADD COLUMN risk_rework_dollar NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN risk_safety_dollar NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN risk_noshow_count INTEGER DEFAULT 0,
  ADD COLUMN risk_noshow_dollar NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN risk_trailing_jobs INTEGER DEFAULT 0,
  ADD COLUMN risk_trend_volume NUMERIC(10,2),
  ADD COLUMN risk_low_data BOOLEAN DEFAULT false,
  ADD COLUMN risk_exposure_12mo NUMERIC(12,2);

CREATE OR REPLACE FUNCTION calculate_scores(
  p_period_start DATE DEFAULT NULL,
  p_period_end DATE DEFAULT NULL
) RETURNS void AS $$
DECLARE
  v_weights RECORD;
  v_safety_mult NUMERIC;
  v_rework_mult NUMERIC;
  v_min_schedule_jobs INTEGER;
  v_min_feedback_count INTEGER;
  v_min_safety_records INTEGER;
  v_min_rework_records INTEGER;
  v_rework_overhead NUMERIC;
  v_no_show_dollar NUMERIC;
  v_min_risk_months INTEGER;
  v_risk_window_start DATE;
BEGIN
  SELECT * INTO v_weights FROM score_weights WHERE is_current = true LIMIT 1;
  v_safety_mult        := COALESCE((SELECT (value#>>'{}')::numeric FROM system_config WHERE key = 'safety_multiplier'), 10);
  v_rework_mult        := COALESCE((SELECT (value#>>'{}')::numeric FROM system_config WHERE key = 'rework_multiplier'), 5);
  v_min_schedule_jobs  := COALESCE((SELECT (value#>>'{}')::int FROM system_config WHERE key = 'min_schedule_jobs'), 5);
  v_min_feedback_count := COALESCE((SELECT (value#>>'{}')::int FROM system_config WHERE key = 'min_feedback_count'), 3);
  v_min_safety_records := COALESCE((SELECT (value#>>'{}')::int FROM system_config WHERE key = 'min_safety_records'), 1);
  v_min_rework_records := COALESCE((SELECT (value#>>'{}')::int FROM system_config WHERE key = 'min_rework_records'), 1);
  v_rework_overhead    := COALESCE((SELECT (value#>>'{}')::numeric FROM system_config WHERE key = 'rework_overhead_dollar'), 150);
  v_no_show_dollar      := COALESCE((SELECT (value#>>'{}')::numeric FROM system_config WHERE key = 'no_show_dollar'), 300);
  v_min_risk_months    := COALESCE((SELECT (value#>>'{}')::int FROM system_config WHERE key = 'min_risk_months'), 3);
  v_risk_window_start  := (CURRENT_DATE - INTERVAL '12 months')::date;

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
         WHEN s.cnt < v_min_safety_records THEN NULL
         WHEN s.total_severity = 0 THEN 100
         ELSE GREATEST(0, 100 - (s.total_severity * v_safety_mult))
    END,
    CASE WHEN sc.vendor_id IS NULL THEN NULL
         WHEN sc.total_jobs < v_min_schedule_jobs THEN NULL
         ELSE ROUND(sc.avg_adherence * 100, 2)
    END,
    CASE WHEN r.vendor_id IS NULL THEN NULL
         WHEN r.cnt < v_min_rework_records THEN NULL
         ELSE GREATEST(0, 100 - (r.total_penalty * v_rework_mult))
    END,
    CASE WHEN f.vendor_id IS NULL THEN NULL
         WHEN f.cnt < v_min_feedback_count THEN NULL
         ELSE f.avg_points
    END,
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

  -- Risk (12mo) exposure — always trailing 12 months from today, independent of
  -- p_period_start/p_period_end (those govern the historical scoring window above).
  WITH rework_12 AS (
    SELECT vendor_id, COUNT(*) cnt
    FROM rework_records
    WHERE record_date >= v_risk_window_start
    GROUP BY vendor_id
  ),
  safety_12 AS (
    SELECT sr.vendor_id, SUM(COALESCE(ssr.dollar_value, 0)) dollar_total
    FROM safety_records sr
    LEFT JOIN safety_severity_rules ssr ON ssr.severity = sr.severity
    WHERE sr.record_date >= v_risk_window_start
    GROUP BY sr.vendor_id
  ),
  schedule_12 AS (
    SELECT vendor_id, SUM(total_jobs) total_jobs, SUM(no_shows) total_noshows
    FROM schedule_records
    WHERE period_month >= v_risk_window_start
    GROUP BY vendor_id
  ),
  -- Group by distinct month first — schedule_records has one row per vendor PER COMMUNITY,
  -- so multiple rows can share a period_month. Ranking raw rows (instead of months) for
  -- recency weight would give same-month rows arbitrary different weights.
  schedule_monthly AS (
    SELECT vendor_id, period_month, SUM(total_jobs) total_jobs
    FROM schedule_records
    WHERE period_month >= v_risk_window_start
    GROUP BY vendor_id, period_month
  ),
  schedule_month_count AS (
    SELECT vendor_id, COUNT(*) months
    FROM schedule_monthly
    GROUP BY vendor_id
  ),
  schedule_ranked AS (
    SELECT vendor_id, total_jobs,
      ROW_NUMBER() OVER (PARTITION BY vendor_id ORDER BY period_month ASC) rn
    FROM schedule_monthly
  ),
  schedule_weighted AS (
    SELECT vendor_id, SUM(total_jobs * rn) / NULLIF(SUM(rn), 0) weighted_avg_monthly
    FROM schedule_ranked
    GROUP BY vendor_id
  ),
  risk_calc AS (
    SELECT v.id AS vendor_id,
      COALESCE(rw.cnt, 0) AS rework_count,
      COALESCE(rw.cnt, 0) * v_rework_overhead AS rework_dollar,
      COALESCE(sf.dollar_total, 0) AS safety_dollar,
      COALESCE(sc.total_noshows, 0) AS noshow_count,
      COALESCE(sc.total_noshows, 0) * v_no_show_dollar AS noshow_dollar,
      COALESCE(sc.total_jobs, 0) AS trailing_jobs,
      -- Below min_risk_months of distinct history, don't extrapolate an annual rate from
      -- too little data — fall back to the actual observed trailing volume as-is.
      CASE WHEN COALESCE(smc.months, 0) >= v_min_risk_months
        THEN ROUND(COALESCE(sw.weighted_avg_monthly, 0) * 12, 2)
        ELSE COALESCE(sc.total_jobs, 0)
      END AS trend_volume,
      COALESCE(smc.months, 0) < v_min_risk_months AS low_data
    FROM vendors v
    LEFT JOIN rework_12 rw ON rw.vendor_id = v.id
    LEFT JOIN safety_12 sf ON sf.vendor_id = v.id
    LEFT JOIN schedule_12 sc ON sc.vendor_id = v.id
    LEFT JOIN schedule_month_count smc ON smc.vendor_id = v.id
    LEFT JOIN schedule_weighted sw ON sw.vendor_id = v.id
  )
  UPDATE score_results sr SET
    risk_rework_count = rc.rework_count,
    risk_rework_dollar = rc.rework_dollar,
    risk_safety_dollar = rc.safety_dollar,
    risk_noshow_count = rc.noshow_count,
    risk_noshow_dollar = rc.noshow_dollar,
    risk_trailing_jobs = rc.trailing_jobs,
    risk_trend_volume = rc.trend_volume,
    risk_low_data = rc.low_data,
    risk_exposure_12mo = CASE
      WHEN rc.trailing_jobs = 0 THEN NULL
      ELSE ROUND(
        (rc.rework_dollar + rc.safety_dollar + rc.noshow_dollar) / rc.trailing_jobs * rc.trend_volume
      , 2)
    END
  FROM risk_calc rc
  WHERE sr.vendor_id = rc.vendor_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
