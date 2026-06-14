import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const TIER_DEFAULTS = { threshold_good: 85, threshold_watch: 70, threshold_probation: 50 }
const MIN_DEFAULTS = { min_schedule_jobs: 5, min_feedback_count: 3, min_safety_records: 1, min_rework_records: 1 }
const ALL_KEYS = [...Object.keys(TIER_DEFAULTS), ...Object.keys(MIN_DEFAULTS)]

export function useThresholds() {
  const [thresholds, setThresholds] = useState(TIER_DEFAULTS)
  const [minThresholds, setMinThresholds] = useState(MIN_DEFAULTS)

  useEffect(() => {
    supabase
      .from('system_config')
      .select('key, value')
      .in('key', ALL_KEYS)
      .then(({ data }) => {
        if (!data?.length) return
        const t = { ...TIER_DEFAULTS }
        const m = { ...MIN_DEFAULTS }
        for (const row of data) {
          const parsed = Number(row.value)
          if (!isNaN(parsed)) {
            if (row.key in t) t[row.key] = parsed
            if (row.key in m) m[row.key] = parsed
          }
        }
        setThresholds(t)
        setMinThresholds(m)
      })
  }, [])

  function getTier(score) {
    if (score == null) return null
    const s = Number(score)
    if (s >= thresholds.threshold_good) return { label: 'Good', color: 'text-green-700', bg: 'bg-green-100' }
    if (s >= thresholds.threshold_watch) return { label: 'Watch', color: 'text-yellow-700', bg: 'bg-yellow-100' }
    if (s >= thresholds.threshold_probation) return { label: 'Probation', color: 'text-orange-700', bg: 'bg-orange-100' }
    return { label: 'Critical', color: 'text-red-700', bg: 'bg-red-100' }
  }

  function hasEnoughData(scoreRow, metric) {
    if (!scoreRow) return true
    if (metric === 'schedule_score') return (scoreRow.schedule_total_jobs ?? 0) >= minThresholds.min_schedule_jobs
    if (metric === 'feedback_score') return (scoreRow.feedback_count ?? 0) >= minThresholds.min_feedback_count
    if (metric === 'safety_score') return (scoreRow.safety_incident_count ?? 0) >= minThresholds.min_safety_records || minThresholds.min_safety_records === 0
    if (metric === 'rework_score') return (scoreRow.rework_count ?? 0) >= minThresholds.min_rework_records || minThresholds.min_rework_records === 0
    return true
  }

  return { thresholds, minThresholds, getTier, hasEnoughData }
}
