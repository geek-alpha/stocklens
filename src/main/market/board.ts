import { join } from 'node:path'
import { app } from 'electron'
import type { MarketBoard, SectorRotation, SectorTrendPoint } from '@shared/types'
import { composeBoard, computeRotation } from './compose'
import { SinaBoardProvider } from './sina_board'
import { SectorHistory } from './snapshot'
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

    const board = composeBoard(indices, industries, concepts)

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
   * 口径选择与排序在 compose.ts，与离线快照脚本共用同一份。
   */
  async getRotation(limit = 20, days = 20): Promise<SectorRotation> {
    const board = await this.getBoard()
    return computeRotation(this.history, board.industries, board.concepts, limit, days)
  }

  async getHistoryStats(): Promise<{ days: number; from: string | null; to: string | null }> {
    return this.history.stats()
  }
}
