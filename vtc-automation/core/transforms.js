import { prepareErpRecords } from '../../src/lib/importers/erp-import.js'

/**
 * A ResPlan result as the scorecard will store it, for validating and archiving. The
 * mapping is the scorecard's own (prepareErpRecords); the import itself still starts
 * from the raw result, exactly as the Uploads page does.
 * Returns { category, records, count } or, for the JC report, { category, communities, vendors, count }.
 */
export function transform(category, result) {
  if (!result || typeof result !== 'object') return { category, records: null, count: 0 }
  if (category === 'jc_vendor_report') {
    const vendors = Array.isArray(result.vendors) ? result.vendors : null
    const count = (vendors || []).reduce((n, v) => n + (Array.isArray(v?.assignments) ? v.assignments.length : 0), 0)
    return { category, communities: Array.isArray(result.communities) ? result.communities : null, vendors, count }
  }
  if (!Array.isArray(result.records)) return { category, records: null, count: 0 }
  const rows = result.records.map(r => (r && typeof r === 'object' ? r : {}))
  // A schedule row without a period_month can't be shifted; validation reports it.
  const records = category === 'schedule'
    ? rows.map(r => (typeof r.period_month === 'string' ? prepareErpRecords('schedule', [r])[0] : r))
    : prepareErpRecords(category, rows)
  return { category, records, count: records.length }
}
