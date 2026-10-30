import fs from 'node:fs'
import { paths } from './paths.js'

const defaultsUrl = new URL('../config/default.json', import.meta.url)

function merge(base, extra) {
  const out = { ...base }
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? merge(base[k], v)
      : v
  }
  return out
}

/** config/default.json, overridden by %LOCALAPPDATA%\vtc-automation\config.json when present. No secrets here. */
export function loadConfig() {
  const defaults = JSON.parse(fs.readFileSync(defaultsUrl, 'utf8'))
  if (!fs.existsSync(paths.configOverride)) return defaults
  return merge(defaults, JSON.parse(fs.readFileSync(paths.configOverride, 'utf8')))
}
