function scoreColor(score) {
  if (score >= 85) return 'text-green-700 bg-green-50'
  if (score >= 70) return 'text-yellow-700 bg-yellow-50'
  if (score >= 50) return 'text-orange-700 bg-orange-50'
  return 'text-red-700 bg-red-50'
}

export default function PerformerCard({
  rank, name, category, score, safetyCount, scheduleJobs, reworkCount, feedbackCount, type
}) {
  const borderColor = type === 'best' ? 'border-l-green-500' : 'border-l-red-500'

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border border-gray-100 border-l-4 ${borderColor} bg-gray-50`}>
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-gray-400 w-6 text-center">#{rank}</span>
        <div>
          <p className="text-sm font-semibold text-gray-900">{name}</p>
          <p className="text-xs text-gray-500">{category}</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-xs text-gray-500 text-right space-y-0.5">
          {scheduleJobs > 0 && <div>{scheduleJobs} jobs</div>}
          {safetyCount > 0 && <div>{safetyCount} incidents</div>}
          {reworkCount > 0 && <div>{reworkCount} backcharges</div>}
          {feedbackCount > 0 && <div>{feedbackCount} feedback</div>}
        </div>
        <span className={`text-lg font-bold px-3 py-1 rounded-lg ${scoreColor(score)}`}>
          {Number(score).toFixed(1)}
        </span>
      </div>
    </div>
  )
}
