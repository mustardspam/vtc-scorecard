import { tierPillStyle, tierValueColor } from '../../lib/design/tokens'

export default function PerformerCard({
  rank, name, category, score, tier,
  safetyCount, scheduleJobs, reworkCount, feedbackCount, type, onClick,
}) {
  const meta = [
    scheduleJobs > 0 && `${scheduleJobs} jobs`,
    safetyCount > 0 && `${safetyCount} incidents`,
    reworkCount > 0 && `${reworkCount} backcharges`,
    feedbackCount > 0 && `${feedbackCount} feedback`,
  ].filter(Boolean).join(' · ')

  return (
    <div
      className="flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors duration-[120ms]"
      style={{ background: 'var(--g-panel-2)', border: '1px solid var(--g-line)' }}
      onClick={onClick}
      onKeyDown={e => e.key === 'Enter' && onClick?.()}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-sm font-bold w-6 text-center shrink-0" style={{ color: 'var(--g-dim)' }}>#{rank}</span>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--g-text)' }}>{name}</p>
          <p className="text-xs truncate" style={{ color: 'var(--g-dim)' }}>
            {category}{meta ? ` · ${meta}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-lg font-bold" style={{ color: tier ? tierValueColor(tier) : 'var(--g-text)' }}>
          {score != null ? Number(score).toFixed(1) : '—'}
        </span>
        {tier && tier.label !== 'No data' && (
          <span className="glass-tier-pill" style={tierPillStyle(tier)}>{tier.label}</span>
        )}
      </div>
    </div>
  )
}
