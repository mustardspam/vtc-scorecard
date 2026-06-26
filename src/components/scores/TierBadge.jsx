import { tierPillStyle } from '../../lib/design/tokens'

export default function TierBadge({ score, getTier }) {
  const tier = getTier(score)
  if (!tier || tier.label === 'No data') return null
  return (
    <span className="glass-tier-pill" style={tierPillStyle(tier)}>
      {tier.label}
    </span>
  )
}
