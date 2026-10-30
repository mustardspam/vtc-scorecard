import test from 'node:test'
import assert from 'node:assert/strict'
import { transform } from '../core/transforms.js'
import { validateDataset } from '../core/validate.js'

const schedule = n => Array.from({ length: n }, (_, i) => ({ vendor_name: `V${i}`, erp_vendor_id: String(100 + i), total_jobs: 10, no_shows: 1, period_month: '2026-09-01' }))

test('schedule transform shifts period_month to the month after (scorecard convention)', () => {
  const t = transform('schedule', { records: schedule(1) })
  assert.equal(t.records[0].period_month, '2026-10-01')
  assert.equal(t.count, 1)
})

test('valid schedule passes', () => {
  const v = validateDataset(transform('schedule', { records: schedule(3) }))
  assert.equal(v.ok, true, v.errors.join())
})

test('missing required column fails with the row named', () => {
  const rows = schedule(2)
  delete rows[1].no_shows
  const v = validateDataset(transform('schedule', { records: rows }))
  assert.equal(v.ok, false)
  assert.match(v.errors[0], /row 2: no_shows is missing/)
})

test('schedule row without period_month is reported, not thrown', () => {
  const v = validateDataset(transform('schedule', { records: [{ vendor_name: 'A', total_jobs: 1, no_shows: 0 }] }))
  assert.equal(v.ok, false)
  assert.match(v.errors[0], /period_month is missing/)
})

test('wrong types fail', () => {
  const v = validateDataset(transform('rework', { records: [{ vendor_name: 'A', cost: 'abc', rework_date: '10/01/2026' }] }))
  assert.equal(v.ok, false)
  assert.match(v.errors[0], /cost should be amount/)
  assert.match(v.errors[0], /rework_date should be date/)
})

test('rework accepts money strings and fills lot_or_address from community', () => {
  const t = transform('rework', { records: [{ vendor_name: 'A', cost: '$1,250.00', rework_date: '2026-10-02', community: 'HOUSB' }] })
  assert.equal(t.records[0].lot_or_address, 'HOUSB')
  assert.equal(validateDataset(t).ok, true)
})

test('safety severity comes from the OFI category', () => {
  const t = transform('safety', { records: [{ trade_type: 'Dalco Roofing', category: 'Fall Protection', incident_date: '2026-10-03' }] })
  assert.equal(t.records[0].severity, 'near_miss')
  assert.equal(validateDataset(t).ok, true)
})

test('records missing entirely fails', () => {
  assert.equal(validateDataset(transform('safety', { summary: {} })).ok, false)
})

test('row-count drop vs the last import of the period fails', () => {
  const v = validateDataset(transform('schedule', { records: schedule(4) }), { previousCount: 40 })
  assert.equal(v.ok, false)
  assert.match(v.errors[0], /dropped from 40 to 4/)
})

test('zero rows after a non-empty import fails', () => {
  const v = validateDataset(transform('schedule', { records: [] }), { previousCount: 5 })
  assert.equal(v.ok, false)
})

test('growth and small dips pass', () => {
  assert.equal(validateDataset(transform('schedule', { records: schedule(30) }), { previousCount: 20 }).ok, true)
  assert.equal(validateDataset(transform('schedule', { records: schedule(15) }), { previousCount: 20 }).ok, true)
})

test('JC report structure is checked and counted by assignments', () => {
  const good = { communities: [{ code: 'HOUSB', name: 'Sunset' }], vendors: [{ jcVendorId: '123', name: 'ACME', assignments: [{ communityCode: 'HOUSB', costCode: '4100' }] }] }
  const t = transform('jc_vendor_report', good)
  assert.equal(t.count, 1)
  assert.equal(validateDataset(t).ok, true)
  const bad = transform('jc_vendor_report', { communities: [], vendors: [{ jcVendorId: 'x', name: '', assignments: [] }] })
  assert.equal(validateDataset(bad).ok, false)
})
