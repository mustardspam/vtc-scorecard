import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ChevronDown, ChevronUp, Users, Activity, Filter, X } from 'lucide-react'

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

export default function ActivityPage() {
  const [tab, setTab] = useState('feedback')

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Activity</h1>

      <div className="flex gap-2 border-b border-gray-200 pb-px">
        <button
          onClick={() => setTab('feedback')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'feedback' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="w-4 h-4" />
          Feedback Submissions
        </button>
        <button
          onClick={() => setTab('log')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'log' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Activity className="w-4 h-4" />
          System Log
        </button>
      </div>

      {tab === 'feedback' ? <FeedbackSubmissionsTab /> : <SystemLogTab />}
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

    const { data } = await query
    setSubmissions(data || [])
    setLoading(false)
  }

  function clearFilters() {
    setFilters({ user_id: '', category: '', severity: '', approved: '' })
  }

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
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
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
    const { data } = await supabase
      .from('activity_log')
      .select('*, profiles!activity_log_user_id_fkey(full_name, email)')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    setLogs(data || [])
    setLoading(false)
  }

  return loading ? (
    <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
  ) : (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
