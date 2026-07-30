export function normalizeSnapshot(extracted) {
  const snapshot = {
    updatedAt: new Date().toISOString(),
    total: {
      usedPercent: extracted.totalPercent,
      kimiPercent: extracted.kimiPercent,
      codePercent: extracted.codePercent,
      resetAt: extracted.totalReset
    },
    fiveHour: {
      percent: extracted.fiveHourPercent,
      resetAt: extracted.fiveHourReset
    },
    sevenDay: {
      percent: extracted.sevenDayPercent,
      resetAt: extracted.sevenDayReset
    }
  }

  const values = [
    snapshot.total.usedPercent,
    snapshot.total.kimiPercent,
    snapshot.total.codePercent,
    snapshot.fiveHour.percent,
    snapshot.sevenDay.percent
  ]
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error('额度页面返回了无效百分比。')
  }
  if (
    Math.abs(
      snapshot.total.kimiPercent
      + snapshot.total.codePercent
      - snapshot.total.usedPercent
    ) > 0.8
  ) {
    throw new Error('Kimi 与 Code 分项之和和总额度不一致。')
  }
  return snapshot
}
