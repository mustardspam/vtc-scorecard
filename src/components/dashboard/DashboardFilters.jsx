import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

export default function DashboardFilters({ filters, onChange }) {
  const [categories, setCategories] = useState([])
  const [communities, setCommunities] = useState([])

  useEffect(() => {
    async function load() {
      const [catRes, comRes] = await Promise.all([
        supabase.from('vendor_categories').select('*').order('sort_order'),
        supabase.from('communities').select('*').eq('is_active', true).order('name')
      ])
      setCategories(catRes.data || [])
      setCommunities(comRes.data || [])
    }
    load()
  }, [])

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={filters.category}
        onChange={e => onChange({ ...filters, category: e.target.value })}
        className="glass-input text-sm py-1.5"
      >
        <option value="">All Categories</option>
        {categories.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <select
        value={filters.community}
        onChange={e => onChange({ ...filters, community: e.target.value })}
        className="glass-input text-sm py-1.5"
      >
        <option value="">All Communities</option>
        {communities.map(c => (
          <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
        ))}
      </select>
    </div>
  )
}
