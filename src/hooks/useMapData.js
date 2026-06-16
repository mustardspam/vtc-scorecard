import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

async function fetchAllAssignments() {
  const pageSize = 1000
  let all = []
  let from = 0
  while (true) {
    const { data } = await supabase
      .from('vendor_community_assignments')
      .select('vendor_id, community_id')
      .range(from, from + pageSize - 1)
    if (!data?.length) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

export function useMapData() {
  const [communities, setCommunities] = useState([])
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [managers, setManagers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const [commRes, vendorRes, catRes, managerRes, allAssignments] = await Promise.all([
        supabase.from('communities').select('*').order('name'),
        supabase.from('vendors').select('id, name, category_id').eq('is_active', true).order('name'),
        supabase.from('vendor_categories').select('id, name').order('name'),
        supabase.from('profiles').select('id, full_name').eq('role', 'manager').order('full_name'),
        fetchAllAssignments(),
      ])
      if (cancelled) return
      setCommunities(commRes.data || [])
      setVendors(vendorRes.data || [])
      setCategories(catRes.data || [])
      setManagers(managerRes.data || [])
      setAssignments(allAssignments)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { communities, vendors, categories, managers, assignments, loading }
}
