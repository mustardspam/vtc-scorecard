import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { logActivity } from '../hooks/useActivityLog'
import { CheckCircle, XCircle, Search, Filter, MessageSquare } from 'lucide-react'

export default function FeedbackPage() {
  const [feedback, setFeedback] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [search, setSearch] = useState('')
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const { user, isManager } = useAuth()
  const canReview = isManager()

  useEffect(() => {
    let mounted = true
    loadFeedback(mounted)
    return () => { mounted = false }
  }, [filter])

  async function loadFeedback(mounted = true) {
    setLoading(true)
    let query = supabase
      .from('builder_feedback')
      .select('*, vendors(name), communities(name), submitted_profile:profiles!builder_feedback_submitted_by_fkey(full_name, email)')
      .order('submitted_at', { ascending: false })

    if (filter === 'pending') query = query.eq('is_approved', false).is('reviewed_at', null)
    else if (filter === 'approved') query = query.eq('is_approved', true)
    else if (filter === 'rejected') query = query.eq('is_approved', false).not('reviewed_at', 'is', null)

    try {
      const { data, error } = await query
      if (error) console.error('Feedback load error:', error)
      if (mounted) setFeedback(data || [])
    } catch (err) {
      console.error('loadFeedback error:', err)
    } finally {
      if (mounted) setLoading(false)
    }
  }

  async function handleApprove(id) {
    await supabase.from('builder_feedback').update({
      is_approved: true, reviewed_by: user.id, reviewed_at: new Date().toISOString()
    }).eq('id', id)
    await logActivity('feedback_approved', 'Approved builder feedback', { feedback_id: id })
    loadFeedback()
  }

  function handleReject(id) {
    setRejectTarget(id)
    setRejectReason('')
  }

  async function confirmReject() {
    const id = rejectTarget
    setRejectTarget(null)
    await supabase.from('builder_feedback').update({
      is_approved: false, reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_notes: rejectReason || 'Rejected'
    }).eq('id', id)
    await logActivity('feedback_rejected', 'Rejected builder feedback', { feedback_id: id, reason: rejectReason })
    loadFeedback()
  }

  const filtered = feedback.filter(f => {
    if (!search) return true
    const vendorName = f.vendors?.name?.toLowerCase() || ''
    const desc = f.description?.toLowerCase() || ''
    return vendorName.includes(search.toLowerCase()) || desc.includes(search.toLowerCase())
  })

  return (
    <div className="space-y-4">
      {rejectTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h2 className="text-base font-semibold text-gray-900">Reject Feedback</h2>
            <p className="text-sm text-gray-500">Optionally provide a reason for rejection. This will be saved to the review notes.</p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={3}
              autoFocus
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none resize-none"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRejectTarget(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={confirmReject} className="flex items-center gap-1 px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">
                <XCircle className="w-4 h-4" /> Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Feedback Review</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'all', label: 'All' },
            ].map(tab => (
              <button
                key={tab.value}
                onClick={() => setFilter(tab.value)}
                className={`px-3 py-1 text-sm rounded-md transition-colors ${filter === tab.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <MessageSquare className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">No {filter} feedback found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(f => (
            <div key={f.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-900">{f.vendors?.name || 'Unknown'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${f.category === 'kudos' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {f.category}{f.severity ? ` — ${f.severity}` : ''}
                    </span>
                    <span className="text-xs font-mono text-gray-500">{f.points} pts</span>
                  </div>
                  {f.subject && <p className="text-sm font-medium text-gray-700">{f.subject}</p>}
                  <p className="text-sm text-gray-600 mt-1">{f.description}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 flex-wrap">
                    <span>By: {f.submitted_profile?.full_name || f.submitted_profile?.email || 'Unknown'}</span>
                    {f.communities?.name && <span>{f.communities.name}</span>}
                    {f.lot_or_address && <span>{f.lot_or_address}</span>}
                    <span>{new Date(f.submitted_at).toLocaleString()}</span>
                  </div>
                  {f.review_notes && (
                    <p className="text-xs text-gray-500 mt-2 italic">Review note: {f.review_notes}</p>
                  )}
                </div>

                {!f.reviewed_at && canReview && (
                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => handleApprove(f.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      <CheckCircle className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => handleReject(f.id)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}

                {!f.reviewed_at && !canReview && (
                  <span className="text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-700 ml-4">Pending</span>
                )}

                {f.reviewed_at && (
                  <span className={`text-xs px-2 py-1 rounded ${f.is_approved ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {f.is_approved ? 'Approved' : 'Rejected'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
