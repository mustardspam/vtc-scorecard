import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useLoadGuard } from '../hooks/useLoadGuard'
import { logActivity } from '../hooks/useActivityLog'
import { Camera, Eye, GitCompare, Trash2, Save, ChevronDown, ChevronUp } from 'lucide-react'

const INSERT_CHUNK = 500
const SCORE_PAGE_SIZE = 1000
const MAX_SCORE_PAGES = 50

async function fetchSnapshotList() {
  const { data: rows, error } = await supabase
    .from('snapshots')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)

  const snapshots = rows || []
  const creatorIds = [...new Set(snapshots.map(s => s.created_by).filter(Boolean))]
  if (!creatorIds.length) return snapshots

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', creatorIds)

  if (profileError) {
    console.warn('Could not load snapshot creators:', profileError.message)
    return snapshots
  }

  const byId = Object.fromEntries((profiles || []).map(p => [p.id, p]))
  return snapshots.map(s => ({ ...s, profiles: byId[s.created_by] || null }))
}

async function fetchAllScoreResults() {
  let all = []
  let from = 0
  for (let page = 0; page < MAX_SCORE_PAGES; page++) {
    const { data, error } = await supabase
      .from('score_results')
      .select('*, vendors(name, vendor_categories(name))')
      .order('weighted_total', { ascending: false, nullsFirst: false })
      .order('vendor_id', { ascending: true })
      .range(from, from + SCORE_PAGE_SIZE - 1)
    if (error) throw new Error('Load scores: ' + error.message)
    if (!data?.length) break
    all.push(...data)
    if (data.length < SCORE_PAGE_SIZE) break
    from += SCORE_PAGE_SIZE
  }
  return all
}

async function insertInChunks(table, rows, label) {
  if (!rows.length) return
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const chunk = rows.slice(i, i + INSERT_CHUNK)
    const { error } = await supabase.from(table).insert(chunk)
    if (error) {
      throw new Error(`${label} (rows ${i + 1}–${i + chunk.length}): ${error.message}`)
    }
  }
}

function mapScoreToSnapshotRow(snapshotId, s) {
  return {
    snapshot_id: snapshotId,
    vendor_id: s.vendor_id,
    vendor_name: s.vendors?.name || 'Unknown',
    category_name: s.vendors?.vendor_categories?.name || '',
    safety_score: s.safety_score,
    schedule_score: s.schedule_score,
    rework_score: s.rework_score,
    feedback_score: s.feedback_score,
    safety_incident_count: s.safety_incident_count,
    schedule_total_jobs: s.schedule_total_jobs,
    schedule_no_shows: s.schedule_no_shows,
    rework_count: s.rework_count,
    feedback_count: s.feedback_count,
    weighted_total: s.weighted_total,
    overall_rank: s.overall_rank,
    category_rank: s.category_rank,
  }
}

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveProgress, setSaveProgress] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [compareIds, setCompareIds] = useState([])
  const [comparison, setComparison] = useState(null)
  const { user, isAdmin, isManager } = useAuth()
  const { begin, isCurrent } = useLoadGuard()

  useEffect(() => {
    loadSnapshots()
  }, [])

  async function loadSnapshots() {
    const seq = begin()
    setLoading(true)
    setLoadError('')
    try {
      const rows = await fetchSnapshotList()
      if (!isCurrent(seq)) return
      setSnapshots(rows)
    } catch (err) {
      console.error('loadSnapshots error:', err)
      if (!isCurrent(seq)) return
      setLoadError(err.message || 'Could not load snapshots')
      setSnapshots([])
    } finally {
      if (isCurrent(seq)) setLoading(false)
    }
  }

  async function handleCreate() {
    if (!createForm.name || !user?.id) return
    setSaving(true)
    setSaveError('')
    setSaveProgress('Loading current scores…')
    let snapshotId = null
    try {
      const [scores, weightsRes, filesRes] = await Promise.all([
        fetchAllScoreResults(),
        supabase.from('score_weights').select('*').eq('is_current', true).maybeSingle(),
        supabase.from('uploaded_files').select('id, original_filename, file_type').order('uploaded_at', { ascending: false }).limit(100),
      ])

      if (weightsRes.error) throw new Error('Load weights: ' + weightsRes.error.message)
      if (filesRes.error) throw new Error('Load files: ' + filesRes.error.message)
      const weights = weightsRes.data
      const files = filesRes.data || []

      setSaveProgress('Creating snapshot…')
      const { data: snapshot, error: snapError } = await supabase.from('snapshots').insert({
        name: createForm.name,
        description: createForm.description || null,
        notes: createForm.notes || null,
        created_by: user.id,
      }).select().single()

      if (snapError) throw new Error('Create snapshot: ' + snapError.message)
      snapshotId = snapshot.id

      if (scores.length) {
        setSaveProgress(`Saving ${scores.length} vendor scores…`)
        await insertInChunks(
          'snapshot_score_results',
          scores.map(s => mapScoreToSnapshotRow(snapshot.id, s)),
          'Save vendor scores',
        )
      }

      if (weights) {
        setSaveProgress('Saving weights…')
        const { error: weightsError } = await supabase.from('snapshot_weights').insert({
          snapshot_id: snapshot.id,
          safety_weight: weights.safety_weight,
          schedule_weight: weights.schedule_weight,
          inspections_weight: weights.inspections_weight ?? 0,
          rework_weight: weights.rework_weight,
          warranty_weight: weights.warranty_weight ?? 0,
          feedback_weight: weights.feedback_weight,
        })
        if (weightsError) throw new Error('Save weights: ' + weightsError.message)
      }

      if (files.length) {
        setSaveProgress('Saving file references…')
        await insertInChunks(
          'snapshot_file_refs',
          files.map(f => ({
            snapshot_id: snapshot.id,
            uploaded_file_id: f.id,
            file_type: ['schedule', 'safety', 'rework', 'vendor_master', 'community_reference', 'other'].includes(f.file_type)
              ? f.file_type
              : null,
            original_filename: f.original_filename,
          })),
          'Save file references',
        )
      }

      logActivity('snapshot_created', `Created snapshot: ${createForm.name}`, { snapshot_id: snapshot.id }).catch(() => {})

      setShowCreate(false)
      setCreateForm({ name: '', description: '', notes: '' })
      setSaveProgress('')
      loadSnapshots()
    } catch (err) {
      console.error('handleCreate error:', err)
      if (snapshotId) {
        await supabase.from('snapshots').delete().eq('id', snapshotId)
      }
      setSaveError(err.message || 'Failed to create snapshot')
    } finally {
      setSaving(false)
      setSaveProgress('')
    }
  }

  async function viewDetail(id) {
    if (expandedId === id) { setExpandedId(null); setDetail(null); return }
    setExpandedId(id)
    const [scoresRes, weightsRes, filesRes] = await Promise.all([
      supabase.from('snapshot_score_results').select('*').eq('snapshot_id', id).order('weighted_total', { ascending: false, nullsFirst: false }),
      supabase.from('snapshot_weights').select('*').eq('snapshot_id', id).single(),
      supabase.from('snapshot_file_refs').select('*').eq('snapshot_id', id),
    ])
    setDetail({ scores: scoresRes.data || [], weights: weightsRes.data, files: filesRes.data || [] })
  }

  function toggleCompare(id) {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= 2) return [prev[1], id]
      return [...prev, id]
    })
    setComparison(null)
  }

  async function runComparison() {
    if (compareIds.length !== 2) return
    const [res1, res2] = await Promise.all(
      compareIds.map(id => supabase.from('snapshot_score_results').select('*').eq('snapshot_id', id).order('vendor_name'))
    )
    const [w1, w2] = await Promise.all(
      compareIds.map(id => supabase.from('snapshot_weights').select('*').eq('snapshot_id', id).single())
    )
    const snap1 = snapshots.find(s => s.id === compareIds[0])
    const snap2 = snapshots.find(s => s.id === compareIds[1])

    const vendorMap = new Map()
    for (const s of (res1.data || [])) vendorMap.set(s.vendor_name, { snap1: s })
    for (const s of (res2.data || [])) {
      const existing = vendorMap.get(s.vendor_name) || {}
      vendorMap.set(s.vendor_name, { ...existing, snap2: s })
    }

    setComparison({
      snap1Name: snap1?.name, snap2Name: snap2?.name,
      weights1: w1.data, weights2: w2.data,
      vendors: [...vendorMap.entries()].map(([name, data]) => ({ name, ...data })),
    })
  }

  async function handleDelete(id) {
    if (!confirm('Are you sure you want to delete this snapshot? This cannot be undone.')) return
    try {
      const { error } = await supabase.from('snapshots').delete().eq('id', id)
      if (error) throw error
      logActivity('snapshot_deleted', 'Deleted snapshot', { snapshot_id: id }).catch(() => {})
      loadSnapshots()
    } catch (err) {
      alert('Could not delete snapshot: ' + err.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="glass-page-title">Snapshots</h1>
        <div className="flex items-center gap-2">
          {compareIds.length === 2 && (
            <button onClick={runComparison} className="flex items-center gap-1 px-3 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">
              <GitCompare className="w-4 h-4" /> Compare Selected
            </button>
          )}
          {(isAdmin() || isManager()) && (
            <button onClick={() => { setShowCreate(!showCreate); setSaveError('') }} className="flex items-center gap-1 px-3 py-1.5 text-sm glass-btn-primary">
              <Camera className="w-4 h-4" /> Save Snapshot
            </button>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="glass-panel p-6 space-y-3">
          <h2 className="text-lg font-semibold">Create Snapshot</h2>
          <input type="text" placeholder="Snapshot name *" value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <input type="text" placeholder="Description" value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          <textarea placeholder="Notes" value={createForm.notes} onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
          <button onClick={handleCreate} disabled={!createForm.name || saving}
            className="flex items-center gap-1 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Snapshot'}
          </button>
          {saveProgress && saving && (
            <p className="text-xs text-gray-500">{saveProgress}</p>
          )}
          {saveError && (
            <p className="text-sm text-red-600">{saveError}</p>
          )}
        </div>
      )}

      {comparison && (
        <div className="bg-white rounded-xl border border-purple-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Comparison: {comparison.snap1Name} vs {comparison.snap2Name}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left">Vendor</th>
                  <th className="px-3 py-2 text-right">{comparison.snap1Name}</th>
                  <th className="px-3 py-2 text-right">{comparison.snap2Name}</th>
                  <th className="px-3 py-2 text-right">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {comparison.vendors.map(v => {
                  const s1 = v.snap1?.weighted_total
                  const s2 = v.snap2?.weighted_total
                  const delta = s1 != null && s2 != null ? Number(s2) - Number(s1) : null
                  return (
                    <tr key={v.name}>
                      <td className="px-3 py-1.5 font-medium">{v.name}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{s1 != null ? Number(s1).toFixed(1) : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{s2 != null ? Number(s2).toFixed(1) : '—'}</td>
                      <td className={`px-3 py-1.5 text-right font-mono font-bold ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="app-loading-spinner" /></div>
      ) : loadError ? (
        <div className="glass-panel p-12 text-center space-y-3">
          <p className="text-sm text-red-600">{loadError}</p>
          <button type="button" onClick={loadSnapshots} className="glass-btn-secondary text-sm px-4 py-2">
            Retry
          </button>
        </div>
      ) : snapshots.length === 0 ? (
        <div className="glass-panel p-12 text-center">
          <Camera className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No snapshots yet. Save one to preserve the current scorecard state.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {snapshots.map(snap => (
            <div key={snap.id} className={`bg-white rounded-xl border ${compareIds.includes(snap.id) ? 'border-purple-400 ring-2 ring-purple-200' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <input type="checkbox" checked={compareIds.includes(snap.id)} onChange={() => toggleCompare(snap.id)}
                    className="accent-purple-600" />
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{snap.name}</p>
                      {snap.name?.startsWith('Week ending') && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 font-medium border border-teal-200">Auto</span>
                      )}
                    </div>
                    {snap.description && <p className="text-xs text-gray-500">{snap.description}</p>}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(snap.created_at).toLocaleString()} · by {snap.profiles?.full_name || snap.profiles?.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => viewDetail(snap.id)} className="flex items-center gap-1 px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">
                    {expandedId === snap.id ? <ChevronUp className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {expandedId === snap.id ? 'Hide' : 'View'}
                  </button>
                  {isAdmin() && (
                    <button onClick={() => handleDelete(snap.id)} className="p-1 text-red-400 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {expandedId === snap.id && detail && (
                <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-3">
                  {detail.weights && (
                    <div className="text-xs text-gray-500">
                      Weights: Safety {(detail.weights.safety_weight * 100).toFixed(1)}% · Schedule {(detail.weights.schedule_weight * 100).toFixed(1)}% · Rework {(detail.weights.rework_weight * 100).toFixed(1)}% · Feedback {(detail.weights.feedback_weight * 100).toFixed(1)}%
                    </div>
                  )}
                  {detail.files.length > 0 && (
                    <div className="text-xs text-gray-500">
                      Source files: {detail.files.map(f => f.original_filename).join(', ')}
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-white">
                        <tr>
                          <th className="px-3 py-2 text-left">Rank</th>
                          <th className="px-3 py-2 text-left">Vendor</th>
                          <th className="px-3 py-2 text-left">Category</th>
                          <th className="px-3 py-2 text-right">Safety</th>
                          <th className="px-3 py-2 text-right">Schedule</th>
                          <th className="px-3 py-2 text-right">Rework</th>
                          <th className="px-3 py-2 text-right">Feedback</th>
                          <th className="px-3 py-2 text-right font-bold">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {detail.scores.map(s => (
                          <tr key={s.id}>
                            <td className="px-3 py-1.5 text-gray-400">#{s.overall_rank || '—'}</td>
                            <td className="px-3 py-1.5 font-medium">{s.vendor_name}</td>
                            <td className="px-3 py-1.5 text-gray-500">{s.category_name}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{s.safety_score != null ? Number(s.safety_score).toFixed(1) : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{s.schedule_score != null ? Number(s.schedule_score).toFixed(1) : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{s.rework_score != null ? Number(s.rework_score).toFixed(1) : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{s.feedback_score != null ? Number(s.feedback_score).toFixed(1) : '—'}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-bold">{s.weighted_total != null ? Number(s.weighted_total).toFixed(1) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
