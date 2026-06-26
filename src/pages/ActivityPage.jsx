import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ChevronDown, ChevronUp, Users, Activity, Filter, X, AlertTriangle, ClipboardList } from 'lucide-react'
import { cn } from '../lib/cn'

const ACTION_COLORS = {
  file_upload: 'bg-blue-100 text-blue-700',
  import_approved: 'bg-green-100 text-green-700',
  import_rejected: 'bg-red-100 text-red-700',
  scores_calculated: 'bg-purple-100 text-purple-700',
  weights_changed: 'bg-orange-100 text-orange-700',
  weights_reset: 'bg-orange-100 text-orange-700',
  snapshot_created: 'bg-teal-100 text-teal-700',
  snapshot_deleted: 'bg-red-100 text-red-700',
  feedback_submitted: 'bg-blue-100 text-blue-700',
  feedback_approved: 'bg-green-100 text-green-700',
  feedback_rejected: 'bg-red-100 text-red-700',
  vendor_created: 'bg-gray-100 text-gray-700',
  rules_updated: 'bg-yellow-100 text-yellow-700',
  user_role_changed: 'bg-pink-100 text-pink-700',
}

const SEVERITY_STYLES = {
  critical: 'bg-red-100 text-red-700',
  major: 'bg-orange-100 text-orange-700',
  minor: 'bg-yellow-100 text-yellow-700',
}

const TABS = [
  { id: 'feedback', label: 'Feedback Submissions', icon: Users },
  { id: 'outliers', label: 'CM Outlier Tracking', icon: AlertTriangle },
  { id: 'vendor-actions', label: 'Vendor Actions', icon: ClipboardList },
  { id: 'log', label: 'System Log', icon: Activity },
]

export default function ActivityPage() {
  const [tab, setTab] = useState('feedback')

  return (
    <div className="space-y-4">
      <h1 className="glass-page-title">Activity</h1>

      <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: 'var(--g-line)' }}>
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap', tab === t.id ? 'glass-tab-active' : 'glass-tab')}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'feedback' && <FeedbackSubmissionsTab />}
      {tab === 'outliers' && <CMOutlierTab />}
      {tab === 'vendor-actions' && <VendorActionsTab />}
      {tab === 'log' && <SystemLogTab />}
    </div>
  )
}

function FeedbackSubmissionsTab() {
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [filters, setFilters] = useState({ user_id: '', category: '', severity: '', approved: '' })
  const [page, setPage] = useState(0)
  const [last30Stats, setLast30Stats] = useState({ complaints: 0, kudos: 0, total: 0 })
  const PAGE_SIZE = 30

  useEffect(() => { loadUsers(); loadLast30Stats() }, [])
  useEffect(() => { setPage(0); loadSubmissions(0) }, [filters])
  useEffect(() => { loadSubmissions(page) }, [page])

  async function loadUsers() {
    const { data } = await supabase.from('profiles').select('id, full_name, email').order('full_name')
    setUsers(data || [])
  }

  async function loadLast30Stats() {
    const since = new Date()
    since.setDate(since.getDate() - 30)
    const { data } = await supabase
      .from('builder_feedback')
      .select('category')
      .gte('submitted_at', since.toISOString())
    if (data) {
      setLast30Stats({
        complaints: data.filter(s => s.category === 'complaint').length,
        kudos: data.filter(s => s.category === 'kudos').length,
        total: data.length,
      })
    }
  }

  async function loadSubmissions(p = page) {
    setLoading(true)
    let query = supabase
      .from('builder_feedback')
      .select(`
        *,
        vendors(name),
        communities(name),
        submitter:profiles!builder_feedback_submitted_by_fkey(full_name, email),
        cm:profiles!builder_feedback_construction_manager_id_fkey(full_name, email)
      `)
      .order('submitted_at', { ascending: false })
      .range(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1)

    if (filters.user_id) query = query.eq('submitted_by', filters.user_id)
    if (filters.category) query = query.eq('category', filters.category)
    if (filters.severity) query = query.eq('severity', filters.severity)
    if (filters.approved === 'approved') query = query.eq('is_approved', true)
    if (filters.approved === 'rejected') query = query.eq('is_approved', false).not('reviewed_at', 'is', null)
    if (filters.approved === 'pending') query = query.is('reviewed_at', null)

    try {
      const { data } = await query
      setSubmissions(data || [])
    } catch (err) {
      console.error('loadSubmissions error:', err)
    } finally {
      setLoading(false)
    }
  }

  function clearFilters() {
    setFilters({ user_id: '', category: '', severity: '', approved: '' })
  }

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="glass-panel p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Filter className="w-4 h-4 text-gray-400 flex-shrink-0" />

          <select
            value={filters.user_id}
            onChange={e => setFilters(f => ({ ...f, user_id: e.target.value }))}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">All Users</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
            ))}
          </select>

          <select
            value={filters.category}
            onChange={e => setFilters(f => ({ ...f, category: e.target.value, severity: '' }))}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">All Types</option>
            <option value="kudos">Kudos</option>
            <option value="complaint">Complaint</option>
          </select>

          {filters.category === 'complaint' && (
            <select
              value={filters.severity}
              onChange={e => setFilters(f => ({ ...f, severity: e.target.value }))}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">All Severity</option>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="critical">Critical</option>
            </select>
          )}

          <select
            value={filters.approved}
            onChange={e => setFilters(f => ({ ...f, approved: e.target.value }))}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>

          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5 border border-gray-200 rounded-lg">
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Summary bar — always shows last 30 days */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
          <p className="text-xl font-bold text-red-600">{last30Stats.complaints}</p>
          <p className="text-xs text-gray-500 mt-0.5">Complaints</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
          <p className="text-xl font-bold text-green-600">{last30Stats.kudos}</p>
          <p className="text-xs text-gray-500 mt-0.5">Kudos</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 text-center">
          <p className="text-xl font-bold text-gray-700">{last30Stats.total}</p>
          <p className="text-xs text-gray-500 mt-0.5">Submissions (Last 30 Days)</p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="app-loading-spinner" /></div>
      ) : (
        <div className="glass-panel overflow-hidden">
          {submissions.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No submissions match the current filters.</div>
          ) : (
            <>
              <div className="divide-y divide-gray-100">
                {submissions.map(s => {
                  const submitter = s.submitter?.full_name || s.submitter?.email || 'Unknown'
                  const cm = s.cm?.full_name || s.cm?.email
                  const isExpanded = expandedId === s.id

                  return (
                    <div key={s.id} className="px-4 py-3">
                      <div
                        className="flex items-start justify-between gap-4 cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      >
                        {/* Left: submitter + vendor + type */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* Submitter chip */}
                            <span className="inline-flex items-center gap-1 text-xs font-medium bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                              <Users className="w-3 h-3" />
                              {submitter}
                            </span>

                            {/* Vendor */}
                            <span className="text-sm font-medium text-gray-900">{s.vendors?.name || '—'}</span>

                            {/* Type badge */}
                            {s.category === 'kudos' ? (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Kudos</span>
                            ) : (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SEVERITY_STYLES[s.severity] || 'bg-gray-100 text-gray-700'}`}>
                                {s.severity ? `${s.severity.charAt(0).toUpperCase() + s.severity.slice(1)} Complaint` : 'Complaint'}
                              </span>
                            )}

                            {/* Points */}
                            <span className="text-xs font-mono text-gray-500">{s.points} pts</span>
                          </div>

                          {/* Description preview */}
                          <p className="text-xs text-gray-500 line-clamp-1">{s.description}</p>

                          {/* Community + CM */}
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            {s.communities?.name && <span>{s.communities.name}</span>}
                            {cm && <span>CM: {cm}</span>}
                          </div>
                        </div>

                        {/* Right: status + date + expand */}
                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          {s.is_approved ? (
                            <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded">Approved</span>
                          ) : s.reviewed_at ? (
                            <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded">Rejected</span>
                          ) : (
                            <span className="text-xs font-medium text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded">Pending</span>
                          )}
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {new Date(s.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          <span className="text-xs text-gray-400">
                            {new Date(s.submitted_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="mt-3 pl-2 border-l-2 border-gray-200 space-y-2 text-sm text-gray-700">
                          <p className="whitespace-pre-wrap">{s.description}</p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-500 pt-1">
                            <span><strong>Submitted by:</strong> {submitter}</span>
                            <span><strong>Submitted at:</strong> {new Date(s.submitted_at).toLocaleString()}</span>
                            {cm && <span><strong>Construction Manager:</strong> {cm}</span>}
                            {s.communities?.name && <span><strong>Community:</strong> {s.communities.name}</span>}
                            <span><strong>Vendor:</strong> {s.vendors?.name}</span>
                            <span><strong>Points:</strong> {s.points}</span>
                            {s.reviewed_at && (
                              <span><strong>Reviewed at:</strong> {new Date(s.reviewed_at).toLocaleString()}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-white disabled:opacity-50">
                  Previous
                </button>
                <span className="text-xs text-gray-500">Page {page + 1} · {submissions.length} entries</span>
                <button onClick={() => setPage(p => p + 1)} disabled={submissions.length < PAGE_SIZE}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-white disabled:opacity-50">
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function SystemLogTab() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState(null)
  const PAGE_SIZE = 25

  useEffect(() => { loadLogs() }, [page])

  async function loadLogs() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('activity_log')
        .select('*, profiles!activity_log_user_id_fkey(full_name, email)')
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      setLogs(data || [])
    } catch (err) {
      console.error('loadLogs error:', err)
    } finally {
      setLoading(false)
    }
  }

  return loading ? (
    <div className="flex justify-center py-12"><div className="app-loading-spinner" /></div>
  ) : (
    <div className="glass-panel overflow-hidden">
      <div className="divide-y divide-gray-100">
        {logs.map(log => (
          <div key={log.id} className="px-4 py-3">
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${ACTION_COLORS[log.action_type] || 'bg-gray-100 text-gray-700'}`}>
                  {log.action_type}
                </span>
                <span className="text-sm text-gray-700">{log.description}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>{log.profiles?.full_name || log.profiles?.email || 'System'}</span>
                <span>{new Date(log.created_at).toLocaleString()}</span>
                {log.metadata && Object.keys(log.metadata).length > 0 && (
                  expandedId === log.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                )}
              </div>
            </div>
            {expandedId === log.id && log.metadata && (
              <pre className="mt-2 p-3 bg-gray-50 rounded text-xs text-gray-600 overflow-x-auto">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {logs.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">No activity recorded yet.</div>
        )}
      </div>

      <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-white disabled:opacity-50">
          Previous
        </button>
        <span className="text-xs text-gray-500">Page {page + 1}</span>
        <button onClick={() => setPage(p => p + 1)} disabled={logs.length < PAGE_SIZE}
          className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-white disabled:opacity-50">
          Next
        </button>
      </div>
    </div>
  )
}

// ── CM Outlier Tracking ──────────────────────────────────────────────────────

function CMOutlierTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const OUTLIER_THRESHOLD = 1.5

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
    const { data } = await supabase
      .from('builder_feedback')
      .select('submitted_by, category, points, is_approved, submitter:profiles!builder_feedback_submitted_by_fkey(full_name, email)')
      .not('submitted_by', 'is', null)

    if (!data?.length) { setRows([]); return }

    const byUser = {}
    for (const f of data) {
      const uid = f.submitted_by
      if (!byUser[uid]) byUser[uid] = {
        uid,
        name: f.submitter?.full_name || f.submitter?.email || uid,
        total: 0, kudos: 0, complaints: 0, totalPoints: 0,
      }
      byUser[uid].total++
      byUser[uid].totalPoints += Number(f.points || 0)
      if (f.category === 'kudos') byUser[uid].kudos++
      else if (f.category === 'complaint') byUser[uid].complaints++
    }

    const users = Object.values(byUser).map(u => ({
      ...u,
      avgPoints: u.total > 0 ? u.totalPoints / u.total : 0,
      kudosPct: u.total > 0 ? (u.kudos / u.total) * 100 : 0,
    }))

    // Z-score on avgPoints
    const avg = users.reduce((s, u) => s + u.avgPoints, 0) / users.length
    const stdDev = Math.sqrt(users.reduce((s, u) => s + Math.pow(u.avgPoints - avg, 2), 0) / users.length) || 1
    for (const u of users) {
      u.zScore = (u.avgPoints - avg) / stdDev
      u.fleetAvg = avg
    }

    setRows(users.filter(u => u.total >= 3).sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)))
    } catch (err) {
      console.error('CMOutlier loadData error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) return <div className="flex justify-center py-16"><div className="app-loading-spinner" /></div>

  const outliers = rows.filter(r => Math.abs(r.zScore) >= 1.5)
  const normal = rows.filter(r => Math.abs(r.zScore) < 1.5)
  const fleetAvg = rows[0]?.fleetAvg

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
        <p className="font-medium mb-1">How outlier detection works</p>
        <p className="text-xs text-blue-700">
          CMs are flagged when their average feedback points deviate more than 1.5 standard deviations from the overall mean.
          High outliers give consistently generous feedback; low outliers give consistently harsh feedback.
          Minimum 3 submissions required. Overall average: <strong>{fleetAvg != null ? fleetAvg.toFixed(1) : '—'} pts</strong>.
        </p>
      </div>

      {outliers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> Outlier CMs ({outliers.length})
          </h3>
          <div className="glass-panel overflow-hidden">
            <CMTable rows={outliers} highlight />
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-2">All CMs — Feedback Patterns</h3>
        <div className="glass-panel overflow-hidden">
          <CMTable rows={normal} />
        </div>
      </div>
    </div>
  )
}

function CMTable({ rows, highlight }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400 p-6 text-center">No data.</p>
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 border-b border-gray-100">
        <tr>
          <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">CM / Submitter</th>
          <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Total</th>
          <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Kudos</th>
          <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Complaints</th>
          <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Avg Pts</th>
          <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Kudos %</th>
          <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Deviation</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map(r => {
          const isHigh = r.zScore > 1.5
          const isLow = r.zScore < -1.5
          return (
            <tr key={r.uid} className={highlight ? (isHigh ? 'bg-green-50' : isLow ? 'bg-red-50' : '') : ''}>
              <td className="px-4 py-2 font-medium text-gray-900">{r.name}</td>
              <td className="px-4 py-2 text-right text-gray-600">{r.total}</td>
              <td className="px-4 py-2 text-right text-green-700">{r.kudos}</td>
              <td className="px-4 py-2 text-right text-red-600">{r.complaints}</td>
              <td className="px-4 py-2 text-right font-mono">{r.avgPoints.toFixed(1)}</td>
              <td className="px-4 py-2 text-right">{r.kudosPct.toFixed(0)}%</td>
              <td className="px-4 py-2 text-right">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  isHigh ? 'bg-green-100 text-green-700' :
                  isLow ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {r.zScore > 0 ? '+' : ''}{r.zScore.toFixed(2)}σ
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Vendor Actions Tab ───────────────────────────────────────────────────────

const VENDOR_ACTION_TYPES = [
  'Notice Sent',
  'Meeting Scheduled',
  'Meeting Held',
  'Placed on Hold',
  'Removed from Bid List',
  'Reinstated',
  'Performance Improvement Plan',
  'Other',
]

function VendorActionsTab() {
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterVendor, setFilterVendor] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const vendorNames = [...new Set(actions.map(a => a.metadata?.vendor_name).filter(Boolean))].sort()

  useEffect(() => { loadActions() }, [])

  async function loadActions() {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('activity_log')
        .select('id, metadata, created_at, profiles!activity_log_user_id_fkey(full_name, email)')
        .eq('action_type', 'vendor_action')
        .order('created_at', { ascending: false })
        .limit(200)
      setActions(data || [])
    } catch (err) {
      console.error('loadActions error:', err)
    } finally {
      setLoading(false)
    }
  }

  const filtered = actions.filter(a => {
    if (filterVendor && a.metadata?.vendor_name !== filterVendor) return false
    if (filterAction && a.metadata?.action !== filterAction) return false
    return true
  })

  if (loading) return <div className="flex justify-center py-16"><div className="app-loading-spinner" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterVendor}
          onChange={e => setFilterVendor(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All Vendors</option>
          {vendorNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
        >
          <option value="">All Action Types</option>
          {VENDOR_ACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(filterVendor || filterAction) && (
          <button onClick={() => { setFilterVendor(''); setFilterAction('') }} className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} action{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 glass-panel">
          <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No vendor actions logged — log from the Scores table ⋯ menu.</p>
        </div>
      ) : (
        <div className="glass-panel divide-y divide-gray-100">
          {filtered.map(a => {
            const meta = a.metadata || {}
            const user = a.profiles?.full_name || a.profiles?.email || 'Unknown'
            return (
              <div key={a.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">{meta.vendor_name || '—'}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{meta.action || 'Action'}</span>
                    </div>
                    {meta.note && <p className="text-xs text-gray-600 mt-1">{meta.note}</p>}
                    <p className="text-xs text-gray-400">by {user}</p>
                  </div>
                  <span className="text-xs text-gray-400 shrink-0">{new Date(a.created_at).toLocaleString()}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
