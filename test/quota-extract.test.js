import assert from 'node:assert/strict'
import test from 'node:test'
import { QUOTA_EXTRACTION_SCRIPT } from '../src/main/quota-extract.js'

function extract(innerText) {
  const document = {
    body: { innerText },
    querySelectorAll: () => []
  }
  return new Function('document', `return (${QUOTA_EXTRACTION_SCRIPT})`)(document)
}

test('quota extraction reads text-based split percentages and the active Allegretto plan', () => {
  const result = extract(`
    Allegretto
    总额度 98.25%
    Kimi 38.36%
    Code 59.89%
    2026-08-26 后重置
    5 小时用量
    Code 0%
    08-25 12:13 后重置
    7 天用量
    Code 0.76%
    08-29 11:13 后重置
  `)

  assert.equal(result.ready, true)
  assert.equal(result.membershipPlan, 'Allegretto')
  assert.equal(result.totalPercent, 98.25)
  assert.equal(result.kimiPercent, 38.36)
  assert.equal(result.codePercent, 59.89)
  assert.equal(result.fiveHourPercent, 0)
  assert.equal(result.sevenDayPercent, 0.76)
})

test('quota extraction keeps the legacy total usage heading compatible', () => {
  const result = extract(`
    总使用量 18.62%
    Kimi 14.70%
    Code 3.92%
    2026-08-25 后重置
    5 小时用量 Code 31.37% 07-27 13:13 后重置
    7 天用量 Code 18.41% 08-01 11:13 后重置
  `)

  assert.equal(result.ready, true)
  assert.equal(result.totalPercent, 18.62)
  assert.equal(result.kimiPercent, 14.7)
  assert.equal(result.codePercent, 3.92)
})
