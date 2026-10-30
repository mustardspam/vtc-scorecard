// Shared plumbing for the read-only MCP servers. They only pull reports through ResPlan;
// they never write to the ERP, HB NEXT or the scorecard.
import { loadConfig } from '../core/config.js'
import { requireCredentials } from '../core/credentials.js'
import { createResplanClient } from '../core/resplan_client.js'
import { archivePull, findRecentPull } from '../core/archive.js'
import { createLogger } from '../core/log.js'
import { monthsBetween, parseISODate } from '../core/months.js'

export const config = loadConfig()
// stdout carries the MCP protocol: log to the file only.
export const log = createLogger({ runId: `mcp-${process.pid}`, quiet: true })

let resplan = null
async function client() {
  if (resplan) return resplan
  const creds = await requireCredentials(['resplan-token'])
  resplan = createResplanClient({ baseUrl: config.resplanUrl, token: creds['resplan-token'], pullTimeoutMs: config.pullTimeoutMinutes * 60000 })
  return resplan
}

/**
 * A pull's result: last night's (or a recent) archived pull when one is fresh enough,
 * otherwise a live pull through ResPlan (archived for next time). Live pulls can take minutes.
 */
export async function getPull({ category, brand, month = null, refresh = false }) {
  if (!refresh) {
    const cached = findRecentPull({ category, brand, month }, config.mcp.cacheHours)
    if (cached?.result) return { result: cached.result, source: 'archive', fetchedAt: cached.at }
  }
  const r = await client()
  if (!(await r.isListening())) throw new Error(`ResPlan is not running on this PC (${config.resplanUrl}). Start it with Start-ResPlan.cmd.`)
  log.info('mcp_pull', { category, brand, month })
  const result = await r.pull(category, brand, month)
  archivePull({ runId: `mcp${Date.now()}`, category, brand, month }, result, null)
  return { result, source: 'live', fetchedAt: new Date().toISOString() }
}

/** Validated start / end dates and the months they cover. */
export function dateRange(start_date, end_date) {
  if (!parseISODate(start_date) || !parseISODate(end_date)) throw new Error('start_date and end_date must be YYYY-MM-DD')
  if (start_date > end_date) throw new Error('start_date must be on or before end_date')
  const months = monthsBetween(start_date, end_date)
  if (months.length > 12) throw new Error('Ask for at most 12 months at a time (each month is a separate ERP report)')
  return months
}

export const contains = (value, needle) => !needle || String(value ?? '').toLowerCase().includes(String(needle).toLowerCase())

export const inRange = (date, start, end) => typeof date === 'string' && date.slice(0, 10) >= start && date.slice(0, 10) <= end

/** Tool result as JSON text, capped at maxRows rows. */
export function jsonResult(payload, rows) {
  const max = config.mcp.maxRows
  const body = rows ? { ...payload, totalRows: rows.length, truncated: rows.length > max, rows: rows.slice(0, max) } : payload
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] }
}

export function errorResult(err) {
  log.error('mcp_tool_failed', { error: err.message })
  return { isError: true, content: [{ type: 'text', text: err.message }] }
}

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
