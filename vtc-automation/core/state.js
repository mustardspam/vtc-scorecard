import fs from 'node:fs'
import { paths } from './paths.js'
import { readJson, writeJsonAtomic } from './fsutil.js'

// Local run state: per category and brand, the last date a scheduled run fully
// succeeded (drives catch-up) and the row count of the last import of each period
// (drives the row-count sanity check). Period is "YYYY-MM", or "all" for the JC report.

export function loadState(file = paths.state) {
  const data = readJson(file, { categories: {} })
  const unit = (category, brand) => {
    data.categories[category] ??= {}
    return (data.categories[category][brand] ??= { lastSuccessDate: null, counts: {} })
  }
  return {
    data,
    lastSuccessDate: (category, brand) => data.categories[category]?.[brand]?.lastSuccessDate ?? null,
    lastCount: (category, brand, period) => data.categories[category]?.[brand]?.counts?.[period] ?? null,
    recordImport(category, brand, period, count) {
      const u = unit(category, brand)
      u.counts[period] = count
      u.lastImportAt = new Date().toISOString()
      // Keep the last 24 periods.
      const periods = Object.keys(u.counts).sort()
      for (const p of periods.slice(0, Math.max(0, periods.length - 24))) delete u.counts[p]
    },
    markSuccess(category, brand, date) {
      const u = unit(category, brand)
      if (!u.lastSuccessDate || date > u.lastSuccessDate) u.lastSuccessDate = date
    },
    save() { writeJsonAtomic(file, data) },
  }
}

/**
 * Single-run lock: the midnight and logon triggers can overlap. A lock older than
 * staleHours, or held by a process that no longer exists, is taken over.
 */
export function acquireLock(file = paths.lock, staleHours = 6) {
  fs.mkdirSync(paths.stateDir, { recursive: true })
  const existing = readJson(file, null)
  if (existing) {
    const age = Date.now() - new Date(existing.at).getTime()
    let alive = false
    try { process.kill(existing.pid, 0); alive = true } catch { /* not running */ }
    if (alive && age < staleHours * 3600 * 1000) return null
    fs.rmSync(file, { force: true })
  }
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: 'wx' })
  } catch {
    return null
  }
  return { release: () => fs.rmSync(file, { force: true }) }
}
