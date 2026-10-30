import fs from 'node:fs'
import path from 'node:path'
import { paths } from './paths.js'
import { toISODate } from './months.js'

const SECRET_KEY = /password|token|secret|apikey|api_key|anon/i

function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v)]))
}

/**
 * JSON-lines logger: logs\YYYY-MM-DD.log under %LOCALAPPDATA%\vtc-automation, plus a
 * readable line on stderr (stdout belongs to MCP servers when they use this).
 */
export function createLogger({ runId, dir = paths.logs, quiet = false } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const write = (level, event, data = {}) => {
    const at = new Date()
    const entry = { at: at.toISOString(), level, runId, event, ...redact(data) }
    fs.appendFileSync(path.join(dir, `${toISODate(at)}.log`), JSON.stringify(entry) + '\n')
    if (!quiet) {
      const detail = Object.keys(data).length ? ' ' + JSON.stringify(redact(data)) : ''
      process.stderr.write(`${entry.at} ${level.toUpperCase().padEnd(5)} ${event}${detail}\n`)
    }
  }
  return {
    info: (event, data) => write('info', event, data),
    warn: (event, data) => write('warn', event, data),
    error: (event, data) => write('error', event, data),
    debug: (event, data) => write('debug', event, data),
  }
}
