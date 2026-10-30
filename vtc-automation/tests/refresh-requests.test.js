import test from 'node:test'
import assert from 'node:assert/strict'
import { claimRequest, requestOutcome } from '../core/refresh_requests.js'
import { OK } from '../core/runner.js'
import { parseArgs } from '../jobs/nightly_import.js'

/** Minimal stand-in for supabase-js's query builder over one in-memory table. */
function fakeSupabase(rows) {
  const from = () => {
    const filters = []
    let patch = null
    const q = {
      select: () => q, order: () => q, limit: () => q,
      update: p => { patch = p; return q },
      eq: (k, v) => { filters.push(r => r[k] === v); return q },
      lt: (k, v) => { filters.push(r => r[k] < v); return q },
      run() {
        const hits = rows.filter(r => filters.every(f => f(r)))
        if (patch) for (const r of hits) Object.assign(r, patch)
        return hits
      },
      maybeSingle: async () => ({ data: q.run()[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve({ data: q.run(), error: null }).then(res, rej),
    }
    return q
  }
  return { from }
}

test('claims the pending request and marks it running', async () => {
  const rows = [{ id: 'a', status: 'pending', requested_at: '2026-10-30T15:00:00Z', categories: null }]
  const claimed = await claimRequest(fakeSupabase(rows))
  assert.equal(claimed.id, 'a')
  assert.equal(rows[0].status, 'running')
  assert.ok(rows[0].started_at)
})

test('nothing pending: no claim', async () => {
  assert.equal(await claimRequest(fakeSupabase([{ id: 'a', status: 'done' }])), null)
})

test('a request stuck running for hours is failed so new ones can queue', async () => {
  const rows = [{ id: 'old', status: 'running', started_at: '2000-01-01T00:00:00Z' }]
  await claimRequest(fakeSupabase(rows))
  assert.equal(rows[0].status, 'failed')
})

test('outcome: done, partial and failed', () => {
  const unit = (status, extra = {}) => ({ category: 'schedule', brand: 'Starlight', month: '2026-10', status, ...extra })
  assert.equal(requestOutcome({ units: [unit('imported', { count: 3 }), unit('empty')] }, OK).status, 'done')
  const partial = requestOutcome({ units: [unit('imported'), unit('failed', { error: 'boom' })] }, OK)
  assert.equal(partial.status, 'partial')
  assert.equal(partial.result[1].error, 'boom')
  assert.equal(requestOutcome({ units: [], fatal: 'ResPlan is not running' }, OK).status, 'failed')
})

test('--requests takes no other options', () => {
  assert.equal(parseArgs(['--requests']).requests, true)
  assert.throws(() => parseArgs(['--requests', '--dry-run']), /no other options/)
})
