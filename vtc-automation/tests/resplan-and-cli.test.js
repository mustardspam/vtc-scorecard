import test from 'node:test'
import assert from 'node:assert/strict'
import { createResplanClient } from '../core/resplan_client.js'
import { parseArgs } from '../jobs/nightly_import.js'

const json = (status, body) => ({ status, ok: status < 400, json: async () => body })

test('ResPlan pull starts a job and polls it to the result', async () => {
  const calls = []
  const responses = [
    json(200, { id: 'j1', status: 'running', step: 'Starlight: Schedule (1 of 2)' }),
    json(200, { id: 'j1', status: 'running', step: 'Starlight: Schedule (2 of 2)' }),
    json(200, { id: 'j1', status: 'done', result: { records: [{ vendor_name: 'A' }] } }),
  ]
  const fetchImpl = async (url, init) => { calls.push([init.method, url, init.body, init.headers['x-resplan-token']]); return responses.shift() }
  const steps = []
  const client = createResplanClient({ baseUrl: 'http://127.0.0.1:4870', token: 'k', fetchImpl, wait: async () => {}, pollMs: 0 })
  const result = await client.pull('schedule', 'Starlight', '2026-10', s => steps.push(s))
  assert.deepEqual(result, { records: [{ vendor_name: 'A' }] })
  assert.deepEqual(calls[0], ['POST', 'http://127.0.0.1:4870/api/vtc/pulls', JSON.stringify({ kind: 'schedule', brand: 'Starlight', month: '2026-10' }), 'k'])
  assert.equal(calls[1][1], 'http://127.0.0.1:4870/api/vtc/pulls/j1')
  assert.equal(steps.length, 2)
})

test('JC report maps to ResPlan kind jc_vendors', async () => {
  let body
  const fetchImpl = async (_url, init) => { body = JSON.parse(init.body); return json(200, { status: 'done', result: {} }) }
  await createResplanClient({ baseUrl: 'http://x', token: 'k', fetchImpl }).pull('jc_vendor_report', 'Ashton Woods', null)
  assert.deepEqual(body, { kind: 'jc_vendors', brand: 'Ashton Woods', month: null })
})

test('a rejected key is a permanent error; a job error is not', async () => {
  const c401 = createResplanClient({ baseUrl: 'http://x', token: 'bad', fetchImpl: async () => json(401, {}) })
  await assert.rejects(c401.pull('schedule', 'Starlight', '2026-10'), err => err.permanent === true)
  const cErr = createResplanClient({ baseUrl: 'http://x', token: 'k', fetchImpl: async () => json(200, { status: 'error', error: 'ERP report timed out' }) })
  await assert.rejects(cErr.pull('schedule', 'Starlight', '2026-10'), err => !err.permanent && /timed out/.test(err.message))
})

test('isListening is false when nothing listens', async () => {
  const c = createResplanClient({ baseUrl: 'http://127.0.0.1:1', token: 'k' })
  assert.equal(await c.isListening(1000), false)
})

test('CLI flags', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--category', 'jc,backcharges', '--brand', 'starlight', '--date', '2026-10-01']), {
    dryRun: true, categories: ['jc_vendor_report', 'rework'], brands: ['Starlight'], date: '2026-10-01', backfill: null,
  })
  assert.deepEqual(parseArgs(['--backfill', '2026-08-01', '2026-09-30']).backfill, ['2026-08-01', '2026-09-30'])
  assert.throws(() => parseArgs(['--date', '10/01/2026']), /YYYY-MM-DD/)
  assert.throws(() => parseArgs(['--backfill', '2026-09-30', '2026-08-01']), /on or before/)
  assert.throws(() => parseArgs(['--category', 'payroll']), /Unknown category/)
  assert.throws(() => parseArgs(['--date', '2026-10-01', '--backfill', '2026-08-01', '2026-09-30']), /not both/)
})
