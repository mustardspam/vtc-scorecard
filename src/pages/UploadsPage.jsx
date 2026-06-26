import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { logActivity } from '../hooks/useActivityLog'
import { useAuth } from '../hooks/useAuth'
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, ArrowRight, Loader2, Building2, Trash2 } from 'lucide-react'
import UploadStepper from '../components/ui/UploadStepper'

const FILE_TYPES = [
  { value: 'schedule', label: 'Schedule Data', description: 'Monthly schedule adherence report' },
  { value: 'safety', label: 'Safety Data', description: 'Safety incident records' },
  { value: 'rework', label: 'Rework / Backcharges', description: 'Backcharge records with costs' },
  { value: 'vendor_master', label: 'Vendor Master List', description: 'Master list of vendors/trades' },
  { value: 'community_reference', label: 'Community Reference', description: 'Community/neighborhood list' },
  { value: 'jc_vendor_report', label: 'JC Vendor Report', description: 'JC Preferred Vendors pivot report (auto-parses vendors + communities)' },
]

const REQUIRED_FIELDS = {
  schedule: ['vendor_name', 'total_jobs', 'no_shows'],
  safety: ['vendor_name', 'severity'],
  rework: ['vendor_name', 'cost'],
  vendor_master: ['vendor_name', 'category'],
  community_reference: ['name', 'code'],
}

const INTERNAL_FIELDS = {
  schedule: ['vendor_name', 'vendor_id', 'total_jobs', 'no_shows', 'adherence_pct', 'period_month', 'community'],
  safety: ['vendor_name', 'severity', 'incident_date', 'incident_type', 'community'],
  rework: ['vendor_name', 'cost', 'rework_date', 'description', 'severity', 'lot_or_address', 'community'],
  vendor_master: ['vendor_name', 'vendor_id', 'category'],
  community_reference: ['name', 'code', 'brand'],
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
  const { user, isManager, isAdmin } = useAuth()
  const canUpload = isManager()

  useEffect(() => {
    let mounted = true
    loadVendors()
    loadHistory(mounted)
    return () => { mounted = false }
  }, [])

  async function loadVendors() {
    try {
      const [vRes, aRes, brRes] = await Promise.all([
        supabase.from('vendors').select('id, name, category_id').eq('is_active', true).order('name'),
        supabase.from('vendor_aliases').select('*'),
        supabase.from('vendor_brand_references').select('jc_vendor_id, vendor_id, brand'),
      ])
      setVendors(vRes.data || [])
      setAliases(aRes.data || [])
      setBrandRefs(brRes.data || [])
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

  async function handleDeleteImport(batch) {
    if (!confirm(`Delete import "${batch.uploaded_files?.original_filename || 'unknown'}" and all its data? This cannot be undone.`)) return
    setDeleting(batch.id)
    try {
      const batchId = batch.id
      const fileId = batch.uploaded_file_id

      await supabase.from('schedule_records').delete().eq('batch_id', batchId)
      await supabase.from('safety_records').delete().eq('batch_id', batchId)
      await supabase.from('rework_records').delete().eq('batch_id', batchId)
      await supabase.from('raw_import_rows').delete().eq('batch_id', batchId)
      await supabase.from('import_batches').delete().eq('id', batchId)

      if (fileId) {
        const { data: otherBatches } = await supabase
          .from('import_batches')
          .select('id')
          .eq('uploaded_file_id', fileId)
          .limit(1)
        if (!otherBatches?.length) {
          if (batch.uploaded_files?.storage_path) {
            await supabase.storage.from('uploads').remove([batch.uploaded_files.storage_path])
          }
          await supabase.from('uploaded_files').delete().eq('id', fileId)
        }
      }

      if (['schedule', 'safety', 'rework'].includes(batch.file_type)) {
        await supabase.rpc('calculate_scores')
      }

      await logActivity('import_deleted', `Deleted import: ${batch.uploaded_files?.original_filename}`, { batch_id: batchId, file_type: batch.file_type })
      await loadHistory()
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

      if (fileType === 'schedule') await insertScheduleRecords(batch.id, mappedRows, vendorMap)
      else if (fileType === 'safety') await insertSafetyRecords(batch.id, mappedRows, vendorMap)
      else if (fileType === 'rework') await insertReworkRecords(batch.id, mappedRows, vendorMap)
      else if (fileType === 'vendor_master') await insertVendorMaster(mappedRows)
      else if (fileType === 'community_reference') await insertCommunityReference(mappedRows)

      if (['schedule', 'safety', 'rework'].includes(fileType)) {
        await supabase.rpc('calculate_scores')
      }

      await logActivity('import_approved', `Imported ${fileType} data: ${file.name} (${mappedRows.length} rows)`, {
        batch_id: batch.id, file_id: uploadedFile.id, filename: file.name, row_count: mappedRows.length
      })

      setStep('done')
      loadHistory()
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

  async function insertJCVendorReport() {
    setImporting(true)
    setImportError(null)
    setImportProgress('')
    try {
      const activeCommunities = jcParsed.communities.filter(c => selectedCommunities.has(c.code))

      // 1. Check/insert communities — fetch ALL then filter client-side (avoids .in() encoding issues)
      setImportProgress(`Checking ${activeCommunities.length} communities...`)
      console.log('[JC] Step 1: fetching all communities')
      const { data: allExistingComms, error: existingCommErr } = await withTimeout(
        supabase.from('communities').select('code'),
        60000, 'communities SELECT'
      )
      console.log('[JC] Step 1 result:', allExistingComms?.length, existingCommErr)
      if (existingCommErr) throw new Error('Fetch existing communities failed: ' + existingCommErr.message)

      const existingCommCodes = new Set((allExistingComms || []).map(c => c.code))
      const missingComms = activeCommunities.filter(c => !existingCommCodes.has(c.code))
      console.log('[JC] Step 1: existing =', existingCommCodes.size, 'missing =', missingComms.length)

      if (missingComms.length > 0) {
        setImportProgress(`Inserting ${missingComms.length} new communities...`)
        const { error: insertCommErr } = await supabase.from('communities').insert(
          missingComms.map(c => ({ name: c.code, code: c.code, brand, is_active: true }))
        )
        console.log('[JC] Step 1 insert result:', insertCommErr)
        if (insertCommErr) throw new Error('Communities insert failed: ' + insertCommErr.message)
      }

      // 2. Fetch lookup maps
      setImportProgress('Fetching communities...')
      console.log('[JC] Step 2a: fetching all communities')
      const commRes = await supabase.from('communities').select('id, code')
      console.log('[JC] Step 2a result:', commRes.data?.length, commRes.error)
      if (commRes.error) throw new Error('Fetch communities failed: ' + commRes.error.message)

      setImportProgress('Fetching vendors...')
      console.log('[JC] Step 2b: fetching vendors')
      const vendorRes = await supabase.from('vendors').select('id, name')
      console.log('[JC] Step 2b result:', vendorRes.data?.length, vendorRes.error)
      if (vendorRes.error) throw new Error('Fetch vendors failed: ' + vendorRes.error.message)

      setImportProgress('Fetching brand references...')
      console.log('[JC] Step 2c: fetching brand refs')
      const refRes = await supabase.from('vendor_brand_references').select('jc_vendor_id, brand')
      console.log('[JC] Step 2c result:', refRes.data?.length, refRes.error)
      if (refRes.error) throw new Error('Fetch brand refs failed: ' + refRes.error.message)

      const communityCodeMap = new Map((commRes.data || []).map(c => [c.code, c.id]))
      const vendorNameMap = new Map((vendorRes.data || []).map(v => [v.name.toLowerCase().trim(), v.id]))
      const existingRefSet = new Set((refRes.data || []).map(r => `${r.brand}:${r.jc_vendor_id}`))

      // 3. Determine which vendors have active assignments
      const activeVendors = jcParsed.vendors.map(v => ({
        ...v,
        filteredAssignments: v.assignments.filter(a => selectedCommunities.has(a.communityCode))
      })).filter(v => v.filteredAssignments.length > 0)

      // 4. Fetch default category for new vendors (vendors table requires category_id NOT NULL)
      const { data: cats } = await supabase.from('vendor_categories').select('id, name').eq('name', 'Supplier').maybeSingle()
      const defaultCategoryId = cats?.id || null

      // 5. Batch insert new vendors
      const newVendorNames = [...new Set(
        activeVendors
          .filter(v => !vendorNameMap.has(v.name.toLowerCase().trim()))
          .map(v => v.name)
      )]
      if (newVendorNames.length > 0) {
        setImportProgress(`Inserting ${newVendorNames.length} new vendors...`)
        console.log('[JC] Step 4: inserting vendors, defaultCategoryId =', defaultCategoryId)
        const { data: inserted, error } = await supabase.from('vendors')
          .insert(newVendorNames.map(name => ({
            name, is_active: true, created_by: user?.id,
            category_id: defaultCategoryId,
          })))
          .select('id, name')
        console.log('[JC] Step 4 result:', inserted?.length, error)
        if (error) throw new Error('Vendor insert failed: ' + error.message)
        for (const v of (inserted || [])) vendorNameMap.set(v.name.toLowerCase().trim(), v.id)
      }

      // 6. Batch insert new brand references
      const newRefs = activeVendors
        .filter(v => !existingRefSet.has(`${brand}:${v.jcVendorId}`))
        .map(v => ({
          vendor_id: vendorNameMap.get(v.name.toLowerCase().trim()),
          brand, jc_vendor_id: v.jcVendorId, jc_vendor_name: v.name,
        }))
        .filter(r => r.vendor_id)
      if (newRefs.length > 0) {
        setImportProgress(`Inserting ${newRefs.length} brand references...`)
        const { error } = await supabase.from('vendor_brand_references').insert(newRefs)
        if (error) throw new Error('Brand refs insert failed: ' + error.message)
      }

      // 7. Batch upsert community assignments in chunks of 500
      const allAssignments = activeVendors.flatMap(v => {
        const vendorId = vendorNameMap.get(v.name.toLowerCase().trim())
        if (!vendorId) return []
        return v.filteredAssignments
          .filter(a => communityCodeMap.has(a.communityCode))
          .map(a => ({
            vendor_id: vendorId,
            community_id: communityCodeMap.get(a.communityCode),
            cost_code: a.costCode,
            brand,
          }))
      })
      const CHUNK = 500
      for (let i = 0; i < allAssignments.length; i += CHUNK) {
        setImportProgress(`Upserting assignments ${i + 1}–${Math.min(i + CHUNK, allAssignments.length)} of ${allAssignments.length}...`)
        const { error } = await supabase.from('vendor_community_assignments').upsert(
          allAssignments.slice(i, i + CHUNK),
          { onConflict: 'vendor_id,community_id,cost_code' }
        )
        if (error) throw new Error('Assignments upsert failed: ' + error.message)
      }

      setImportProgress('Logging activity...')
      const importedVendors = activeVendors.length
      const importedAssignments = allAssignments.length

      // Record in import history (JC imports previously skipped import_batches)
      if (file && user?.id) {
        setImportProgress('Saving import record...')
        const storagePath = `${Date.now()}_${file.name}`
        const { data: fileRecord } = await supabase.storage.from('uploads').upload(storagePath, file)
        const { data: uploadedFile, error: uploadedFileErr } = await supabase.from('uploaded_files').insert({
          original_filename: file.name,
          storage_path: fileRecord?.path || storagePath,
          file_type: 'other',
          file_size_bytes: file.size,
          mime_type: file.type,
          uploaded_by: user.id,
        }).select().single()
        if (!uploadedFileErr && uploadedFile) {
          await supabase.from('import_batches').insert({
            uploaded_file_id: uploadedFile.id,
            file_type: 'other',
            status: 'approved',
            column_mapping: { source: 'jc_vendor_report', brand },
            row_count: importedAssignments,
            valid_row_count: importedAssignments,
            error_row_count: 0,
            imported_by: user.id,
            approved_by: user.id,
            approved_at: new Date().toISOString(),
          })
        }
      }

      await logActivity('import_approved',
        `Imported JC Vendor Report (${brand}): ${importedVendors} vendors, ${activeCommunities.length} communities, ${importedAssignments} assignments`,
        { brand, vendor_count: importedVendors, community_count: activeCommunities.length, assignment_count: importedAssignments }
      )

      setStep('done')
      loadHistory()
      loadVendors()
    } catch (err) {
      setImportError(err.message)
    } finally {
      setImporting(false)
    }
  }

  async function insertScheduleRecords(batchId, rows, vendorMap) {
    const records = rows.filter(r => r.vendor_name).map(r => {
      const totalJobs = Number(r.total_jobs) || 0
      const noShows = Number(r.no_shows) || 0
      const adherence = totalJobs > 0 ? (totalJobs - noShows) / totalJobs : 1
      return {
        batch_id: batchId,
        vendor_id: vendorMap.get(r.vendor_name) || null,
        vendor_name_raw: r.vendor_name,
        period_month: r.period_month || new Date().toISOString().slice(0, 8) + '01',
        total_jobs: totalJobs, no_shows: noShows, adherence_pct: adherence,
      }
    })
    if (records.length > 0) {
      const { error } = await supabase.from('schedule_records').insert(records)
      if (error) throw new Error('Schedule records insert failed: ' + error.message)
    }
  }

  async function insertSafetyRecords(batchId, rows, vendorMap) {
    const severityPoints = { equipment: 1, ppe: 2, near_miss: 5, first_aid: 10, recordable: 25, lost_time: 50 }
    const records = rows.filter(r => r.vendor_name).map(r => {
      const sev = (r.severity || '').toLowerCase().replace(/\s+/g, '_')
      return {
        batch_id: batchId,
        vendor_id: vendorMap.get(r.vendor_name) || null,
        vendor_name_raw: r.vendor_name,
        incident_date: r.incident_date || null,
        incident_type: r.incident_type || null,
        severity: sev || 'ppe',
        severity_points: severityPoints[sev] || 2,
        record_date: r.incident_date || new Date().toISOString().slice(0, 10),
      }
    })
    if (records.length > 0) {
      const { error } = await supabase.from('safety_records').insert(records)
      if (error) throw new Error('Safety records insert failed: ' + error.message)
    }
  }

  async function insertReworkRecords(batchId, rows, vendorMap) {
    const records = rows.filter(r => r.vendor_name).map(r => {
      const cost = Math.abs(Number(String(r.cost).replace(/[$,()]/g, '').trim()) || 0)
      let severity, penaltyPoints
      if (cost <= 100) { severity = 'low'; penaltyPoints = 2 }
      else if (cost <= 250) { severity = 'medium'; penaltyPoints = 5 }
      else { severity = 'high'; penaltyPoints = 10 }
      return {
        batch_id: batchId,
        vendor_id: vendorMap.get(r.vendor_name) || null,
        vendor_name_raw: r.vendor_name,
        rework_date: r.rework_date || null,
        description: r.description || null,
        cost, severity, penalty_points: penaltyPoints,
        lot_or_address: r.lot_or_address || null,
        record_date: r.rework_date || new Date().toISOString().slice(0, 10),
      }
    })
    if (records.length > 0) {
      const { error } = await supabase.from('rework_records').insert(records)
      if (error) throw new Error('Rework records insert failed: ' + error.message)
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

  async function insertCommunityReference(rows) {
    for (const row of rows) {
      if (!row.name || !row.code) continue
      await supabase.from('communities').upsert({
        name: row.name,
        code: row.code,
        brand: row.brand || null,
        is_active: true,
      }, { onConflict: 'code' })
    }
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
    loadHistory()
  }

  return (
    <div className="space-y-6 min-w-0">
      <h1 className="glass-page-title">Upload Center</h1>
      {canUpload && step !== 'upload' && <UploadStepper step={step} />}

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
            {FILE_TYPES.map(ft => (
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
              </button>
            ))}
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
                  <span>{h.created_at ? new Date(h.created_at).toLocaleDateString() : '—'}</span>
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
