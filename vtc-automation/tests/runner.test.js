import test from 'node:test'
import assert from 'node:assert/strict'
import { runNightly, planUnits, reportFailed, formatReport } from '../core/runner.js'

const config = {
  resplanUrl: 'http://127.0.0.1:4870',
  maxCatchUpDays: 62,
  retry: { attempts: 3, baseDelayMs: 1 },
  validation: { maxInvalidRowRatio: 0, rowCountDropThreshold: 0.5, minRowsForDropCheck: 10 },
}

const quietLog = { info() {}, warn() {}, error() {}, debug() {} }

function memoryState(initial = {}) {
  const data = { categories: structuredClone(initial) }
  let saved = 0
  return {
    data,
    get saved() { return saved },
    lastSuccessDate: (c, b) => data.categories[c]?.[b]?.lastSuccessDate ?? null,
    lastCount: (c, b, p) => data.categories[c]?.[b]?.counts?.[p] ?? null,
    recordImport(c, b, p, n) { ((data.categories[c] ??= {})[b] ??= { counts: {} }).counts[p] = n },
    markSuccess(c, b, d) { ((data.categories[c] ??= {})[b] ??= { counts: {} }).lastSuccessDate = d },
    save() { saved++ },
  }
}

const jc = { communities: [{ code: 'HOUSB', name: 'Sunset' }], vendors: [{ jcVendorId: '1', name: 'ACME', assignments: [{ communityCode: 'HOUSB', costCode: '4100' }] }] }
const records = {
  schedule: { records: [{ vendor_name: 'ACME', total_jobs: 5, no_shows: 0, period_month: '2026-10-01' }] },
  rework: { records: [{ vendor_name: 'ACME', cost: 120, rework_date: '2026-10-05' }] },
  safety: { records: [{ trade_type: 'ACME', category: 'PPE', incident_date: '2026-10-06' }] },
  jc_vendor_report: jc,
}

function fakeDeps({ state = memoryState(), pull, listening = true } = {}) {
  const imported = []
  const archived = []
  let activity = null
  return {
    imported, archived, get activity() { return activity },
    deps: {
      log: quietLog,
      state,
      wait: async () => {},
      resplanListening: async () => listening,
      pull: pull || (async u => structuredClone(records[u.category])),
      connect: async () => ({ ctx: { logActivity: async (...a) => { activity = a } }, close: async () => {} }),
      importUnit: async (_ctx, unit) => { imported.push(unit); return { unmatched: [] } },
      archive: (unit) => { archived.push(unit); return `archive/${unit.category}` },
    },
  }
}

const opts = extra => ({ runId: 't1', asOf: '2026-10-15', config, ...extra })

test('plans JC first, both brands, safety Ashton Woods only', () => {
  const units = planUnits({ asOf: '2026-10-15', state: memoryState(), maxCatchUpDays: 62 })
  assert.deepEqual(units.map(u => `${u.category}/${u.brand}/${u.month}`), [
    'jc_vendor_report/Starlight/null', 'jc_vendor_report/Ashton Woods/null',
    'schedule/Starlight/2026-10', 'schedule/Ashton Woods/2026-10',
    'rework/Starlight/2026-10', 'rework/Ashton Woods/2026-10',
    'safety/Ashton Woods/2026-10',
  ])
})

test('--date and --backfill pull the months asked for and skip JC unless requested', () => {
  const s = memoryState()
  assert.deepEqual(planUnits({ date: '2026-08-12', asOf: '2026-10-15', state: s, categories: ['schedule'], brands: ['Starlight'] })
    .map(u => u.month), ['2026-08'])
  const back = planUnits({ backfill: ['2026-07-01', '2026-09-30'], asOf: '2026-10-15', state: s })
  assert.ok(back.every(u => u.category !== 'jc_vendor_report'))
  assert.equal(back.filter(u => u.category === 'safety').length, 3)
})

test('a failing category does not block the others', async () => {
  const f = fakeDeps({ pull: async u => { if (u.category === 'rework') throw new Error('ERP report crashed'); return structuredClone(records[u.category]) } })
  const report = await runNightly(opts(), f.deps)
  const byStatus = report.units.reduce((m, u) => ({ ...m, [u.status]: (m[u.status] || 0) + 1 }), {})
  assert.deepEqual(byStatus, { imported: 5, failed: 2 })
  assert.equal(f.imported.filter(u => u.category === 'safety').length, 1)
  assert.ok(reportFailed(report))
  assert.match(formatReport(report), /FAIL {2}rework \/ Starlight \/ 2026-10: failed .*ERP report crashed/)
})

test('transient failures are retried up to 3 attempts', async () => {
  let calls = 0
  const f = fakeDeps({ pull: async u => { if (u.category === 'schedule' && u.brand === 'Starlight' && ++calls < 3) throw new Error('socket hang up'); return structuredClone(records[u.category]) } })
  const report = await runNightly(opts({ categories: ['schedule'], brands: ['Starlight'] }), f.deps)
  assert.equal(calls, 3)
  assert.equal(report.units[0].status, 'imported')
})

test('permanent failures are not retried', async () => {
  let calls = 0
  const f = fakeDeps({ pull: async () => { calls++; throw Object.assign(new Error('bad key'), { permanent: true }) } })
  await runNightly(opts({ categories: ['schedule'], brands: ['Starlight'] }), f.deps)
  assert.equal(calls, 1)
})

test('validation failure skips that import and is reported', async () => {
  const f = fakeDeps({ pull: async u => (u.category === 'schedule' ? { records: [{ vendor_name: 'A' }] } : structuredClone(records[u.category])) })
  const report = await runNightly(opts(), f.deps)
  const bad = report.units.filter(u => u.status === 'invalid')
  assert.equal(bad.length, 2)
  assert.ok(!f.imported.some(u => u.category === 'schedule'))
  assert.ok(f.imported.some(u => u.category === 'rework'))
})

test('success advances catch-up state; failure leaves it so the next run catches up', async () => {
  const state = memoryState()
  const f = fakeDeps({ state, pull: async u => { if (u.category === 'safety') throw new Error('timeout'); return structuredClone(records[u.category]) } })
  await runNightly(opts(), f.deps)
  assert.equal(state.lastSuccessDate('schedule', 'Starlight'), '2026-10-15')
  assert.equal(state.lastSuccessDate('safety', 'Ashton Woods'), null)
  assert.equal(state.lastCount('schedule', 'Starlight', '2026-10'), 1)
  assert.equal(state.saved, 1)
})

test('dry run pulls, validates and archives but never connects, imports or saves state', async () => {
  const state = memoryState()
  const f = fakeDeps({ state })
  f.deps.connect = async () => { throw new Error('should not connect') }
  const report = await runNightly(opts({ dryRun: true }), f.deps)
  assert.ok(report.units.every(u => u.status === 'dry-run'))
  assert.equal(f.imported.length, 0)
  assert.equal(f.archived.length, 7)
  assert.equal(state.saved, 0)
})

test('ResPlan down fails fast without pulling', async () => {
  let pulled = false
  const f = fakeDeps({ listening: false, pull: async () => { pulled = true } })
  const report = await runNightly(opts(), f.deps)
  assert.equal(pulled, false)
  assert.match(report.fatal, /ResPlan is not running/)
  assert.ok(report.units.every(u => u.status === 'failed'))
})

test('empty month is left alone (no import), like the web app', async () => {
  const f = fakeDeps({ pull: async u => (u.category === 'rework' ? { records: [] } : structuredClone(records[u.category])) })
  const report = await runNightly(opts({ categories: ['rework'] }), f.deps)
  assert.ok(report.units.every(u => u.status === 'empty'))
  assert.equal(f.imported.length, 0)
  assert.equal(reportFailed(report), false)
})

test('re-running the same date imports the same units again (the import replaces the month)', async () => {
  const state = memoryState()
  const f = fakeDeps({ state })
  await runNightly(opts({ date: '2026-10-15', categories: ['schedule'] }), f.deps)
  await runNightly(opts({ date: '2026-10-15', categories: ['schedule'] }), f.deps)
  assert.equal(f.imported.length, 4)
  assert.deepEqual([...new Set(f.imported.map(u => `${u.brand}/${u.month}`))], ['Starlight/2026-10', 'Ashton Woods/2026-10'])
  // A date run never moves the catch-up marker.
  assert.equal(state.lastSuccessDate('schedule', 'Starlight'), null)
})

test('progress is reported before each unit', async () => {
  const f = fakeDeps()
  const seen = []
  f.deps.onProgress = (u, i, total) => seen.push(`${i + 1}/${total} ${u.category}`)
  await runNightly(opts({ categories: ['safety', 'jc_vendor_report'], trigger: 'Refresh requested from the Uploads page' }), f.deps)
  assert.deepEqual(seen, ['1/3 jc_vendor_report', '2/3 jc_vendor_report', '3/3 safety'])
  assert.match(f.activity[1], /^Refresh requested from the Uploads page: 3 of 3 imported/)
})

test('nightly summary is written to the scorecard activity log', async () => {
  const f = fakeDeps()
  await runNightly(opts(), f.deps)
  assert.equal(f.activity[0], 'nightly_erp_pull')
  assert.match(f.activity[1], /7 of 7 imported/)
})
