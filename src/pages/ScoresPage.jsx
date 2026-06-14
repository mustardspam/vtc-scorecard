import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ArrowUpDown, Search, Download, ChevronDown, ChevronUp, RefreshCw, Printer, ClipboardList, X } from 'lucide-react'
import { useThresholds } from '../hooks/useThresholds'
import { useAuth } from '../hooks/useAuth'
import { logActivity } from '../hooks/useActivityLog'
import TierBadge from '../components/scores/TierBadge'
import TrendSparkline from '../components/scores/TrendSparkline'
import VendorReportCard from '../components/scores/VendorReportCard'

const VENDOR_ACTION_TYPES = [
  'Notice Sent', 'Meeting Scheduled', 'Meeting Held',
  'Placed on Hold', 'Removed from Bid List', 'Reinstated',
  'Performance Improvement Plan', 'Other',
]

function scoreColor(score) {
  if (score == null) return 'text-gray-400'
  if (score >= 85) return 'text-green-700'
  if (score >= 70) return 'text-yellow-700'
  if (score >= 50) return 'text-orange-700'
  return 'text-red-700'
}

function scoreBg(score) {
  if (score == null) return ''
  if (score >= 85) return 'bg-green-50'
  if (score >= 70) return 'bg-yellow-50'
  if (score >= 50) return 'bg-orange-50'
  return 'bg-red-50'
}

export default function ScoresPage() {
  const [scores, setScores] = useState([])
  const [trendMap, setTrendMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [recalculating, setRecalculating] = useState(false)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState('weighted_total')
  const [sortDir, setSortDir] = useState('desc')
  const [expandedId, setExpandedId] = useState(null)
  const [drillDown, setDrillDown] = useState(null)
  const [reportCard, setReportCard] = useState(null)
  const [logActionTarget, setLogActionTarget] = useState(null)
  const { getTier, hasEnoughData } = useThresholds()
  const { isManager } = useAuth()
  const canEdit = isManager()

  useEffect(() => { loadScores() }, [])

  async function loadScores() {
    setLoading(true)
    try {
    const [scoresRes, trendRes] = await Promise.all([
      supabase
        .from('score_results')
        .select('*, vendors(name, category_id, vendor_categories(name))')
        .order('weighted_total', { ascending: false, nullsFirst: false }),
      supabase
        .from('snapshot_score_results')
        .select('vendor_id, weighted_total, snapshots(created_at)')
        .not('vendor_id', 'is', null),
    ])

    setScores(scoresRes.data || [])

    const map = {}
    for (const row of (trendRes.data || [])) {
      if (!row.snapshots?.created_at || row.weighted_total == null) continue
      if (!map[row.vendor_id]) map[row.vendor_id] = []
      map[row.vendor_id].push({ score: Number(row.weighted_total), date: row.snapshots.created_at })
    }
    for (const id of Object.keys(map)) {
      map[id].sort((a, b) => new Date(a.date) - new Date(b.date))
    }
    setTrendMap(map)
    } catch (err) {
      console.error('loadScores error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleRecalculate() {
    setRecalculating(true)
    await supabase.rpc('calculate_scores')
    await loadScores()
    setRecalculating(false)
  }

  function handleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const filtered = scores
    .filter(s => {
      if (!search) return true
      const name = s.vendors?.name?.toLowerCase() || ''
      const cat = s.vendors?.vendor_categories?.name?.toLowerCase() || ''
      return name.includes(search.toLowerCase()) || cat.includes(search.toLowerCase())
    })
    .sort((a, b) => {
      const aVal = a[sortField] ?? -Infinity
      const bVal = b[sortField] ?? -Infinity
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })

  async function loadDrillDown(scoreResult) {
    if (expandedId === scoreResult.id) {
      setExpandedId(null)
      setDrillDown(null)
      return
    }
    setExpandedId(scoreResult.id)
    const vendorId = scoreResult.vendor_id
    const [schedRes, safetyRes, reworkRes, feedbackRes] = await Promise.all([
      supabase.from('schedule_records').select('*, import_batches(uploaded_files(original_filename))').eq('vendor_id', vendorId).order('period_month', { ascending: false }).limit(20),
      supabase.from('safety_records').select('*, import_batches(uploaded_files(original_filename))').eq('vendor_id', vendorId).order('record_date', { ascending: false }).limit(20),
      supabase.from('rework_records').select('*, import_batches(uploaded_files(original_filename))').eq('vendor_id', vendorId).order('record_date', { ascending: false }).limit(20),
      supabase.from('builder_feedback').select('*').eq('vendor_id', vendorId).eq('is_approved', true).order('submitted_at', { ascending: false }).limit(20),
    ])
    setDrillDown({
      schedule: schedRes.data || [],
      safety: safetyRes.data || [],
      rework: reworkRes.data || [],
      feedback: feedbackRes.data || [],
    })
  }

  function exportCSV() {
    const headers = ['Rank', 'Vendor', 'Category', 'Safety', 'Schedule', 'Rework', 'Feedback', 'Weighted Total']
    const rows = filtered.map((s, i) => [
      i + 1, s.vendors?.name, s.vendors?.vendor_categories?.name,
      s.safety_score ?? '', s.schedule_score ?? '', s.rework_score ?? '',
      s.feedback_score ?? '', s.weighted_total ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vtc-scores-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-gray-400" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {reportCard && (
        <VendorReportCard
          scoreRow={reportCard}
          getTier={getTier}
          onClose={() => setReportCard(null)}
        />
      )}
      {logActionTarget && (
        <LogActionModal
          vendorName={logActionTarget.vendors?.name}
          vendorId={logActionTarget.vendor_id}
          onClose={() => setLogActionTarget(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Scores</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search vendors..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          {canEdit && (
            <button
              onClick={handleRecalculate}
              disabled={recalculating}
              className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
              {recalculating ? 'Recalculating...' : 'Recalculate'}
            </button>
          )}
          <button
            onClick={exportCSV}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-10">#</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor / Trade</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
              {['safety_score', 'schedule_score', 'rework_score', 'feedback_score', 'weighted_total'].map(field => (
                <th
                  key={field}
                  className="px-4 py-3 font-medium text-gray-600 text-right cursor-pointer hover:text-gray-900"
                  onClick={() => handleSort(field)}
                >
                  <span className="flex items-center justify-end gap-1">
                    {field === 'weighted_total' ? 'Total' : field.replace('_score', '').charAt(0).toUpperCase() + field.replace('_score', '').slice(1)}
                    <SortIcon field={field} />
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 font-medium text-gray-600 text-center">Trend</th>
              <th className="px-2 py-3 w-10 no-print" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((s, i) => (
              <>
                <tr
                  key={s.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => loadDrillDown(s)}
                >
                  <td className="px-4 py-3 text-gray-500">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{s.vendors?.name || '—'}</div>
                    <TierBadge score={s.weighted_total} getTier={getTier} />
                  </td>
                  <td className="px-4 py-3 text-gray-500">{s.vendors?.vendor_categories?.name || '—'}</td>
                  {['safety_score', 'schedule_score', 'rework_score', 'feedback_score', 'weighted_total'].map(field => {
                    const lowData = field !== 'weighted_total' && !hasEnoughData(s, field)
                    return (
                      <td
                        key={field}
                        className={`px-4 py-3 text-right font-mono ${lowData ? 'opacity-50' : scoreColor(s[field])} ${field === 'weighted_total' ? 'font-bold' : ''}`}
                      >
                        <span
                          className={`px-2 py-0.5 rounded ${lowData ? 'bg-gray-100 text-gray-400' : scoreBg(s[field])}`}
                          title={lowData ? 'Low data — fewer records than the minimum threshold' : undefined}
                        >
                          {s[field] != null ? Number(s[field]).toFixed(1) : '—'}
                          {lowData && ' ⚠'}
                        </span>
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-center">
                    <TrendSparkline history={(trendMap[s.vendor_id] || []).map(h => h.score)} />
                  </td>
                  <td className="px-2 py-3 no-print">
                    <button
                      onClick={e => { e.stopPropagation(); setReportCard(s) }}
                      className="p-1.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700"
                      title="Open Report Card"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
                {expandedId === s.id && drillDown && (
                  <tr key={`${s.id}-detail`}>
                    <td colSpan={10} className="px-4 py-4 bg-blue-50">
                      <DrillDownPanel
                        data={drillDown}
                        vendorName={s.vendors?.name}
                        onLogAction={() => setLogActionTarget(s)}
                        canLogAction={canEdit}
                      />
                    </td>
                  </tr>
                )}
              </>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center">
                  {search ? (
                    <>
                      <p className="text-sm font-medium text-gray-700">No results for "{search}"</p>
                      <p className="text-xs text-gray-400 mt-1">Try a different vendor name or clear the search.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-700">No scores yet</p>
                      <p className="text-xs text-gray-400 mt-1">Upload schedule, safety, or rework data to calculate vendor scores.</p>
                    </>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DrillDownPanel({ data, vendorName, onLogAction, canLogAction }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Score Details — {vendorName}</h3>
        {canLogAction && (
          <button
            onClick={onLogAction}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            <ClipboardList className="w-3.5 h-3.5" /> Log Action
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-medium text-gray-600 uppercase mb-2">Schedule Records ({data.schedule.length})</h4>
          {data.schedule.length === 0 ? <p className="text-xs text-gray-400">No schedule data</p> : (
            <div className="space-y-1">
              {data.schedule.map(r => (
                <div key={r.id} className="text-xs bg-white p-2 rounded border border-gray-200">
                  <span className="font-mono">{r.period_month}</span> — {r.total_jobs} jobs, {r.no_shows} no-shows ({((r.adherence_pct || 0) * 100).toFixed(1)}%)
                  <span className="text-gray-400 ml-2">from {r.import_batches?.uploaded_files?.original_filename || '?'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4 className="text-xs font-medium text-gray-600 uppercase mb-2">Safety Incidents ({data.safety.length})</h4>
          {data.safety.length === 0 ? <p className="text-xs text-gray-400">No safety incidents</p> : (
            <div className="space-y-1">
              {data.safety.map(r => (
                <div key={r.id} className="text-xs bg-white p-2 rounded border border-gray-200">
                  <span className="font-mono">{r.record_date}</span> — {r.severity} ({r.severity_points} pts)
                  {r.incident_type && <span className="text-gray-500"> — {r.incident_type}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4 className="text-xs font-medium text-gray-600 uppercase mb-2">Rework / Backcharges ({data.rework.length})</h4>
          {data.rework.length === 0 ? <p className="text-xs text-gray-400">No rework records</p> : (
            <div className="space-y-1">
              {data.rework.map(r => (
                <div key={r.id} className="text-xs bg-white p-2 rounded border border-gray-200">
                  <span className="font-mono">{r.record_date}</span> — ${Number(r.cost).toFixed(2)} ({r.severity}, {r.penalty_points} pts)
                  {r.description && <span className="text-gray-500"> — {r.description}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <h4 className="text-xs font-medium text-gray-600 uppercase mb-2">Feedback ({data.feedback.length})</h4>
          {data.feedback.length === 0 ? <p className="text-xs text-gray-400">No feedback records</p> : (
            <div className="space-y-1">
              {data.feedback.map(r => (
                <div key={r.id} className="text-xs bg-white p-2 rounded border border-gray-200">
                  <span className="font-mono">{new Date(r.submitted_at).toLocaleDateString()}</span> — {r.category}{r.severity ? ` (${r.severity})` : ''} — {r.points} pts
                  {r.description && <p className="text-gray-500 mt-1 truncate">{r.description}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LogActionModal({ vendorName, vendorId, onClose }) {
  const [action, setAction] = useState(VENDOR_ACTION_TYPES[0])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await logActivity('vendor_action', `${action} — ${vendorName}`, {
        vendor_id: vendorId,
        vendor_name: vendorName,
        action,
        note: note.trim(),
      })
      setSaved(true)
      setTimeout(onClose, 1200)
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-blue-600" />
            Log Action — {vendorName}
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action Type</label>
            <select
              value={action}
              onChange={e => setAction(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
            >
              {VENDOR_ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add details about this action..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className="flex-1 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saved ? '✓ Saved' : saving ? 'Saving...' : 'Save Action'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  )
}
