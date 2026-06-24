import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../hooks/useActivityLog'
import { useAuth } from '../../hooks/useAuth'
import { Save } from 'lucide-react'

export default function SeverityRulesEditor() {
  const [safetyRules, setSafetyRules] = useState([])
  const [reworkRules, setReworkRules] = useState([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const { user } = useAuth()

  useEffect(() => { loadRules() }, [])

  async function loadRules() {
    const [sRes, rRes] = await Promise.all([
      supabase.from('safety_severity_rules').select('*').order('sort_order'),
      supabase.from('rework_severity_rules').select('*').order('sort_order'),
    ])
    setSafetyRules(sRes.data || [])
    setReworkRules(rRes.data || [])
  }

  async function handleSave() {
    setSaving(true)
    for (const rule of safetyRules) {
      await supabase.from('safety_severity_rules').update({ points: rule.points, dollar_value: rule.dollar_value, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', rule.id)
    }
    for (const rule of reworkRules) {
      await supabase.from('rework_severity_rules').update({ penalty_points: rule.penalty_points, cost_threshold_low: rule.cost_threshold_low, cost_threshold_high: rule.cost_threshold_high, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', rule.id)
    }
    await logActivity('rules_updated', 'Updated severity rules')
    setMessage('Rules saved')
    setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-2">Safety Severity Points & Risk $ Value</h2>
        <p className="text-sm text-gray-500 mb-3">Points deducted per incident (score = 100 - total_points x multiplier). Dollar value feeds the Risk (12mo) exposure metric — anchored to the 2026 OSHA penalty schedule, editable here.</p>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Severity</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Points</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Risk $ value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {safetyRules.map(r => (
              <tr key={r.id}>
                <td className="px-3 py-2 capitalize">{r.severity.replace('_', ' ')}</td>
                <td className="px-3 py-2"><input type="number" value={r.points} onChange={e => setSafetyRules(prev => prev.map(x => x.id === r.id ? { ...x, points: Number(e.target.value) } : x))} className="w-24 px-2 py-1 border border-gray-300 rounded text-sm" /></td>
                <td className="px-3 py-2"><input type="number" value={r.dollar_value} onChange={e => setSafetyRules(prev => prev.map(x => x.id === r.id ? { ...x, dollar_value: Number(e.target.value) } : x))} className="w-28 px-2 py-1 border border-gray-300 rounded text-sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Rework Severity & Cost Thresholds</h2>
        <p className="text-sm text-gray-500 mb-3">Auto-calculated from backcharge cost. Formula: score = 100 - (total_penalty x multiplier)</p>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Severity</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Penalty Points</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Cost Min ($)</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Cost Max ($)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {reworkRules.map(r => (
              <tr key={r.id}>
                <td className="px-3 py-2 capitalize">{r.severity}</td>
                <td className="px-3 py-2"><input type="number" value={r.penalty_points} onChange={e => setReworkRules(prev => prev.map(x => x.id === r.id ? { ...x, penalty_points: Number(e.target.value) } : x))} className="w-20 px-2 py-1 border border-gray-300 rounded text-sm" /></td>
                <td className="px-3 py-2"><input type="number" value={r.cost_threshold_low || ''} onChange={e => setReworkRules(prev => prev.map(x => x.id === r.id ? { ...x, cost_threshold_low: Number(e.target.value) || null } : x))} className="w-24 px-2 py-1 border border-gray-300 rounded text-sm" /></td>
                <td className="px-3 py-2"><input type="number" value={r.cost_threshold_high || ''} onChange={e => setReworkRules(prev => prev.map(x => x.id === r.id ? { ...x, cost_threshold_high: Number(e.target.value) || null } : x))} className="w-24 px-2 py-1 border border-gray-300 rounded text-sm" placeholder="No max" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save All Rules'}
        </button>
        {message && <span className="text-xs text-green-600">{message}</span>}
      </div>
    </div>
  )
}
