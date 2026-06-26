import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../hooks/useActivityLog'
import { useAuth } from '../../hooks/useAuth'
import { RotateCcw, Save } from 'lucide-react'

const DEFAULTS = {
  safety_weight: 0.25,
  schedule_weight: 0.25,
  rework_weight: 0.125,
  feedback_weight: 0.375,
}

const LABELS = {
  safety_weight: 'Safety',
  schedule_weight: 'Schedule',
  rework_weight: 'Rework',
  feedback_weight: 'Feedback / Log',
}

export default function WeightSliders() {
  const [weights, setWeights] = useState(DEFAULTS)
  const [weightId, setWeightId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const { isManager, isAdmin } = useAuth()
  const canEdit = isManager() || isAdmin()

  useEffect(() => {
    let mounted = true
    loadWeights(mounted)
    return () => { mounted = false }
  }, [])

  async function loadWeights(mounted = true) {
    try {
      const { data } = await supabase.from('score_weights').select('*').eq('is_current', true).single()
      if (mounted && data) {
        setWeightId(data.id)
        setWeights({
          safety_weight: Number(data.safety_weight),
          schedule_weight: Number(data.schedule_weight),
          rework_weight: Number(data.rework_weight),
          feedback_weight: Number(data.feedback_weight),
        })
      }
    } catch (err) {
      console.error('loadWeights error:', err)
    }
  }

  const total = Object.values(weights).reduce((sum, v) => sum + v, 0)
  const isValid = Math.abs(total - 1) < 0.001

  function handleChange(key, value) {
    setWeights(prev => ({ ...prev, [key]: Number(value) }))
    setMessage('')
  }

  async function handleSave() {
    if (!isValid) return
    setSaving(true)
    const before = { ...weights }
    const { error } = await supabase
      .from('score_weights')
      .update({
        ...weights,
        inspections_weight: 0,
        warranty_weight: 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', weightId)

    if (!error) {
      await logActivity('weights_changed', 'Updated score weights', { before, after: weights })
      setMessage('Weights saved successfully')
    } else {
      setMessage('Error saving weights')
    }
    setSaving(false)
  }

  async function handleReset() {
    const before = { ...weights }
    setWeights(DEFAULTS)
    if (weightId) {
      await supabase
        .from('score_weights')
        .update({ ...DEFAULTS, inspections_weight: 0, warranty_weight: 0, updated_at: new Date().toISOString() })
        .eq('id', weightId)
      await logActivity('weights_reset', 'Reset weights to default settings', { before, after: DEFAULTS })
    }
    setMessage('Weights reset to defaults')
  }

  return (
    <div className="space-y-4">
      {Object.entries(LABELS).map(([key, label]) => (
        <div key={key} className="flex items-center gap-4">
          <span className="text-sm font-medium w-28" style={{ color: 'var(--g-text)' }}>{label}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.025"
            value={weights[key]}
            onChange={e => handleChange(key, e.target.value)}
            disabled={!canEdit}
            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer disabled:opacity-50"
            style={{ background: 'var(--g-line)', accentColor: 'var(--g-accent)' }}
          />
          <span
            className="text-sm font-mono w-16 text-right"
            style={{ color: !isValid ? '#d44848' : 'var(--g-text)', fontWeight: !isValid ? 700 : 400 }}
          >
            {(weights[key] * 100).toFixed(1)}%
          </span>
        </div>
      ))}

      <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--g-line)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium" style={{ color: 'var(--g-text)' }}>Total:</span>
          <span className="text-sm font-bold" style={{ color: isValid ? '#2fa35f' : '#d44848' }}>
            {(total * 100).toFixed(1)}%
          </span>
          {!isValid && <span className="text-xs" style={{ color: '#d44848' }}>Must equal 100%</span>}
        </div>

        {canEdit && (
          <div className="flex items-center gap-2">
            {message && <span className="text-xs" style={{ color: '#2fa35f' }}>{message}</span>}
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg"
              style={{ color: 'var(--g-dim)', border: '1px solid var(--g-line)' }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to Default
            </button>
            <button
              onClick={handleSave}
              disabled={!isValid || saving}
              className="glass-btn-primary flex items-center gap-1 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Weights'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
