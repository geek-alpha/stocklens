import type { IndexQuote, MarketBoard, SectorRotation, SectorSnapshot } from '@shared/types'
import { BENCHMARK_SYMBOL, SectorHistory } from './snapshot'

/**
 * 看板组装逻辑单独成文件，不 import electron。
 *
 * 主进程和离线快照脚本（tools/snapshot-board.mjs）共用同一份组装口径——
 * 放在 board.ts 里会被 app.getPath 连累，脚本在纯 node 下 require 就崩。
 */

/** 板块涨跌幅是相对上证/深证算的，基准必须用沪深300才能横向比较 */
export function tradeDateOf(indices: IndexQuote[]): string {
  const cn = indices.filter((i) => i.region === 'CN' && i.marketTime > 0)
  const pool = cn.length > 0 ? cn : indices
  const latest = pool.reduce((max, i) => (i.marketTime > max ? i.marketTime : max), 0)
  const at = latest > 0 ? new Date(latest * 1000) : new Date()
  return at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

export function composeBoard(
  indices: IndexQuote[],
  industries: SectorSnapshot[],
  concepts: SectorSnapshot[],
  fetchedAt = Math.floor(Date.now() / 1000)
): MarketBoard {
  // 概念板块之间成分股高度重叠，加总会重复计算；行业板块近似互斥，用它代表全市场
  const totalAmount = industries.reduce((sum, s) => sum + s.amount, 0)
  const benchmark = indices.find((i) => i.symbol === BENCHMARK_SYMBOL)?.changePercent ?? 0

  const decorate = (list: SectorSnapshot[]): SectorSnapshot[] =>
    list.map((sector) => ({
      ...sector,
      amountShare: totalAmount > 0 ? (sector.amount / totalAmount) * 100 : null,
      relativeStrength: sector.changePercent - benchmark
    }))

  return {
    fetchedAt,
    tradeDate: tradeDateOf(indices),
    source: 'tencent+sina-board',
    indices,
    industries: decorate(industries),
    concepts: decorate(concepts),
    totalAmount
  }
}

/**
 * 强势/弱势板块排序。
 *
 * 历史不足 2 天时只能按单日超额排，并在返回里标明 basis——调用方（界面和 AI）
 * 必须知道这是单日口径：一天的超额分不清「持续走强」和「一日反弹」。
 */
export async function computeRotation(
  history: SectorHistory,
  industries: SectorSnapshot[],
  concepts: SectorSnapshot[],
  limit = 20,
  days = 20
): Promise<SectorRotation> {
  const all = [...industries, ...concepts]
  const stats = await history.stats()

  if (stats.days < 2) {
    const sorted = [...all].sort((a, b) => (b.relativeStrength ?? 0) - (a.relativeStrength ?? 0))
    return {
      basis: 'single-day',
      historyDays: stats.days,
      rising: sorted.slice(0, limit),
      falling: sorted.slice(-limit).reverse()
    }
  }

  const trends = await history.trends(days)
  const scored = all.map((sector) => {
    const series = trends.get(sector.code) ?? []
    const cumulative = series.reduce((sum, p) => sum + (p.relativeStrength ?? 0), 0)
    return { sector, cumulative }
  })

  scored.sort((a, b) => b.cumulative - a.cumulative)
  return {
    basis: 'cumulative',
    historyDays: stats.days,
    rising: scored.slice(0, limit).map((s) => ({ ...s.sector, relativeStrength: s.cumulative })),
    falling: scored
      .slice(-limit)
      .reverse()
      .map((s) => ({ ...s.sector, relativeStrength: s.cumulative }))
  }
}
