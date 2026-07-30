import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeSnapshot } from '../src/main/quota-snapshot.js'

function validExtracted(overrides = {}) {
  return {
    totalPercent: 20,
    kimiPercent: 15,
    codePercent: 5,
    totalReset: '2026-08-01',
    fiveHourPercent: 30,
    fiveHourReset: '08-01 10:00',
    sevenDayPercent: 25,
    sevenDayReset: '08-05 10:00',
    ...overrides
  }
}

test('normalizeSnapshot maps extracted fields into a structured snapshot', () => {
  const snap = normalizeSnapshot(validExtracted())
  assert.equal(snap.total.usedPercent, 20)
  assert.equal(snap.total.kimiPercent, 15)
  assert.equal(snap.total.codePercent, 5)
  assert.equal(snap.total.resetAt, '2026-08-01')
  assert.equal(snap.fiveHour.percent, 30)
  assert.equal(snap.sevenDay.percent, 25)
  assert.match(snap.updatedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('normalizeSnapshot rejects out-of-range percentages', () => {
  assert.throws(() => normalizeSnapshot(validExtracted({ totalPercent: 150 })), /无效百分比/)
  assert.throws(() => normalizeSnapshot(validExtracted({ kimiPercent: -1 })), /无效百分比/)
})

test('normalizeSnapshot rejects kimi+code diverging from total beyond tolerance', () => {
  assert.throws(
    () => normalizeSnapshot(validExtracted({ totalPercent: 20, kimiPercent: 15, codePercent: 10 })),
    /不一致/
  )
})

test('normalizeSnapshot accepts kimi+code within tolerance of total', () => {
  assert.doesNotThrow(() =>
    normalizeSnapshot(validExtracted({ totalPercent: 20, kimiPercent: 15, codePercent: 5.5 }))
  )
})
