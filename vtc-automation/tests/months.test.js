import test from 'node:test'
import assert from 'node:assert/strict'
import { monthsBetween, monthsToPull, addDays, parseISODate } from '../core/months.js'

test('monthsBetween spans years', () => {
  assert.deepEqual(monthsBetween('2025-11-15', '2026-02-01'), ['2025-11', '2025-12', '2026-01', '2026-02'])
})

test('parseISODate rejects impossible dates', () => {
  assert.equal(parseISODate('2026-02-30'), null)
  assert.ok(parseISODate('2026-02-28'))
})

test('addDays crosses month ends', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})

test('first run pulls the current month only mid-month', () => {
  assert.deepEqual(monthsToPull({ asOf: '2026-10-15' }), ['2026-10'])
})

test('1st-3rd also re-pulls the previous month', () => {
  assert.deepEqual(monthsToPull({ asOf: '2026-11-01', lastSuccessDate: '2026-10-31' }), ['2026-10', '2026-11'])
  assert.deepEqual(monthsToPull({ asOf: '2026-01-03', lastSuccessDate: '2026-01-02' }), ['2025-12', '2026-01'])
})

test('missed days catch up every month they fall in', () => {
  assert.deepEqual(monthsToPull({ asOf: '2026-12-10', lastSuccessDate: '2026-10-20' }), ['2026-10', '2026-11', '2026-12'])
})

test('catch-up is capped at maxCatchUpDays', () => {
  assert.deepEqual(monthsToPull({ asOf: '2026-12-10', lastSuccessDate: '2025-01-01', maxCatchUpDays: 20 }), ['2026-11', '2026-12'])
})
