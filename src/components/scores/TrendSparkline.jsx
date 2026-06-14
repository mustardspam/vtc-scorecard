export default function TrendSparkline({ history }) {
  if (!history || history.length === 0) {
    return <span className="text-xs text-gray-300">—</span>
  }

  const scores = history.map(Number).filter(n => !isNaN(n))
  if (scores.length === 0) return <span className="text-xs text-gray-300">—</span>

  const W = 56
  const H = 22
  const padding = 4
  const innerH = H - padding * 2

  const minVal = Math.max(0, Math.min(...scores) - 5)
  const maxVal = Math.min(100, Math.max(...scores) + 5)
  const range = maxVal - minVal || 1

  const pts = scores.map((v, i) => {
    const x = scores.length === 1 ? W / 2 : (i / (scores.length - 1)) * W
    const y = padding + innerH - ((v - minVal) / range) * innerH
    return [parseFloat(x.toFixed(1)), parseFloat(y.toFixed(1))]
  })

  const pointsStr = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const [lx, ly] = pts[pts.length - 1]

  const delta = scores.length >= 2 ? scores[scores.length - 1] - scores[scores.length - 2] : null
  const lineColor = delta == null
    ? '#087482'
    : delta > 0.05 ? '#16a34a'
    : delta < -0.05 ? '#dc2626'
    : '#6b7280'

  return (
    <div className="flex items-center gap-1.5">
      <svg width={W} height={H} className="overflow-visible flex-shrink-0">
        {scores.length >= 2 && (
          <polyline
            points={pointsStr}
            fill="none"
            stroke={lineColor}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        <circle cx={lx} cy={ly} r="2.5" fill={lineColor} />
      </svg>
      {delta !== null && (
        <span className="text-xs font-mono font-medium" style={{ color: lineColor }}>
          {delta > 0.05 ? '+' : ''}{delta.toFixed(1)}
        </span>
      )}
    </div>
  )
}
