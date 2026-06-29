// Permit-volume forecasting helpers. Pure functions over normalized
// permit_series rows ({ scope_type, scope_name, period_month, permits }).
//
// Method: a seasonal-naive forecast with a trailing-12 momentum adjustment.
// With ~24 months of strongly seasonal data this is the right altitude — each
// future month is anchored to the same calendar month a year earlier, then
// scaled by how the trailing-12 total is trending. Transparent, not a black box.

/** 'YYYY-MM-01' + n months -> 'YYYY-MM-01'. */
export function addMonths(monthStr, n) {
  const [y, m] = monthStr.split('-').map(Number)
  const idx = (y * 12 + (m - 1)) + n
  const ny = Math.floor(idx / 12)
  const nm = (idx % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}-01`
}

/** Inclusive list of first-of-month strings from start to end. */
export function monthRange(startMonth, endMonth) {
  const out = []
  let cur = startMonth
  // guard against runaway loops on bad input
  for (let i = 0; i < 600 && cur <= endMonth; i++) {
    out.push(cur)
    cur = addMonths(cur, 1)
  }
  return out
}

export function formatMonthShort(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  const abbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${abbr[m - 1]} ${String(y).slice(2)}`
}

/**
 * Roll a dense monthly actuals array up to the chosen granularity.
 * @param {Array<{month, permits}>} actuals
 * @param {'monthly'|'quarterly'} granularity
 * @returns {Array<{period, label, permits, units, complete}>}
 *   `period` is a sortable key, `units` the # of months contributing, `complete`
 *   true when a quarter has all 3 months (used to keep partial quarters out of
 *   the statistical baseline).
 */
export function aggregatePeriods(actuals, granularity) {
  if (granularity !== 'quarterly') {
    return actuals.map(a => ({
      period: a.month, label: formatMonthShort(a.month), permits: a.permits, units: 1, complete: true,
    }))
  }
  const buckets = new Map()
  for (const a of actuals) {
    const [y, m] = a.month.split('-').map(Number)
    const q = Math.floor((m - 1) / 3) + 1
    const key = `${y}-Q${q}`
    if (!buckets.has(key)) buckets.set(key, { period: key, label: `Q${q} '${String(y).slice(2)}`, permits: 0, units: 0, complete: false })
    const b = buckets.get(key)
    b.permits += a.permits
    b.units += 1
  }
  const out = [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period))
  out.forEach(b => { b.complete = b.units === 3 })
  return out
}

function mean(xs) { return xs.reduce((s, x) => s + x, 0) / xs.length }
function stddev(xs, mu) {
  if (xs.length < 2) return 0
  const v = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1)
  return Math.sqrt(v)
}

/**
 * Flag periods whose permit volume sits beyond ±sigma standard deviations of the
 * baseline mean. This is the "out of the norm" signal: a low outlier means trades
 * are about to be over-committed (claw work/$ back); a high outlier means a surge
 * is coming and crews need more work booked before they walk.
 *
 * The baseline excludes partial (incomplete) periods and, by default, the latest
 * period itself so a fresh outlier is measured against history rather than
 * diluted by its own value.
 *
 * @param {Array<{period,label,permits,complete}>} periods chosen-granularity series
 * @param {{sigma?: number}} opts
 * @returns {null | { mean, std, sigma, band:{lo,hi}, periods:[{...,z,status}], latest }}
 */
export function detectAnomalies(periods, { sigma = 2 } = {}) {
  const usable = periods.filter(p => p.complete)
  if (usable.length < 4) return null

  // baseline = all complete periods except the most recent one
  const baseline = usable.slice(0, -1).map(p => p.permits)
  const mu = mean(baseline)
  const sd = stddev(baseline, mu)
  if (sd === 0) return null

  const band = { lo: mu - sigma * sd, hi: mu + sigma * sd }
  const annotated = periods.map(p => {
    const z = (p.permits - mu) / sd
    let status = 'normal'
    if (p.complete) {
      if (z >= sigma) status = 'high'
      else if (z <= -sigma) status = 'low'
    }
    return { ...p, z, status }
  })

  // latest = most recent complete period (the one to act on)
  const latest = [...annotated].reverse().find(p => p.complete) || null

  return { mean: mu, std: sd, sigma, band, periods: annotated, latest }
}

/**
 * Build a dense actuals array (missing months filled with 0) for one entity.
 * @param {Array} rows series rows already filtered to a single scope_name
 * @param {string} firstMonth, lastMonth bounds (first-of-month strings)
 * @returns {Array<{month: string, permits: number}>}
 */
export function denseActuals(rows, firstMonth, lastMonth) {
  const byMonth = new Map(rows.map(r => [r.period_month, r.permits]))
  return monthRange(firstMonth, lastMonth).map(month => ({
    month,
    permits: byMonth.get(month) || 0,
  }))
}

function sumLast(arr, n) {
  return arr.slice(-n).reduce((s, x) => s + x.permits, 0)
}

/**
 * Core metrics + 12-month forecast for one dense actuals series.
 * @returns {{
 *   trailing12: number, priorTrailing12: number|null, yoyPct: number|null,
 *   momentum: number, last3: number, forecast: Array<{month, permits, forecast: true}>
 * }}
 */
export function computeForecast(actuals, horizon = 12) {
  const n = actuals.length
  const trailing12 = sumLast(actuals, 12)
  const priorTrailing12 = n >= 24 ? actuals.slice(-24, -12).reduce((s, x) => s + x.permits, 0) : null

  const yoyPct = priorTrailing12 && priorTrailing12 > 0
    ? (trailing12 / priorTrailing12) - 1
    : null

  // Momentum factor scales the seasonal baseline. Clamped so a thin prior year
  // can't produce an absurd projection.
  let momentum = 1
  if (priorTrailing12 && priorTrailing12 > 0) {
    momentum = Math.min(2, Math.max(0.5, trailing12 / priorTrailing12))
  }

  const byMonth = new Map(actuals.map(a => [a.month, a.permits]))
  const lastMonth = actuals[n - 1]?.month
  const avgMonth = trailing12 / 12

  const forecast = []
  for (let i = 1; i <= horizon; i++) {
    const fMonth = addMonths(lastMonth, i)
    // Anchor to the same calendar month one year earlier; fall back to the
    // trailing average when that month isn't in the window.
    const anchorMonth = addMonths(fMonth, -12)
    const base = byMonth.has(anchorMonth) ? byMonth.get(anchorMonth) : avgMonth
    forecast.push({ month: fMonth, permits: Math.round(base * momentum), forecast: true })
  }

  return {
    trailing12,
    priorTrailing12,
    yoyPct,
    momentum,
    last3: sumLast(actuals, 3),
    forecast,
  }
}

/**
 * Aggregate a list of series rows into per-entity summaries for a given scope.
 * Used for the region table and builder leaderboard.
 * @returns {Array<{ name, trailing12, priorTrailing12, yoyPct, forecast12 }>}
 */
export function summarizeScope(rows, scopeType, firstMonth, lastMonth) {
  const names = [...new Set(rows.filter(r => r.scope_type === scopeType).map(r => r.scope_name))]
  return names.map(name => {
    const entityRows = rows.filter(r => r.scope_type === scopeType && r.scope_name === name)
    const actuals = denseActuals(entityRows, firstMonth, lastMonth)
    const f = computeForecast(actuals)
    return {
      name,
      trailing12: f.trailing12,
      priorTrailing12: f.priorTrailing12,
      yoyPct: f.yoyPct,
      forecast12: f.forecast.reduce((s, x) => s + x.permits, 0),
    }
  }).sort((a, b) => b.trailing12 - a.trailing12)
}
