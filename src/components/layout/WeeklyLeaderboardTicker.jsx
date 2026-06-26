import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const MEDAL_COLORS = ['#d4a017', '#9aa3b2', '#b87333']

function getISOWeekStart() {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString()
}

export default function WeeklyLeaderboardTicker() {
  const [leaders, setLeaders] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const weekStart = getISOWeekStart()
        const { data: feedback } = await supabase
          .from('builder_feedback')
          .select('submitted_by')
          .gte('submitted_at', weekStart)

        if (!feedback?.length) {
          if (mounted) { setLeaders([]); setLoaded(true) }
          return
        }

        const counts = {}
        for (const row of feedback) {
          const uid = row.submitted_by
          if (uid) counts[uid] = (counts[uid] || 0) + 1
        }

        const topIds = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)

        if (!topIds.length) {
          if (mounted) { setLeaders([]); setLoaded(true) }
          return
        }

        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', topIds.map(([id]) => id))

        const profileMap = Object.fromEntries((profiles || []).map(p => [p.id, p]))

        const ranked = topIds.map(([id, count], i) => {
          const p = profileMap[id]
          const name = p?.full_name || p?.email?.split('@')[0] || 'Unknown'
          return { rank: i + 1, name, count }
        })

        if (mounted) { setLeaders(ranked); setLoaded(true) }
      } catch {
        if (mounted) { setLeaders([]); setLoaded(true) }
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  if (!loaded || leaders.length === 0) return null

  const items = [...leaders, ...leaders]

  return (
    <div className="ticker-bar shrink-0">
      <div className="ticker-cap">
        <span className="ticker-dot" />
        <span className="ticker-label">WEEKLY LEADERBOARD</span>
      </div>
      <div className="ticker-track-wrap">
        <div className="ticker-track">
          {items.map((item, i) => (
            <div key={i} className="ticker-item">
              <span
                className="ticker-medal"
                style={{ background: MEDAL_COLORS[item.rank - 1] || 'var(--g-line)' }}
              >
                {item.rank}
              </span>
              <span className="ticker-rank-label">
                {item.rank === 1 ? '1st' : item.rank === 2 ? '2nd' : item.rank === 3 ? '3rd' : `${item.rank}th`} Place
              </span>
              <span className="ticker-name">{item.name}</span>
              <span className="ticker-count">{item.count} submission{item.count !== 1 ? 's' : ''} this week</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
