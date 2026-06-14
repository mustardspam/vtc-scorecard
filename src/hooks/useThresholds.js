import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const DEFAULTS = { threshold_good: 85, threshold_watch: 70, threshold_probation: 50 }

export function useThresholds() {
  const [thresholds, setThresholds] = useState(DEFAULTS)

  useEffect(() => {
    supabase
      .from('system_config')
      .select('key, value')
      .in('key', ['threshold_good', 'threshold_watch', 'threshold_probation'])
      .then(({ data }) => {
        if (!data?.length) return
        const t = { ...DEFAULTS }
        for (const row of data) {
          const parsed = typeof row.value === 'string' ? Number(row.value) : Number(row.value)
          if (!isNaN(parsed)) t[row.key] = parsed
        }
        setThresholds(t)
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

  return { thresholds, getTier }
}
