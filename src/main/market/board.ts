import { join } from 'node:path'
import { app } from 'electron'
import type { IndexQuote, MarketBoard, SectorSnapshot, SectorTrendPoint } from '@shared/types'
import { SinaBoardProvider } from './sina_board'
import { BENCHMARK_SYMBOL, SectorHistory } from './snapshot'
import { TencentProvider } from './tencent'

/**
 * 市场看板门面：一次抓取聚合「全球指数 + A股板块」，并把当日板块快照落盘。
 *
 * 抓取节奏受两个实测约束支配：
 * 1. 东财 push2 请求过密会整段掐断 TLS（静默 60s 也不恢复），所以板块走新浪；
 * 2. 腾讯单次请求超过 12 个代码会被静默截断，指数必须分批。
 *
 * 相对强度是这里唯一有分析价值的派生量：板块涨跌幅减基准涨跌幅。
 * 单日涨跌幅分不清「持续走强」和「超跌反弹」，所以同时把快照落盘攒序列。
 */

const BOARD_TTL = 60_000

/** 板块涨跌幅是相对上证/深证算的，基准必须用沪深300才能横向比较 */
function tradeDateOf(indices: IndexQuote[]): string {
  const cn = indices.filter((i) => i.region === 'CN' && i.marketTime > 0)
  const pool = cn.length > 0 ? cn : indices
  const latest = pool.reduce((max, i) => (i.marketTime > max ? i.marketTime : max), 0)
  const at = latest > 0 ? new Date(latest * 1000) : new Date()
  return at.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

export class MarketBoardService {
  private readonly tencent = new TencentProvider()
  private readonly sectors = new SinaBoardProvider()
  private readonly history: SectorHistory
  private cached: { at: number; value: MarketBoard } | null = null

  constructor(historyDir = join(app.getPath('userData'), 'sector-history')) {
    this.history = new SectorHistory(historyDir)
  }

  async getBoard(force = false): Promise<MarketBoard> {
    if (!force && this.cached && Date.now() - this.cached.at < BOARD_TTL) {
      return this.cached.value
    }

    const [indices, industries, concepts] = await Promise.all([
      this.tencent.getIndices(),
      this.sectors.getSectors('industry'),
      this.sectors.getSectors('concept')
    ])

    // 概念板块之间成分股高度重叠，加总会重复计算；行业板块近似互斥，用它代表全市场
    const totalAmount = industries.reduce((sum, s) => sum + s.amount, 0)
    const benchmark = indices.find((i) => i.symbol === BENCHMARK_SYMBOL)?.changePercent ?? 0

    const decorate = (list: SectorSnapshot[]): SectorSnapshot[] =>
      list.map((sector) => ({
        ...sector,
        amountShare: totalAmount > 0 ? (sector.amount / totalAmount) * 100 : null,
        relativeStrength: sector.changePercent - benchmark
      }))

    const board: MarketBoard = {
      fetchedAt: Math.floor(Date.now() / 1000),
      tradeDate: tradeDateOf(indices),
      source: 'tencent+sina-board',
      indices,
      industries: decorate(industries),
      concepts: decorate(concepts),
      totalAmount
    }

    await this.history.save(board)
    this.cached = { at: Date.now(), value: board }
    return board
  }

  /** 单个板块的相对强度轨迹。判断产业兴衰看的是这条线的斜率，不是某一天的值 */
  async getSectorTrend(code: string, days = 60): Promise<SectorTrendPoint[]> {
    const trends = await this.history.trends(days)
    return trends.get(code) ?? []
  }

  /**
   * 按「近 N 日相对强度累计」排出的强势/弱势板块。
   * 只在历史不足时退回单日排序，并在返回里标明用的是哪种口径。
   */
  async getRotation(limit = 20, days = 20): Promise<{
    basis: 'single-day' | 'cumulative'
    historyDays: number
    rising: SectorSnapshot[]
    falling: SectorSnapshot[]
  }> {
    const board = await this.getBoard()
    const all = [...board.industries, ...board.concepts]
    const stats = await this.history.stats()

    if (stats.days < 2) {
      const sorted = [...all].sort((a, b) => (b.relativeStrength ?? 0) - (a.relativeStrength ?? 0))
      return {
        basis: 'single-day',
        historyDays: stats.days,
        rising: sorted.slice(0, limit),
        falling: sorted.slice(-limit).reverse()
      }
    }

    const trends = await this.history.trends(days)
    const scored = all.map((sector) => {
      const series = trends.get(sector.code) ?? []
      const cumulative = series.reduce((sum, p) => sum + (p.relativeStrength ?? 0), 0)
      return { sector, cumulative }
    })

    scored.sort((a, b) => b.cumulative - a.cumulative)
    return {
      basis: 'cumulative',
      historyDays: stats.days,
      rising: scored.slice(0, limit).map((s) => ({
        ...s.sector,
        relativeStrength: s.cumulative
      })),
      falling: scored
        .slice(-limit)
        .reverse()
        .map((s) => ({ ...s.sector, relativeStrength: s.cumulative }))
    }
  }

  async getHistoryStats(): Promise<{ days: number; from: string | null; to: string | null }> {
    return this.history.stats()
  }
}
