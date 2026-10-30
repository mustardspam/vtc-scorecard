import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Point the job's home at a temp folder before loading anything that reads paths.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vtc-automation-test-'))
process.env.VTC_AUTOMATION_HOME = home
const { paths } = await import('../core/paths.js')
const { writeJsonAtomic, purgeDated } = await import('../core/fsutil.js')
const { archivePull, findRecentPull } = await import('../core/archive.js')
const { loadState, acquireLock } = await import('../core/state.js')
const { createLogger } = await import('../core/log.js')

test.after(() => fs.rmSync(home, { recursive: true, force: true }))

test('atomic write leaves no temp files behind', () => {
  const file = path.join(home, 'x', 'a.json')
  writeJsonAtomic(file, { a: 1 })
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['a.json'])
})

test('archive writes raw + transformed by date, and the MCP cache finds it', () => {
  const unit = { runId: 'r1', category: 'schedule', brand: 'Ashton Woods', month: '2026-10' }
  const raw = archivePull(unit, { records: [1] }, { count: 1 })
  assert.ok(raw.endsWith(path.join('r1_schedule_Ashton-Woods_2026-10.raw.json')))
  assert.ok(fs.existsSync(raw.replace('.raw.json', '.transformed.json')))
  assert.deepEqual(findRecentPull(unit, 24).result, { records: [1] })
  assert.equal(findRecentPull({ ...unit, month: '2026-09' }, 24), null)
})

test('retention removes dated folders and logs older than the limit only', () => {
  const dir = path.join(home, 'purge')
  for (const name of ['2026-01-01', '2026-10-20', 'keep-me']) fs.mkdirSync(path.join(dir, name), { recursive: true })
  fs.writeFileSync(path.join(dir, '2026-01-02.log'), '')
  const removed = purgeDated(dir, 90, new Date(2026, 9, 30))
  assert.deepEqual(removed.sort(), ['2026-01-01', '2026-01-02.log'])
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-10-20', 'keep-me'])
})

test('state round-trips and never moves lastSuccessDate backwards', () => {
  const s = loadState()
  s.markSuccess('schedule', 'Starlight', '2026-10-15')
  s.markSuccess('schedule', 'Starlight', '2026-10-01')
  s.recordImport('schedule', 'Starlight', '2026-10', 42)
  s.save()
  const again = loadState()
  assert.equal(again.lastSuccessDate('schedule', 'Starlight'), '2026-10-15')
  assert.equal(again.lastCount('schedule', 'Starlight', '2026-10'), 42)
})

test('only one run holds the lock', () => {
  const lock = acquireLock()
  assert.ok(lock)
  assert.equal(acquireLock(), null)
  lock.release()
  const again = acquireLock()
  assert.ok(again)
  again.release()
})

test('logger redacts secrets', () => {
  const log = createLogger({ runId: 't', quiet: true })
  log.info('creds', { password: 'hunter2', nested: { 'resplan-token': 'abc' }, rows: 3 })
  const text = fs.readFileSync(path.join(paths.logs, fs.readdirSync(paths.logs)[0]), 'utf8')
  assert.ok(!text.includes('hunter2') && !text.includes('abc'))
  assert.match(text, /"rows":3/)
})
