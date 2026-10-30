import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths.js'
import { purgeDated, readJson, writeJsonAtomic } from './fsutil.js'
import { toISODate } from './months.js'

// archive\YYYY-MM-DD\<runId>_<category>_<brand>_<period>.raw.json / .transformed.json

const slug = s => String(s).replace(/[^A-Za-z0-9-]+/g, '-')

export function archiveName({ runId, category, brand, month }) {
  return `${runId}_${category}_${slug(brand)}_${month || 'all'}`
}

/** Writes the raw pull and the transformed data for one unit; returns the raw file path. */
export function archivePull(unit, raw, transformed, { dir = paths.archive, now = new Date() } = {}) {
  const base = path.join(dir, toISODate(now), archiveName(unit))
  writeJsonAtomic(`${base}.raw.json`, raw)
  if (transformed) writeJsonAtomic(`${base}.transformed.json`, transformed)
  return `${base}.raw.json`
}

/**
 * The newest archived raw pull of a category / brand / period no older than maxAgeHours,
 * or null. Lets the MCP servers answer from last night's pull instead of a fresh one.
 */
export function findRecentPull({ category, brand, month }, maxAgeHours, { dir = paths.archive } = {}) {
  if (!fs.existsSync(dir)) return null
  const suffix = `_${category}_${slug(brand)}_${month || 'all'}.raw.json`
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000
  const days = fs.readdirSync(dir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse().slice(0, 3)
  let best = null
  for (const day of days) {
    for (const name of fs.readdirSync(path.join(dir, day))) {
      if (!name.endsWith(suffix)) continue
      const file = path.join(dir, day, name)
      const mtime = fs.statSync(file).mtimeMs
      if (mtime >= cutoff && (!best || mtime > best.mtime)) best = { file, mtime }
    }
  }
  return best ? { result: readJson(best.file, null), file: best.file, at: new Date(best.mtime).toISOString() } : null
}

export function purgeOld(retentionDays) {
  return { archive: purgeDated(paths.archive, retentionDays), logs: purgeDated(paths.logs, retentionDays) }
}
