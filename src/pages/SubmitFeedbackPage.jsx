import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { logActivity } from '../hooks/useActivityLog'
import { MessageSquare, CheckCircle, Clock, Send, ThumbsUp, AlertTriangle } from 'lucide-react'

export default function SubmitFeedbackPage() {
  const { user, profile } = useAuth()
  const [vendors, setVendors] = useState([])
  const [communities, setCommunities] = useState([])
  const [managers, setManagers] = useState([])
  const [rules, setRules] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [form, setForm] = useState({
    construction_manager_id: '',
    vendor_id: '',
    community_id: '',
    category: '',
    severity: '',
    description: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [vRes, cRes, mRes, rRes, sRes] = await Promise.all([
      supabase.from('vendors').select('id, name, vendor_categories(name)').eq('is_active', true).order('name'),
      supabase.from('communities').select('id, name, code').eq('is_active', true).order('name'),
      supabase.from('profiles').select('id, full_name, email').in('role', ['admin', 'manager']).eq('is_active', true).order('full_name'),
      supabase.from('feedback_point_rules').select('*').order('sort_order'),
      supabase.from('builder_feedback')
        .select('*, vendors(name), communities(name), cm:profiles!builder_feedback_construction_manager_id_fkey(full_name, email)')
        .eq('submitted_by', user.id)
        .order('submitted_at', { ascending: false })
        .limit(20),
    ])
    setVendors(vRes.data || [])
    setCommunities(cRes.data || [])
    setManagers(mRes.data || [])
    setRules(rRes.data || [])
    setSubmissions(sRes.data || [])
  }

  function getPoints() {
    if (!form.category) return null
    const rule = rules.find(r =>
      r.category === form.category &&
      (form.category === 'kudos' ? r.severity === null : r.severity === form.severity)
    )
    return rule?.points ?? null
  }

  const points = getPoints()
  const isValid = form.vendor_id && form.category &&
    (form.category === 'kudos' || (form.category === 'complaint' && form.severity)) &&
    form.description.trim()

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isValid) return
    setSubmitting(true)
    setError('')
    try {
      const { error: insertError } = await supabase.from('builder_feedback').insert({
        submitted_by: user.id,
        construction_manager_id: form.construction_manager_id || null,
        vendor_id: form.vendor_id,
        community_id: form.community_id || null,
        category: form.category,
        severity: form.category === 'complaint' ? form.severity : null,
        points: points ?? 0,
        description: form.description.trim(),
      })
      if (insertError) throw insertError

      await logActivity('feedback_submitted',
        `${profile?.full_name || profile?.email} submitted ${form.category}${form.severity ? ` (${form.severity})` : ''} feedback`,
        { vendor_id: form.vendor_id, category: form.category, severity: form.severity || null }
      )

      setSuccess(true)
      setForm({ construction_manager_id: '', vendor_id: '', community_id: '', category: '', severity: '', description: '' })
      loadData()
      setTimeout(() => setSuccess(false), 4000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const severityConfig = {
    minor:    { label: 'Minor',    color: 'text-yellow-700', points: rules.find(r => r.category === 'complaint' && r.severity === 'minor')?.points },
    major:    { label: 'Major',    color: 'text-orange-700', points: rules.find(r => r.category === 'complaint' && r.severity === 'major')?.points },
    critical: { label: 'Critical', color: 'text-red-700',    points: rules.find(r => r.category === 'complaint' && r.severity === 'critical')?.points },
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Submit Field Feedback</h1>
        <p className="text-sm text-gray-500 mt-1">
          Report vendor and trade performance issues or commendations. All submissions are reviewed by management.
        </p>
      </div>

      {/* Submission form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {success && (
          <div className="mb-5 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3 text-sm text-green-700">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <div>
              <p className="font-medium">Feedback submitted successfully.</p>
              <p className="text-green-600 text-xs mt-0.5">Management will review and approve it shortly.</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Construction Manager */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Construction Manager</label>
            <select
              value={form.construction_manager_id}
              onChange={e => setForm(f => ({ ...f, construction_manager_id: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="">— Select construction manager (optional) —</option>
              {managers.map(m => (
                <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
              ))}
            </select>
          </div>

          {/* Vendor */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Vendor / Trade <span className="text-red-500">*</span>
            </label>
            <select
              value={form.vendor_id}
              onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              required
            >
              <option value="">— Select a vendor or trade —</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.vendor_categories?.name ? ` (${v.vendor_categories.name})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Community */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Community</label>
            <select
              value={form.community_id}
              onChange={e => setForm(f => ({ ...f, community_id: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="">— Select a community (optional) —</option>
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>

          {/* Feedback type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Feedback Type <span className="text-red-500">*</span>
            </label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value, severity: '' }))}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
              required
            >
              <option value="">— Kudos or Complaint? —</option>
              <option value="kudos">👍 Kudos — Positive commendation</option>
              <option value="complaint">⚠️ Complaint — Performance issue</option>
            </select>
          </div>

          {/* Severity — only shown for complaints */}
          {form.category === 'complaint' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Severity <span className="text-red-500">*</span>
              </label>
              <select
                value={form.severity}
                onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                required
              >
                <option value="">— Select severity —</option>
                <option value="minor">Minor — Small issue, easily corrected ({severityConfig.minor.points} pts)</option>
                <option value="major">Major — Significant defect or delay ({severityConfig.major.points} pts)</option>
                <option value="critical">Critical — Safety risk or major cost impact ({severityConfig.critical.points} pts)</option>
              </select>
            </div>
          )}

          {/* Score preview */}
          {form.category && (form.category === 'kudos' || form.severity) && points !== null && (
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium ${
              form.category === 'kudos'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : form.severity === 'critical'
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : form.severity === 'major'
                    ? 'bg-orange-50 text-orange-700 border border-orange-200'
                    : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
            }`}>
              {form.category === 'kudos'
                ? <ThumbsUp className="w-4 h-4" />
                : <AlertTriangle className="w-4 h-4" />
              }
              This submission will contribute <strong className="mx-1">{points} points</strong> to the vendor's feedback score.
            </div>
          )}

          {/* Notes / Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Notes <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={5}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              placeholder="Describe the issue or commendation in detail. Include dates, lot numbers, or any other relevant context that will help make the case..."
              required
            />
            <p className="text-xs text-gray-400 mt-1">
              Be specific — detailed notes strengthen the case when presenting to vendors.
            </p>
          </div>

          <button
            type="submit"
            disabled={submitting || !isValid}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
            {submitting ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </form>
      </div>

      {/* My recent submissions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-gray-500" />
          My Recent Submissions
        </h2>

        {submissions.length === 0 ? (
          <p className="text-sm text-gray-500">No feedback submitted yet.</p>
        ) : (
          <div className="space-y-3">
            {submissions.map(s => (
              <div key={s.id} className="flex items-start justify-between p-3 rounded-lg border border-gray-100 bg-gray-50 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{s.vendors?.name || 'Unknown vendor'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      s.category === 'kudos'
                        ? 'bg-green-100 text-green-700'
                        : s.severity === 'critical'
                          ? 'bg-red-100 text-red-700'
                          : s.severity === 'major'
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {s.category === 'kudos' ? 'Kudos' : `Complaint — ${s.severity}`}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{s.description}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {s.cm?.full_name && `CM: ${s.cm.full_name} · `}
                    {s.communities?.name && `${s.communities.name} · `}
                    {new Date(s.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-sm font-mono font-medium text-gray-700">{s.points} pts</span>
                  {s.is_approved ? (
                    <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                      <CheckCircle className="w-3 h-3" /> Approved
                    </span>
                  ) : s.reviewed_at ? (
                    <span className="flex items-center gap-1 text-xs text-red-500 font-medium">Rejected</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-yellow-600">
                      <Clock className="w-3 h-3" /> Pending
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
