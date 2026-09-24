import type {
  AppSettings,
  BarInterval,
  BarRange,
  CandleSeries,
  NewsItem,
  Quote,
  SymbolHit
} from '@shared/types'
import { EastMoneyProvider } from './eastmoney'
import { FinnhubProvider } from './finnhub'
import { SinaProvider } from './sina'
import { TencentProvider } from './tencent'
import { MarketError, type MarketCapability, type MarketProvider } from './types'
import { YahooProvider } from './yahoo'

/** 各周期的 K 线缓存时长：越短的周期越需要新鲜数据 */
const CANDLE_TTL: Record<BarInterval, number> = {
  '1m': 30_000,
  '5m': 60_000,
  '15m': 120_000,
  '30m': 120_000,
  '1h': 180_000,
  '1d': 600_000,
  '1wk': 900_000,
  '1mo': 900_000
}

interface CacheEntry<T> {
  at: number
  ttl: number
  value: T
}

class TtlCache<T> {
  constructor(private readonly maxSize = 300) {}

  private readonly map = new Map<string, CacheEntry<T>>()

  get(key: string): T | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (Date.now() - hit.at > hit.ttl) {
      this.map.delete(key)
      return undefined
    }
    return hit.value
  }

  /** 取过期值：所有源都挂了时用它兜底，界面不空窗（调用方必须标记 stale） */
  peek(key: string): T | undefined {
    return this.map.get(key)?.value
  }

  set(key: string, value: T, ttl: number): void {
    if (this.map.size >= this.maxSize) {
      const oldest = [...this.map.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50)
      oldest.forEach(([k]) => this.map.delete(k))
    }
    this.map.set(key, { at: Date.now(), ttl, value })
  }
}

/**
 * 行情门面：按「能力」组降级链，而不是整体切换数据源。
 * 实测国内环境下 Yahoo 常被 429、东财请求过密会断 TLS——单点依赖都会让软件不可用，
 * 所以每个能力都配了多条链路，任何一条能通就返回。
 */
export class MarketService {
  private readonly yahoo = new YahooProvider()
  private readonly finnhub: FinnhubProvider
  private readonly eastmoney = new EastMoneyProvider()
  private readonly tencent = new TencentProvider()
  private readonly sina = new SinaProvider()

  private readonly quoteCache = new TtlCache<Quote[]>(200)
  private readonly candleCache = new TtlCache<CandleSeries>(80)
  private readonly searchCache = new TtlCache<SymbolHit[]>(200)
  private readonly newsCache = new TtlCache<NewsItem[]>(100)

  constructor(private readonly settings: () => AppSettings) {
    this.finnhub = new FinnhubProvider(() => this.settings().finnhubKey)
  }

  private chains(): Record<MarketCapability, MarketProvider[]> {
    const preferred = this.settings().dataProvider

    if (preferred === 'yahoo') {
      return {
        quote: [this.yahoo, this.tencent, this.sina],
        candles: [this.yahoo, this.eastmoney],
        search: [this.yahoo, this.eastmoney],
        news: [this.yahoo]
      }
    }

    if (preferred === 'finnhub') {
      return {
        quote: [this.finnhub, this.tencent, this.sina, this.yahoo],
        candles: [this.eastmoney, this.yahoo],
        search: [this.eastmoney, this.yahoo],
        news: [this.finnhub, this.yahoo]
      }
    }

    // auto：国内直连源优先，海外源兜底
    return {
      quote: [this.tencent, this.sina, this.yahoo],
      candles: [this.eastmoney, this.yahoo],
      search: [this.eastmoney, this.yahoo],
      news: [this.yahoo]
    }
  }

  private async runChain<T>(
    capability: MarketCapability,
    fn: (provider: MarketProvider) => Promise<T>
  ): Promise<{ value: T; source: string }> {
    let lastError: unknown
    for (const provider of this.chains()[capability]) {
      try {
        const value = await fn(provider)
        return { value, source: provider.id }
      } catch (err) {
        lastError = err
      }
    }
    throw lastError instanceof Error ? lastError : new MarketError('所有数据源都不可用', 'network')
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const normalized = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
    if (normalized.length === 0) return []

    const key = normalized.join(',')
    const cached = this.quoteCache.get(key)
    if (cached) return cached

    try {
      // 空结果必须当成失败，否则降级链会误判为“这个源可用”而不再尝试下一个
      const { value } = await this.runChain('quote', async (provider) => {
        const quotes = await provider.getQuote(normalized)
        if (quotes.length === 0) {
          throw new MarketError(`${provider.label} 未返回报价`, 'notfound')
        }
        return quotes
      })
      this.quoteCache.set(
        key,
        value,
        Math.max(3000, Math.min(this.settings().refreshIntervalMs, 60_000))
      )
      return value
    } catch (err) {
      const stale = this.quoteCache.peek(key)
      if (stale) {
        return stale.map((quote) => ({ ...quote, stale: true }))
      }
      throw err
    }
  }

  async getCandles(symbol: string, interval: BarInterval, range: BarRange): Promise<CandleSeries> {
    const clean = symbol.trim().toUpperCase()
    const key = `${clean}:${interval}:${range}`
    const cached = this.candleCache.get(key)
    if (cached) return cached

    try {
      const { value, source } = await this.runChain('candles', (provider) =>
        provider.getCandles(clean, interval, range)
      )
      if (value.length === 0) {
        throw new MarketError(`未获取到 ${clean} 的 K 线数据`, 'notfound')
      }
      const series: CandleSeries = { symbol: clean, interval, range, candles: value, source }
      this.candleCache.set(key, series, CANDLE_TTL[interval])
      return series
    } catch (err) {
      const stale = this.candleCache.peek(key)
      if (stale) return { ...stale, source: `${stale.source}(缓存)` }
      throw err
    }
  }

  async searchSymbols(query: string): Promise<SymbolHit[]> {
    const trimmed = query.trim()
    if (!trimmed) return []
    const cached = this.searchCache.get(trimmed)
    if (cached) return cached

    try {
      const { value } = await this.runChain('search', (provider) => provider.searchSymbols(trimmed))
      this.searchCache.set(trimmed, value, 300_000)
      return value
    } catch {
      return []
    }
  }

  async getNews(symbol: string): Promise<NewsItem[]> {
    const clean = symbol.trim().toUpperCase()
    const cached = this.newsCache.get(clean)
    if (cached) return cached

    try {
      const { value } = await this.runChain('news', (provider) => provider.getNews(clean))
      this.newsCache.set(clean, value, 600_000)
      return value
    } catch {
      return []
    }
  }
}
