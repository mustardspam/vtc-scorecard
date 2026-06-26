import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { logActivity } from '../../hooks/useActivityLog'
import { Plus, Pencil, Save, X } from 'lucide-react'

export default function CommunityManager() {
  const [communities, setCommunities] = useState([])
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', code: '', brand: '' })
  const { user } = useAuth()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const { data } = await supabase.from('communities').select('*').order('name')
    setCommunities(data || [])
  }

  async function handleSave() {
    if (!form.name || !form.code) return
    if (editing) {
      await supabase.from('communities').update({ name: form.name, code: form.code, brand: form.brand || null }).eq('id', editing)
      setEditing(null)
    } else {
      await supabase.from('communities').insert({ name: form.name, code: form.code, brand: form.brand || null, created_by: user.id })
    }
    setForm({ name: '', code: '', brand: '' })
    setCreating(false)
    loadData()
  }

  async function handleToggleActive(id, name, currentActive) {
    if (currentActive && !confirm(`Mark ${name} inactive? It will be hidden from filters, the map, and feedback forms.`)) return
    await supabase.from('communities').update({ is_active: !currentActive }).eq('id', id)
    await logActivity(currentActive ? 'community_deactivated' : 'community_reactivated', `${currentActive ? 'Deactivated' : 'Reactivated'} community: ${name}`, { community_name: name })
    loadData()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Communities ({communities.length})</h2>
        <button onClick={() => { setCreating(true); setEditing(null); setForm({ name: '', code: '', brand: '' }) }}
          className="flex items-center gap-1 px-3 py-1.5 text-sm glass-btn-primary">
          <Plus className="w-4 h-4" /> Add Community
        </button>
      </div>

      {creating && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <input type="text" placeholder="Community name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <input type="text" placeholder="Code (e.g., HOUFM) *" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <select value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">Brand</option>
              <option value="Ashton Woods">Ashton Woods</option>
              <option value="Starlight">Starlight</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"><Save className="w-3.5 h-3.5" /> Save</button>
            <button onClick={() => { setCreating(false); setEditing(null) }} className="flex items-center gap-1 glass-btn-secondary text-sm py-1.5"><X className="w-3.5 h-3.5" /> Cancel</button>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Code</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Brand</th>
            <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
            <th className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {communities.map(c => (
            <tr key={c.id}>
              <td className="px-3 py-2 font-medium">{c.name}</td>
              <td className="px-3 py-2 font-mono text-gray-500">{c.code}</td>
              <td className="px-3 py-2 text-gray-500">{c.brand || '—'}</td>
              <td className="px-3 py-2">
                <button onClick={() => handleToggleActive(c.id, c.name, c.is_active)}
                  title={c.is_active ? 'Click to mark inactive' : 'Click to reactivate'}
                  className={`text-xs px-2 py-0.5 rounded cursor-pointer ${c.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {c.is_active ? 'Active' : 'Inactive'}
                </button>
              </td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => { setEditing(c.id); setForm({ name: c.name, code: c.code, brand: c.brand || '' }); setCreating(true) }} className="p-1 text-gray-400 hover:text-blue-600"><Pencil className="w-3.5 h-3.5" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
