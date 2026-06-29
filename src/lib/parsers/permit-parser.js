import * as XLSX from 'xlsx'

// Parses the monthly Houston-area permit workbook (the "HPermits - <Month> <Year>"
// file). Despite sometimes carrying a .csv extension, it is an XLSX workbook with
// one tab per breakdown. We read the three clean tabular tabs and unpivot their
// month columns into normalized (scope, month, permits) rows:
//
//   MKT  -> 'Grand Total' row becomes scope_type 'total'; the remaining region
//           rows become scope_type 'region'
//   BLD  -> each builder row becomes scope_type 'builder' (the duplicate
//           'Grand Total' row is skipped — the total already comes from MKT)
//
// The SUB / PROJ / chart / *-data tabs are intentionally ignored: they are either
// derived summaries or hierarchical layouts that are brittle to parse, and the
// chosen breakdowns are total / region / builder.

const MONTH_ABBR = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

/** "MAY 24" -> "2024-05-01". Trailing-12 totals like "MAY 24 - APR 25" don't match. */
function parseMonthHeader(h) {
  if (typeof h !== 'string') return null
  const m = h.trim().match(/^([A-Za-z]{3})\s+(\d{2})$/)
  if (!m) return null
  const mo = MONTH_ABBR[m[1].toUpperCase()]
  if (!mo) return null
  const year = 2000 + Number(m[2])
  return `${year}-${String(mo).padStart(2, '0')}-01`
}

/** Index the columns of a header row that are real month columns. */
function monthColumns(headerRow) {
  const cols = []
  headerRow.forEach((h, idx) => {
    const month = parseMonthHeader(h)
    if (month) cols.push({ idx, month })
  })
  return cols
}

function toCount(v) {
  if (v === '' || v == null) return 0
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

/**
 * Unpivot one sheet (array-of-arrays) into series rows.
 * @returns {{ rows: Array, months: string[] }}
 */
function unpivotSheet(aoa, { scopeFor, skipNames }) {
  if (!aoa || aoa.length < 2) return { rows: [], months: [] }
  const header = aoa[0] || []
  const cols = monthColumns(header)
  if (cols.length === 0) return { rows: [], months: [] }

  const skip = new Set((skipNames || []).map(s => s.toLowerCase()))
  const rows = []
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    const rawName = row[0]
    if (rawName == null || String(rawName).trim() === '') continue
    const name = String(rawName).trim()
    const scopeType = scopeFor(name)
    if (!scopeType) continue
    if (skip.has(name.toLowerCase())) continue

    for (const { idx, month } of cols) {
      const permits = toCount(row[idx])
      // Sparse storage: only persist months with actual activity. Missing months
      // are treated as zero by the consumer, so this is lossless for our purposes.
      if (permits <= 0) continue
      rows.push({ scope_type: scopeType, scope_name: name, period_month: month, permits })
    }
  }
  const months = cols.map(c => c.month)
  return { rows, months }
}

function sheetToAoa(workbook, name) {
  const sheet = workbook.Sheets[name]
  if (!sheet) return null
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false })
}

/**
 * Parse the project-level (PROJ) tab into crossed region x builder facts.
 * The tab is hierarchical: market header rows (col A in the known region set,
 * col B empty) introduce a region; submarket headers and *-Total subtotals also
 * have an empty col B and are ignored; project rows carry a builder in col B and
 * monthly counts. We aggregate up to (region, builder, month) — the grain the
 * peer-group filter needs. This covers the production "top builder" set only.
 * @param {Array} aoa array-of-arrays for the PROJ sheet
 * @param {Set<string>} regionSet upper-cased region names (from the MKT tab)
 * @returns {Array<{region, builder, period_month, permits}>}
 */
function parseProjectSheet(aoa, regionSet) {
  if (!aoa || aoa.length < 2) return []
  const cols = monthColumns(aoa[0] || [])
  if (cols.length === 0) return []

  const totals = new Map() // `${region}|${builder}|${month}` -> permits
  let region = null
  for (let r = 1; r < aoa.length; r++) {
    const row = aoa[r] || []
    const nameA = row[0] == null ? '' : String(row[0]).trim()
    const builder = row[1] == null ? '' : String(row[1]).trim()
    if (!nameA && !builder) continue

    if (!builder) {
      // header or subtotal row — only the known regions switch the active region
      if (regionSet.has(nameA.toUpperCase())) region = nameA.toUpperCase()
      continue
    }
    if (!region) continue // project row before any market header — skip defensively

    for (const { idx, month } of cols) {
      const permits = toCount(row[idx])
      if (permits <= 0) continue
      const key = `${region}|${builder}|${month}`
      totals.set(key, (totals.get(key) || 0) + permits)
    }
  }

  const out = []
  for (const [key, permits] of totals) {
    const [region, builder, period_month] = key.split('|')
    out.push({ region, builder, period_month, permits })
  }
  return out
}

export function parsePermitFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'array' })
        const names = workbook.SheetNames

        const mktAoa = sheetToAoa(workbook, 'MKT')
        const bldAoa = sheetToAoa(workbook, 'BLD')
        if (!mktAoa || !bldAoa) {
          reject(new Error(
            `This does not look like the permit workbook. Expected "MKT" and "BLD" tabs but found: ${names.join(', ')}.`
          ))
          return
        }

        // MKT: 'Grand Total' -> total scope; every other row -> region scope.
        const mkt = unpivotSheet(mktAoa, {
          scopeFor: (name) => (name.toLowerCase() === 'grand total' ? 'total' : 'region'),
        })
        // BLD: builder rows; skip the duplicate Grand Total (total comes from MKT).
        const bld = unpivotSheet(bldAoa, {
          scopeFor: (name) => (name.toLowerCase() === 'grand total' ? null : 'builder'),
          skipNames: ['grand total'],
        })

        const series = [...mkt.rows, ...bld.rows]
        if (series.length === 0) {
          reject(new Error('No permit data found in the MKT/BLD tabs. The file may be empty or in an unexpected format.'))
          return
        }

        const monthSet = new Set(series.map(s => s.period_month))
        const months = [...monthSet].sort()
        const reportMonth = months[months.length - 1]
        const firstMonth = months[0]

        // Crossed region x builder slice from the project-level tab (optional).
        const regionSet = new Set(
          series.filter(s => s.scope_type === 'region').map(s => s.scope_name.toUpperCase())
        )
        const projAoa = sheetToAoa(workbook, 'PROJ')
        const rbSeries = projAoa ? parseProjectSheet(projAoa, regionSet) : []

        const counts = {
          total: series.filter(s => s.scope_type === 'total').length,
          region: new Set(series.filter(s => s.scope_type === 'region').map(s => s.scope_name)).size,
          builder: new Set(series.filter(s => s.scope_type === 'builder').map(s => s.scope_name)).size,
          crossedBuilders: new Set(rbSeries.map(r => r.builder)).size,
          crossedRows: rbSeries.length,
        }

        resolve({
          series,
          rbSeries,
          months,
          reportMonth,
          firstMonth,
          counts,
          rowCount: series.length,
          sheetNames: names,
        })
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsArrayBuffer(file)
  })
}
