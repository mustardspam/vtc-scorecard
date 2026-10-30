import net from 'node:net'
import { permanent, sleep } from './retry.js'

// Node client for ResPlan, the local service that drives the ERP (Dynamic Builder) and
// HB NEXT. Same API the Uploads page uses (src/lib/resplan.js): start a pull, then poll it.

/** VTC upload type -> ResPlan pull kind. */
export const PULL_KINDS = {
  schedule: 'schedule',
  safety: 'safety',
  rework: 'rework',
  jc_vendor_report: 'jc_vendors',
}

const POLL_MS = 3000
const POLL_FAILURE_LIMIT_MS = 2 * 60 * 1000

export function createResplanClient({ baseUrl, token, pullTimeoutMs = 20 * 60 * 1000, fetchImpl = fetch, wait = sleep, pollMs = POLL_MS }) {
  async function call(method, path, body) {
    let res
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers: { 'x-resplan-token': token, 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      })
    } catch (err) {
      throw new Error(`ResPlan is not reachable at ${baseUrl} (${err.cause?.code || err.message}). Is ResPlan running (Start-ResPlan.cmd)?`)
    }
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw permanent('ResPlan rejected the key. Copy it again from ResPlan > Settings > VTC Scorecard and run: npm run credentials')
    if (res.status >= 400 && res.status < 500) throw permanent(data.error || `ResPlan error ${res.status}`)
    if (!res.ok) throw new Error(data.error || `ResPlan error ${res.status}`)
    return data
  }

  return {
    /** True when something is listening on ResPlan's port (fast fail-fast check, no request sent). */
    isListening(timeoutMs = 3000) {
      const { hostname, port } = new URL(baseUrl)
      return new Promise(resolve => {
        const socket = net.connect({ host: hostname, port: Number(port) || 80 })
        const done = ok => { socket.destroy(); resolve(ok) }
        socket.setTimeout(timeoutMs, () => done(false))
        socket.once('connect', () => done(true))
        socket.once('error', () => done(false))
      })
    },

    /**
     * Runs one pull and waits for it. Resolves to ResPlan's result:
     * { records, summary, range, pulledAt } or, for jc_vendors, { communities, vendors, summary, pulledAt }.
     */
    async pull(category, brand, month, onStep = () => {}) {
      const kind = PULL_KINDS[category]
      if (!kind) throw permanent(`No ResPlan pull for ${category}`)
      let job = await call('POST', '/api/vtc/pulls', { kind, brand, month })
      const started = Date.now()
      let failingSince = null
      while (job.status === 'running') {
        onStep(job.step)
        if (Date.now() - started > pullTimeoutMs) throw new Error(`The ResPlan pull took longer than ${Math.round(pullTimeoutMs / 60000)} minutes`)
        await wait(pollMs)
        // ResPlan can be slow to answer while it reads a large report; keep polling
        // through brief failures and only give up after a couple of minutes of them.
        try {
          job = await call('GET', `/api/vtc/pulls/${job.id}`)
          failingSince = null
        } catch (err) {
          if (err.permanent) throw err
          failingSince ??= Date.now()
          if (Date.now() - failingSince > POLL_FAILURE_LIMIT_MS) throw err
        }
      }
      if (job.status === 'error') throw new Error(job.error || 'ResPlan reported an error')
      if (!job.result) throw new Error(`ResPlan returned status "${job.status}" with no result`)
      return job.result
    },
  }
}
