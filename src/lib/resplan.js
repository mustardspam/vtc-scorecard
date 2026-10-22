import { fetchWithTimeout } from './fetchWithTimeout'

// Client for ResPlan, the local service on the office PC that drives the ERP
// (Dynamic Builder). "Pull from ERP" on the Uploads page asks it to run the reports
// we used to download by hand; it hands back the records, which the Uploads page
// imports straight away as an approved batch.
// Only works in a browser on the PC running ResPlan (it listens on 127.0.0.1).

const BASE = 'http://127.0.0.1:4870'
const KEY_STORAGE = 'resplan_vtc_key'
const POLL_MS = 3000
const MAX_WAIT_MS = 20 * 60 * 1000
const POLL_FAILURE_LIMIT_MS = 2 * 60 * 1000

/**
 * VTC upload type -> ResPlan pull kind (Houston: Starlight and Ashton Woods). Safety
 * comes from HB NEXT's OFIs rather than the ERP, Ashton Woods only.
 */
export const ERP_PULL_KINDS = {
  schedule: 'schedule',
  safety: 'safety',
  rework: 'rework',
  jc_vendor_report: 'jc_vendors',
}

export function getResplanKey() {
  try { return localStorage.getItem(KEY_STORAGE) || '' } catch { return '' }
}

export function setResplanKey(key) {
  try { localStorage.setItem(KEY_STORAGE, key.trim()) } catch { /* ignore */ }
}

async function call(method, path, body) {
  let res
  try {
    res = await fetchWithTimeout(BASE + path, {
      method,
      headers: { 'x-resplan-token': getResplanKey(), 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, 30000)
  } catch {
    throw new Error('ResPlan is not reachable. Pull from ERP only works on the office PC with ResPlan running (Start-ResPlan.cmd), and the browser must be allowed to reach local network devices.')
  }
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) throw new Error('ResPlan rejected the key. Copy it again from ResPlan › Settings › VTC Scorecard.')
  if (!res.ok) throw new Error(data.error || `ResPlan error ${res.status}`)
  return data
}

/**
 * Runs a pull for one brand ('Starlight' | 'Ashton Woods') and waits for it.
 * Resolves to { records, summary } for schedule / rework, or
 * { communities, vendors, summary } for the JC vendor report.
 * onStep receives ResPlan's progress text ("Starlight: Preferred Vendors HOUSB (3 of 17)").
 */
export async function pullFromErp(fileType, brand, month, onStep = () => {}) {
  const kind = ERP_PULL_KINDS[fileType]
  if (!kind) throw new Error(`No ERP pull for ${fileType}`)
  let job = await call('POST', '/api/vtc/pulls', { kind, brand, month })
  const started = Date.now()
  let failingSince = null
  while (job.status === 'running') {
    onStep(job.step)
    if (Date.now() - started > MAX_WAIT_MS) throw new Error('The ERP pull is taking too long. Check ResPlan and try again.')
    await new Promise(r => setTimeout(r, POLL_MS))
    // ResPlan can be slow to answer while it reads a large report; keep polling
    // through brief failures and only give up after a couple of minutes of them.
    try {
      job = await call('GET', `/api/vtc/pulls/${job.id}`)
      failingSince = null
    } catch (err) {
      failingSince ??= Date.now()
      if (Date.now() - failingSince > POLL_FAILURE_LIMIT_MS) throw err
    }
  }
  if (job.status === 'error') throw new Error(job.error)
  return job.result
}
