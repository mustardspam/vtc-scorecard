import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ArrowUpDown, Search, Download, ChevronDown, ChevronUp, RefreshCw, MoreHorizontal, X, ArrowLeft } from 'lucide-react'
import { useThresholds } from '../hooks/useThresholds'
import { useAuth } from '../hooks/useAuth'
import { logActivity } from '../hooks/useActivityLog'
import TierBadge from '../components/scores/TierBadge'
import VendorReportCard from '../components/scores/VendorReportCard'
import CategoryChip from '../components/ui/CategoryChip'
import { tierValueColor } from '../lib/design/tokens'

const VENDOR_ACTION_TYPES = [
  'Notice Sent', 'Meeting Scheduled', 'Meeting Held',
  'Placed on Hold', 'Removed from Bid List', 'Reinstated',
  'Performance Improvement Plan', 'Other',
]

const SCORE_FIELDS = ['safety_score', 'schedule_score', 'rework_score', 'feedback_score', 'weighted_total']
const SCORE_LABELS = { safety_score: 'Safety', schedule_score: 'Schedule', rework_score: 'Rework', feedback_score: 'Feedback', weighted_total: 'Total' }

function fmtCurrency(n) {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function countLowDataMetrics(s, hasEnoughData) {
  return ['safety_score', 'schedule_score', 'rework_score', 'feedback_score']
    .filter(f => !hasEnoughData(s, f)).length
}

function trendDelta(history) {
  if (!history || history.length < 2) return null
  const prev = history[history.length - 2]
  const curr = history[history.length - 1]
  return curr - prev
}

export default function ScoresPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const vendorId = searchParams.get('vendor')

  const [scores, setScores] = useState([])
  const [trendMap, setTrendMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [recalculating, setRecalculating] = useState(false)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState('weighted_total')
  const [sortDir, setSortDir] = useState('desc')
  const [reportCard, setReportCard] = useState(null)
  const [logActionTarget, setLogActionTarget] = useState(null)
  const [openMenuId, setOpenMenuId] = useState(null)
  const menuRef = useRef(null)
  const { getTier, hasEnoughData } = useThresholds()
  const { isManager } = useAuth()
  const canEdit = isManager()

  useEffect(() => {
    let mounted = true
    loadScores(mounted)
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenuId(null)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  async function loadScores(mounted = true) {
    setLoading(true)
    try {
      const [scoresRes, trendRes] = await Promise.all([
        supabase.from('score_results').select('*, vendors(name, category_id, vendor_categories(name))').order('weighted_total', { ascending: false, nullsFirst: false }),
        supabase.from('snapshot_score_results').select('vendor_id, weighted_total, snapshots(created_at)').not('vendor_id', 'is', null),
      ])
      if (!mounted) return
      setScores(scoresRes.data || [])
      const map = {}
      for (const row of (trendRes.data || [])) {
        if (!row.snapshots?.created_at || row.weighted_total == null) continue
        if (!map[row.vendor_id]) map[row.vendor_id] = []
        map[row.vendor_id].push({ score: Number(row.weighted_total), date: row.snapshots.created_at })
      }
      for (const id of Object.keys(map)) map[id].sort((a, b) => new Date(a.date) - new Date(b.date))
      setTrendMap(map)
    } catch (err) {
      console.error('loadScores error:', err)
    } finally {
      if (mounted) setLoading(false)
    }
  }

  async function handleRecalculate() {
    setRecalculating(true)
    try {
      const { error } = await supabase.rpc('calculate_scores')
      if (error) throw error
      await loadScores()
    } catch (err) {
      console.error('Recalculate error:', err)
    } finally {
      setRecalculating(false)
    }
  }

  function handleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
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

  function exportCSV() {
    const headers = ['Rank', 'Vendor', 'Category', 'Safety', 'Schedule', 'Rework', 'Feedback', 'Total', 'Risk (12mo)']
    const rows = filtered.map((s, i) => [
      i + 1, s.vendors?.name, s.vendors?.vendor_categories?.name,
      s.safety_score ?? '', s.schedule_score ?? '', s.rework_score ?? '',
      s.feedback_score ?? '', s.weighted_total ?? '', s.risk_exposure_12mo ?? '',
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

  function openVendorDetail(id) {
    setSearchParams({ vendor: id })
  }

  const detailRow = vendorId ? scores.find(s => s.vendor_id === vendorId) : null

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="app-loading-spinner" />
      </div>
    )
  }

  if (vendorId && detailRow) {
    return (
      <div className="space-y-4 min-w-0">
        <button type="button" onClick={() => setSearchParams({})} className="glass-link flex items-center gap-1.5 text-sm bg-transparent border-none cursor-pointer">
          <ArrowLeft className="w-4 h-4" /> Back to Scores
        </button>
        <VendorReportCard scoreRow={detailRow} getTier={getTier} onClose={() => setSearchParams({})} />
      </div>
    )
  }

  return (
    <div className="space-y-4 min-w-0">
      {reportCard && <VendorReportCard scoreRow={reportCard} getTier={getTier} onClose={() => setReportCard(null)} />}
      {logActionTarget && (
        <LogActionModal vendorName={logActionTarget.vendors?.name} vendorId={logActionTarget.vendor_id} onClose={() => setLogActionTarget(null)} />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="glass-page-title">Scores</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--g-dim)' }} />
            <input type="text" placeholder="Search vendors..." value={search} onChange={e => setSearch(e.target.value)} className="glass-input pl-9 py-1.5 text-sm w-52" />
          </div>
          {canEdit && (
            <button type="button" onClick={handleRecalculate} disabled={recalculating} className="glass-btn-secondary flex items-center gap-1.5 text-sm py-1.5">
              <RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
              {recalculating ? 'Recalculating...' : 'Recalculate'}
            </button>
          )}
          <button type="button" onClick={exportCSV} className="glass-btn-secondary flex items-center gap-1.5 text-sm py-1.5">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="overflow-auto" style={{ maxHeight: '62vh' }}>
          <table className="w-full glass-table scores-grid">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left">#</th>
                <th className="text-left">Vendor / Trade</th>
                <th className="text-left">Category</th>
                {SCORE_FIELDS.map(field => (
                  <th key={field} className="text-right cursor-pointer" onClick={() => handleSort(field)}>
                    <span className="inline-flex items-center justify-end gap-1 w-full">{SCORE_LABELS[field]}<SortIcon field={field} /></span>
                  </th>
                ))}
                <th className="text-right cursor-pointer" onClick={() => handleSort('risk_exposure_12mo')}>
                  <span className="inline-flex items-center justify-end gap-1 w-full">Risk<SortIcon field="risk_exposure_12mo" /></span>
                </th>
                <th className="text-center">Trend</th>
                <th className="text-center no-print w-[52px]"> </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const lowCount = countLowDataMetrics(s, hasEnoughData)
                const rowLowData = lowCount > 0
                const totalTier = getTier(s.weighted_total)
                const delta = trendDelta((trendMap[s.vendor_id] || []).map(h => h.score))
                return (
                  <tr
                    key={s.id}
                    className="cursor-pointer transition-colors duration-[120ms]"
                    style={{ opacity: rowLowData ? 0.62 : 1 }}
                    onClick={() => openVendorDetail(s.vendor_id)}
                  >
                    <td style={{ color: 'var(--g-dim)' }}>{i + 1}</td>
                    <td>
                      <div className="font-semibold text-[13px]" style={{ color: 'var(--g-text)' }}>
                        {s.vendors?.name || '—'}
                        {rowLowData && (
                          <span title={`Insufficient data — missing ${lowCount} metric(s)`} className="ml-1">⚠</span>
                        )}
                      </div>
                    </td>
                    <td><CategoryChip name={s.vendors?.vendor_categories?.name} /></td>
                    {SCORE_FIELDS.map(field => {
                      const lowData = field !== 'weighted_total' && !hasEnoughData(s, field)
                      const tier = getTier(s[field])
                      const color = s[field] != null && !lowData ? tierValueColor(tier) : 'var(--g-dim)'
                      return (
                        <td key={field} className={`text-right font-semibold font-mono text-[13px] ${field === 'weighted_total' ? 'font-bold' : ''}`} style={{ color }}>
                          {s[field] != null ? Number(s[field]).toFixed(1) : '—'}
                        </td>
                      )
                    })}
                    <td className="text-right relative group">
                      <span className="font-mono text-[13px]" style={{ color: 'var(--g-text)' }}>{fmtCurrency(s.risk_exposure_12mo)}</span>
                      {s.risk_exposure_12mo != null && (
                        <div className="hidden group-hover:block absolute right-0 top-full mt-1 w-[210px] p-3 rounded-xl z-40 text-left text-xs font-normal glass-panel-solid shadow-lg space-y-1" style={{ color: 'var(--g-dim)' }}>
                          <p>{s.risk_rework_count} rework → {fmtCurrency(s.risk_rework_dollar)}</p>
                          <p>Safety → {fmtCurrency(s.risk_safety_dollar)}</p>
                          <p>{s.risk_noshow_count} no-show{s.risk_noshow_count === 1 ? '' : 's'} → {fmtCurrency(s.risk_noshow_dollar)}</p>
                          {s.risk_low_data && <p style={{ color: '#8a5a08' }}>Limited schedule history</p>}
                        </div>
                      )}
                    </td>
                    <td className="text-center text-sm font-bold">
                      {delta == null ? <span style={{ color: 'var(--g-dim)' }}>—</span>
                        : delta >= 0 ? <span style={{ color: '#1f7a44' }}>▲ {Math.abs(delta).toFixed(1)}</span>
                        : <span style={{ color: '#a72727' }}>▼ {Math.abs(delta).toFixed(1)}</span>}
                    </td>
                    <td className="no-print relative" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="w-7 h-7 rounded-lg flex items-center justify-center mx-auto transition-colors"
                        style={{ color: 'var(--g-dim)' }}
                        onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === s.id ? null : s.id) }}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {openMenuId === s.id && (
                        <div ref={menuRef} className="absolute right-2 top-full mt-1 w-[172px] glass-panel-solid rounded-xl z-50 py-1 shadow-lg text-left">
                          <button type="button" className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--g-panel-2)]" style={{ color: 'var(--g-text)' }} onClick={() => { setReportCard(s); setOpenMenuId(null) }}>🖨 Print report card</button>
                          {canEdit && (
                            <button type="button" className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--g-panel-2)]" style={{ color: 'var(--g-text)' }} onClick={() => { setLogActionTarget(s); setOpenMenuId(null) }}>📋 Log vendor action</button>
                          )}
                          <button type="button" className="w-full text-left px-3 py-2 text-[13px] hover:bg-[var(--g-panel-2)]" style={{ color: 'var(--g-text)' }} onClick={() => { openVendorDetail(s.vendor_id); setOpenMenuId(null) }}>→ View scorecard</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11} className="text-center py-12" style={{ color: 'var(--g-dim)' }}>No vendors match your search</td></tr>
              )}
            </tbody>
          </table>
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
      await logActivity('vendor_action', `${action} — ${vendorName}`, { vendor_id: vendorId, vendor_name: vendorName, action, note: note.trim() })
      setSaved(true)
      setTimeout(onClose, 1200)
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="glass-modal-backdrop">
      <div className="glass-modal w-full max-w-[480px] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="glass-section-title">Log Action — {vendorName}</h3>
          <button type="button" onClick={onClose} className="bg-transparent border-none cursor-pointer" style={{ color: 'var(--g-dim)' }}><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="glass-eyebrow block mb-1">Action Type</label>
            <select value={action} onChange={e => setAction(e.target.value)} className="glass-input w-full">
              {VENDOR_ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label className="glass-eyebrow block mb-1">Notes</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Add details..." rows={3} className="glass-input w-full resize-none" />
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleSave} disabled={saving || saved} className="glass-btn-primary flex-1">{saved ? '✓ Saved' : saving ? 'Saving...' : 'Save Action'}</button>
          <button type="button" onClick={onClose} className="glass-btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  )
}
