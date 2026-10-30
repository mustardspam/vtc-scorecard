// Checks a transformed dataset against what the scorecard's tables need before it is
// imported. Field names follow what ResPlan sends and what src/lib/importers/erp-import.js
// reads; adjust SCHEMAS here if ResPlan's records change.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const isIsoDate = v => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v))
const isText = v => typeof v === 'string' && v.trim() !== ''
const isCount = v => v !== '' && v !== null && typeof v !== 'boolean' && Number.isInteger(Number(v)) && Number(v) >= 0
const isMoney = v => v !== '' && v !== null && typeof v !== 'boolean' && Number.isFinite(Number(String(v).replace(/[$,()]/g, '').trim()))
const SEVERITIES = ['equipment', 'ppe', 'near_miss', 'first_aid', 'recordable', 'lost_time']

const field = (required, check, expected) => ({ required, check, expected })

export const SCHEMAS = {
  schedule: {
    vendor_name: field(true, isText, 'vendor name'),
    total_jobs: field(true, isCount, 'whole number >= 0'),
    no_shows: field(true, isCount, 'whole number >= 0'),
    period_month: field(true, v => isIsoDate(v) && v.endsWith('-01'), 'first of a month (YYYY-MM-01)'),
  },
  rework: {
    vendor_name: field(true, isText, 'vendor name'),
    cost: field(true, isMoney, 'amount'),
    rework_date: field(false, isIsoDate, 'date (YYYY-MM-DD)'),
    description: field(false, v => typeof v === 'string', 'text'),
  },
  safety: {
    incident_date: field(true, isIsoDate, 'date (YYYY-MM-DD)'),
    severity: field(true, v => SEVERITIES.includes(v), SEVERITIES.join(' / ')),
    category: field(false, v => typeof v === 'string', 'text'),
  },
}

const missing = v => v === undefined || v === null || v === ''
const show = v => JSON.stringify(v)?.slice(0, 40)

function rowErrors(schema, row) {
  const errs = []
  for (const [name, f] of Object.entries(schema)) {
    const v = row[name]
    if (missing(v)) { if (f.required) errs.push(`${name} is missing`); continue }
    if (!f.check(v)) errs.push(`${name} should be ${f.expected} (got ${show(v)})`)
  }
  return errs
}

function jcErrors(t) {
  const errors = []
  if (!Array.isArray(t.communities)) return ['communities is missing or not a list']
  if (!Array.isArray(t.vendors)) return ['vendors is missing or not a list']
  if (!t.communities.length) errors.push('no communities in the report')
  t.communities.forEach((c, i) => { if (!isText(c?.code)) errors.push(`community ${i + 1}: code is missing`) })
  t.vendors.forEach((v, i) => {
    const at = `vendor ${i + 1}`
    if (!/^\d+$/.test(String(v?.jcVendorId ?? ''))) errors.push(`${at}: jcVendorId should be digits (got ${show(v?.jcVendorId)})`)
    if (!isText(v?.name)) errors.push(`${at}: name is missing`)
    if (!Array.isArray(v?.assignments)) { errors.push(`${at}: assignments is not a list`); return }
    v.assignments.forEach((a, j) => {
      if (!isText(a?.communityCode)) errors.push(`${at} assignment ${j + 1}: communityCode is missing`)
      if (!/^\d+$/.test(String(a?.costCode ?? ''))) errors.push(`${at} assignment ${j + 1}: costCode should be digits`)
    })
  })
  return errors
}

/**
 * Validates a transformed dataset. previousCount is the row count of the last import of
 * the same category, brand and month: a month-to-date pull should not shrink.
 * Returns { ok, errors, warnings, count }.
 */
export function validateDataset(transformed, { previousCount = null, maxInvalidRowRatio = 0, rowCountDropThreshold = 0.5, minRowsForDropCheck = 10 } = {}) {
  const { category, count } = transformed
  const errors = []
  const warnings = []

  if (category === 'jc_vendor_report') {
    const errs = jcErrors(transformed)
    if (errs.length) errors.push(`${errs.length} problem(s): ${errs.slice(0, 10).join('; ')}`)
  } else {
    const schema = SCHEMAS[category]
    if (!schema) errors.push(`Unknown category ${category}`)
    else if (!Array.isArray(transformed.records)) errors.push('records is missing or not a list')
    else {
      const bad = []
      transformed.records.forEach((row, i) => {
        const errs = rowErrors(schema, row)
        if (errs.length) bad.push(`row ${i + 1}: ${errs.join(', ')}`)
        if (category === 'schedule' && isCount(row.total_jobs) && isCount(row.no_shows) && Number(row.no_shows) > Number(row.total_jobs)) {
          warnings.push(`row ${i + 1}: no_shows (${row.no_shows}) > total_jobs (${row.total_jobs})`)
        }
        if (category === 'safety' && ![row.vendor_name, row.trade_type, row.subcontractor].some(isText)) {
          warnings.push(`row ${i + 1}: no trade partner named (imports as "Unknown")`)
        }
      })
      if (bad.length && bad.length > maxInvalidRowRatio * transformed.records.length) {
        errors.push(`${bad.length} of ${transformed.records.length} rows invalid: ${bad.slice(0, 10).join('; ')}${bad.length > 10 ? '; ...' : ''}`)
      } else if (bad.length) {
        warnings.push(`${bad.length} invalid rows tolerated: ${bad.slice(0, 5).join('; ')}`)
      }
    }
  }

  if (previousCount != null && !errors.length) {
    if (count === 0 && previousCount > 0) {
      errors.push(`returned 0 rows; the last import of this period had ${previousCount}`)
    } else if (previousCount >= minRowsForDropCheck && count < previousCount * (1 - rowCountDropThreshold)) {
      errors.push(`row count dropped from ${previousCount} to ${count} (more than ${Math.round(rowCountDropThreshold * 100)}%) since the last import of this period`)
    }
  }

  return { ok: errors.length === 0, errors, warnings: warnings.slice(0, 20), count }
}
