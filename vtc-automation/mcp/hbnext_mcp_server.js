#!/usr/bin/env node
// Read-only MCP server for HB NEXT safety OFIs via ResPlan (Ashton Woods). Local stdio only.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ofiSeverity } from '../../src/lib/importers/erp-import.js'
import { resolveOfiVendor } from '../../src/lib/parsers/vendor-matcher.js'
import { getPull, dateRange, contains, inRange, jsonResult, errorResult, READ_ONLY } from './common.js'

const server = new McpServer({ name: 'vtc-hbnext', version: '1.0.0' })

const BRAND = 'Ashton Woods'
const dates = {
  start_date: z.string().describe('YYYY-MM-DD'),
  end_date: z.string().describe('YYYY-MM-DD'),
}
const refresh = z.boolean().optional().describe('Pull live from HB NEXT instead of using a pull from the last 24 hours (slow)')

/** The company an OFI is against, as the scorecard import names it (trade-only names fall back to the trade). */
const companyOf = ofi => ofi.vendor_name || resolveOfiVendor(ofi, []).name

async function ofis(args) {
  const months = dateRange(args.start_date, args.end_date)
  const pulls = []
  const rows = []
  for (const month of months) {
    const { result, source, fetchedAt } = await getPull({ category: 'safety', brand: BRAND, month, refresh: args.refresh })
    pulls.push({ month, source, fetchedAt, summary: result.summary ?? null })
    for (const r of result.records || []) {
      if (!inRange(r.incident_date, args.start_date, args.end_date)) continue
      rows.push({ ...r, company: companyOf(r), severity: ofiSeverity(r.category) })
    }
  }
  return { pulls, rows }
}

server.registerTool('get_safety_inspections', {
  title: 'Safety OFIs',
  description: 'HB NEXT safety OFIs (opportunities for improvement) between two dates, with the company named, violation category and the severity the scorecard gives it. Ashton Woods only.',
  inputSchema: { ...dates, community: z.string().optional().describe('Community contains'), vendor: z.string().optional().describe('Company or trade contains'), refresh },
  annotations: READ_ONLY,
}, async args => {
  try {
    const { pulls, rows } = await ofis(args)
    const kept = rows.filter(r => contains(r.community, args.community)
      && (contains(r.company, args.vendor) || contains(r.trade_type, args.vendor) || contains(r.subcontractor, args.vendor)))
    return jsonResult({ pulls }, kept)
  } catch (err) { return errorResult(err) }
})

server.registerTool('get_safety_summary_by_vendor', {
  title: 'Safety OFIs by vendor',
  description: 'OFI counts per company between two dates, split by scorecard severity (near_miss, equipment, ppe) and violation category.',
  inputSchema: { ...dates, refresh },
  annotations: READ_ONLY,
}, async args => {
  try {
    const { pulls, rows } = await ofis(args)
    const byCompany = new Map()
    for (const r of rows) {
      const s = byCompany.get(r.company) || { company: r.company, ofis: 0, bySeverity: {}, byCategory: {} }
      s.ofis++
      s.bySeverity[r.severity] = (s.bySeverity[r.severity] || 0) + 1
      const cat = r.category || 'Uncategorized'
      s.byCategory[cat] = (s.byCategory[cat] || 0) + 1
      byCompany.set(r.company, s)
    }
    const summary = [...byCompany.values()].sort((a, b) => b.ofis - a.ofis)
    return jsonResult({ pulls, totalOfis: rows.length }, summary)
  } catch (err) { return errorResult(err) }
})

await server.connect(new StdioServerTransport())
