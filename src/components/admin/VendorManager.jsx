import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { logActivity } from '../../hooks/useActivityLog'
import { useAuth } from '../../hooks/useAuth'
import { Plus, Pencil, Search, Save, X } from 'lucide-react'

export default function VendorManager() {
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [editing, setEditing] = useState(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', category_id: '', is_trade: true })
  const { user } = useAuth()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [vRes, cRes] = await Promise.all([
      supabase.from('vendors').select('*, vendor_categories(name)').order('name'),
      supabase.from('vendor_categories').select('*').order('sort_order'),
    ])
    setVendors(vRes.data || [])
    setCategories(cRes.data || [])
  }

  async function handleSave() {
    if (!form.name || !form.category_id) return
    if (editing) {
      await supabase.from('vendors').update({
        name: form.name, category_id: form.category_id, is_trade: form.is_trade, updated_at: new Date().toISOString()
      }).eq('id', editing)
      setEditing(null)
    } else {
      await supabase.from('vendors').insert({
        name: form.name, category_id: form.category_id, is_trade: form.is_trade, created_by: user.id
      })
      await logActivity('vendor_created', `Added vendor: ${form.name}`, { vendor_name: form.name })
    }
    setForm({ name: '', category_id: '', is_trade: true })
    setCreating(false)
    loadData()
  }

  async function handleToggleActive(id, name, currentActive) {
    if (currentActive && !confirm(`Deactivate ${name}? Historical records will be preserved, and their score will drop out of the dashboard averages.`)) return
    await supabase.from('vendors').update({ is_active: !currentActive }).eq('id', id)
    await supabase.rpc('calculate_scores')
    await logActivity(currentActive ? 'vendor_deactivated' : 'vendor_reactivated', `${currentActive ? 'Deactivated' : 'Reactivated'} vendor: ${name}`, { vendor_name: name })
    loadData()
  }

  function startEdit(v) {
    setEditing(v.id)
    setForm({ name: v.name, category_id: v.category_id, is_trade: v.is_trade })
    setCreating(true)
  }

  const filtered = vendors.filter(v =>
    (showAll || v.is_active) &&
    (v.name.toLowerCase().includes(search.toLowerCase()) ||
      v.vendor_categories?.name?.toLowerCase().includes(search.toLowerCase()))
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Vendors & Trades ({filtered.length})</h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-sm bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setShowAll(false)}
              className={`px-2.5 py-1 rounded-md ${!showAll ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
              Active only
            </button>
            <button onClick={() => setShowAll(true)}
              className={`px-2.5 py-1 rounded-md ${showAll ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
              Show all
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg outline-none" />
          </div>
          <button onClick={() => { setCreating(true); setEditing(null); setForm({ name: '', category_id: '', is_trade: true }) }}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Add Vendor
          </button>
        </div>
      </div>

      {creating && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">{editing ? 'Edit Vendor' : 'New Vendor'}</h3>
          <div className="grid grid-cols-3 gap-3">
            <input type="text" placeholder="Vendor name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
              <option value="">Select category *</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_trade} onChange={e => setForm(f => ({ ...f, is_trade: e.target.checked }))} />
              Field labor (trade)
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">
              <Save className="w-3.5 h-3.5" /> Save
            </button>
            <button onClick={() => { setCreating(false); setEditing(null) }} className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-y-auto max-h-[500px]">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Category</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Type</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(v => (
              <tr key={v.id} className={!v.is_active ? 'opacity-50' : ''}>
                <td className="px-3 py-2 font-medium">{v.name}</td>
                <td className="px-3 py-2 text-gray-500">{v.vendor_categories?.name}</td>
                <td className="px-3 py-2 text-gray-500">{v.is_trade ? 'Trade' : 'Vendor'}</td>
                <td className="px-3 py-2">
                  <button onClick={() => handleToggleActive(v.id, v.name, v.is_active)}
                    title={v.is_active ? 'Click to deactivate' : 'Click to reactivate'}
                    className={`text-xs px-2 py-0.5 rounded cursor-pointer ${v.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    {v.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => startEdit(v)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
