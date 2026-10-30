#!/usr/bin/env node
// Read-only MCP server for ERP (Dynamic Builder) reports via ResPlan. Local stdio only.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ERP_BRANDS } from '../../src/lib/importers/erp-import.js'
import { getPull, dateRange, contains, inRange, jsonResult, errorResult, READ_ONLY } from './common.js'

const server = new McpServer({ name: 'vtc-erp', version: '1.0.0' })

const brand = z.enum(ERP_BRANDS).optional().describe('ERP brand; both when omitted')
const refresh = z.boolean().optional().describe('Pull live from the ERP instead of using a pull from the last 24 hours (slow: minutes per report)')
const dates = {
  start_date: z.string().describe('YYYY-MM-DD'),
  end_date: z.string().describe('YYYY-MM-DD'),
}

/** Pulls each brand x month and collects the records that pass `keep`. */
async function monthlyRecords(category, args, keep) {
  const months = dateRange(args.start_date, args.end_date)
  const pulls = []
  const rows = []
  for (const b of args.brand ? [args.brand] : ERP_BRANDS) {
    for (const month of months) {
      const { result, source, fetchedAt } = await getPull({ category, brand: b, month, refresh: args.refresh })
      pulls.push({ brand: b, month, source, fetchedAt, range: result.range ?? null, summary: result.summary ?? null })
      for (const r of result.records || []) if (keep(r)) rows.push({ brand: b, ...r })
    }
  }
  return { pulls, rows }
}

server.registerTool('get_schedule_data', {
  title: 'Schedule adherence',
  description: 'Schedule adherence per vendor and month (total jobs, no-shows) from the ERP. Monthly report: every month the dates touch is included in full.',
  inputSchema: { ...dates, brand, vendor: z.string().optional().describe('Vendor name or ERP vendor ID contains'), refresh },
  annotations: READ_ONLY,
}, async args => {
  try {
    const { pulls, rows } = await monthlyRecords('schedule', args, r => contains(r.vendor_name, args.vendor) || contains(r.erp_vendor_id, args.vendor))
    return jsonResult({ pulls }, rows)
  } catch (err) { return errorResult(err) }
})

server.registerTool('get_rework_backcharges', {
  title: 'Rework / backcharges',
  description: 'Backcharge records (vendor, cost, date, description, community) from the ERP between two dates.',
  inputSchema: { ...dates, brand, vendor: z.string().optional().describe('Vendor name or ERP vendor ID contains'), community: z.string().optional().describe('Community contains'), refresh },
  annotations: READ_ONLY,
}, async args => {
  try {
    const { pulls, rows } = await monthlyRecords('rework', args, r =>
      (!r.rework_date || inRange(r.rework_date, args.start_date, args.end_date))
      && (contains(r.vendor_name, args.vendor) || contains(r.erp_vendor_id, args.vendor))
      && contains(r.community, args.community))
    const total = rows.reduce((n, r) => n + Math.abs(Number(String(r.cost).replace(/[$,()]/g, '')) || 0), 0)
    return jsonResult({ pulls, totalCost: Math.round(total * 100) / 100 }, rows)
  } catch (err) { return errorResult(err) }
})

server.registerTool('get_jc_vendor_report', {
  title: 'JC preferred vendors',
  description: 'The JC Preferred Vendors report: which vendor (with ERP JC ID) is assigned to each community and cost code. A current snapshot, so it takes no dates.',
  inputSchema: { brand, vendor: z.string().optional().describe('Vendor name or JC ID contains'), community: z.string().optional().describe('Community code contains'), refresh },
  annotations: READ_ONLY,
}, async args => {
  try {
    const pulls = []
    const rows = []
    for (const b of args.brand ? [args.brand] : ERP_BRANDS) {
      const { result, source, fetchedAt } = await getPull({ category: 'jc_vendor_report', brand: b, refresh: args.refresh })
      pulls.push({ brand: b, source, fetchedAt, communities: result.communities?.length ?? 0 })
      for (const v of result.vendors || []) {
        if (!contains(v.name, args.vendor) && !contains(v.jcVendorId, args.vendor)) continue
        const assignments = (v.assignments || []).filter(a => contains(a.communityCode, args.community))
        if (assignments.length) rows.push({ brand: b, jcVendorId: v.jcVendorId, name: v.name, assignments })
      }
    }
    return jsonResult({ pulls }, rows)
  } catch (err) { return errorResult(err) }
})

server.registerTool('list_vendors', {
  title: 'List ERP vendors',
  description: 'Vendors in the ERP JC Preferred Vendors report, with JC ID and how many communities / cost codes each covers.',
  inputSchema: { brand, search: z.string().optional().describe('Name or JC ID contains'), refresh },
  annotations: READ_ONLY,
}, async args => {
  try {
    const rows = []
    for (const b of args.brand ? [args.brand] : ERP_BRANDS) {
      const { result } = await getPull({ category: 'jc_vendor_report', brand: b, refresh: args.refresh })
      for (const v of result.vendors || []) {
        if (!contains(v.name, args.search) && !contains(v.jcVendorId, args.search)) continue
        const a = v.assignments || []
        rows.push({ brand: b, jcVendorId: v.jcVendorId, name: v.name, communities: new Set(a.map(x => x.communityCode)).size, costCodes: new Set(a.map(x => x.costCode)).size })
      }
    }
    rows.sort((x, y) => x.name.localeCompare(y.name))
    return jsonResult({}, rows)
  } catch (err) { return errorResult(err) }
})

await server.connect(new StdioServerTransport())
