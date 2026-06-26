import { tierPillStyle, tierValueColor } from '../../lib/design/tokens'
import { cn } from '../../lib/cn'

export default function ScoreSummaryCard({ title, value, icon: Icon, subtitle, tier, hero = false, className }) {
  if (hero) {
    return (
      <div className={cn('glass-kpi-hero h-full', className)}>
        <p className="text-[11px] font-bold uppercase tracking-[0.06em] opacity-80 mb-1.5">{title}</p>
        <div className="flex items-end justify-between gap-2 min-w-0">
          <div className="glass-kpi-value truncate">{value}</div>
          {tier && tier.label !== 'No data' && (
            <span className="glass-tier-pill shrink-0" style={{ ...tierPillStyle(tier), background: 'rgba(255,255,255,0.2)', color: '#fff' }}>
              {tier.label}
            </span>
          )}
        </div>
      </div>
    )
  }

  const valueColor = tier && tier.label !== 'No data' ? tierValueColor(tier) : 'var(--g-text)'

  return (
    <div className={cn('glass-panel p-4 min-w-0 h-full', className)}>
      <div className="flex items-center justify-between gap-1 mb-1.5 min-w-0">
        <span className="glass-eyebrow truncate">{title}</span>
        {tier && tier.label !== 'No data' && (
          <span className="glass-tier-pill shrink-0" style={tierPillStyle(tier)}>{tier.label}</span>
        )}
      </div>
      <div className="glass-kpi-card-value truncate" style={{ color: valueColor }}>{value ?? '—'}</div>
      {subtitle && <p className="text-xs mt-1" style={{ color: 'var(--g-dim)' }}>{subtitle}</p>}
      {Icon && <Icon className="hidden" />}
    </div>
  )
}
