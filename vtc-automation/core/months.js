// Dates are local calendar dates ("YYYY-MM-DD"); the PC runs on Central time.

const pad = n => String(n).padStart(2, '0')

export const toISODate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export function parseISODate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return toISODate(d) === iso ? d : null
}

export function addDays(iso, n) {
  const d = parseISODate(iso)
  return toISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
}

/** "2026-10-17" -> "2026-10" */
export const monthOf = iso => iso.slice(0, 7)

/** Every "YYYY-MM" from start's month to end's month, inclusive. */
export function monthsBetween(startIso, endIso) {
  const months = []
  let [y, m] = startIso.split('-').map(Number)
  const [ey, em] = endIso.split('-').map(Number)
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${pad(m)}`)
    if (++m > 12) { m = 1; y++ }
  }
  return months
}

/**
 * Months to pull for a scheduled run on asOf. ResPlan pulls a month to date and an
 * import replaces that month, so catching up missed days means pulling each month
 * they fall in once. On the 1st-3rd the previous month is pulled once more so its
 * last days are in (as the web app's nightly pull always did).
 */
export function monthsToPull({ asOf, lastSuccessDate = null, maxCatchUpDays = 62 }) {
  const earliest = addDays(asOf, -maxCatchUpDays)
  let from = lastSuccessDate ? addDays(lastSuccessDate, 1) : asOf
  if (from < earliest) from = earliest
  if (from > asOf) from = asOf
  const months = new Set(monthsBetween(from, asOf))
  if (Number(asOf.slice(8, 10)) <= 3) months.add(monthOf(addDays(`${monthOf(asOf)}-01`, -1)))
  return [...months].sort()
}
