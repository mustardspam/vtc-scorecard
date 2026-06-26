import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 1000
const MAX_PAGES = 50

async function fetchAllAssignments() {
  let all = []
  let from = 0
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from('vendor_community_assignments')
      .select('vendor_id, community_id')
      .order('vendor_id')
      .order('community_id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (!data?.length) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

function pickData(res, label) {
  if (res.error) {
    console.error(`useMapData ${label} error:`, res.error)
    return []
  }
  return res.data || []
}

export function useMapData() {
  const [communities, setCommunities] = useState([])
  const [vendors, setVendors] = useState([])
  const [categories, setCategories] = useState([])
  const [managers, setManagers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [assignmentsLoading, setAssignmentsLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function loadCore() {
      setLoading(true)
      setError('')
      try {
        const [commRes, vendorRes, catRes, managerRes] = await Promise.all([
          supabase.from('communities').select('*').order('name'),
          supabase.from('vendors').select('id, name, category_id').eq('is_active', true).order('name'),
          supabase.from('vendor_categories').select('id, name').order('name'),
          supabase.from('profiles').select('id, full_name').eq('is_area_manager', true).order('full_name'),
        ])
        if (!mounted) return

        const comms = pickData(commRes, 'communities')
        const vends = pickData(vendorRes, 'vendors')
        const cats = pickData(catRes, 'categories')
        const mgrs = pickData(managerRes, 'managers')

        setCommunities(comms)
        setVendors(vends)
        setCategories(cats)
        setManagers(mgrs)

        if (!comms.length && (commRes.error || vendorRes.error)) {
          setError('Could not load map data. Please refresh.')
        }
      } catch (err) {
        console.error('useMapData core load error:', err)
        if (mounted) setError('Could not load map data. Please refresh.')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    async function loadAssignments() {
      setAssignmentsLoading(true)
      try {
        const all = await fetchAllAssignments()
        if (mounted) setAssignments(all)
      } catch (err) {
        console.error('useMapData assignments load error:', err)
      } finally {
        if (mounted) setAssignmentsLoading(false)
      }
    }

    loadCore()
    loadAssignments()
    return () => { mounted = false }
  }, [])

  return {
    communities,
    vendors,
    categories,
    managers,
    assignments,
    loading,
    assignmentsLoading,
    error,
  }
}
