import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MarketBoard, SectorKind, SectorTrendPoint } from '@shared/types'

/**
 * 板块每日快照落盘。
 *
 * 「新兴产业取代落寞产业」在单日行情里看不见——一天的涨跌幅分不清「持续走强」
 * 和「超跌反弹」。唯一诚实的做法是把每天的板块快照攒成序列，再算相对基准的
 * 超额收益。这个模块存在的唯一理由就是攒这个序列。
 *
 * 落盘按交易日一个文件，同日重复抓取直接覆盖（幂等）；只保留最近 keepDays 个交易日。
 */

/** 基准指数：板块相对强度一律相对它计算，换成上证会让「超额」失去可比性 */
export const BENCHMARK_SYMBOL = 'sh000300'

interface StoredSector {
  code: string
  name: string
  kind: SectorKind
  changePercent: number
  amount: number
  amountShare: number | null
}

interface DaySnapshot {
  date: string
  /** 基准当日涨跌幅，读回时用它还原相对强度 */
  benchmarkChangePercent: number
  totalAmount: number
  sectors: StoredSector[]
}

function isDaySnapshot(value: unknown): value is DaySnapshot {
  if (!value || typeof value !== 'object') return false
  const snap = value as Partial<DaySnapshot>
  return typeof snap.date === 'string' && Array.isArray(snap.sectors)
}

export class SectorHistory {
  constructor(
    private readonly dir: string,
    private readonly keepDays = 120
  ) {}

  private pathFor(date: string): string {
    return join(this.dir, `${date}.json`)
  }

  async save(board: MarketBoard): Promise<void> {
    if (!board.tradeDate) return
    await mkdir(this.dir, { recursive: true })

    const benchmark = board.indices.find((i) => i.symbol === BENCHMARK_SYMBOL)
    const snapshot: DaySnapshot = {
      date: board.tradeDate,
      benchmarkChangePercent: benchmark?.changePercent ?? 0,
      totalAmount: board.totalAmount,
      sectors: [...board.industries, ...board.concepts].map((s) => ({
        code: s.code,
        name: s.name,
        kind: s.kind,
        changePercent: s.changePercent,
        amount: s.amount,
        amountShare: s.amountShare
      }))
    }

    await writeFile(this.pathFor(board.tradeDate), JSON.stringify(snapshot), 'utf-8')
    await this.prune()
  }

  /** 按交易日倒序返回快照，最新在前 */
  async loadDays(limit = 60): Promise<DaySnapshot[]> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return []
    }

    const dates = names
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .map((n) => n.slice(0, -5))
      .sort()
      .reverse()
      .slice(0, Math.max(1, limit))

    const days: DaySnapshot[] = []
    for (const date of dates) {
      try {
        const raw = JSON.parse(await readFile(this.pathFor(date), 'utf-8')) as unknown
        if (isDaySnapshot(raw)) days.push(raw)
      } catch {
        // 单个文件损坏不该让整段历史不可用，跳过即可
      }
    }
    return days
  }

  /**
   * 把逐日快照折叠成每个板块的时间序列。
   * 序列按时间正序（旧 → 新），调用方直接算斜率。
   */
  async trends(limit = 60): Promise<Map<string, SectorTrendPoint[]>> {
    const days = (await this.loadDays(limit)).reverse()
    const map = new Map<string, SectorTrendPoint[]>()

    for (const day of days) {
      for (const sector of day.sectors) {
        const series = map.get(sector.code) ?? []
        series.push({
          date: day.date,
          changePercent: sector.changePercent,
          amount: sector.amount,
          amountShare: sector.amountShare,
          relativeStrength: sector.changePercent - day.benchmarkChangePercent
        })
        map.set(sector.code, series)
      }
    }
    return map
  }

  /** 已落盘的交易日数量与跨度，界面用来提示「历史还在攒」 */
  async stats(): Promise<{ days: number; from: string | null; to: string | null }> {
    const days = await this.loadDays(1000)
    if (days.length === 0) return { days: 0, from: null, to: null }
    const sorted = days.map((d) => d.date).sort()
    return { days: sorted.length, from: sorted[0], to: sorted[sorted.length - 1] }
  }

  private async prune(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return
    }

    const dates = names
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .map((n) => n.slice(0, -5))
      .sort()
      .reverse()

    for (const date of dates.slice(this.keepDays)) {
      try {
        await unlink(this.pathFor(date))
      } catch {
        // 删不掉就留着，不影响功能
      }
    }
  }
}
