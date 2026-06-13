import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { parseCSV } from '../lib/parsers/csv-parser'
import { parseXLSX } from '../lib/parsers/xlsx-parser'
import { matchVendors } from '../lib/parsers/vendor-matcher'
import { parseJCVendorReport, parseJCVendorReportXLSX } from '../lib/parsers/jc-vendor-parser'
import { logActivity } from '../hooks/useActivityLog'
import { useAuth } from '../hooks/useAuth'
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, ArrowRight, Loader2, Building2 } from 'lucide-react'

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
  const [jcParsed, setJcParsed] = useState(null)
  const { user } = useAuth()

  useEffect(() => {
    loadVendors()
    loadHistory()
  }, [])

  async function loadVendors() {
    const [vRes, aRes, brRes] = await Promise.all([
      supabase.from('vendors').select('id, name, category_id').eq('is_active', true).order('name'),
      supabase.from('vendor_aliases').select('*'),
      supabase.from('vendor_brand_references').select('jc_vendor_id, vendor_id, brand'),
    ])
    setVendors(vRes.data || [])
    setAliases(aRes.data || [])
    setBrandRefs(brRes.data || [])
  }

  async function loadHistory() {
    const { data } = await supabase
      .from('import_batches')
      .select('*, uploaded_files(original_filename)')
      .order('created_at', { ascending: false })
      .limit(20)
    setHistory(data || [])
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
          const text = await file.text()
          result = parseJCVendorReport(text)
        } else if (['xls', 'xlsx'].includes(ext)) {
          result = await parseJCVendorReportXLSX(file)
        } else {
          alert('Please upload a CSV or XLSX file.')
          return
        }
        if (!result) { alert('Could not parse this file as a JC Preferred Vendors Report. Make sure the file contains a "Cost Code" header row.'); return }
        setJcParsed(result)
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
        result = await parseCSV(file)
      } else if (['xls', 'xlsx'].includes(ext)) {
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

  function applyMapping() {
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
      const matches = matchVendors(rawNames, vendors, aliases, brandRefs)
      setVendorMatches(matches)
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
      supabase.from('vendor_aliases').upsert({ alias_name: rawName, vendor_id: vendorId, created_by: user?.id })
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
      const { data: fileRecord } = await supabase.storage
        .from('uploads')
        .upload(`${Date.now()}_${file.name}`, file)

      const { data: uploadedFile } = await supabase.from('uploaded_files').insert({
        original_filename: file.name,
        storage_path: fileRecord?.path || `${Date.now()}_${file.name}`,
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

  async function insertJCVendorReport() {
    setImporting(true)
    try {
      // 1. Upsert communities
      for (const c of jcParsed.communities) {
        await supabase.from('communities').upsert(
          { name: c.code, code: c.code, brand, is_active: true },
          { onConflict: 'code' }
        )
      }

      // 2. Build lookup maps
      const { data: allCommunities } = await supabase.from('communities').select('id, code')
      const communityCodeMap = new Map((allCommunities || []).map(c => [c.code, c.id]))

      const { data: existingVendors } = await supabase.from('vendors').select('id, name')
      const vendorNameMap = new Map((existingVendors || []).map(v => [v.name.toLowerCase().trim(), v.id]))

      const { data: existingRefs } = await supabase.from('vendor_brand_references').select('jc_vendor_id, brand')
      const existingRefSet = new Set((existingRefs || []).map(r => `${r.brand}:${r.jc_vendor_id}`))

      // 3. Import each vendor
      for (const v of jcParsed.vendors) {
        const refKey = `${brand}:${v.jcVendorId}`
        if (existingRefSet.has(refKey)) continue

        // Find or create canonical vendor record
        let vendorId = vendorNameMap.get(v.name.toLowerCase().trim())
        if (!vendorId) {
          const { data: newVendor } = await supabase.from('vendors').insert({
            name: v.name, is_active: true, created_by: user?.id,
          }).select('id').single()
          vendorId = newVendor?.id
          if (vendorId) vendorNameMap.set(v.name.toLowerCase().trim(), vendorId)
        }
        if (!vendorId) continue

        // Insert brand reference
        await supabase.from('vendor_brand_references').insert({
          vendor_id: vendorId, brand, jc_vendor_id: v.jcVendorId, jc_vendor_name: v.name,
        })

        // Insert community assignments
        const assignmentRows = v.assignments
          .filter(a => communityCodeMap.has(a.communityCode))
          .map(a => ({
            vendor_id: vendorId,
            community_id: communityCodeMap.get(a.communityCode),
            cost_code: a.costCode,
            brand,
          }))

        if (assignmentRows.length > 0) {
          await supabase.from('vendor_community_assignments').upsert(
            assignmentRows,
            { onConflict: 'vendor_id,community_id,cost_code' }
          )
        }
      }

      await logActivity('import_approved',
        `Imported JC Vendor Report (${brand}): ${jcParsed.vendors.length} vendors, ${jcParsed.communities.length} communities`,
        { brand, vendor_count: jcParsed.vendors.length, community_count: jcParsed.communities.length }
      )

      setStep('done')
      loadHistory()
      loadVendors()
    } catch (err) {
      alert('Import error: ' + err.message)
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
    if (records.length > 0) await supabase.from('schedule_records').insert(records)
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
    if (records.length > 0) await supabase.from('safety_records').insert(records)
  }

  async function insertReworkRecords(batchId, rows, vendorMap) {
    const records = rows.filter(r => r.vendor_name).map(r => {
      const cost = Math.abs(Number(r.cost) || 0)
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
    if (records.length > 0) await supabase.from('rework_records').insert(records)
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
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Upload Center</h1>

      {step === 'upload' && (
        <div className="space-y-4">
          <div
            onDrop={handleFileDrop}
            onDragOver={e => e.preventDefault()}
            className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-500 transition-colors cursor-pointer"
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
                className={`p-3 rounded-lg border text-left transition-colors ${
                  fileType === ft.value
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
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
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            Parse File <ArrowRight className="w-4 h-4" />
          </button>

          {history.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Import History</h2>
              <div className="space-y-2">
                {history.map(h => (
                  <div key={h.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-gray-400" />
                      <span className="font-medium">{h.uploaded_files?.original_filename}</span>
                      <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{h.file_type}</span>
                    </div>
                    <div className="flex items-center gap-3 text-gray-500">
                      <span>{h.row_count} rows</span>
                      <span className={`px-2 py-0.5 rounded text-xs ${h.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {h.status}
                      </span>
                      <span>{new Date(h.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* JC Vendor Report preview */}
      {step === 'jc-preview' && jcParsed && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">JC Vendor Report — Preview</h2>
              <p className="text-sm text-gray-500 mt-1">Brand: <strong>{brand}</strong> · File: {file?.name}</p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-blue-700">{jcParsed.communities.length}</p>
                <p className="text-sm text-blue-600 mt-1">Communities</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-green-700">{jcParsed.vendors.length}</p>
                <p className="text-sm text-green-600 mt-1">Unique Vendors</p>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-purple-700">
                  {jcParsed.vendors.reduce((sum, v) => sum + v.assignments.length, 0).toLocaleString()}
                </p>
                <p className="text-sm text-purple-600 mt-1">Assignments</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Community codes ({jcParsed.communities.length}):</p>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                {jcParsed.communities.map(c => (
                  <span key={c.code} className="text-xs font-mono bg-gray-100 text-gray-700 px-2 py-1 rounded">
                    {c.code}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Vendors (showing {Math.min(25, jcParsed.vendors.length)} of {jcParsed.vendors.length}):
              </p>
              <div className="space-y-1 max-h-56 overflow-y-auto border border-gray-200 rounded-lg">
                {jcParsed.vendors.slice(0, 25).map(v => (
                  <div key={v.jcVendorId} className="flex items-center justify-between px-3 py-1.5 text-xs odd:bg-gray-50">
                    <span className="text-gray-800 font-medium">{v.name}</span>
                    <div className="flex items-center gap-3 text-gray-400 flex-shrink-0">
                      <span className="font-mono">{v.jcVendorId}</span>
                      <span>{v.assignments.length} assignments</span>
                    </div>
                  </div>
                ))}
                {jcParsed.vendors.length > 25 && (
                  <p className="text-xs text-gray-400 px-3 py-2">+ {jcParsed.vendors.length - 25} more vendors</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep('upload')} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
              Back
            </button>
            <button
              onClick={insertJCVendorReport}
              disabled={importing}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {importing ? 'Importing...' : `Import ${brand} Data`}
            </button>
          </div>
        </div>
      )}

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
            <button onClick={applyMapping} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Apply Mapping <ArrowRight className="w-4 h-4 inline ml-1" />
            </button>
          </div>
        </div>
      )}

      {step === 'vendor-match' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold">Vendor Name Matching</h2>
          <p className="text-sm text-gray-500">Some vendor names need confirmation. Review the matches below:</p>

          <div className="space-y-4">
            {vendorMatches.filter(m => m.needsConfirmation || (!m.matchedVendor && !m.skipped)).map(match => (
              <VendorMatchCard
                key={match.rawName}
                match={match}
                vendors={vendors}
                onConfirm={handleVendorMatchConfirm}
                onSkip={handleVendorMatchSkip}
              />
            ))}
          </div>

          {vendorMatches.filter(m => m.needsConfirmation || (!m.matchedVendor && !m.skipped)).length === 0 && (
            <p className="text-sm text-green-600">All vendor names resolved.</p>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep('map-columns')} className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Back</button>
            <button onClick={proceedFromMatching} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Continue to Preview <ArrowRight className="w-4 h-4 inline ml-1" />
            </button>
          </div>
        </div>
      )}

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
          <button onClick={resetUpload} className="mt-6 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
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
