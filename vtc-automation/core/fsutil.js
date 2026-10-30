import fs from 'node:fs'
import path from 'node:path'

/** Writes to a temp name, then renames, so nothing ever reads a half-written file. */
export function writeFileAtomic(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, contents)
  fs.renameSync(tmp, file)
}

export function writeJsonAtomic(file, value) {
  writeFileAtomic(file, JSON.stringify(value, null, 2))
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

/**
 * Removes entries of dir named YYYY-MM-DD (folders) or YYYY-MM-DD.log (files) older than
 * retentionDays. Returns the names removed.
 */
export function purgeDated(dir, retentionDays, now = new Date()) {
  if (!fs.existsSync(dir)) return []
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - retentionDays)
  const removed = []
  for (const name of fs.readdirSync(dir)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(\.log)?$/.exec(name)
    if (!m) continue
    if (new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) >= cutoff) continue
    fs.rmSync(path.join(dir, name), { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}
