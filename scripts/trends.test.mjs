import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTrendHistory, trendPoints, fetchAllTrendRows } from '../src/lib/trends.js'
const currentScore = (id, score = 80, category = 'Electrical') => ({ vendor_id: id, weighted_total: score, vendors: { name: `Current ${id}`, vendor_categories: { name: category } } })

test('history sorts every snapshot, preserves missing scores, and averages historical peers', () => {
  const snapshots = ['3', '1', '2'].map(id => ({ id, created_at: `2026-0${id}-01`, name: id }))
  const row = (snapshot_id, vendor_id, weighted_total, category_name = 'Electrical') => ({ snapshot_id, vendor_id, weighted_total, category_name, vendor_name: vendor_id })
  const history = buildTrendHistory(snapshots, [row('1', 'a', '60'), row('1', 'b', '80'), row('1', 'c', null), row('2', 'b', 0), row('3', 'a', 90, 'Plumbing'), row('3', 'b', 80)], [currentScore('a', 90, 'Plumbing'), currentScore('b')])
  const points = trendPoints(history, ['a', 'b'], 'Electrical')
  assert.deepEqual(points.map(p => p.id), ['1', '2', '3'])
  assert.deepEqual(points.map(p => p.scores.a), [60, null, 90])
  assert.deepEqual(points.map(p => p.average), [70, 0, 80])
  assert.deepEqual(points.map(p => p.peerCount), [2, 1, 1])
  assert.equal(history.trades.find(t => t.id === 'a').category, 'Plumbing')
  assert.equal(trendPoints(history, ['a'], 'No peers')[0].average, null)
  assert.deepEqual(trendPoints(history, ['a'], 'Electrical', '2').map(p => p.id), ['2', '3'])
})

test('current Scores roster excludes removed and unscored vendors from selections and averages', () => {
  const snapshots = [{ id: '1', name: 'First', created_at: '2026-01-01' }]
  const rows = ['a', 'removed', 'unscored', null].map(vendor_id => ({ snapshot_id: '1', vendor_id, vendor_name: 'Old duplicate name', category_name: 'Electrical', weighted_total: vendor_id === 'a' ? 60 : 100 }))
  const history = buildTrendHistory(snapshots, rows, [currentScore('a'), currentScore('a'), currentScore('unscored', null), currentScore('zero', 0)])
  assert.deepEqual(history.trades.map(t => t.id), ['a', 'zero'])
  assert.equal(history.trades[0].name, 'Current a')
  const [point] = trendPoints(history, ['a', 'zero'], 'Electrical')
  assert.equal(point.average, 60)
  assert.equal(point.peerCount, 1)
  assert.equal(point.scores.zero, null)
  assert.equal(buildTrendHistory(snapshots, rows, []).trades.length, 0)
})

test('pagination retains all rows even when the server caps the page size', async () => {
  const expected = Array.from({ length: 1203 }, (_, id) => ({ id }))
  const query = () => ({ range: start => ({ abortSignal: async () => ({ data: expected.slice(start, start + 200), error: null }) }) })
  assert.deepEqual(await fetchAllTrendRows(query, new AbortController().signal), expected)
})

test('pagination surfaces errors and stops on cancellation', async () => {
  await assert.rejects(fetchAllTrendRows(() => ({ range: () => ({ abortSignal: async () => ({ error: new Error('Denied') }) }) })), /Denied/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetchAllTrendRows(() => { throw new Error('Should not query') }, controller.signal), { name: 'AbortError' })
})
