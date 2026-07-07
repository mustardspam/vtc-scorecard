import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useThresholds } from '../../hooks/useThresholds'

function flameBadge(weeks) {
  if (weeks >= 10) return '🔥🔥🔥'
  if (weeks >= 7) return '🔥🔥'
  return '🔥'
}

function badgeBg(weeks) {
  if (weeks >= 10) return 'linear-gradient(120deg, #f97316, #ef4444)'
  if (weeks >= 7) return 'linear-gradient(120deg, #f59e0b, #f97316)'
  return 'linear-gradient(120deg, #fbbf24, #f59e0b)'
}

function computeStreak(snaps, threshold) {
  let weeks = 0
  for (const snap of snaps) {
    if (snap.weighted_total != null && Number(snap.weighted_total) >= threshold) weeks++
    else break
  }
  return weeks
}

const RECENT_SNAPSHOT_WEEKS = 15

export default function HotStreakTicker() {
  const [streaks, setStreaks] = useState([])
  const [loaded, setLoaded] = useState(false)
  const { thresholds } = useThresholds()

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const { data: recentSnaps } = await supabase
          .from('snapshots')
          .select('id')
          .order('created_at', { ascending: false })
          .limit(RECENT_SNAPSHOT_WEEKS)

        const snapIds = (recentSnaps || []).map(s => s.id)
        if (!snapIds.length) {
          if (mounted) { setStreaks([]); setLoaded(true) }
          return
        }

        const [{ data }, { data: activeVendors }] = await Promise.all([
          supabase
            .from('snapshot_score_results')
            .select('vendor_id, vendor_name, category_name, weighted_total, snapshots(created_at)')
            .in('snapshot_id', snapIds)
            .not('vendor_id', 'is', null)
            .not('weighted_total', 'is', null),
          supabase
            .from('vendors')
            .select('id')
            .eq('is_active', true),
        ])

        if (!data?.length) {
          if (mounted) { setStreaks([]); setLoaded(true) }
          return
        }

        // Inactive vendors/trades must not appear in the ticker.
        const activeIds = new Set((activeVendors || []).map(v => v.id))
        const threshold = thresholds.threshold_good ?? 85
        const byVendor = {}

        for (const row of data) {
          if (!row.snapshots?.created_at) continue
          if (!activeIds.has(row.vendor_id)) continue
          if (!byVendor[row.vendor_id]) {
            byVendor[row.vendor_id] = {
              name: row.vendor_name,
              cat: row.category_name || '',
              cats: new Set(),
              snaps: [],
            }
          }
          if (row.category_name) byVendor[row.vendor_id].cats.add(row.category_name)
          byVendor[row.vendor_id].snaps.push({
            weighted_total: Number(row.weighted_total),
            date: row.snapshots.created_at,
          })
        }

        const results = Object.values(byVendor)
          // Exclude vendors/trades scored in fewer than two categories.
          .filter(v => v.cats.size >= 2)
          .map(v => {
            v.snaps.sort((a, b) => new Date(b.date) - new Date(a.date))
            const seen = new Set()
            const unique = v.snaps.filter(s => {
              const key = s.date.slice(0, 10)
              if (seen.has(key)) return false
              seen.add(key)
              return true
            })
            return { name: v.name, cat: v.cat, weeks: computeStreak(unique, threshold) }
          })
          .filter(v => v.weeks >= 2)
          .sort((a, b) => b.weeks - a.weeks)
          .slice(0, 10)

        if (mounted) { setStreaks(results); setLoaded(true) }
      } catch {
        if (mounted) { setStreaks([]); setLoaded(true) }
      }
    }
    load()
    return () => { mounted = false }
  }, [thresholds.threshold_good])

  if (!loaded || streaks.length === 0) return null

  const loop = [...streaks, ...streaks]

  return (
    <div className="hot-streak-bar shrink-0">
      <div className="hot-streak-cap">
        <span className="vtc-flame text-[17px]">🔥</span>
        <span className="vtc-flame vtc-flame-b text-sm -ml-1.5 opacity-85">🔥</span>
        <span className="vtc-flame vtc-flame-c text-[11px] -ml-1 opacity-70">🔥</span>
        <span className="hot-streak-label">HOT STREAKS</span>
      </div>
      <div className="hot-streak-track-wrap">
        <div className="vtc-streak-track">
          {loop.map((v, i) => (
            <div key={i} className="hot-streak-item">
              <span className="text-sm leading-none">{flameBadge(v.weeks)}</span>
              <span className="text-[13px] font-bold" style={{ color: 'var(--g-text)' }}>{v.name}</span>
              {v.cat && <span className="text-[11px]" style={{ color: '#78716c' }}>{v.cat}</span>}
              <span className="vtc-streak-badge text-[11px] font-bold text-white px-2.5 py-0.5 rounded-full" style={{ background: badgeBg(v.weeks) }}>
                {v.weeks} week{v.weeks === 1 ? '' : 's'} straight
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
