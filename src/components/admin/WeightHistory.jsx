import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { RefreshCw, History } from 'lucide-react'

const WEIGHT_LABELS = {
  safety_weight: 'Safety',
  schedule_weight: 'Schedule',
  rework_weight: 'Rework',
  feedback_weight: 'Feedback',
}

function WeightDiff({ before, after }) {
  if (!before || !after) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {Object.entries(WEIGHT_LABELS).map(([key, label]) => {
        const b = Number(before[key]) || 0
        const a = Number(after[key]) || 0
        const delta = a - b
        if (Math.abs(delta) < 0.0005) return null
        return (
          <span key={key} className="text-xs">
            <span className="text-gray-500">{label}:</span>{' '}
            <span className="font-mono text-gray-600">{(b * 100).toFixed(1)}%</span>
            {' → '}
            <span className={`font-mono font-semibold ${delta > 0 ? 'text-green-700' : 'text-red-700'}`}>
              {(a * 100).toFixed(1)}%
            </span>
            <span className={`ml-1 text-xs ${delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
              ({delta > 0 ? '+' : ''}{(delta * 100).toFixed(1)}%)
            </span>
          </span>
        )
      })}
    </div>
  )
}

function WeightSnapshot({ weights, label }) {
  if (!weights) return <span className="text-gray-400 text-xs">—</span>
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
      {Object.entries(WEIGHT_LABELS).map(([key, lbl]) => (
        <span key={key} className="text-xs text-gray-600">
          {lbl}: <span className="font-mono font-medium">{(Number(weights[key] || 0) * 100).toFixed(1)}%</span>
        </span>
      ))}
    </div>
  )
}

export default function WeightHistory() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadHistory() }, [])

  async function loadHistory() {
    setLoading(true)
    const { data } = await supabase
      .from('activity_log')
      .select('id, action_type, description, metadata, created_at, profiles!activity_log_user_id_fkey(full_name, email)')
      .in('action_type', ['weights_changed', 'weights_reset'])
      .order('created_at', { ascending: false })
      .limit(100)
    setEntries(data || [])
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <History className="w-5 h-5 text-blue-600" />
            Weight Change History
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">Every time scoring weights were changed or reset.</p>
        </div>
        <button
          onClick={loadHistory}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <History className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No weight changes recorded yet.</p>
          <p className="text-xs mt-1">Changes are logged automatically when weights are saved.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, i) => {
            const meta = entry.metadata || {}
            const isReset = entry.action_type === 'weights_reset'
            const userName = entry.profiles?.full_name || entry.profiles?.email || 'Unknown user'
            return (
              <div key={entry.id} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                <div className={`flex items-center justify-between px-4 py-2.5 ${isReset ? 'bg-amber-50 border-b border-amber-100' : 'bg-blue-50 border-b border-blue-100'}`}>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${isReset ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                      {isReset ? 'Reset to Defaults' : 'Weights Updated'}
                    </span>
                    <span className="text-xs text-gray-600">{userName}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {meta.before && meta.after && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Changes</p>
                      <WeightDiff before={meta.before} after={meta.after} />
                    </div>
                  )}
                  {meta.after && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">New weights</p>
                      <WeightSnapshot weights={meta.after} />
                    </div>
                  )}
                  {meta.before && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Previous weights</p>
                      <WeightSnapshot weights={meta.before} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
