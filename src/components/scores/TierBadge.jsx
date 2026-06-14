export default function TierBadge({ score, getTier }) {
  const tier = getTier(score)
  if (!tier) return null
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold mt-0.5 ${tier.bg} ${tier.color}`}>
      {tier.label}
    </span>
  )
}
