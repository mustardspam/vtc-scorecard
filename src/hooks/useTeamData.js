import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'

export function useTeamData() {
  const [acms, setAcms] = useState([])
  const [builders, setBuilders] = useState([])
  const [communities, setCommunities] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [acmRes, builderRes, commRes, assignRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, email, is_area_manager')
          .eq('is_area_manager', true)
          .eq('is_active', true)
          .order('full_name'),
        supabase
          .from('profiles')
          .select('id, full_name, email, acm_id, is_builder, is_front_end_builder')
          .eq('is_builder', true)
          .eq('is_active', true)
          .order('full_name'),
        supabase
          .from('communities')
          .select('id, name, code, brand, area_manager_id')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('builder_community_assignments')
          .select('profile_id, community_id, assignment_type'),
      ])

      if (acmRes.error) throw acmRes.error
      if (builderRes.error) throw builderRes.error
      if (commRes.error) throw commRes.error
      if (assignRes.error) throw assignRes.error

      setAcms(acmRes.data || [])
      setBuilders(builderRes.data || [])
      setCommunities(commRes.data || [])
      setAssignments(assignRes.data || [])
    } catch (err) {
      console.error('useTeamData load error:', err)
      setError(err.message || 'Could not load team data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const communityMap = useMemo(() => {
    const map = new Map()
    for (const c of communities) map.set(c.id, c)
    return map
  }, [communities])

  const teams = useMemo(() => {
    const acmIds = new Set(acms.map(a => a.id))
    const assignmentMap = new Map()
    for (const a of assignments) {
      if (!assignmentMap.has(a.profile_id)) assignmentMap.set(a.profile_id, [])
      assignmentMap.get(a.profile_id).push(a)
    }

    const enrichBuilder = (b) => ({
      ...b,
      assignments: (assignmentMap.get(b.id) || [])
        .map(a => ({ ...a, community: communityMap.get(a.community_id) }))
        .filter(a => a.community)
        .sort((x, y) => (x.assignment_type === 'primary' ? 0 : 1) - (y.assignment_type === 'primary' ? 0 : 1)),
    })

    const grouped = acms.map(acm => ({
      ...acm,
      communities: communities.filter(c => c.area_manager_id === acm.id),
      builders: builders
        .filter(b => b.acm_id === acm.id)
        .map(enrichBuilder),
    }))

    const unassigned = builders
      .filter(b => !b.acm_id || !acmIds.has(b.acm_id))
      .map(enrichBuilder)

    return { grouped, unassigned }
  }, [acms, builders, communities, assignments, communityMap])

  const pruneInvalidAssignments = useCallback(async (builderId, acmId) => {
    const validIds = new Set(
      communities.filter(c => c.area_manager_id === acmId).map(c => c.id)
    )
    const toRemove = assignments
      .filter(a => a.profile_id === builderId && !validIds.has(a.community_id))
      .map(a => a.community_id)
    if (!toRemove.length) return
    const { error: delErr } = await supabase
      .from('builder_community_assignments')
      .delete()
      .eq('profile_id', builderId)
      .in('community_id', toRemove)
    if (delErr) throw delErr
  }, [assignments, communities])

  const moveBuilderToAcm = useCallback(async (builderId, acmId) => {
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ acm_id: acmId, updated_at: new Date().toISOString() })
      .eq('id', builderId)
    if (updErr) throw updErr
    if (acmId) await pruneInvalidAssignments(builderId, acmId)
    await reload()
  }, [pruneInvalidAssignments, reload])

  const clearBuilderAcm = useCallback(async (builderId) => {
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ acm_id: null, updated_at: new Date().toISOString() })
      .eq('id', builderId)
    if (updErr) throw updErr
    await reload()
  }, [reload])

  const assignCommunity = useCallback(async (builderId, communityId) => {
    const community = communityMap.get(communityId)
    if (!community) throw new Error('Community not found.')

    const builder = builders.find(b => b.id === builderId)
    if (!community.area_manager_id) {
      throw new Error('This community has no area manager assigned.')
    }

    if (builder?.acm_id !== community.area_manager_id) {
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ acm_id: community.area_manager_id, updated_at: new Date().toISOString() })
        .eq('id', builderId)
      if (updErr) throw updErr
      await pruneInvalidAssignments(builderId, community.area_manager_id)
    }

    const current = assignments.filter(a => a.profile_id === builderId)
    if (current.some(a => a.community_id === communityId)) return

    if (current.length >= 1 && !builder?.is_front_end_builder) {
      throw new Error('Promote this builder to front-end before assigning a second community.')
    }

    if (current.length >= 2) {
      throw new Error('Front-end builders can be assigned to at most 2 communities.')
    }

    const assignment_type = current.length === 0 ? 'primary' : 'secondary'
    const { error: insErr } = await supabase
      .from('builder_community_assignments')
      .insert({ profile_id: builderId, community_id: communityId, assignment_type })
    if (insErr) throw insErr
    await reload()
  }, [assignments, builders, communityMap, pruneInvalidAssignments, reload])

  const removeCommunity = useCallback(async (builderId, communityId) => {
    const { error: delErr } = await supabase
      .from('builder_community_assignments')
      .delete()
      .eq('profile_id', builderId)
      .eq('community_id', communityId)
    if (delErr) throw delErr
    await reload()
  }, [reload])

  const promoteToFrontEnd = useCallback(async (builderId) => {
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ is_front_end_builder: true, updated_at: new Date().toISOString() })
      .eq('id', builderId)
    if (updErr) throw updErr
    await reload()
  }, [reload])

  const demoteFromFrontEnd = useCallback(async (builderId) => {
    const secondary = assignments.filter(
      a => a.profile_id === builderId && a.assignment_type === 'secondary'
    )
    if (secondary.length) {
      const { error: delErr } = await supabase
        .from('builder_community_assignments')
        .delete()
        .eq('profile_id', builderId)
        .eq('assignment_type', 'secondary')
      if (delErr) throw delErr
    }
    const { error: updErr } = await supabase
      .from('profiles')
      .update({ is_front_end_builder: false, updated_at: new Date().toISOString() })
      .eq('id', builderId)
    if (updErr) throw updErr
    await reload()
  }, [assignments, reload])

  const clearAllAssignments = useCallback(async (builderId) => {
    const { error: delErr } = await supabase
      .from('builder_community_assignments')
      .delete()
      .eq('profile_id', builderId)
    if (delErr) throw delErr
    const { error: updErr } = await supabase
      .from('profiles')
      .update({
        acm_id: null,
        is_front_end_builder: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', builderId)
    if (updErr) throw updErr
    await reload()
  }, [reload])

  const removeFromTeams = useCallback(async (builderId) => {
    const { error: delErr } = await supabase
      .from('builder_community_assignments')
      .delete()
      .eq('profile_id', builderId)
    if (delErr) throw delErr
    const { error: updErr } = await supabase
      .from('profiles')
      .update({
        is_builder: false,
        acm_id: null,
        is_front_end_builder: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', builderId)
    if (updErr) throw updErr
    await reload()
  }, [reload])

  return {
    acms,
    builders,
    communities,
    assignments,
    teams,
    communityMap,
    loading,
    error,
    reload,
    moveBuilderToAcm,
    clearBuilderAcm,
    assignCommunity,
    removeCommunity,
    promoteToFrontEnd,
    demoteFromFrontEnd,
    clearAllAssignments,
    removeFromTeams,
  }
}
