import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../hooks/useActivityLog'
import { useAuth } from '../../hooks/useAuth'
import { Save, Calculator, AlertCircle } from 'lucide-react'

const TIER_FIELDS = [
  {
    key: 'threshold_good',
    label: 'Good (≥)',
    description: 'Scores at or above this are classified as Good',
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-200',
  },
  {
    key: 'threshold_watch',
    label: 'Watch (≥)',
    description: 'Scores at or above this (below Good) are classified as Watch',
    color: 'text-yellow-700',
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
  },
  {
    key: 'threshold_probation',
    label: 'Probation (≥)',
    description: 'Scores at or above this (below Watch) are Probation — below this is Critical',
    color: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-200',
  },
]

const MIN_FIELDS = [
  { key: 'min_schedule_jobs', label: 'Minimum Schedule Jobs', description: 'Jobs needed before a schedule score is shown. Set 0 to disable.', icon: '📅' },
  { key: 'min_feedback_count', label: 'Minimum Feedback Entries', description: 'Approved feedback entries needed before a feedback score is shown. Set 0 to disable.', icon: '💬' },
  { key: 'min_safety_records', label: 'Minimum Safety Records', description: 'Safety incidents logged before a safety score is flagged. Set 0 to disable.', icon: '🦺' },
  { key: 'min_rework_records', label: 'Minimum Rework Records', description: 'Rework/backcharge entries needed before a rework score is flagged. Set 0 to disable.', icon: '🔧' },
]

export default function ScoringConfig() {
  const [config, setConfig] = useState({})
  const [thresholds, setThresholds] = useState({ threshold_good: 85, threshold_watch: 70, threshold_probation: 50 })
  const [minData, setMinData] = useState({ min_schedule_jobs: 5, min_feedback_count: 3, min_safety_records: 1, min_rework_records: 1 })
  const [saving, setSaving] = useState(false)
  const [savingThresholds, setSavingThresholds] = useState(false)
  const [savingMin, setSavingMin] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [message, setMessage] = useState('')
  const [thresholdMsg, setThresholdMsg] = useState('')
  const [minMsg, setMinMsg] = useState('')
  const { user } = useAuth()

  useEffect(() => { loadConfig() }, [])

  async function loadConfig() {
    const { data } = await supabase.from('system_config').select('*')
    const map = {}
    for (const row of (data || [])) map[row.key] = row.value
    setConfig(map)
    setThresholds({
      threshold_good: Number(map.threshold_good) || 85,
      threshold_watch: Number(map.threshold_watch) || 70,
      threshold_probation: Number(map.threshold_probation) || 50,
    })
    setMinData({
      min_schedule_jobs: map.min_schedule_jobs != null ? Number(map.min_schedule_jobs) : 5,
      min_feedback_count: map.min_feedback_count != null ? Number(map.min_feedback_count) : 3,
      min_safety_records: map.min_safety_records != null ? Number(map.min_safety_records) : 1,
      min_rework_records: map.min_rework_records != null ? Number(map.min_rework_records) : 1,
    })
  }

  async function handleSaveMin() {
    setSavingMin(true)
    for (const [key, value] of Object.entries(minData)) {
      await supabase
        .from('system_config')
        .upsert({ key, value: String(value), updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    }
    await logActivity('rules_updated', 'Updated minimum data thresholds', { minData })
    setMinMsg('Minimums saved')
    setSavingMin(false)
    setTimeout(() => setMinMsg(''), 3000)
  }

  async function handleSave() {
    setSaving(true)
    for (const [key, value] of Object.entries(config)) {
      await supabase
        .from('system_config')
        .update({ value: JSON.stringify(value), updated_by: user.id, updated_at: new Date().toISOString() })
        .eq('key', key)
    }
    await logActivity('rules_updated', 'Updated scoring configuration', { config })
    setMessage('Configuration saved')
    setSaving(false)
    setTimeout(() => setMessage(''), 3000)
  }

  async function handleSaveThresholds() {
    if (thresholds.threshold_good <= thresholds.threshold_watch ||
        thresholds.threshold_watch <= thresholds.threshold_probation) {
      setThresholdMsg('Error: Good must be > Watch > Probation')
      return
    }
    setSavingThresholds(true)
    for (const [key, value] of Object.entries(thresholds)) {
      await supabase
        .from('system_config')
        .upsert(
          { key, value: String(value), updated_by: user.id, updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        )
    }
    await logActivity('rules_updated', 'Updated performance tier thresholds', { thresholds })
    setThresholdMsg('Thresholds saved')
    setSavingThresholds(false)
    setTimeout(() => setThresholdMsg(''), 3000)
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
      setMessage('Error: ' + err.message)
    } finally {
      setCalculating(false)
    }
  }

  const thresholdError = thresholds.threshold_good <= thresholds.threshold_watch ||
    thresholds.threshold_watch <= thresholds.threshold_probation

  return (
    <div className="space-y-8">

      {/* Scoring multipliers */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Scoring Multipliers</h2>
        <p className="text-sm text-gray-500 mb-4">Controls how aggressively scores are deducted per incident.</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Safety Multiplier</label>
            <p className="text-xs text-gray-400 mb-1">Score = 100 − (severity_points × multiplier)</p>
            <input
              type="number"
              value={config.safety_multiplier || 10}
              onChange={e => setConfig(c => ({ ...c, safety_multiplier: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rework Multiplier</label>
            <p className="text-xs text-gray-400 mb-1">Score = 100 − (penalty_points × multiplier)</p>
            <input
              type="number"
              value={config.rework_multiplier || 5}
              onChange={e => setConfig(c => ({ ...c, rework_multiplier: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 pt-4 border-t border-gray-200 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Multipliers'}
          </button>
          <button
            onClick={handleRecalculate}
            disabled={calculating}
            className="flex items-center gap-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            <Calculator className="w-4 h-4" /> {calculating ? 'Calculating...' : 'Recalculate Scores'}
          </button>
          {message && (
            <span className={`text-xs ${message.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
              {message}
            </span>
          )}
        </div>
      </div>

      {/* Performance tier thresholds */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Performance Tier Thresholds</h2>
        <p className="text-sm text-gray-500 mb-4">
          Defines what score range puts a vendor in each tier. Shown as badges throughout the app and on report cards.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-2">
          {TIER_FIELDS.map(({ key, label, description, color, bg, border }) => (
            <div key={key} className={`rounded-lg border p-4 ${bg} ${border}`}>
              <label className={`block text-sm font-semibold mb-0.5 ${color}`}>{label}</label>
              <p className="text-xs text-gray-500 mb-2">{description}</p>
              <input
                type="number"
                min={0}
                max={100}
                value={thresholds[key]}
                onChange={e => setThresholds(t => ({ ...t, [key]: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              />
            </div>
          ))}
        </div>

        {/* Preview */}
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-4 flex-wrap">
          <span>Preview:</span>
          <span className="px-2 py-0.5 rounded font-semibold bg-green-100 text-green-700">Good ≥ {thresholds.threshold_good}</span>
          <span className="text-gray-300">·</span>
          <span className="px-2 py-0.5 rounded font-semibold bg-yellow-100 text-yellow-700">Watch ≥ {thresholds.threshold_watch}</span>
          <span className="text-gray-300">·</span>
          <span className="px-2 py-0.5 rounded font-semibold bg-orange-100 text-orange-700">Probation ≥ {thresholds.threshold_probation}</span>
          <span className="text-gray-300">·</span>
          <span className="px-2 py-0.5 rounded font-semibold bg-red-100 text-red-700">Critical &lt; {thresholds.threshold_probation}</span>
        </div>

        {thresholdError && (
          <p className="text-xs text-red-600 mb-3">Thresholds must be in descending order: Good &gt; Watch &gt; Probation.</p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveThresholds}
            disabled={savingThresholds || thresholdError}
            className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {savingThresholds ? 'Saving...' : 'Save Thresholds'}
          </button>
          {thresholdMsg && (
            <span className={`text-xs ${thresholdMsg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
              {thresholdMsg}
            </span>
          )}
        </div>
      </div>

      {/* Minimum data thresholds */}
      <div>
        <h2 className="text-lg font-semibold mb-1">Minimum Data Requirements</h2>
        <p className="text-sm text-gray-500 mb-4">
          Scores with insufficient data are flagged with a warning on the Scores page. Set to 0 to disable a threshold.
        </p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {MIN_FIELDS.map(({ key, label, description, icon }) => (
            <div key={key} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <label className="block text-sm font-semibold text-gray-700 mb-0.5">{icon} {label}</label>
              <p className="text-xs text-gray-400 mb-2">{description}</p>
              <input
                type="number"
                min={0}
                value={minData[key]}
                onChange={e => setMinData(m => ({ ...m, [key]: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg mb-4">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-700">
            These thresholds only affect visual warnings — scores are still calculated by the database. Vendors flagged with ⚠ have fewer data points than the minimum and their score may not be representative.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleSaveMin}
            disabled={savingMin}
            className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {savingMin ? 'Saving...' : 'Save Minimums'}
          </button>
          {minMsg && <span className="text-xs text-green-600">{minMsg}</span>}
        </div>
      </div>

      {/* Scoring formulas reference */}
      <div className="bg-gray-50 rounded-lg p-4 text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-700">Scoring Formulas:</p>
        <p>Safety: 100 − (sum_severity_points × {config.safety_multiplier || 10}), min 0</p>
        <p>Schedule: avg(adherence_pct) × 100 — adherence = (total_jobs − no_shows) / total_jobs</p>
        <p>Rework: 100 − (sum_penalty_points × {config.rework_multiplier || 5}), min 0</p>
        <p>Feedback: avg(points) — Kudos = 100, Minor = 85, Major = 70, Critical = 50</p>
        <p>Weighted Total: sum(score × weight) / sum(active_weights) — only includes metrics with data</p>
      </div>
    </div>
  )
}
