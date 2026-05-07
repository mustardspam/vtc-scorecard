import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Activity, ChevronDown, ChevronUp } from 'lucide-react'

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

export default function ActivityPage() {
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

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>

      {loading ? (
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
      )}
    </div>
  )
}
