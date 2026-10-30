// Import logic shared by the Uploads page and the nightly job (vtc-automation/).
// Every function takes a context instead of importing the app's Supabase client,
// so it runs in the browser and in Node alike:
//   ctx = { supabase, user, isAdmin: boolean, logActivity(actionType, description, metadata) }
// Keep relative imports with explicit .js extensions: Node needs them.
import { resolveVendorForImport, resolveOfiVendor } from '../parsers/vendor-matcher.js'

/** Brands ResPlan can pull from the ERP (each is its own ERP login). */
export const ERP_BRANDS = ['Starlight', 'Ashton Woods']

/** Brands a pull type exists for: safety OFIs (HB NEXT) are only kept for Ashton Woods Houston. */
export const erpBrandsFor = type => (type === 'safety' ? ['Ashton Woods'] : ERP_BRANDS)

/** "2026-09-01" -> "2026-10-01" */
export function monthAfter(isoDate) {
  const [y, m] = isoDate.split('-').map(Number)
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/**
 * Severity of a safety OFI from its violation category (HB NEXT "nature of safety
 * violation"). Fall protection is scored as a near miss; tools and equipment
 * operation as equipment; everything else (PPE, ladders, electrical, site/trailer
 * general...) as PPE.
 */
export function ofiSeverity(category) {
  const c = (category || '').toLowerCase()
  if (/fall/.test(c)) return 'near_miss'
  if (/tool|equipment/.test(c)) return 'equipment'
  return 'ppe'
}

/** One-line summary of what an ERP pull imported, per upload type. */
export function erpSummaryText(fileType, s) {
  if (fileType === 'schedule') return `${s.vendors} vendors, ${s.tasks} tasks, ${s.noShows} no-shows`
  if (fileType === 'rework') return `${s.backcharges} backcharges totaling $${s.total.toLocaleString()}`
  if (fileType === 'safety') return `${s.ofis} OFIs${s.fines ? `, $${s.fines.toLocaleString()} in fines` : ''}`
  if (fileType === 'jc_vendor_report') return `${s.vendors} vendors, ${s.communities} communities, ${s.assignments} assignments`
  return ''
}

/**
 * Pulled ERP records as they are inserted. Schedule uploads have always been stored
 * under the month they were uploaded, i.e. the month after the data (July's report
 * -> 2026-08-01); ERP pulls follow suit.
 */
export function prepareErpRecords(type, records) {
  if (type === 'schedule') return records.map(r => ({ ...r, period_month: monthAfter(r.period_month) }))
  if (type === 'safety') return records.map(r => ({ ...r, severity: ofiSeverity(r.category), incident_type: r.category }))
  return records.map(r => ({ ...r, lot_or_address: r.community }))
}

/** Active vendors, aliases and ERP vendor ID references, for matching imported names. */
export async function fetchVendorData(supabase) {
  const [vRes, aRes, brRes] = await Promise.all([
    supabase.from('vendors').select('id, name, category_id').eq('is_active', true).order('name'),
    supabase.from('vendor_aliases').select('*'),
    supabase.from('vendor_brand_references').select('jc_vendor_id, vendor_id, brand'),
  ])
  for (const r of [vRes, aRes, brRes]) if (r.error) throw new Error('Loading vendors failed: ' + r.error.message)
  return { vendors: vRes.data || [], aliases: aRes.data || [], brandRefs: brRes.data || [] }
}

/** Deletes a batch, its records, and its file when no other batch uses it. Admin only (RLS). */
export async function removeBatchData(supabase, batch) {
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
}

/**
 * Imports pulled schedule / rework / safety records as an approved batch, replacing
 * an earlier pull of the same type, brand and month.
 * Returns { unmatched } (vendor names that couldn't be matched) and, for safety,
 * { review }: the batch and each OFI name with its vendor, to check and correct.
 */
export async function importErpRecords(ctx, type, records, sourceFile, pullInfo, progress = () => {}) {
  const { supabase, user } = ctx
  progress('Checking for an earlier pull of this month...')
  const { data: previous, error: prevErr } = await supabase.from('import_batches')
    .select('id, file_type, uploaded_file_id, uploaded_files(storage_path)')
    .eq('file_type', type)
    .eq('column_mapping->>source', 'erp_pull')
    .eq('column_mapping->>brand', pullInfo.brand)
    .eq('column_mapping->>month', pullInfo.month)
  if (prevErr) throw new Error('Checking earlier pulls failed: ' + prevErr.message)
  if (previous?.length && !ctx.isAdmin) {
    throw new Error(`${pullInfo.month} was already pulled. Only an admin can replace it.`)
  }
  for (const batch of previous || []) await removeBatchData(supabase, batch)

  // Vendor matching without review: ERP vendor ID via brand references first, then
  // alias / exact / confident fuzzy name match. Anything else stays unmatched.
  progress('Matching vendors...')
  // Fresh vendor data rather than the page's: nightly pulls run several imports in a row.
  const { vendors, aliases, brandRefs } = await fetchVendorData(supabase)
  const vendorMap = new Map()
  const matchLog = []
  if (type === 'safety') {
    // An OFI names the trade partner loosely, or only the trade with the company
    // under "Subcontractor Involved"; vendor_name becomes the company as written.
    const { data: categories } = await supabase.from('vendor_categories').select('name')
    records = records.map(r => {
      const m = resolveOfiVendor(r, vendors, aliases, categories || [])
      if (!vendorMap.has(m.name)) {
        vendorMap.set(m.name, m.vendor?.id || null)
        matchLog.push({ raw: m.name, matched: m.vendor?.name, source: m.source, trade_only: m.tradeOnly || undefined })
      }
      return { ...r, vendor_name: m.name }
    })
  }
  for (const r of records) {
    if (vendorMap.has(r.vendor_name)) continue
    let vendor = null, match = null
    for (const raw of [r.erp_vendor_id && `${r.erp_vendor_id} ${r.vendor_name}`, r.vendor_name].filter(Boolean)) {
      ({ vendor, match } = resolveVendorForImport(raw, vendors, aliases, brandRefs, { importBrand: pullInfo.brand }))
      if (vendor) break
    }
    vendorMap.set(r.vendor_name, vendor?.id || null)
    matchLog.push({ raw: r.vendor_name, matched: vendor?.name, confidence: match?.confidence, source: vendor ? match?.source : 'unmatched' })
  }
  const unmatched = matchLog.filter(m => !m.matched).map(m => m.raw)

  progress('Saving import...')
  const storagePath = `${Date.now()}_${sourceFile.name}`
  const { data: fileRecord } = await supabase.storage.from('uploads').upload(storagePath, sourceFile)
  const { data: uploadedFile, error: fileErr } = await supabase.from('uploaded_files').insert({
    original_filename: sourceFile.name,
    storage_path: fileRecord?.path || storagePath,
    file_type: type,
    file_size_bytes: sourceFile.size,
    mime_type: sourceFile.type,
    uploaded_by: user.id,
  }).select().single()
  if (fileErr) throw new Error('Saving import record failed: ' + fileErr.message)

  const { data: batch, error: batchErr } = await supabase.from('import_batches').insert({
    uploaded_file_id: uploadedFile.id,
    file_type: type,
    status: 'approved',
    column_mapping: { source: 'erp_pull', ...pullInfo },
    row_count: records.length,
    valid_row_count: records.length,
    error_row_count: 0,
    vendor_match_log: matchLog,
    imported_by: user.id,
    approved_by: user.id,
    approved_at: new Date().toISOString(),
  }).select().single()
  if (batchErr) throw new Error('Saving import batch failed: ' + batchErr.message)

  if (records.length) {
    await supabase.from('raw_import_rows').insert(
      records.map((row, i) => ({ batch_id: batch.id, row_number: i + 1, raw_data: row, is_valid: true }))
    )
  }

  progress(`Importing ${records.length} records...`)
  const prepared = prepareErpRecords(type, records)
  if (type === 'schedule') await insertScheduleRecords(supabase, batch.id, prepared, vendorMap)
  else if (type === 'safety') await insertSafetyRecords(supabase, batch.id, prepared, vendorMap)
  else await insertReworkRecords(supabase, batch.id, prepared, vendorMap)

  progress('Recalculating scores...')
  await supabase.rpc('calculate_scores')
  await ctx.logActivity('import_approved', `Pulled ${type} data from ERP: ${sourceFile.name.replace(/^ERP pull - /, '').replace(/\.json$/, '')} (${records.length} rows)`, {
    batch_id: batch.id, file_id: uploadedFile.id, filename: sourceFile.name, row_count: records.length, ...pullInfo,
  })
  if (type !== 'safety') return { unmatched }
  const counts = new Map()
  for (const r of records) counts.set(r.vendor_name, (counts.get(r.vendor_name) || 0) + 1)
  return {
    unmatched: [],
    review: {
      batchId: batch.id,
      names: matchLog.map(m => ({
        name: m.raw, count: counts.get(m.raw) || 0, source: m.source, tradeOnly: !!m.trade_only,
        vendorId: vendorMap.get(m.raw) || '',
      })).sort((a, b) => (!!a.vendorId - !!b.vendorId) || a.name.localeCompare(b.name)),
    },
  }
}

/** Imports parsed JC Preferred Vendors data (from a file or an ERP pull). Throws on failure. */
export async function importJCVendors(ctx, { parsed, codes, brandName, sourceFile, extraMapping = {}, progress = () => {} }) {
  const { supabase, user } = ctx
  const activeCommunities = parsed.communities.filter(c => codes.has(c.code))

  // 1. Upsert communities — preserve existing brand when code already exists
  progress('Fetching existing communities...')
  const existingCommRes = await supabase.from('communities').select('code, brand')
  if (existingCommRes.error) throw new Error('Fetch communities failed: ' + existingCommRes.error.message)
  const existingBrandByCode = new Map((existingCommRes.data || []).map(c => [c.code, c.brand]))

  progress(`Upserting ${activeCommunities.length} communities...`)
  const { error: upsertCommErr } = await supabase.from('communities').upsert(
    activeCommunities.map(c => ({
      name: c.name,
      code: c.code,
      brand: existingBrandByCode.get(c.code) || brandName,
      is_active: true,
    })),
    { onConflict: 'code' }
  )
  if (upsertCommErr) throw new Error('Communities upsert failed: ' + upsertCommErr.message)

  // 2. Fetch lookup maps
  progress('Fetching communities...')
  console.log('[JC] Step 2a: fetching all communities')
  const commRes = await supabase.from('communities').select('id, code, brand')
  console.log('[JC] Step 2a result:', commRes.data?.length, commRes.error)
  if (commRes.error) throw new Error('Fetch communities failed: ' + commRes.error.message)

  progress('Fetching vendors...')
  console.log('[JC] Step 2b: fetching vendors')
  const [vendorRes, aliasRes] = await Promise.all([
    supabase.from('vendors').select('id, name').eq('is_active', true),
    supabase.from('vendor_aliases').select('alias_name, vendor_id'),
  ])
  console.log('[JC] Step 2b result:', vendorRes.data?.length, vendorRes.error)
  if (vendorRes.error) throw new Error('Fetch vendors failed: ' + vendorRes.error.message)
  if (aliasRes.error) throw new Error('Fetch aliases failed: ' + aliasRes.error.message)

  progress('Fetching brand references...')
  console.log('[JC] Step 2c: fetching brand refs')
  const refRes = await supabase.from('vendor_brand_references').select('jc_vendor_id, vendor_id, brand')
  console.log('[JC] Step 2c result:', refRes.data?.length, refRes.error)
  if (refRes.error) throw new Error('Fetch brand refs failed: ' + refRes.error.message)

  const vendorList = vendorRes.data || []
  const aliasList = aliasRes.data || []
  const allBrandRefs = refRes.data || []

  const communityCodeMap = new Map((commRes.data || []).map(c => [c.code, c.id]))
  const communityBrandByCode = new Map((commRes.data || []).map(c => [c.code, c.brand]))
  const existingRefSet = new Set(allBrandRefs.map(r => `${r.brand}:${r.jc_vendor_id}`))
  const refVendorByBrandJc = new Map(allBrandRefs.map(r => [`${r.brand}:${r.jc_vendor_id}`, r.vendor_id]))
  const aliasesToSave = new Map()

  function rememberAlias(aliasName, vendorId) {
    if (!aliasName || !vendorId) return
    aliasesToSave.set(aliasName, vendorId)
  }

  // 3. Determine which vendors have active assignments
  const activeVendors = parsed.vendors.map(v => ({
    ...v,
    filteredAssignments: v.assignments.filter(a => codes.has(a.communityCode))
  })).filter(v => v.filteredAssignments.length > 0)

  /** Brands inferred from assigned communities (vendors can span AW + SL with different JC IDs). */
  function brandsForVendor(jcVendor) {
    const brands = new Set()
    for (const a of jcVendor.filteredAssignments || []) {
      const commBrand = communityBrandByCode.get(a.communityCode)
      if (commBrand) brands.add(commBrand)
    }
    if (brands.size === 0) brands.add(brandName)
    return [...brands]
  }

  function resolveJCVendor(jcVendor) {
    for (const refBrand of brandsForVendor(jcVendor)) {
      const existingRefVendorId = refVendorByBrandJc.get(`${refBrand}:${jcVendor.jcVendorId}`)
      if (existingRefVendorId) return existingRefVendorId
    }

    const withId = `${jcVendor.jcVendorId} ${jcVendor.name}`
    for (const rawName of [withId, jcVendor.name]) {
      const { vendor, match } = resolveVendorForImport(rawName, vendorList, aliasList, allBrandRefs)
      if (vendor) {
        if (match?.source !== 'exact' && match?.source !== 'exact_ci' && match?.source !== 'jc_id') {
          rememberAlias(jcVendor.name, vendor.id)
        }
        return vendor.id
      }
    }
    return null
  }

  // 4. Fetch default category for new vendors (vendors table requires category_id NOT NULL)
  const { data: cats } = await supabase.from('vendor_categories').select('id, name').eq('name', 'Supplier').maybeSingle()
  const defaultCategoryId = cats?.id || null

  // 5. Batch insert new vendors (only when matcher + aliases can't find a match).
  // A vendor someone deactivated stays out: it isn't recreated or assigned.
  const { data: inactiveRows, error: inactiveErr } = await supabase.from('vendors').select('name').eq('is_active', false)
  if (inactiveErr) throw new Error('Fetch inactive vendors failed: ' + inactiveErr.message)
  const inactiveNames = new Set((inactiveRows || []).map(v => v.name))
  const unresolvedNames = [...new Set(
    activeVendors
      .filter(v => !resolveJCVendor(v))
      .map(v => v.name)
  )]
  const skippedInactive = unresolvedNames.filter(name => inactiveNames.has(name))
  const newVendorNames = unresolvedNames.filter(name => !inactiveNames.has(name))
  if (newVendorNames.length > 0) {
    progress(`Inserting ${newVendorNames.length} new vendors...`)
    console.log('[JC] Step 4: inserting vendors, defaultCategoryId =', defaultCategoryId)
    const { data: inserted, error } = await supabase.from('vendors')
      .insert(newVendorNames.map(name => ({
        name, is_active: true, created_by: user?.id,
        category_id: defaultCategoryId,
      })))
      .select('id, name')
    console.log('[JC] Step 4 result:', inserted?.length, error)
    if (error) throw new Error('Vendor insert failed: ' + error.message)
    for (const v of (inserted || [])) vendorList.push(v)
  }

  // Remember name variants so the next import auto-matches
  if (aliasesToSave.size > 0) {
    progress(`Saving ${aliasesToSave.size} vendor aliases...`)
    const { error: aliasErr } = await supabase.from('vendor_aliases').upsert(
      [...aliasesToSave.entries()].map(([alias_name, vendor_id]) => ({
        alias_name, vendor_id, created_by: user?.id,
      })),
      { onConflict: 'alias_name' }
    )
    if (aliasErr) console.warn('[JC] Alias save failed (non-fatal):', aliasErr.message)
  }

  function vendorIdFor(jcVendor) {
    return resolveJCVendor(jcVendor) || vendorList.find(v => v.name === jcVendor.name)?.id
  }

  // 6. Batch insert new brand references (one per brand when vendor spans AW + SL)
  const newRefs = []
  for (const v of activeVendors) {
    const vendorId = vendorIdFor(v)
    if (!vendorId) continue
    for (const refBrand of brandsForVendor(v)) {
      const refKey = `${refBrand}:${v.jcVendorId}`
      if (existingRefSet.has(refKey)) continue
      existingRefSet.add(refKey)
      newRefs.push({
        vendor_id: vendorId,
        brand: refBrand,
        jc_vendor_id: v.jcVendorId,
        jc_vendor_name: v.name,
      })
    }
  }
  if (newRefs.length > 0) {
    progress(`Inserting ${newRefs.length} brand references...`)
    const { error } = await supabase.from('vendor_brand_references').insert(newRefs)
    if (error) throw new Error('Brand refs insert failed: ' + error.message)
  }

  // 7. Batch upsert community assignments in chunks of 500
  const allAssignments = activeVendors.flatMap(v => {
    const vendorId = vendorIdFor(v)
    if (!vendorId) return []
    return v.filteredAssignments
      .filter(a => communityCodeMap.has(a.communityCode))
      .map(a => ({
        vendor_id: vendorId,
        community_id: communityCodeMap.get(a.communityCode),
        cost_code: a.costCode,
        brand: communityBrandByCode.get(a.communityCode) || brandName,
      }))
  })
  const CHUNK = 500
  for (let i = 0; i < allAssignments.length; i += CHUNK) {
    progress(`Upserting assignments ${i + 1}–${Math.min(i + CHUNK, allAssignments.length)} of ${allAssignments.length}...`)
    const { error } = await supabase.from('vendor_community_assignments').upsert(
      allAssignments.slice(i, i + CHUNK),
      { onConflict: 'vendor_id,community_id,cost_code' }
    )
    if (error) throw new Error('Assignments upsert failed: ' + error.message)
  }

  progress('Logging activity...')
  const importedVendors = activeVendors.filter(v => vendorIdFor(v)).length
  const importedAssignments = allAssignments.length
  if (skippedInactive.length) console.warn('[JC] Skipped deactivated vendors:', skippedInactive)

  // Record in import history (JC imports previously skipped import_batches)
  if (sourceFile && user?.id) {
    progress('Saving import record...')
    const storagePath = `${Date.now()}_${sourceFile.name}`
    const { data: fileRecord } = await supabase.storage.from('uploads').upload(storagePath, sourceFile)
    const { data: uploadedFile, error: uploadedFileErr } = await supabase.from('uploaded_files').insert({
      original_filename: sourceFile.name,
      storage_path: fileRecord?.path || storagePath,
      file_type: 'other',
      file_size_bytes: sourceFile.size,
      mime_type: sourceFile.type,
      uploaded_by: user.id,
    }).select().single()
    if (!uploadedFileErr && uploadedFile) {
      await supabase.from('import_batches').insert({
        uploaded_file_id: uploadedFile.id,
        file_type: 'other',
        status: 'approved',
        column_mapping: { source: 'jc_vendor_report', brand: brandName, ...extraMapping },
        row_count: importedAssignments,
        valid_row_count: importedAssignments,
        error_row_count: 0,
        imported_by: user.id,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
      })
    }
  }

  await ctx.logActivity('import_approved',
    `Imported JC Vendor Report (${brandName}${extraMapping.erp_pull ? ', pulled from ERP' : ''}): ${importedVendors} vendors, ${activeCommunities.length} communities, ${importedAssignments} assignments`,
    { brand: brandName, vendor_count: importedVendors, community_count: activeCommunities.length, assignment_count: importedAssignments }
  )

  return { vendors: importedVendors, communities: activeCommunities.length, assignments: importedAssignments, skippedInactive }
}

export async function insertScheduleRecords(supabase, batchId, rows, vendorMap) {
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

export async function insertSafetyRecords(supabase, batchId, rows, vendorMap) {
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

export async function insertReworkRecords(supabase, batchId, rows, vendorMap) {
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
