import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../hooks/useActivityLog'
import { useAuth } from '../../hooks/useAuth'
import { Save, Calculator, Play } from 'lucide-react'

export default function ScoringConfig() {
  const [config, setConfig] = useState({})
  const [saving, setSaving] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [message, setMessage] = useState('')
  const { user } = useAuth()

  useEffect(() => { loadConfig() }, [])

  async function loadConfig() {
    const { data } = await supabase.from('system_config').select('*')
    const map = {}
    for (const row of (data || [])) map[row.key] = row.value
    setConfig(map)
  }

  async function handleSave() {
    setSaving(true)
    for (const [key, value] of Object.entries(config)) {
      await supabase.from('system_config').update({ value: JSON.stringify(value), updated_by: user.id, updated_at: new Date().toISOString() }).eq('key', key)
    }
    await logActivity('rules_updated', 'Updated scoring configuration', { config })
    setMessage('Configuration saved')
    setSaving(false)
  }

  async function handleRecalculate() {
    setCalculating(true)
    setMessage('')
    try {
      const { error } = await supabase.rpc('calculate_scores')
      if (error) throw error
      await logActivity('scores_calculated', 'Recalculated all vendor scores')
      setMessage('Scores recalculated successfully')
    } catch (err) {
      setMessage('Error: ' + err.message + '. Make sure the calculate_scores function exists in Supabase.')
    } finally {
      setCalculating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">Scoring Multipliers</h2>
        <p className="text-sm text-gray-500 mb-4">These control how aggressively scores are deducted per incident.</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Safety Multiplier</label>
            <p className="text-xs text-gray-400 mb-1">Score = 100 - (severity_points x multiplier)</p>
            <input type="number" value={config.safety_multiplier || 10}
              onChange={e => setConfig(c => ({ ...c, safety_multiplier: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rework Multiplier</label>
            <p className="text-xs text-gray-400 mb-1">Score = 100 - (penalty_points x multiplier)</p>
            <input type="number" value={config.rework_multiplier || 5}
              onChange={e => setConfig(c => ({ ...c, rework_multiplier: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Config'}
        </button>
        <button onClick={handleRecalculate} disabled={calculating}
          className="flex items-center gap-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
          <Play className="w-4 h-4" /> {calculating ? 'Calculating...' : 'Recalculate Scores'}
        </button>
        {message && <span className="text-xs text-green-600">{message}</span>}
      </div>

      <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-700">Scoring Formulas:</p>
        <p>Safety: 100 - (sum_severity_points x {config.safety_multiplier || 10}), min 0</p>
        <p>Schedule: avg(adherence_pct) x 100 — adherence = (total_jobs - no_shows) / total_jobs</p>
        <p>Rework: 100 - (sum_penalty_points x {config.rework_multiplier || 5}), min 0</p>
        <p>Feedback: avg(points) — Kudos=100, Minor=85, Major=70, Critical=50</p>
        <p>Weighted Total: sum(score x weight) / sum(active_weights) — only includes metrics with data</p>
      </div>
    </div>
  )
}
