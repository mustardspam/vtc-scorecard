-- Fix: safety_score should be NULL when a vendor has no safety records,
-- not 100. A vendor with records and zero incidents still scores 100.
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

  -- Weighted total with dynamic denominator (NULL scores excluded from both numerator and denominator)
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

-- Re-run scoring so existing score_results reflect the fix immediately
SELECT calculate_scores();
