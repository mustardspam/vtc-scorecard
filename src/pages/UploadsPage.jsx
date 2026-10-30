import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { logActivity } from '../hooks/useActivityLog'
import { useAuth } from '../hooks/useAuth'
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, ArrowRight, Loader2, Building2, Trash2, CloudDownload } from 'lucide-react'
import UploadStepper from '../components/ui/UploadStepper'
import { ERP_PULL_KINDS, pullFromErp, getResplanKey, setResplanKey } from '../lib/resplan'
import {
  erpBrandsFor, erpSummaryText, fetchVendorData as fetchVendorDataShared,
  removeBatchData as removeBatchDataShared, importErpRecords as importErpRecordsShared,
  importJCVendors as importJCVendorsShared, insertScheduleRecords, insertSafetyRecords, insertReworkRecords,
} from '../lib/importers/erp-import'

const FILE_TYPES = [
  { value: 'schedule', label: 'Schedule Data', description: 'Monthly schedule adherence report' },
  { value: 'safety', label: 'Safety Data', description: 'Safety incident records' },
  { value: 'rework', label: 'Rework / Backcharges', description: 'Backcharge records with costs' },
  { value: 'jc_vendor_report', label: 'JC Vendor Report', description: 'JC Preferred Vendors pivot report (auto-parses vendors + communities)' },
]

/** Upload cadence per type: 'weekly' = green ≤7d / red after; default = tiered. */
const UPLOAD_CADENCE = {
  safety: 'weekly',
  rework: 'weekly',
}

/** Color-coded freshness badge for "days since last upload". */
function uploadFreshness(days, cadence) {
  if (days == null) return { label: 'No uploads yet', bg: '#f3f4f6', dot: '#9ca3af', text: '#6b7280' }
  const ago = days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
  const label = `Last upload: ${ago}`
  if (cadence === 'weekly') {
    if (days <= 7) return { label, bg: '#dcfce7', dot: '#16a34a', text: '#15803d' }  // green
    return { label, bg: '#fee2e2', dot: '#dc2626', text: '#b91c1c' }                  // red
  }
  if (days <= 14) return { label, bg: '#dcfce7', dot: '#16a34a', text: '#15803d' }   // green
  if (days <= 27) return { label, bg: '#fef9c3', dot: '#eab308', text: '#a16207' }   // yellow
  if (days <= 30) return { label, bg: '#ffedd5', dot: '#f97316', text: '#c2410c' }   // orange
  return { label, bg: '#fee2e2', dot: '#dc2626', text: '#b91c1c' }                    // red
}

const REQUIRED_FIELDS = {
  schedule: ['vendor_name', 'total_jobs', 'no_shows'],
  safety: ['vendor_name', 'severity'],
  rework: ['vendor_name', 'cost'],
  vendor_master: ['vendor_name', 'category'],
}

const INTERNAL_FIELDS = {
  schedule: ['vendor_name', 'vendor_id', 'total_jobs', 'no_shows', 'adherence_pct', 'period_month', 'community'],
  safety: ['vendor_name', 'severity', 'incident_date', 'incident_type', 'community'],
  rework: ['vendor_name', 'cost', 'rework_date', 'description', 'severity', 'lot_or_address', 'community'],
  vendor_master: ['vendor_name', 'vendor_id', 'category'],
}

/** "YYYY-MM" of this month — the default for an ERP pull (month-to-date). */
function thisMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** "2026-10-01" -> "Oct 1, 2026" (local date, no timezone shift). */
function formatDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Oct 22, 2026, 9:41 AM" */
function formatStamp(iso) {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** How an ERP pull is labelled: the dates it covers and when it was pulled. */
function erpPullLabel(range, pulledAt) {
  return `${range ? `${formatDay(range.from)} – ${formatDay(range.to)}, ` : ''}pulled ${formatStamp(pulledAt)}`
}

function importTypeLabel(batch) {
  if (batch.column_mapping?.source === 'jc_vendor_report') return 'JC Vendor Report'
  const match = FILE_TYPES.find(t => t.value === batch.file_type)
  return match?.label || batch.file_type || 'Import'
}

export default function UploadsPage() {
  const [step, setStep] = useState('upload')
  const [file, setFile] = useState(null)
  const [fileType, setFileType] = useState('')
  const [brand, setBrand] = useState('Ashton Woods')
  const [parsed, setParsed] = useState(null)
  const [sheetName, setSheetName] = useState('')
  const [columnMap, setColumnMap] = useState({})
  const [vendorMatches, setVendorMatches] = useState([])
  const [vendors, setVendors] = useState([])
  const [aliases, setAliases] = useState([])
  const [brandRefs, setBrandRefs] = useState([])
  const [mappedRows, setMappedRows] = useState([])
  const [errors, setErrors] = useState([])
  const [importing, setImporting] = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [jcParsed, setJcParsed] = useState(null)
  const [selectedCommunities, setSelectedCommunities] = useState(new Set())
  const [importError, setImportError] = useState(null)
  const [importProgress, setImportProgress] = useState('')
  const [selectedUnmatched, setSelectedUnmatched] = useState(new Set())
  const [deleting, setDeleting] = useState(null)
  const [lastUploads, setLastUploads] = useState({})
  const [erpMonth, setErpMonth] = useState(thisMonth)
  const [erpPulling, setErpPulling] = useState(null)
  const [erpStep, setErpStep] = useState('')
  const [erpError, setErpError] = useState('')
  const [erpResult, setErpResult] = useState(null)
  const [resplanKey, setResplanKeyState] = useState(getResplanKey)
  const { user, isManager, isAdmin } = useAuth()
  const canUpload = isManager()
  /** Context for the shared importers (src/lib/importers/erp-import.js). */
  const importCtx = () => ({ supabase, user, isAdmin: isAdmin(), logActivity })

  useEffect(() => {
    let mounted = true
    loadVendors()
    loadHistory(mounted)
    loadLastUploads(mounted)
    return () => { mounted = false }
  }, [])

  // Most recent upload date per file type, for the freshness badges on the type tiles.
  async function loadLastUploads(mounted = true) {
    try {
      const dataTypes = ['schedule', 'safety', 'rework']
      const queries = dataTypes.map(t =>
        supabase.from('import_batches')
          .select('created_at')
          .eq('file_type', t)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )
      // JC Vendor Report is stored as file_type 'other' with column_mapping.source = 'jc_vendor_report'
      queries.push(
        supabase.from('import_batches')
          .select('created_at')
          .eq('column_mapping->>source', 'jc_vendor_report')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      )

      const results = await Promise.all(queries)
      const keys = [...dataTypes, 'jc_vendor_report']
      const map = {}
      results.forEach((res, i) => {
        map[keys[i]] = res.data?.created_at || null
      })
      if (mounted) setLastUploads(map)
    } catch (err) {
      console.error('loadLastUploads error:', err)
    }
  }

  function daysSince(dateStr) {
    if (!dateStr) return null
    const ms = Date.now() - new Date(dateStr).getTime()
    return Math.max(0, Math.floor(ms / 86400000))
  }

  async function loadVendors() {
    try {
      const v = await fetchVendorDataShared(supabase)
      setVendors(v.vendors)
      setAliases(v.aliases)
      setBrandRefs(v.brandRefs)
    } catch (err) {
      console.error('loadVendors error:', err)
    }
  }

  async function loadHistory(mounted = true) {
    setHistoryLoading(true)
    setHistoryError('')
    try {
      let rows = null

      const joined = await supabase
        .from('import_batches')
        .select('*, uploaded_files!import_batches_uploaded_file_id_fkey(original_filename, storage_path)')
        .order('created_at', { ascending: false })
        .limit(20)

      if (joined.error) {
        console.warn('loadHistory joined query failed, falling back:', joined.error.message)
        const batchesRes = await supabase
          .from('import_batches')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)
        if (batchesRes.error) throw batchesRes.error

        const fileIds = [...new Set((batchesRes.data || []).map(b => b.uploaded_file_id).filter(Boolean))]
        let filesById = {}
        if (fileIds.length) {
          const filesRes = await supabase
            .from('uploaded_files')
            .select('id, original_filename, storage_path')
            .in('id', fileIds)
          if (filesRes.error) throw filesRes.error
          filesById = Object.fromEntries((filesRes.data || []).map(f => [f.id, f]))
        }

        rows = (batchesRes.data || []).map(b => ({
          ...b,
          uploaded_files: filesById[b.uploaded_file_id] || null,
        }))
      } else {
        rows = joined.data
      }

      if (mounted) setHistory(rows || [])
    } catch (err) {
      console.error('loadHistory error:', err)
      if (mounted) {
        setHistory([])
        setHistoryError('Could not load import history. Please refresh the page.')
      }
    } finally {
      if (mounted) setHistoryLoading(false)
    }
  }

  /** Deletes a batch, its records, and its file when no other batch uses it. Admin only (RLS). */
  function removeBatchData(batch) {
    return removeBatchDataShared(supabase, batch)
  }

  async function handleDeleteImport(batch) {
    if (!confirm(`Delete import "${batch.uploaded_files?.original_filename || 'unknown'}" and all its data? This cannot be undone.`)) return
    setDeleting(batch.id)
    try {
      await removeBatchData(batch)

      if (['schedule', 'safety', 'rework'].includes(batch.file_type)) {
        await supabase.rpc('calculate_scores')
      }

      await logActivity('import_deleted', `Deleted import: ${batch.uploaded_files?.original_filename}`, { batch_id: batch.id, file_type: batch.file_type })
      await loadHistory()
      loadLastUploads()
    } catch (err) {
      console.error('Delete import error:', err)
      alert('Failed to delete import: ' + err.message)
    } finally {
      setDeleting(null)
    }
  }

  const handleFileDrop = useCallback((e) => {
    e.preventDefault()
    const droppedFile = e.dataTransfer?.files?.[0] || e.target?.files?.[0]
    if (droppedFile) setFile(droppedFile)
  }, [])

  // Refresh now: ResPlan only listens on the office PC, so any manager's browser queues
  // a request (erp_refresh_requests) and the vtc-automation job on that PC runs it.
  const [refreshReq, setRefreshReq] = useState(null)
  const [refreshRequesting, setRefreshRequesting] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const refreshOpen = ['pending', 'running'].includes(refreshReq?.status)
  const refreshStale = refreshReq?.status === 'pending' && Date.now() - new Date(refreshReq.requested_at).getTime() > 15 * 60 * 1000

  async function loadRefreshRequest() {
    const { data, error } = await supabase.from('erp_refresh_requests')
      .select('*').order('requested_at', { ascending: false }).limit(1).maybeSingle()
    if (error) { console.warn('loadRefreshRequest failed:', error.message); return null }
    setRefreshReq(data)
    return data
  }

  async function requestRefresh() {
    setRefreshError('')
    setRefreshRequesting(true)
    try {
      const { data, error } = await supabase.from('erp_refresh_requests').insert({ requested_by: user.id }).select().single()
      if (error?.code === '23505') { await loadRefreshRequest(); return }  // someone already queued one
      if (error) throw error
      setRefreshReq(data)
      await logActivity('erp_refresh_requested', 'Requested an ERP / HB NEXT data refresh', { request_id: data.id })
    } catch (err) {
      setRefreshError('Could not queue the refresh: ' + err.message)
    } finally {
      setRefreshRequesting(false)
    }
  }

  useEffect(() => { loadRefreshRequest() }, [])

  // While a refresh is queued or running, check on it; reload the page's data when it ends.
  useEffect(() => {
    if (!refreshOpen) return
    const timer = setInterval(async () => {
      const r = await loadRefreshRequest()
      if (r && !['pending', 'running'].includes(r.status)) { loadHistory(); loadLastUploads(); loadVendors() }
    }, 10000)
    return () => clearInterval(timer)
  // Polls only while a request is open; the loaders are plain functions of this component.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshOpen])

  // Pull from ERP: ResPlan (on the office PC) runs the reports, and the result is
  // imported straight away, the same as an approved upload. Pulling a month again
  // replaces that month's earlier pull for the brand.
  async function handleErpImport(brandName) {
    const type = fileType
    const month = type === 'jc_vendor_report' ? null : erpMonth
    setErpError('')
    setErpResult(null)
    setErpPulling(brandName)
    setErpStep('Contacting ResPlan...')
    try {
      setErpResult(await runErpPull(type, brandName, month, setErpStep))
      loadHistory()
      loadLastUploads()
      loadVendors()
    } catch (err) {
      setErpError(`${brandName}: ${err.message}`)
    } finally {
      setErpPulling(null)
      setErpStep('')
    }
  }

  /** One pull from ResPlan, imported. Resolves to what happened (shown under the Pull buttons). */
  async function runErpPull(type, brandName, month, progress) {
    const result = await pullFromErp(type, brandName, month, progress)
    const typeLabel = FILE_TYPES.find(t => t.value === type)?.label || type
    const label = erpPullLabel(result.range, result.pulledAt)
    const name = `ERP pull - ${typeLabel} - ${brandName} - ${label}.json`
    const sourceFile = new File([JSON.stringify(result)], name, { type: 'application/json' })
    const pullInfo = {
      erp_pull: true, brand: brandName, month, pulled_at: result.pulledAt,
      range_from: result.range?.from ?? null, range_to: result.range?.to ?? null,
    }

    if (type === 'jc_vendor_report') {
      const imported = await importJCVendors({
        parsed: result, codes: new Set(result.communities.map(c => c.code)), brandName, sourceFile,
        extraMapping: pullInfo, progress,
      })
      return { type, brand: brandName, label, summary: { ...imported, errors: result.summary.errors }, unmatched: [] }
    }
    // Nothing in the ERP for this period: leave VTC (and any earlier pull) as it is.
    if (!result.records.length) return { type, brand: brandName, label, summary: result.summary, unmatched: [], empty: true }
    const { unmatched, review } = await importErpRecords(type, result.records, sourceFile, pullInfo, progress)
    return { type, brand: brandName, label, summary: result.summary, unmatched, review }
  }

  // Nightly pulls: ResPlan opens /uploads?autopull=nightly in its own browser (signed
  // in to VTC) at midnight and reads window.__vtcAutopull for the outcome. Every pull
  // runs for the current month; on the 1st-3rd the previous month is pulled once more
  // so its last days are in. Pulling a month again needs an admin.
  // Refresh requests: ResPlan opens /uploads?autopull=request every few minutes; the page
  // runs the oldest queued "Refresh now" (see runRefreshRequest) or reports 'idle'.
  const [autopull, setAutopull] = useState(null)
  const autopullStarted = useRef(false)
  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get('autopull')
    if (mode !== 'nightly' && mode !== 'request') return
    if (!user || autopullStarted.current) return
    autopullStarted.current = true
    if (mode === 'request') runRefreshRequest()
    else runNightlyPulls()
  // Runs once, as soon as the signed-in user is known.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  /**
   * Runs every pull (JC vendors first, then schedule, rework, safety; both brands) and
   * publishes progress on window.__vtcAutopull for ResPlan. months defaults to this
   * month, plus last month on the 1st-3rd; types limits the pull types; onJob hears
   * each pull as it starts. Returns the final report.
   */
  async function runNightlyPulls({ months = null, types = null, onJob = () => {}, title = 'Nightly pulls' } = {}) {
    const report = { title, status: 'running', startedAt: new Date().toISOString(), step: '', results: [] }
    const publish = () => { window.__vtcAutopull = { ...report, results: [...report.results] }; setAutopull(window.__vtcAutopull) }
    publish()
    if (!isAdmin()) {
      Object.assign(report, { status: 'error', error: `${title} need an admin account (pulling a month again replaces it).` })
      publish()
      return report
    }
    if (!months) {
      const today = new Date()
      months = [thisMonth()]
      if (today.getDate() <= 3) {
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        months.unshift(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`)
      }
    }
    // JC vendors first: it adds vendors and their ERP IDs that the other pulls match on.
    const jobs = []
    for (const type of ['jc_vendor_report', 'schedule', 'rework', 'safety']) {
      if (types?.length && !types.includes(type)) continue
      for (const b of erpBrandsFor(type)) {
        for (const month of type === 'jc_vendor_report' ? [null] : months) jobs.push({ type, brand: b, month })
      }
    }
    for (const [i, job] of jobs.entries()) {
      const typeLabel = FILE_TYPES.find(t => t.value === job.type)?.label || job.type
      const what = `${typeLabel} - ${job.brand}${job.month ? ` - ${job.month}` : ''}`
      report.step = what
      publish()
      await onJob(`${what} (${i + 1} of ${jobs.length})`)
      try {
        const r = await runErpPull(job.type, job.brand, job.month, s => { report.step = `${what}: ${s}`; publish() })
        report.results.push({
          ...job, ok: true, label: r.label,
          text: r.empty ? 'no data for this period' : erpSummaryText(r.type, r.summary),
          unmatched: r.unmatched.length + (r.review?.names.filter(n => !n.vendorId && !n.tradeOnly).length || 0),
        })
      } catch (err) {
        report.results.push({ ...job, ok: false, error: err.message })
      }
      publish()
    }
    const failed = report.results.filter(r => !r.ok).length
    Object.assign(report, { status: failed ? 'partial' : 'done', step: '', finishedAt: new Date().toISOString() })
    publish()
    await logActivity('nightly_erp_pull', `${title}: ${report.results.length - failed} of ${report.results.length} imported${failed ? `, ${failed} failed` : ''}`, { results: report.results })
    loadHistory()
    loadLastUploads()
    loadVendors()
    return report
  }

  /**
   * Runs the oldest queued "Refresh now" request (erp_refresh_requests), writing progress
   * and the outcome back to it for the manager's page. Pulls every month since the last
   * finished refresh (at most 3), so days nobody refreshed are still filled in.
   */
  async function runRefreshRequest() {
    const idle = extra => { window.__vtcAutopull = { status: 'idle', results: [], ...extra } }
    const fail = error => { window.__vtcAutopull = { title: 'Refresh request', status: 'error', error, results: [] }; setAutopull(window.__vtcAutopull) }
    if (!isAdmin()) return fail('Refresh requests need an admin account (pulling a month again replaces it).')
    const requests = () => supabase.from('erp_refresh_requests')
    try {
      // A run that died mid-request would leave it "running" and block new ones: give up on it.
      await requests().update({ status: 'failed', error: 'Stopped responding after 2 hours', step: null, finished_at: new Date().toISOString() })
        .eq('status', 'running').lt('started_at', new Date(Date.now() - 2 * 3600 * 1000).toISOString())

      const { data: pending, error } = await requests().select('id, categories')
        .eq('status', 'pending').order('requested_at').limit(1).maybeSingle()
      if (error) throw error
      if (!pending) return idle()
      const { data: claimed, error: claimErr } = await requests()
        .update({ status: 'running', started_at: new Date().toISOString(), step: 'Starting...' })
        .eq('id', pending.id).eq('status', 'pending').select('id').maybeSingle()
      if (claimErr) throw claimErr
      if (!claimed) return idle()  // another run took it

      const { data: last } = await requests().select('finished_at')
        .in('status', ['done', 'partial']).not('finished_at', 'is', null)
        .order('finished_at', { ascending: false }).limit(1).maybeSingle()
      const today = new Date()
      const from = new Date(today.getFullYear(), today.getMonth() - 2, 1)  // at most 3 months
      const since = last ? new Date(last.finished_at) : today
      const start = since > from ? new Date(since.getFullYear(), since.getMonth(), 1) : from
      if (today.getDate() <= 3 && start.getFullYear() === today.getFullYear() && start.getMonth() === today.getMonth()) start.setMonth(start.getMonth() - 1)
      const months = []
      for (const d = start; d <= today; d.setMonth(d.getMonth() + 1)) months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)

      const report = await runNightlyPulls({
        months, types: pending.categories, title: 'Refresh requested from the Uploads page',
        onJob: step => requests().update({ step }).eq('id', pending.id).then(({ error: e }) => e && console.warn('Refresh progress update failed:', e.message)),
      })
      const ok = report.results.filter(r => r.ok).length
      const { error: doneErr } = await requests().update({
        status: report.status === 'error' || ok === 0 ? 'failed' : ok < report.results.length ? 'partial' : 'done',
        error: report.error || null,
        step: null,
        finished_at: new Date().toISOString(),
        result: report.results.map(r => ({ category: r.type, brand: r.brand, month: r.month, status: r.ok ? 'imported' : 'failed', text: r.text || null, error: r.error || null })),
      }).eq('id', pending.id)
      if (doneErr) console.warn('Saving the refresh outcome failed:', doneErr.message)
    } catch (err) {
      fail('Refresh request: ' + err.message)
    }
  }

  /** Imports pulled schedule / rework / safety records as an approved batch (see erp-import.js). */
  function importErpRecords(type, records, sourceFile, pullInfo, progress = setErpStep) {
    return importErpRecordsShared(importCtx(), type, records, sourceFile, pullInfo, progress)
  }

  /**
   * Corrects the vendor of one OFI name in a safety pull: re-points its records,
   * remembers the name as an alias (so the next pull matches it) and rescores.
   */
  async function assignOfiVendor(batchId, name, vendorId) {
    const { error } = await supabase.from('safety_records')
      .update({ vendor_id: vendorId || null })
      .eq('batch_id', batchId)
      .eq('vendor_name_raw', name)
    if (error) throw new Error('Updating the safety records failed: ' + error.message)
    // Remember the choice for the next pull (or forget it when cleared).
    const { error: aliasErr } = vendorId
      ? await supabase.from('vendor_aliases').upsert({ alias_name: name, vendor_id: vendorId, created_by: user?.id }, { onConflict: 'alias_name' })
      : await supabase.from('vendor_aliases').delete().eq('alias_name', name)
    if (aliasErr) console.warn('Alias save failed (non-fatal):', aliasErr.message)
    await supabase.rpc('calculate_scores')
    setErpResult(prev => prev?.review?.batchId === batchId ? {
      ...prev,
      review: { ...prev.review, names: prev.review.names.map(n => n.name === name ? { ...n, vendorId, source: vendorId ? 'confirmed' : 'unmatched' } : n) },
    } : prev)
    loadVendors()
  }

  async function handleParse() {
    if (!file || !fileType) return

    // JC Vendor Report has its own parse path (supports both CSV and XLSX)
    if (fileType === 'jc_vendor_report') {
      try {
        const ext = file.name.split('.').pop().toLowerCase()
        let result
        if (ext === 'csv') {
          const { parseJCVendorReport } = await import('../lib/parsers/jc-vendor-parser')
          const text = await file.text()
          result = parseJCVendorReport(text)
        } else if (['xls', 'xlsx'].includes(ext)) {
          const { parseJCVendorReportXLSX } = await import('../lib/parsers/jc-vendor-parser')
          result = await parseJCVendorReportXLSX(file)
        } else {
          alert('Please upload a CSV or XLSX file.')
          return
        }
        if (!result) { alert('Could not parse this file as a JC Preferred Vendors Report. Make sure the file contains a "Cost Code" header row.'); return }
        setJcParsed(result)
        setSelectedCommunities(new Set(result.communities.map(c => c.code)))
        setStep('jc-preview')
      } catch (err) {
        alert('Parse error: ' + err.message)
      }
      return
    }

    try {
      let result
      const ext = file.name.split('.').pop().toLowerCase()
      if (ext === 'csv') {
        const { parseCSV } = await import('../lib/parsers/csv-parser')
        result = await parseCSV(file)
      } else if (['xls', 'xlsx'].includes(ext)) {
        const { parseXLSX } = await import('../lib/parsers/xlsx-parser')
        result = await parseXLSX(file)
        if (result.sheetNames?.length > 1 && !sheetName) {
          setParsed(result)
          setStep('select-sheet')
          return
        }
        if (sheetName && result.sheets[sheetName]) {
          result.headers = result.sheets[sheetName].headers
          result.rows = result.sheets[sheetName].rows
        }
      } else {
        alert('Unsupported file type. Please upload CSV, XLS, or XLSX.')
        return
      }
      setParsed(result)
      autoMapColumns(result.headers)
      setStep('map-columns')
    } catch (err) {
      alert('Error parsing file: ' + err.message)
    }
  }

  function autoMapColumns(headers) {
    const fields = INTERNAL_FIELDS[fileType] || []
    const map = {}
    for (const field of fields) {
      const match = headers.find(h => {
        const hl = h.toLowerCase().replace(/[^a-z0-9]/g, '')
        const fl = field.toLowerCase().replace(/[^a-z0-9]/g, '')
        return hl === fl || hl.includes(fl) || fl.includes(hl)
      })
      if (match) map[field] = match
    }
    setColumnMap(map)
  }

  function handleMapColumn(internalField, sourceColumn) {
    setColumnMap(prev => ({ ...prev, [internalField]: sourceColumn }))
  }

  async function applyMapping() {
    const fields = INTERNAL_FIELDS[fileType] || []
    const required = REQUIRED_FIELDS[fileType] || []

    const rows = parsed.rows.map((row, i) => {
      const mapped = {}
      for (const field of fields) {
        const srcCol = columnMap[field]
        mapped[field] = srcCol ? row[srcCol] : null
      }
      mapped._rowNum = i + 1
      return mapped
    })

    const errs = []
    rows.forEach((row, i) => {
      for (const req of required) {
        if (!row[req] && row[req] !== 0) {
          errs.push({ row: i + 1, field: req, message: `Missing required field: ${req}` })
        }
      }
    })

    setMappedRows(rows)
    setErrors(errs)

    if (['schedule', 'safety', 'rework'].includes(fileType)) {
      const rawNames = [...new Set(rows.map(r => r.vendor_name).filter(Boolean))]
      const { matchVendors } = await import('../lib/parsers/vendor-matcher')
      const matches = matchVendors(rawNames, vendors, aliases, brandRefs)
      setVendorMatches(matches)
      const unmatched = matches.filter(m => m.source === 'unmatched')
      setSelectedUnmatched(new Set(unmatched.map(m => m.rawName)))
      const needsReview = matches.some(m => m.needsConfirmation || !m.matchedVendor)
      if (needsReview) { setStep('vendor-match'); return }
    }

    setStep('preview')
  }

  function handleVendorMatchConfirm(rawName, vendorId, remember) {
    setVendorMatches(prev => prev.map(m => {
      if (m.rawName === rawName) {
        const vendor = vendors.find(v => v.id === vendorId)
        return { ...m, matchedVendor: vendor, needsConfirmation: false, confirmed: true }
      }
      return m
    }))
    if (remember && vendorId) {
      supabase.from('vendor_aliases')
        .upsert({ alias_name: rawName, vendor_id: vendorId, created_by: user?.id })
        .then(({ error }) => { if (error) console.warn('Alias save failed (non-fatal):', error.message) })
    }
  }

  function handleVendorMatchSkip(rawName) {
    setVendorMatches(prev => prev.map(m =>
      m.rawName === rawName ? { ...m, matchedVendor: null, needsConfirmation: false, skipped: true } : m
    ))
  }

  function proceedFromMatching() { setStep('preview') }

  async function handleApprove() {
    setImporting(true)
    try {
      const storagePath = `${Date.now()}_${file.name}`
      const { data: fileRecord } = await supabase.storage
        .from('uploads')
        .upload(storagePath, file)
      // Storage upload is best-effort — missing bucket shouldn't block import

      const { data: uploadedFile } = await supabase.from('uploaded_files').insert({
        original_filename: file.name,
        storage_path: fileRecord?.path || storagePath,
        file_type: fileType,
        file_size_bytes: file.size,
        mime_type: file.type,
        uploaded_by: user.id,
      }).select().single()

      const { data: batch } = await supabase.from('import_batches').insert({
        uploaded_file_id: uploadedFile.id,
        file_type: fileType,
        status: 'approved',
        column_mapping: columnMap,
        row_count: mappedRows.length,
        valid_row_count: mappedRows.length - errors.length,
        error_row_count: errors.length,
        vendor_match_log: vendorMatches.length > 0 ? vendorMatches.map(m => ({
          raw: m.rawName, matched: m.matchedVendor?.name, confidence: m.confidence, source: m.source
        })) : null,
        imported_by: user.id,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      }).select().single()

      await supabase.from('raw_import_rows').insert(
        mappedRows.map((row, i) => ({
          batch_id: batch.id,
          row_number: i + 1,
          raw_data: row,
          is_valid: !errors.find(e => e.row === i + 1),
        }))
      )

      const vendorMap = new Map(vendorMatches.map(m => [m.rawName, m.matchedVendor?.id]))

      if (fileType === 'schedule') await insertScheduleRecords(supabase, batch.id, mappedRows, vendorMap)
      else if (fileType === 'safety') await insertSafetyRecords(supabase, batch.id, mappedRows, vendorMap)
      else if (fileType === 'rework') await insertReworkRecords(supabase, batch.id, mappedRows, vendorMap)
      else if (fileType === 'vendor_master') await insertVendorMaster(mappedRows)

      if (['schedule', 'safety', 'rework'].includes(fileType)) {
        await supabase.rpc('calculate_scores')
      }

      await logActivity('import_approved', `Imported ${fileType} data: ${file.name} (${mappedRows.length} rows)`, {
        batch_id: batch.id, file_id: uploadedFile.id, filename: file.name, row_count: mappedRows.length
      })

      setStep('done')
      loadHistory()
      loadLastUploads()
    } catch (err) {
      alert('Import error: ' + err.message)
    } finally {
      setImporting(false)
    }
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s at: ${label}`)), ms)
      ),
    ])
  }

  /** Imports parsed JC Preferred Vendors data (from a file or an ERP pull). Throws on failure. */
  function importJCVendors(args) {
    return importJCVendorsShared(importCtx(), args)
  }

  async function insertJCVendorReport() {
    setImporting(true)
    setImportError(null)
    setImportProgress('')
    try {
      await importJCVendors({ parsed: jcParsed, codes: selectedCommunities, brandName: brand, sourceFile: file, progress: setImportProgress })
      setStep('done')
      loadHistory()
      loadVendors()
      loadLastUploads()
    } catch (err) {
      setImportError(err.message)
    } finally {
      setImporting(false)
    }
  }

  async function insertVendorMaster(rows) {
    const { data: categories } = await supabase.from('vendor_categories').select('id, name')
    const catMap = new Map((categories || []).map(c => [c.name.toLowerCase(), c.id]))
    for (const row of rows) {
      if (!row.vendor_name) continue
      const catId = catMap.get((row.category || '').toLowerCase())
      if (!catId) continue
      await supabase.from('vendors').upsert({
        name: row.vendor_name,
        vendor_id_legacy: row.vendor_id ? Number(row.vendor_id) : null,
        category_id: catId,
        is_active: true,
      }, { onConflict: 'name' })
    }
    loadVendors()
  }

  function resetUpload() {
    setStep('upload')
    setFile(null)
    setFileType('')
    setParsed(null)
    setSheetName('')
    setColumnMap({})
    setVendorMatches([])
    setMappedRows([])
    setErrors([])
    setJcParsed(null)
    setSelectedCommunities(new Set())
    setImportError(null)
    setImportProgress('')
    setSelectedUnmatched(new Set())
    setErpResult(null)
    setErpError('')
    loadHistory()
  }

  return (
    <div className="space-y-6 min-w-0">
      <h1 className="glass-page-title">Upload Center</h1>
      {canUpload && step !== 'upload' && <UploadStepper step={step} />}

      {autopull && (
        <div className="glass-panel p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {autopull.status === 'running' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" style={{ color: 'var(--g-accent)' }} />}
            <h3 className="font-medium">
              {autopull.title || 'Nightly pulls'} {autopull.status === 'running' ? 'running' : autopull.status === 'done' ? 'finished' : autopull.status === 'partial' ? 'finished with failures' : 'could not run'}
            </h3>
          </div>
          {autopull.error && <p className="text-xs text-red-600">{autopull.error}</p>}
          {autopull.step && <p className="text-xs text-gray-500">{autopull.step}</p>}
          {autopull.results.map((r, i) => (
            <p key={i} className={`text-xs ${r.ok ? 'text-gray-700' : 'text-red-600'}`}>
              {r.ok ? <CheckCircle className="inline w-3 h-3 mr-1 text-green-600" /> : <XCircle className="inline w-3 h-3 mr-1" />}
              {FILE_TYPES.find(t => t.value === r.type)?.label} – {r.brand}{r.month ? ` – ${r.month}` : ''}: {r.ok ? r.text : r.error}
              {r.unmatched > 0 && <span className="text-amber-700"> ({r.unmatched} unmatched)</span>}
            </p>
          ))}
        </div>
      )}

      {canUpload && (
        <div className="glass-panel p-4 space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {refreshOpen ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" style={{ color: 'var(--g-accent)' }} />}
              <div>
                <h3 className="font-medium">Refresh ERP &amp; HB NEXT data now</h3>
                <p className="text-xs text-gray-500">Pulls schedule, rework, safety and JC vendor data for the current month instead of waiting for the midnight import.</p>
              </div>
            </div>
            <button
              onClick={requestRefresh}
              disabled={refreshOpen || refreshRequesting}
              className="glass-btn-primary flex items-center gap-2 px-4 py-2 disabled:opacity-50"
            >
              {refreshRequesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
              {refreshOpen ? 'Refresh in progress' : 'Refresh now'}
            </button>
          </div>
          {refreshError && <p className="text-xs text-red-600">{refreshError}</p>}
          {refreshReq && (
            <p className={`text-xs ${['failed', 'partial'].includes(refreshReq.status) ? 'text-red-600' : 'text-gray-500'}`}>
              {refreshReq.status === 'pending' && <>Queued {formatStamp(refreshReq.requested_at)}. The ResPlan PC picks it up within a few minutes{refreshStale ? ' — it seems to be off or offline; the refresh will run as soon as it is back' : ''}.</>}
              {refreshReq.status === 'running' && <>Running since {formatStamp(refreshReq.started_at)}{refreshReq.step ? `: ${refreshReq.step}` : ''}. This can take 10–30 minutes.</>}
              {refreshReq.status === 'done' && <><CheckCircle className="inline w-3 h-3 mr-1 text-green-600" />Last refreshed {formatStamp(refreshReq.finished_at)}: {refreshReq.result?.length || 0} pulls imported.</>}
              {['partial', 'failed'].includes(refreshReq.status) && <>
                <XCircle className="inline w-3 h-3 mr-1" />
                Last refresh {formatStamp(refreshReq.finished_at)} {refreshReq.status === 'partial' ? 'finished with failures' : 'failed'}
                {refreshReq.error ? `: ${refreshReq.error}` : ''}
                {(refreshReq.result || []).filter(r => r.error).map((r, i) => (
                  <span key={i} className="block">{FILE_TYPES.find(t => t.value === r.category)?.label} – {r.brand}{r.month ? ` – ${r.month}` : ''}: {r.error}</span>
                ))}
              </>}
            </p>
          )}
        </div>
      )}

      {!canUpload && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">View-only access</p>
            <p className="text-xs text-amber-700 mt-0.5">You can review the import history below. Uploading and importing data requires a manager or admin role.</p>
          </div>
        </div>
      )}

      {canUpload && step === 'upload' && (
        <div className="space-y-4">
          <div
            onDrop={handleFileDrop}
            onDragOver={e => e.preventDefault()}
            className="border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer glass-panel"
            style={{ borderColor: 'var(--g-line)' }}
          >
            <input type="file" accept=".csv,.xls,.xlsx" onChange={handleFileDrop} className="hidden" id="file-input" />
            <label htmlFor="file-input" className="cursor-pointer">
              <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
              <p className="text-sm text-gray-600">{file ? file.name : 'Drop a CSV, XLS, or XLSX file here, or click to browse'}</p>
              {file && <p className="text-xs text-gray-400 mt-1">{(file.size / 1024).toFixed(1)} KB</p>}
            </label>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {FILE_TYPES.map(ft => {
              const fresh = uploadFreshness(daysSince(lastUploads[ft.value]), UPLOAD_CADENCE[ft.value])
              return (
                <button
                  key={ft.value}
                  onClick={() => setFileType(ft.value)}
                  className={`p-3 rounded-xl border text-left transition-colors glass-panel ${
                    fileType === ft.value ? 'ring-2' : ''
                  }`}
                  style={fileType === ft.value ? { borderColor: 'var(--g-accent)', boxShadow: '0 0 0 1px var(--g-accent)' } : { borderColor: 'var(--g-line)' }}
                >
                  <p className="text-sm font-medium">{ft.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{ft.description}</p>
                  <span
                    className="inline-flex items-center gap-1.5 mt-2 px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{ backgroundColor: fresh.bg, color: fresh.text }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: fresh.dot }} />
                    {fresh.label}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Brand selector for JC reports */}
          {fileType === 'jc_vendor_report' && (
            <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <Building2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <label className="text-sm font-medium text-blue-800">Brand:</label>
              <select
                value={brand}
                onChange={e => setBrand(e.target.value)}
                className="px-3 py-1.5 border border-blue-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value="Ashton Woods">Ashton Woods</option>
                <option value="Starlight">Starlight</option>
              </select>
              <span className="text-xs text-blue-600">Select the brand this report belongs to</span>
            </div>
          )}

          <button
            onClick={handleParse}
            disabled={!file || !fileType}
            className="glass-btn-primary flex items-center gap-2 px-4 py-2 disabled:opacity-50"
          >
            Parse File <ArrowRight className="w-4 h-4" />
          </button>

          {/* Pull from ERP: ResPlan on the office PC runs the reports and the data is imported directly */}
          {ERP_PULL_KINDS[fileType] && (
            <div className="glass-panel p-4 space-y-3">
              <div className="flex items-center gap-2">
                <CloudDownload className="w-4 h-4" style={{ color: 'var(--g-accent)' }} />
                <h3 className="text-sm font-medium">{fileType === 'safety' ? 'Or pull the OFIs straight from HB NEXT' : 'Or pull it straight from the ERP'}</h3>
              </div>
              <p className="text-xs text-gray-500">
                {fileType === 'safety'
                  ? 'ResPlan reads the trade partner OFIs for Ashton Woods Homes - Houston from HB NEXT (Safety Manager › View OFIs), opening each OFI’s PDF for the company, community and violation, and imports them right away — no file needed. Each OFI is scored by its violation: fall protection as a near miss, tools and equipment as equipment, everything else as PPE.'
                  : 'ResPlan runs the reports in Dynamic Builder (Houston) and the data is imported right away — no file needed.'}
                {fileType !== 'jc_vendor_report' && ' Pull whenever you need: the current month covers the 1st through today, and pulling a month again replaces its earlier pull with the latest data.'}
                {fileType === 'schedule' && ' Like a manual upload, a month’s schedule data is filed under the following month.'}
                {' '}Works on the office PC while ResPlan is running.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                {fileType !== 'jc_vendor_report' && (
                  <label className="text-xs text-gray-600">
                    Data month
                    <input
                      type="month"
                      value={erpMonth}
                      onChange={e => setErpMonth(e.target.value)}
                      className="block mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                    />
                  </label>
                )}
                <label className="text-xs text-gray-600 flex-1 min-w-[12rem]">
                  ResPlan key <span className="text-gray-400">(ResPlan › Settings › VTC Scorecard)</span>
                  <input
                    type="password"
                    value={resplanKey}
                    onChange={e => { setResplanKeyState(e.target.value); setResplanKey(e.target.value) }}
                    placeholder="Paste once; saved in this browser"
                    className="block w-full mt-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white"
                  />
                </label>
                {erpBrandsFor(fileType).map(b => (
                  <button
                    key={b}
                    onClick={() => handleErpImport(b)}
                    disabled={!!erpPulling || !resplanKey || (fileType !== 'jc_vendor_report' && !erpMonth)}
                    className="glass-btn-primary flex items-center gap-2 px-4 py-2 disabled:opacity-50"
                  >
                    {erpPulling === b ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />}
                    Pull {b}
                  </button>
                ))}
              </div>
              {erpPulling && erpStep && <p className="text-xs text-gray-500">{erpStep} — this can take a few minutes.</p>}
              {erpError && <p className="text-xs text-red-600">{erpError}</p>}
              {erpResult && erpResult.type === fileType && (
                <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800">
                  <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p>
                      {erpResult.empty ? (
                        <><span className="font-medium">{erpResult.brand} ({erpResult.label}):</span> {erpResult.type === 'safety' ? 'HB NEXT has no OFIs for this period' : 'the ERP returned no data for this period'}, so nothing was imported.</>
                      ) : (
                        <><span className="font-medium">Imported {erpResult.brand} ({erpResult.label}):</span>{' '}{erpSummaryText(erpResult.type, erpResult.summary)}</>
                      )}
                    </p>
                    {erpResult.unmatched.length > 0 && (
                      <p className="text-xs text-amber-700 mt-1">
                        {erpResult.unmatched.length} vendor{erpResult.unmatched.length !== 1 ? 's' : ''} not matched to a scorecard vendor (imported without a vendor):{' '}
                        {erpResult.unmatched.join(', ')}
                      </p>
                    )}
                    {erpResult.summary.skippedInactive?.length > 0 && (
                      <p className="text-xs text-amber-700 mt-1">
                        Skipped {erpResult.summary.skippedInactive.length} vendor{erpResult.summary.skippedInactive.length !== 1 ? 's' : ''} deactivated in the scorecard:{' '}
                        {erpResult.summary.skippedInactive.join(', ')}
                      </p>
                    )}
                    {erpResult.summary.errors?.length > 0 && (
                      <p className="text-xs text-amber-700 mt-1">
                        {erpResult.type === 'safety' ? 'Some OFIs couldn’t be read and are missing' : 'Some projects failed and are missing'}: {erpResult.summary.errors.join('; ')}
                      </p>
                    )}
                    {erpResult.review && (
                      <OfiVendorReview review={erpResult.review} vendors={vendors} onAssign={assignOfiVendor} />
                    )}
                    {erpResult.summary.noShowVendorsWithoutTasks?.length > 0 && (
                      <p className="text-xs text-green-700 mt-1">
                        Left out (no-shows but no tasks this month): {erpResult.summary.noShowVendorsWithoutTasks.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Import history — visible to everyone (read-only for viewers) */}
      {step === 'upload' && (
        <div className="glass-panel p-6">
          <h2 className="glass-section-title mb-3">Import History</h2>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <div className="app-loading-spinner" />
            </div>
          ) : historyError ? (
            <div className="text-sm text-red-600 py-4">{historyError}</div>
          ) : history.length === 0 ? (
            <p className="text-sm py-4" style={{ color: 'var(--g-dim)' }}>No imports yet. Upload a file above to get started.</p>
          ) : (
          <div className="space-y-2">
            {history.map(h => (
              <div key={h.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-100">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="font-medium truncate">{h.uploaded_files?.original_filename || 'Unknown file'}</span>
                  <span className="text-xs px-2 py-0.5 bg-gray-100 rounded shrink-0">{importTypeLabel(h)}</span>
                </div>
                <div className="flex items-center gap-3 text-gray-500 shrink-0">
                  <span>{h.row_count ?? 0} rows</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${h.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                    {h.status}
                  </span>
                  <span>{h.created_at ? formatStamp(h.created_at) : '—'}</span>
                  {isAdmin() && (
                    <button
                      onClick={() => handleDeleteImport(h)}
                      disabled={deleting === h.id}
                      className="ml-1 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                      title="Delete this import and all associated data"
                    >
                      {deleting === h.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          )}
        </div>
      )}

      {/* JC Vendor Report preview */}
      {step === 'jc-preview' && jcParsed && (() => {
        const activeVendors = jcParsed.vendors.map(v => ({
          ...v,
          assignments: v.assignments.filter(a => selectedCommunities.has(a.communityCode))
        })).filter(v => v.assignments.length > 0)
        const activeAssignments = activeVendors.reduce((sum, v) => sum + v.assignments.length, 0)
        const allSelected = selectedCommunities.size === jcParsed.communities.length

        return (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">JC Vendor Report — Preview</h2>
                <p className="glass-page-subtitle">Brand: <strong>{brand}</strong> · File: {file?.name}</p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-blue-700">{selectedCommunities.size}</p>
                  <p className="text-xs text-blue-500 mt-0.5">of {jcParsed.communities.length} total</p>
                  <p className="text-sm text-blue-600 mt-1">Communities</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-green-700">{activeVendors.length}</p>
                  <p className="text-xs text-green-500 mt-0.5">of {jcParsed.vendors.length} total</p>
                  <p className="text-sm text-green-600 mt-1">Unique Vendors</p>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
                  <p className="text-2xl font-bold text-purple-700">{activeAssignments.toLocaleString()}</p>
                  <p className="text-xs text-purple-500 mt-0.5">of {jcParsed.vendors.reduce((s, v) => s + v.assignments.length, 0).toLocaleString()} total</p>
                  <p className="text-sm text-purple-600 mt-1">Assignments</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-gray-700">
                    Community codes — click to toggle ({selectedCommunities.size} of {jcParsed.communities.length} selected):
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelectedCommunities(new Set(jcParsed.communities.map(c => c.code)))}
                      className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded border border-blue-200"
                    >
                      All
                    </button>
                    <button
                      onClick={() => setSelectedCommunities(new Set())}
                      className="text-xs px-2 py-1 text-gray-500 hover:bg-gray-50 rounded border border-gray-200"
                    >
                      None
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                  {jcParsed.communities.map(c => {
                    const on = selectedCommunities.has(c.code)
                    return (
                      <button
                        key={c.code}
                        title={c.name}
                        onClick={() => setSelectedCommunities(prev => {
                          const next = new Set(prev)
                          if (next.has(c.code)) next.delete(c.code)
                          else next.add(c.code)
                          return next
                        })}
                        className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${
                          on
                            ? 'glass-nav-active border-transparent'
                            : 'bg-gray-100 text-gray-400 border-gray-200 line-through'
                        }`}
                      >
                        {c.code}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Vendors with active assignments (showing {Math.min(25, activeVendors.length)} of {activeVendors.length}):
                </p>
                <div className="space-y-1 max-h-56 overflow-y-auto border border-gray-200 rounded-lg">
                  {activeVendors.slice(0, 25).map(v => (
                    <div key={v.jcVendorId} className="flex items-center justify-between px-3 py-1.5 text-xs odd:bg-gray-50">
                      <span className="text-gray-800 font-medium">{v.name}</span>
                      <div className="flex items-center gap-3 text-gray-400 flex-shrink-0">
                        <span className="font-mono">{v.jcVendorId}</span>
                        <span>{v.assignments.length} assignments</span>
                      </div>
                    </div>
                  ))}
                  {activeVendors.length > 25 && (
                    <p className="text-xs text-gray-400 px-3 py-2">+ {activeVendors.length - 25} more vendors</p>
                  )}
                  {activeVendors.length === 0 && (
                    <p className="text-xs text-gray-400 px-3 py-3 text-center">No vendors — select at least one community above.</p>
                  )}
                </div>
              </div>
            </div>

            {importing && importProgress && (
              <p className="text-sm text-blue-700 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" /> {importProgress}
              </p>
            )}

            {importError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-medium text-red-800 flex items-center gap-2">
                  <XCircle className="w-4 h-4 flex-shrink-0" /> Import failed
                </p>
                <p className="text-xs text-red-700 mt-1 font-mono whitespace-pre-wrap">{importError}</p>
                {importError.includes('Timed out') && (
                  <p className="text-xs text-red-600 mt-2">
                    The database is waking up (Supabase free tier cold start). Wait 30 seconds and click Import again — it will work on the second attempt.
                  </p>
                )}
                {(importError.includes('vendor_brand_references') || importError.includes('vendor_community_assignments')) && (
                  <p className="text-xs text-red-600 mt-2">
                    Required database tables are missing. Run the SQL migration in Supabase → SQL Editor before importing.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep('upload')} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
                Back
              </button>
              <button
                onClick={insertJCVendorReport}
                disabled={importing || selectedCommunities.size === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                {importing ? 'Importing...' : `Import ${selectedCommunities.size} Communities`}
              </button>
            </div>
          </div>
        )
      })()}

      {step === 'select-sheet' && parsed?.sheetNames && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Select Sheet</h2>
          <p className="text-sm text-gray-500 mb-3">This workbook has multiple sheets. Select which one contains the data:</p>
          <div className="space-y-2">
            {parsed.sheetNames.map(name => (
              <button
                key={name}
                onClick={() => { setSheetName(name); setStep('upload'); setTimeout(handleParse, 100) }}
                className="block w-full text-left px-4 py-2 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 text-sm"
              >
                {name} ({parsed.sheets[name]?.rows.length} rows)
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'map-columns' && parsed && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold">Map Columns</h2>
          <p className="text-sm text-gray-500">Match your file columns to the required fields. Auto-mapped where possible.</p>

          <div className="space-y-3">
            {(INTERNAL_FIELDS[fileType] || []).map(field => (
              <div key={field} className="flex items-center gap-4">
                <span className={`text-sm w-40 ${(REQUIRED_FIELDS[fileType] || []).includes(field) ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>
                  {field.replace(/_/g, ' ')}
                  {(REQUIRED_FIELDS[fileType] || []).includes(field) && <span className="text-red-500 ml-1">*</span>}
                </span>
                <ArrowRight className="w-4 h-4 text-gray-400" />
                <select
                  value={columnMap[field] || ''}
                  onChange={e => handleMapColumn(field, e.target.value)}
                  className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white"
                >
                  <option value="">— Select column —</option>
                  {parsed.headers.map(h => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
                {columnMap[field] && <CheckCircle className="w-4 h-4 text-green-500" />}
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-4">
            <button onClick={() => setStep('upload')} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Back</button>
            <button onClick={applyMapping} className="glass-btn-primary">
              Apply Mapping <ArrowRight className="w-4 h-4 inline ml-1" />
            </button>
          </div>
        </div>
      )}

      {step === 'vendor-match' && (() => {
        const unmatchedList = vendorMatches.filter(m => m.source === 'unmatched' && !m.skipped)
        const fuzzyList = vendorMatches.filter(m => m.needsConfirmation && !m.confirmed && !m.skipped)
        const allUnmatchedSelected = unmatchedList.length > 0 && unmatchedList.every(m => selectedUnmatched.has(m.rawName))

        function skipSelected() {
          const toSkip = unmatchedList.filter(m => selectedUnmatched.has(m.rawName))
          setVendorMatches(prev => prev.map(m =>
            selectedUnmatched.has(m.rawName) ? { ...m, matchedVendor: null, needsConfirmation: false, skipped: true } : m
          ))
          setSelectedUnmatched(new Set())
        }

        return (
          <div className="space-y-4">
            {/* Section 1: Not in master list — batch skip */}
            {unmatchedList.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Not in master list ({unmatchedList.length})</h2>
                    <p className="text-sm text-gray-500 mt-0.5">These names have no match in your vendor database. Select all to skip them in one go, or uncheck any you want to manually assign.</p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 ml-4">
                    <button
                      onClick={() => setSelectedUnmatched(new Set(unmatchedList.map(m => m.rawName)))}
                      className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                    >Select all</button>
                    <button
                      onClick={() => setSelectedUnmatched(new Set())}
                      className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
                    >Deselect all</button>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="w-10 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={allUnmatchedSelected}
                            onChange={e => setSelectedUnmatched(e.target.checked ? new Set(unmatchedList.map(m => m.rawName)) : new Set())}
                          />
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name in file</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Closest master list entry</th>
                        <th className="w-20 px-3 py-2 text-left text-xs font-medium text-gray-600">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {unmatchedList.map(m => {
                        const top = m.candidates?.[0]
                        const checked = selectedUnmatched.has(m.rawName)
                        return (
                          <tr key={m.rawName} className={checked ? 'bg-gray-50 opacity-60' : ''}>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  const next = new Set(selectedUnmatched)
                                  e.target.checked ? next.add(m.rawName) : next.delete(m.rawName)
                                  setSelectedUnmatched(next)
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-800">{m.rawName}</td>
                            <td className="px-3 py-2 text-gray-400">{top ? top.vendor.name : '—'}</td>
                            <td className="px-3 py-2 text-gray-400 text-xs">{top ? `${(top.score * 100).toFixed(0)}%` : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {selectedUnmatched.size > 0 && (
                  <button
                    onClick={skipSelected}
                    className="flex items-center gap-2 px-4 py-2 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900"
                  >
                    <XCircle className="w-4 h-4" />
                    Skip {selectedUnmatched.size} selected vendor{selectedUnmatched.size !== 1 ? 's' : ''}
                  </button>
                )}
              </div>
            )}

            {/* Section 2: Fuzzy matches needing confirmation */}
            {fuzzyList.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">Confirm matches ({fuzzyList.length})</h2>
                  <p className="text-sm text-gray-500 mt-0.5">These names are similar to vendors in your database — confirm or correct each one.</p>
                </div>
                <div className="space-y-3">
                  {fuzzyList.map(match => (
                    <VendorMatchCard
                      key={match.rawName}
                      match={match}
                      vendors={vendors}
                      onConfirm={handleVendorMatchConfirm}
                      onSkip={handleVendorMatchSkip}
                    />
                  ))}
                </div>
              </div>
            )}

            {unmatchedList.length === 0 && fuzzyList.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <p className="text-sm text-green-600">All vendor names resolved.</p>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep('map-columns')} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Back</button>
              <button onClick={proceedFromMatching} className="glass-btn-primary">
                Continue to Preview <ArrowRight className="w-4 h-4 inline ml-1" />
              </button>
            </div>
          </div>
        )
      })()}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Preview Import</h2>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-500">{mappedRows.length} rows</span>
                {errors.length > 0 && (
                  <span className="text-red-600 flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> {errors.length} errors
                  </span>
                )}
              </div>
            </div>

            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">#</th>
                    {(INTERNAL_FIELDS[fileType] || []).map(f => (
                      <th key={f} className="px-3 py-2 text-left font-medium text-gray-600">{f}</th>
                    ))}
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {mappedRows.slice(0, 50).map((row, i) => {
                    const rowErrors = errors.filter(e => e.row === i + 1)
                    return (
                      <tr key={i} className={rowErrors.length > 0 ? 'bg-red-50' : ''}>
                        <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                        {(INTERNAL_FIELDS[fileType] || []).map(f => (
                          <td key={f} className="px-3 py-1.5 text-gray-700 max-w-40 truncate">{row[f] ?? '—'}</td>
                        ))}
                        <td className="px-3 py-1.5">
                          {rowErrors.length > 0
                            ? <span className="text-red-600">{rowErrors.map(e => e.message).join('; ')}</span>
                            : <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {mappedRows.length > 50 && <p className="text-xs text-gray-400 p-3">Showing first 50 of {mappedRows.length} rows</p>}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep('map-columns')} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Back</button>
            <button
              onClick={handleApprove}
              disabled={importing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {importing ? 'Importing...' : 'Approve & Import'}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900">Import Complete</h2>
          <p className="text-sm text-gray-500 mt-2">{file?.name}</p>
          <button onClick={resetUpload} className="mt-6 glass-btn-primary">
            Upload Another File
          </button>
        </div>
      )}
    </div>
  )
}

function VendorMatchCard({ match, vendors, onConfirm, onSkip }) {
  const [selectedId, setSelectedId] = useState(match.matchedVendor?.id || '')
  const [remember, setRemember] = useState(false)

  return (
    <div className="border border-yellow-200 bg-yellow-50 rounded-lg p-4">
      <p className="text-sm font-medium text-gray-900">
        Found "<span className="font-bold">{match.rawName}</span>" in your file.
      </p>

      {match.matchedVendor && (
        <p className="text-sm text-gray-600 mt-1">
          Did you mean <span className="font-semibold">{match.matchedVendor.name}</span>?
          <span className="text-gray-400 ml-2">({(match.confidence * 100).toFixed(0)}% match)</span>
        </p>
      )}

      {match.candidates && (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-gray-500">Possible matches:</p>
          {match.candidates.map(c => (
            <label key={c.vendor.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`match-${match.rawName}`}
                value={c.vendor.id}
                checked={selectedId === c.vendor.id}
                onChange={() => setSelectedId(c.vendor.id)}
              />
              {c.vendor.name} ({(c.score * 100).toFixed(0)}%)
            </label>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-4">
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1 bg-white flex-1"
        >
          <option value="">— Select vendor —</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>

        <label className="flex items-center gap-1 text-xs text-gray-500">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
          Remember
        </label>

        <button
          onClick={() => onConfirm(match.rawName, selectedId, remember)}
          disabled={!selectedId}
          className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
        >
          Match
        </button>
        <button
          onClick={() => onSkip(match.rawName)}
          className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

const OFI_MATCH_LABELS = {
  alias: 'remembered', exact: 'exact', exact_ci: 'exact', normalized: 'same name',
  fuzzy: 'similar name', name_words: 'similar name', confirmed: 'confirmed', unmatched: 'not matched',
}

/**
 * After a safety pull: each trade partner name as the OFIs wrote it, with the vendor
 * it was matched to. Unmatched names come first; any match can be corrected.
 */
function OfiVendorReview({ review, vendors, onAssign }) {
  const [saving, setSaving] = useState(null)
  const [error, setError] = useState('')
  const unmatched = review.names.filter(n => !n.vendorId && !n.tradeOnly).length

  async function assign(name, vendorId) {
    setSaving(name)
    setError('')
    try { await onAssign(review.batchId, name, vendorId) } catch (err) { setError(err.message) } finally { setSaving(null) }
  }

  return (
    <div className="mt-3 text-gray-800">
      <p className="text-xs font-medium">
        Trade partners in these OFIs{unmatched > 0 && <span className="text-amber-700"> — {unmatched} not matched yet</span>}
      </p>
      <p className="text-xs text-gray-500 mb-2">
        Names are as the OFIs wrote them. Pick the scorecard vendor for any that are wrong or missing; the choice is remembered for the next pull.
      </p>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
        {review.names.map(n => (
          <div key={n.name} className="flex flex-wrap items-center gap-2 text-xs">
            <span className="w-48 truncate font-medium" title={n.name}>{n.name}</span>
            <span className="w-10 text-gray-500">{n.count} OFI{n.count !== 1 ? 's' : ''}</span>
            {n.tradeOnly ? (
              <span className="text-amber-700">Only the trade was named, so it can’t be attributed to a vendor</span>
            ) : (
              <>
                <select
                  value={n.vendorId}
                  disabled={saving === n.name}
                  onChange={e => assign(n.name, e.target.value)}
                  className={`flex-1 min-w-[12rem] border rounded px-2 py-1 bg-white ${n.vendorId ? 'border-gray-300' : 'border-amber-400'}`}
                >
                  <option value="">— Not matched —</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
                <span className={`w-24 ${n.vendorId ? 'text-gray-500' : 'text-amber-700'}`}>
                  {saving === n.name ? 'Saving…' : OFI_MATCH_LABELS[n.source] || n.source}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
