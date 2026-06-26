import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { TIER_COLORS } from '../lib/design/tokens'

const TIER_DEFAULTS = { threshold_good: 85, threshold_watch: 70, threshold_probation: 50 }
const MIN_DEFAULTS = { min_schedule_jobs: 5, min_feedback_count: 3, min_safety_records: 1, min_rework_records: 1 }
const ALL_KEYS = [...Object.keys(TIER_DEFAULTS), ...Object.keys(MIN_DEFAULTS)]

const useThresholdStore = create((set, get) => ({
  thresholds: TIER_DEFAULTS,
  minThresholds: MIN_DEFAULTS,
  loaded: false,

  load: async () => {
    if (get().loaded) return
    try {
      const { data } = await supabase.from('system_config').select('key, value').in('key', ALL_KEYS)
      if (data?.length) {
        const t = { ...TIER_DEFAULTS }
        const m = { ...MIN_DEFAULTS }
        for (const row of data) {
          const parsed = Number(row.value)
          if (!isNaN(parsed)) {
            if (row.key in t) t[row.key] = parsed
            if (row.key in m) m[row.key] = parsed
          }
        }
        set({ thresholds: t, minThresholds: m, loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },
}))

export function useThresholds() {
  const { thresholds, minThresholds, loaded, load } = useThresholdStore()

  useEffect(() => {
    if (!loaded) load()
  }, [loaded, load])

  function getTier(score) {
    if (score == null) return { label: 'No data', ...TIER_COLORS['No data'], color: 'text-[var(--g-dim)]', bg: 'bg-transparent' }
    const s = Number(score)
    let label
    if (s >= thresholds.threshold_good) label = 'Good'
    else if (s >= thresholds.threshold_watch) label = 'Watch'
    else if (s >= thresholds.threshold_probation) label = 'Probation'
    else label = 'Critical'
    const c = TIER_COLORS[label]
    return { label, fg: c.fg, softBg: c.softBg, bar: c.bar }
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
