import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const MEDAL_COLORS = ['#d4a017', '#9aa3b2', '#b87333']
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function getWeekStart() {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? 6 : day - 1
  const monday = new Date(now)
  monday.setDate(now.getDate() - diff)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function rankSubmitters(rows) {
  const counts = {}
  const profileMap = {}
  for (const row of rows) {
    const uid = row.submitted_by
    if (!uid) continue
    counts[uid] = (counts[uid] || 0) + 1
    if (row.profiles && !profileMap[uid]) profileMap[uid] = row.profiles
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count], i) => {
      const p = profileMap[id]
      const name = p?.full_name || p?.email?.split('@')[0] || 'Unknown'
      return { rank: i + 1, name, count }
    })
}

export default function WeeklyLeaderboardTicker() {
  // { leaders, period: 'this' | 'last' | 'empty' } once loaded; null while loading or on error.
  const [board, setBoard] = useState(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const weekStart = getWeekStart()
        const lastWeekStart = new Date(weekStart.getTime() - WEEK_MS)
        // Fetch this week and last week together so a quiet start to the week
        // falls back to last week's standings instead of hiding the bar.
        const { data: feedback, error } = await supabase
          .from('builder_feedback')
          .select('submitted_by, submitted_at, profiles!builder_feedback_submitted_by_fkey(full_name, email)')
          .gte('submitted_at', lastWeekStart.toISOString())

        if (error) throw error

        const rows = feedback || []
        const thisWeek = rows.filter((r) => new Date(r.submitted_at) >= weekStart)
        const lastWeek = rows.filter((r) => new Date(r.submitted_at) < weekStart)

        let next
        if (thisWeek.length) next = { leaders: rankSubmitters(thisWeek), period: 'this' }
        else if (lastWeek.length) next = { leaders: rankSubmitters(lastWeek), period: 'last' }
        else next = { leaders: [], period: 'empty' }

        if (mounted) setBoard(next)
      } catch (err) {
        console.error('Weekly leaderboard failed to load:', err)
        if (mounted) setBoard(null)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  if (!board) return null

  const label = board.period === 'last' ? "LAST WEEK'S LEADERBOARD" : 'WEEKLY LEADERBOARD'
  const suffix = board.period === 'last' ? 'last week' : 'this week'

  return (
    <div className="ticker-bar shrink-0">
      <div className="ticker-cap">
        <span className="ticker-dot" />
        <span className="ticker-label">{label}</span>
      </div>
      <div className="ticker-track-wrap">
        {board.period === 'empty' ? (
          <div className="ticker-item h-full px-5">
            <span className="ticker-count">No feedback submitted yet this week — be the first to take the lead!</span>
          </div>
        ) : (
          <div className="ticker-track">
            {[...board.leaders, ...board.leaders].map((item, i) => (
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
                <span className="ticker-count">{item.count} submission{item.count !== 1 ? 's' : ''} {suffix}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
