import assert from 'node:assert/strict'
import test from 'node:test'
import { mapQuotaStats, QUOTA_STATS_API_PATH } from '../src/main/quota-api.js'

test('maps the official Kimi subscription stats response', () => {
  const result = mapQuotaStats({
    ratelimit_code_5h: {
      ratio: 0.0083,
      reset_time: '2026-08-26T12:11:00.000Z'
    },
    ratelimit_code_7d: {
      ratio: 0.0456,
      reset_time: '2026-09-02T02:11:00.000Z'
    },
    subscription_balance: {
      amount_used_ratio: 0.0151,
      kimi_code_used_ratio: 0.0083,
      expire_time: '2026-09-25T00:00:00.000Z'
    }
  }, 'Allegretto')

  assert.equal(result.ready, true)
  assert.equal(result.membershipPlan, 'Allegretto')
  assert.equal(result.totalPercent, 1.51)
  assert.equal(result.kimiPercent, 0.68)
  assert.equal(result.codePercent, 0.83)
  assert.equal(result.fiveHourPercent, 0.83)
  assert.equal(result.sevenDayPercent, 4.56)
  assert.equal(result.totalReset, '2026-09-25')
  assert.match(result.fiveHourReset, /^08-26 \d{2}:11$/)
  assert.match(result.sevenDayReset, /^09-02 \d{2}:11$/)
})

test('accepts wrapped and camelCase stats payloads and keeps zero code usage', () => {
  const result = mapQuotaStats({ data: {
    ratelimitCode5h: { ratio: 0, resetTime: { seconds: '1787703060' } },
    ratelimitCode7d: { ratio: 0.01, resetTime: { seconds: '1788310260' } },
    subscriptionBalance: {
      amountUsedRatio: 0.0088,
      kimiCodeUsedRatio: 0,
      expireTime: { seconds: '1789689600' }
    }
  }})

  assert.equal(result.ready, true)
  assert.equal(result.totalPercent, 0.88)
  assert.equal(result.kimiPercent, 0.88)
  assert.equal(result.codePercent, 0)
  assert.equal(result.fiveHourPercent, 0)
  assert.equal(QUOTA_STATS_API_PATH, '/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats')
})

test('does not claim readiness when official stats are incomplete', () => {
  const result = mapQuotaStats({ subscription_balance: { amount_used_ratio: 0.0151 } })
  assert.equal(result.ready, false)
  assert.equal(result.error, '官方额度接口未返回完整数据。')
})
