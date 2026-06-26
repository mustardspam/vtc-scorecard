import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../hooks/useActivityLog'
import { useAuth } from '../../hooks/useAuth'
import { Save } from 'lucide-react'

export default function FeedbackRulesEditor() {
  const [rules, setRules] = useState([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const { user } = useAuth()

  useEffect(() => { loadRules() }, [])

  async function loadRules() {
    const { data } = await supabase.from('feedback_point_rules').select('*').order('sort_order')
    setRules(data || [])
  }

  function handleChange(id, value) {
    setRules(prev => prev.map(r => r.id === id ? { ...r, points: Number(value) } : r))
    setMessage('')
  }

  async function handleSave() {
    setSaving(true)
    const before = rules.map(r => ({ label: r.label, points: r.points }))
    for (const rule of rules) {
      await supabase.from('feedback_point_rules').update({
        points: rule.points, updated_by: user.id, updated_at: new Date().toISOString()
      }).eq('id', rule.id)
    }
    await logActivity('rules_updated', 'Updated feedback point rules', { before, after: rules.map(r => ({ label: r.label, points: r.points })) })
    setMessage('Rules saved')
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Feedback Point Values</h2>
      <p className="text-sm text-gray-500">These points determine how builder feedback affects vendor scores. Higher = better.</p>

      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Category</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Severity</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Points</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rules.map(rule => (
            <tr key={rule.id}>
              <td className="px-3 py-2 capitalize">{rule.category}</td>
              <td className="px-3 py-2 capitalize text-gray-500">{rule.severity || '—'}</td>
              <td className="px-3 py-2">
                <input
                  type="number"
                  value={rule.points}
                  onChange={e => handleChange(rule.id, e.target.value)}
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-3">
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-1 px-4 py-2 text-sm glass-btn-primary disabled:opacity-50">
          <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Rules'}
        </button>
        {message && <span className="text-xs text-green-600">{message}</span>}
      </div>
    </div>
  )
}
