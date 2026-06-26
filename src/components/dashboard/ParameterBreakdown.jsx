import { tierBarColor } from '../../lib/design/tokens'
import { useThresholds } from '../../hooks/useThresholds'

export default function ParameterBreakdown({ scores }) {
  const { getTier } = useThresholds()
  const params = ['safety_score', 'schedule_score', 'rework_score', 'feedback_score']
  const labels = { safety_score: 'Safety', schedule_score: 'Schedule', rework_score: 'Rework', feedback_score: 'Feedback' }

  const data = params.map(param => {
    const valid = scores.filter(s => s[param] != null)
    const avg = valid.length
      ? valid.reduce((sum, s) => sum + Number(s[param]), 0) / valid.length
      : null
    return { name: labels[param], score: avg != null ? Number(avg.toFixed(1)) : null, tier: getTier(avg) }
  })

  return (
    <div className="glass-panel p-4 sm:p-5 min-w-0 max-w-full">
      <h2 className="glass-section-title mb-3">Parameter Breakdown</h2>
      <div className="space-y-3">
        {data.map(row => (
          <div key={row.name}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-semibold" style={{ color: 'var(--g-text)' }}>{row.name}</span>
              <span className="text-sm font-semibold" style={{ color: row.tier ? tierBarColor(row.tier) : 'var(--g-dim)' }}>
                {row.score != null ? row.score : '—'}
              </span>
            </div>
            <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--g-line)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: row.score != null ? `${Math.min(row.score, 100)}%` : '0%',
                  background: row.tier ? tierBarColor(row.tier) : '#9aa3b2',
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
