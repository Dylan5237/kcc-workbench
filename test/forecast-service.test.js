import test from 'node:test'
import assert from 'node:assert/strict'
import { buildForecast } from '../src/main/forecast-service.js'

test('requires two valid samples', () => {
  const result = buildForecast([])
  assert.equal(result.status, 'insufficient')
})

test('predicts critical short-window exhaustion before reset', () => {
  const now = new Date('2026-07-27T12:00:00+08:00')
  const history = [
    sample('2026-07-27T10:00:00+08:00', 20, '07-27 16:00'),
    sample('2026-07-27T12:00:00+08:00', 80, '07-27 16:00')
  ]
  const result = buildForecast(history, now)
  assert.equal(result.metrics.fiveHour.status, 'critical')
  assert.ok(result.metrics.fiveHour.hoursToExhaust < 1)
})

test('marks a pace safe when projected exhaustion is after reset', () => {
  const now = new Date('2026-07-27T12:00:00+08:00')
  const history = [
    sample('2026-07-27T10:00:00+08:00', 20, '07-27 16:00'),
    sample('2026-07-27T12:00:00+08:00', 21, '07-27 16:00')
  ]
  const result = buildForecast(history, now)
  assert.equal(result.metrics.fiveHour.status, 'safe')
})

function sample(updatedAt, fiveHourPercent, fiveHourReset) {
  return {
    updatedAt,
    total: {
      usedPercent: fiveHourPercent,
      kimiPercent: fiveHourPercent,
      codePercent: 0,
      resetAt: '2026-08-25'
    },
    fiveHour: {
      percent: fiveHourPercent,
      resetAt: fiveHourReset
    },
    sevenDay: {
      percent: fiveHourPercent,
      resetAt: '08-01 11:13'
    }
  }
}
