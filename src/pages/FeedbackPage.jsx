import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { logActivity } from '../hooks/useActivityLog'
import { CheckCircle, XCircle, Search, MessageSquare, X } from 'lucide-react'
import { cn } from '../lib/cn'

const FILTERS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
]

const FEEDBACK_PAGE_SIZE = 100

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
      .range(0, FEEDBACK_PAGE_SIZE - 1)

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
    try {
      const { error } = await supabase.from('builder_feedback').update({
        is_approved: true, reviewed_by: user.id, reviewed_at: new Date().toISOString()
      }).eq('id', id)
      if (error) throw error
      logActivity('feedback_approved', 'Approved builder feedback', { feedback_id: id }).catch(() => {})
      loadFeedback()
    } catch (err) {
      console.error('Approve error:', err)
    }
  }

  function handleReject(id) {
    setRejectTarget(id)
    setRejectReason('')
  }

  async function confirmReject() {
    if (!rejectReason.trim()) return
    const id = rejectTarget
    try {
      const { error } = await supabase.from('builder_feedback').update({
        is_approved: false, reviewed_by: user.id, reviewed_at: new Date().toISOString(), review_notes: rejectReason.trim()
      }).eq('id', id)
      if (error) throw error
      logActivity('feedback_rejected', 'Rejected builder feedback', { feedback_id: id, reason: rejectReason }).catch(() => {})
      setRejectTarget(null)
      loadFeedback()
    } catch (err) {
      console.error('Reject error:', err)
    }
  }

  const filtered = feedback.filter(f => {
    if (!search) return true
    const vendorName = f.vendors?.name?.toLowerCase() || ''
    const desc = f.description?.toLowerCase() || ''
    return vendorName.includes(search.toLowerCase()) || desc.includes(search.toLowerCase())
  })

  const typePill = (f) => f.category === 'kudos'
    ? { bg: '#dcf2e4', color: '#1f7a44', label: 'Kudos' }
    : { bg: '#f8dada', color: '#a72727', label: `Complaint${f.severity ? ` · ${f.severity}` : ''}` }

  return (
    <div className="space-y-4 min-w-0">
      {rejectTarget && (
        <div className="glass-modal-backdrop">
          <div className="glass-modal w-full max-w-[460px] p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="glass-section-title">Reject Feedback</h2>
              <button type="button" onClick={() => setRejectTarget(null)} className="bg-transparent border-none cursor-pointer" style={{ color: 'var(--g-dim)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm" style={{ color: 'var(--g-dim)' }}>Provide a reason for rejection. This is required and saved to review notes.</p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason"
              rows={4}
              autoFocus
              className="glass-input w-full resize-none"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRejectTarget(null)} className="glass-btn-secondary">Cancel</button>
              <button
                type="button"
                onClick={confirmReject}
                disabled={!rejectReason.trim()}
                className="glass-btn-reject flex items-center gap-1 disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" /> Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="glass-page-title">Feedback Review</h1>
          {filter === 'pending' && !loading && (
            <p className="glass-page-subtitle">{filtered.length} awaiting review</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--g-dim)' }} />
            <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="glass-input pl-9 py-1.5 text-sm w-48" />
          </div>
          <div className="flex rounded-xl p-1" style={{ background: 'var(--g-panel-2)' }}>
            {FILTERS.map(tab => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilter(tab.value)}
                className={cn('px-3 py-1.5 text-sm rounded-lg transition-all', filter === tab.value ? 'glass-nav-active' : 'glass-nav-item')}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="app-loading-spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel p-12 text-center">
          <MessageSquare className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--g-dim)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--g-text)' }}>No feedback found</p>
          <p className="text-sm mt-1" style={{ color: 'var(--g-dim)' }}>Try a different filter or search term.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(f => {
            const pill = typePill(f)
            return (
              <div key={f.id} className="glass-panel p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="text-sm font-semibold" style={{ color: 'var(--g-text)' }}>{f.vendors?.name || 'Unknown'}</span>
                      <span className="glass-tier-pill" style={{ background: pill.bg, color: pill.color }}>{pill.label}</span>
                      <span className="text-xs font-mono" style={{ color: 'var(--g-dim)' }}>{f.points} pts</span>
                    </div>
                    {f.subject && <p className="text-sm font-medium" style={{ color: 'var(--g-text)' }}>{f.subject}</p>}
                    <p className="text-sm mt-1" style={{ color: 'var(--g-dim)' }}>{f.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs flex-wrap" style={{ color: 'var(--g-dim)' }}>
                      <span>By {f.submitted_profile?.full_name || f.submitted_profile?.email || 'Unknown'}</span>
                      {f.communities?.name && <span>{f.communities.name}</span>}
                      {f.lot_or_address && <span>{f.lot_or_address}</span>}
                      <span>{new Date(f.submitted_at).toLocaleString()}</span>
                    </div>
                    {f.review_notes && <p className="text-xs mt-2 italic" style={{ color: 'var(--g-dim)' }}>Note: {f.review_notes}</p>}
                  </div>
                  {!f.reviewed_at && canReview && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => handleApprove(f.id)} className="glass-btn-approve flex items-center gap-1 text-xs px-3 py-1.5">
                        <CheckCircle className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button type="button" onClick={() => handleReject(f.id)} className="glass-btn-reject flex items-center gap-1 text-xs px-3 py-1.5">
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  )}
                  {!f.reviewed_at && !canReview && (
                    <span className="glass-tier-pill shrink-0" style={{ background: '#f8ecc9', color: '#8a5a08' }}>Pending</span>
                  )}
                  {f.reviewed_at && (
                    <span className="glass-tier-pill shrink-0" style={f.is_approved ? { background: '#dcf2e4', color: '#1f7a44' } : { background: '#f8dada', color: '#a72727' }}>
                      {f.is_approved ? '✓ Approved' : '✕ Rejected'}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
