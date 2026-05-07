import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

function getColor(score) {
  if (score >= 85) return '#16a34a'
  if (score >= 70) return '#ca8a04'
  if (score >= 50) return '#ea580c'
  return '#dc2626'
}

export default function ParameterBreakdown({ scores }) {
  const params = ['safety_score', 'schedule_score', 'rework_score', 'feedback_score']
  const labels = { safety_score: 'Safety', schedule_score: 'Schedule', rework_score: 'Rework', feedback_score: 'Feedback' }

  const data = params.map(param => {
    const valid = scores.filter(s => s[param] != null)
    const avg = valid.length
      ? valid.reduce((sum, s) => sum + Number(s[param]), 0) / valid.length
      : 0
    return { name: labels[param], score: Number(avg.toFixed(1)), count: valid.length }
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Parameter Breakdown</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
            <XAxis type="number" domain={[0, 100]} />
            <YAxis type="category" dataKey="name" width={70} />
            <Tooltip
              formatter={(value, name, props) => [`${value} (${props.payload.count} vendors)`, 'Avg Score']}
            />
            <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={28}>
              {data.map((entry, i) => (
                <Cell key={i} fill={getColor(entry.score)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
