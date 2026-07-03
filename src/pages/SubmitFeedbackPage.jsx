import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { logActivity } from '../hooks/useActivityLog'
import { MessageSquare, CheckCircle, Clock, Send, ThumbsUp, AlertTriangle, Paperclip, X, FileText, Image as ImageIcon, Camera } from 'lucide-react'

const MAX_FILES = 5
const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB per file
const ACCEPTED_TYPES = 'image/*,application/pdf'

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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
    lot_or_address: '',
    description: '',
  })
  const [files, setFiles] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef(null)

  useEffect(() => {
    let mounted = true
    loadData(mounted)
    return () => { mounted = false }
  }, [])

  async function loadData(mounted = true) {
    try {
      const [vRes, cRes, mRes, rRes, sRes] = await Promise.all([
        supabase.from('vendors').select('id, name, vendor_categories(name)').eq('is_active', true).order('name'),
        supabase.from('communities').select('id, name, code').eq('is_active', true).order('name'),
        supabase.from('profiles').select('id, full_name, email').eq('role', 'viewer').eq('is_active', true).order('full_name'),
        supabase.from('feedback_point_rules').select('*').order('sort_order'),
        supabase.from('builder_feedback')
          .select('*, vendors(name), communities(name)')
          .eq('submitted_by', user.id)
          .order('submitted_at', { ascending: false })
          .limit(20),
      ])
      if (mounted) {
        setVendors(vRes.data || [])
        setCommunities(cRes.data || [])
        setManagers(mRes.data || [])
        setRules(rRes.data || [])
        setSubmissions(sRes.data || [])
      }
    } catch (err) {
      console.error('loadData error:', err)
    }
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
    form.lot_or_address.trim() &&
    form.description.trim()

  function handleFilesSelected(e) {
    const picked = Array.from(e.target.files || [])
    if (fileInputRef.current) fileInputRef.current.value = '' // allow re-selecting the same file
    setError('')
    setFiles(prev => {
      const next = [...prev]
      for (const file of picked) {
        if (next.length >= MAX_FILES) {
          setError(`You can attach at most ${MAX_FILES} files.`)
          break
        }
        if (file.size > MAX_FILE_BYTES) {
          setError(`"${file.name}" is larger than ${formatBytes(MAX_FILE_BYTES)} and was skipped.`)
          continue
        }
        // Skip exact duplicates by name+size
        if (next.some(f => f.name === file.name && f.size === file.size)) continue
        next.push(file)
      }
      return next
    })
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isValid) return
    setSubmitting(true)
    setError('')
    const uploadedPaths = []
    try {
      // Upload any attached evidence to storage first
      let evidencePhotos = null
      if (files.length > 0) {
        const uploaded = []
        for (const file of files) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const storagePath = `feedback/${user.id}/${Date.now()}_${safeName}`
          const { data: up, error: upErr } = await supabase.storage
            .from('uploads')
            .upload(storagePath, file, { contentType: file.type || undefined })
          if (upErr) throw new Error(`Failed to upload "${file.name}": ${upErr.message}`)
          const path = up?.path || storagePath
          uploadedPaths.push(path)
          uploaded.push({
            path,
            name: file.name,
            size: file.size,
            type: file.type || null,
          })
        }
        evidencePhotos = uploaded
      }

      const { error: insertError } = await supabase.from('builder_feedback').insert({
        submitted_by: user.id,
        construction_manager_id: form.construction_manager_id || null,
        vendor_id: form.vendor_id,
        community_id: form.community_id || null,
        category: form.category,
        severity: form.category === 'complaint' ? form.severity : null,
        points: points ?? 0,
        lot_or_address: form.lot_or_address.trim(),
        description: form.description.trim(),
        evidence_photos: evidencePhotos,
      })
      if (insertError) throw insertError

      logActivity('feedback_submitted',
        `${profile?.full_name || profile?.email} submitted ${form.category}${form.severity ? ` (${form.severity})` : ''} feedback`,
        { vendor_id: form.vendor_id, category: form.category, severity: form.severity || null }
      ).catch(() => {})

      setSuccess(true)
      setForm({ construction_manager_id: '', vendor_id: '', community_id: '', category: '', severity: '', lot_or_address: '', description: '' })
      setFiles([])
      loadData(true)
      setTimeout(() => setSuccess(false), 4000)
    } catch (err) {
      // Clean up any files uploaded before the failure so they don't orphan in storage
      if (uploadedPaths.length > 0) {
        supabase.storage.from('uploads').remove(uploadedPaths).catch(() => {})
      }
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
    <div className="max-w-[680px] mx-auto space-y-6 min-w-0">
      <div>
        <h1 className="glass-page-title">Submit Field Feedback</h1>
        <p className="glass-page-subtitle">
          Report vendor and trade performance issues or commendations. All submissions are reviewed by management.
        </p>
      </div>

      {/* Submission form */}
      <div className="glass-panel p-4 sm:p-6">
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
              className="glass-input w-full"
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
              className="glass-input w-full"
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
              className="glass-input w-full"
            >
              <option value="">— Select a community (optional) —</option>
              {communities.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
              ))}
            </select>
          </div>

          {/* Address(es) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Address(es) / Lot(s) <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.lot_or_address}
              onChange={e => setForm(f => ({ ...f, lot_or_address: e.target.value }))}
              placeholder="e.g. 123 Oak St, Lot 47, 456 Maple Ave"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              required
            />
            <p className="text-xs text-gray-400 mt-1">Separate multiple addresses or lot numbers with commas.</p>
          </div>

          {/* Feedback type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Feedback Type <span className="text-red-500">*</span>
            </label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value, severity: '' }))}
              className="glass-input w-full"
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
                className="glass-input w-full"
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

          {/* Attachments */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Photos / Attachments <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              onChange={handleFilesSelected}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={files.length >= MAX_FILES}
              className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 rounded-lg text-sm font-semibold text-white bg-[#087482] hover:bg-[#0a606c] shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Camera className="w-4 h-4" />
              {files.length > 0 ? 'Add More Photos or Files' : 'Upload Photos or Files'}
            </button>
            <p className="text-xs text-gray-400 mt-1.5">
              Click to attach — up to {MAX_FILES} files, {formatBytes(MAX_FILE_BYTES)} each. Images and PDFs.
            </p>

            {files.length > 0 && (
              <ul className="mt-3 space-y-2">
                {files.map((file, i) => (
                  <li key={`${file.name}-${file.size}-${i}`} className="flex items-center gap-3 p-2 rounded-lg border border-gray-100 bg-gray-50">
                    {file.type?.startsWith('image/')
                      ? <ImageIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      : <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                    <span className="text-sm text-gray-700 truncate flex-1 min-w-0">{file.name}</span>
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatBytes(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="text-gray-400 hover:text-red-500 flex-shrink-0"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || !isValid}
            className="flex items-center justify-center gap-2 w-full sm:w-auto px-6 py-3 sm:py-2.5 glass-btn-primary font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
            {submitting ? (files.length > 0 ? 'Uploading...' : 'Submitting...') : 'Submit Feedback'}
          </button>
        </form>
      </div>

      {/* My recent submissions */}
      <div className="glass-panel p-4 sm:p-6">
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
                  <p className="text-xs text-gray-400 mt-1 flex items-center gap-1.5 flex-wrap">
                    {s.communities?.name && <span>{s.communities.name} ·</span>}
                    <span>{new Date(s.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {Array.isArray(s.evidence_photos) && s.evidence_photos.length > 0 && (
                      <span className="flex items-center gap-0.5 text-gray-500">
                        · <Paperclip className="w-3 h-3" /> {s.evidence_photos.length}
                      </span>
                    )}
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
