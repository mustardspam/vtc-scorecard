import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { logActivity } from '../hooks/useActivityLog'
import { MessageSquare, CheckCircle, Clock, LogOut, Send } from 'lucide-react'

export default function BuilderFeedbackPage() {
  const { user, profile, logout } = useAuth()
  const [vendors, setVendors] = useState([])
  const [communities, setCommunities] = useState([])
  const [rules, setRules] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [form, setForm] = useState({
    vendor_id: '', community_id: '', lot_or_address: '',
    category: 'kudos', severity: '', subject: '', description: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    const [vRes, cRes, rRes, sRes] = await Promise.all([
      supabase.from('vendors').select('id, name').eq('is_active', true).order('name'),
      supabase.from('communities').select('id, name, code').eq('is_active', true).order('name'),
      supabase.from('feedback_point_rules').select('*').order('sort_order'),
      supabase.from('builder_feedback').select('*, vendors(name), communities(name)')
        .eq('submitted_by', user.id).order('submitted_at', { ascending: false }).limit(50),
    ])
    setVendors(vRes.data || [])
    setCommunities(cRes.data || [])
    setRules(rRes.data || [])
    setSubmissions(sRes.data || [])
  }

  function getPoints() {
    const rule = rules.find(r =>
      r.category === form.category &&
      (form.category === 'kudos' ? r.severity === null : r.severity === form.severity)
    )
    return rule?.points || 0
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.vendor_id || !form.description) return
    setSubmitting(true)
    try {
      const points = getPoints()
      const { error } = await supabase.from('builder_feedback').insert({
        submitted_by: user.id,
        vendor_id: form.vendor_id,
        community_id: form.community_id || null,
        lot_or_address: form.lot_or_address || null,
        category: form.category,
        severity: form.category === 'complaint' ? form.severity : null,
        points,
        subject: form.subject || null,
        description: form.description,
      })
      if (error) throw error

      await logActivity('feedback_submitted', `Builder submitted ${form.category} feedback`, {
        vendor_id: form.vendor_id, category: form.category, severity: form.severity
      })

      setSuccess(true)
      setForm({ vendor_id: '', community_id: '', lot_or_address: '', category: 'kudos', severity: '', subject: '', description: '' })
      loadData()
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      alert('Error submitting feedback: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">VTC Feedback Portal</h1>
          <p className="text-xs text-gray-500">{profile?.full_name || profile?.email}</p>
        </div>
        <button onClick={logout} className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </header>

      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-blue-600" />
            Submit Vendor/Trade Feedback
          </h2>

          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-sm text-green-700">
              <CheckCircle className="w-4 h-4" />
              Feedback submitted successfully. It will be reviewed by management.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor/Trade *</label>
                <select
                  value={form.vendor_id}
                  onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  required
                >
                  <option value="">Select vendor...</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Community</label>
                <select
                  value={form.community_id}
                  onChange={e => setForm(f => ({ ...f, community_id: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                >
                  <option value="">Select community...</option>
                  {communities.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lot / Address</label>
              <input
                type="text"
                value={form.lot_or_address}
                onChange={e => setForm(f => ({ ...f, lot_or_address: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g., Lot 42 or 1234 Oak St"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Feedback Type *</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" value="kudos" checked={form.category === 'kudos'} onChange={e => setForm(f => ({ ...f, category: e.target.value, severity: '' }))} />
                  <span className="text-green-700 font-medium">Kudos</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" value="complaint" checked={form.category === 'complaint'} onChange={e => setForm(f => ({ ...f, category: e.target.value, severity: 'minor' }))} />
                  <span className="text-red-700 font-medium">Complaint</span>
                </label>
              </div>
            </div>

            {form.category === 'complaint' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Severity *</label>
                <div className="flex gap-4">
                  {['minor', 'major', 'critical'].map(sev => (
                    <label key={sev} className="flex items-center gap-2 text-sm">
                      <input type="radio" value={sev} checked={form.severity === sev} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} />
                      <span className="capitalize">{sev}</span>
                      <span className="text-xs text-gray-400">
                        ({rules.find(r => r.category === 'complaint' && r.severity === sev)?.points || '?'} pts)
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                value={form.subject}
                onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Brief summary..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
              <textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                placeholder="Describe the feedback in detail..."
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !form.vendor_id || !form.description}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">My Submissions</h2>
          {submissions.length === 0 ? (
            <p className="text-sm text-gray-500">No feedback submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {submissions.map(s => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {s.vendors?.name || 'Unknown vendor'}
                      <span className={`ml-2 text-xs px-2 py-0.5 rounded ${s.category === 'kudos' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {s.category}{s.severity ? ` — ${s.severity}` : ''}
                      </span>
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate max-w-md">{s.description}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {s.communities?.name && `${s.communities.name} · `}
                      {new Date(s.submitted_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">{s.points} pts</span>
                    {s.is_approved ? (
                      <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle className="w-3.5 h-3.5" /> Approved</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-yellow-600"><Clock className="w-3.5 h-3.5" /> Pending</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
