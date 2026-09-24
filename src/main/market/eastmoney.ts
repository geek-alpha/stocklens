import type { BarInterval, BarRange, Candle, NewsItem, Quote, SymbolHit } from '@shared/types'
import { createThrottle, fetchJson, MarketError, withRetry, type MarketProvider } from './types'

/**
 * 东方财富：国内直连的免费美股 K 线与搜索源，返回标准 JSON。
 * 实测限制：请求过密会直接断开 TLS（不是 HTTP 429），所以所有调用都过节流 + 退避重试。
 */

const PUSH_HIS = 'https://push2his.eastmoney.com'
const SEARCH = 'https://searchapi.eastmoney.com'

const KLT: Record<BarInterval, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '1d': '101',
  '1wk': '102',
  '1mo': '103'
}

const RANGE_LIMIT: Record<BarRange, number> = {
  '1d': 300,
  '5d': 300,
  '1mo': 300,
  '3mo': 300,
  '6mo': 300,
  '1y': 400,
  '2y': 700,
  '5y': 1400,
  '10y': 2600,
  max: 6000
}

const REFERER = { Referer: 'https://quote.eastmoney.com/' }

const throttle = createThrottle(320)

interface SuggestItem {
  Code?: string
  Name?: string
  JYS?: string
  Classify?: string
  QuoteID?: string
}

interface SuggestResponse {
  QuotationCodeTable?: { Data?: SuggestItem[] }
}

interface KlineResponse {
  data?: {
    code?: string
    name?: string
    decimal?: number
    dktotal?: number
    preKPrice?: number
    klines?: string[]
  } | null
}

/** 日线用 UTC 午夜，与图表层还原日期字符串的口径保持一致；分钟线按美东时间换算 */
function parseKlineTime(value: string, interval: BarInterval): number {
  const trimmed = value.trim()
  if (interval === '1d' || interval === '1wk' || interval === '1mo') {
    const parsed = Date.parse(`${trimmed.slice(0, 10)}T00:00:00Z`)
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0
  }
  const month = Number(trimmed.slice(5, 7))
  const offset = month >= 4 && month <= 10 ? '-04:00' : '-05:00'
  const parsed = Date.parse(`${trimmed.replace(' ', 'T')}:00${offset}`)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0
}

export class EastMoneyProvider implements MarketProvider {
  readonly id = 'eastmoney'
  readonly label = '东方财富'
  readonly capabilities: MarketProvider['capabilities'] = ['candles', 'search']

  private readonly secidCache = new Map<string, string>()

  /** 东财用 secid（市场号.代码）寻址，105=纳斯达克 106=纽交所 107=美交所，靠搜索接口解析并缓存 */
  private async resolveSecid(symbol: string): Promise<string> {
    const clean = symbol.trim().toUpperCase()
    const cached = this.secidCache.get(clean)
    if (cached) return cached

    const url = `${SEARCH}/api/suggest/get?input=${encodeURIComponent(clean)}&type=14&count=10`
    const data = await throttle(() =>
      withRetry(() => fetchJson<SuggestResponse>(url, { headers: REFERER }))
    )

    const hit = (data.QuotationCodeTable?.Data ?? []).find(
      (item) =>
        item.Classify === 'UsStock' &&
        (item.Code ?? '').toUpperCase() === clean &&
        Boolean(item.QuoteID)
    )
    if (!hit?.QuoteID) {
      throw new MarketError(`未找到美股标的 ${clean}`, 'notfound')
    }

    this.secidCache.set(clean, hit.QuoteID)
    return hit.QuoteID
  }

  async getCandles(symbol: string, interval: BarInterval, range: BarRange): Promise<Candle[]> {
    const secid = await this.resolveSecid(symbol)
    const url =
      `${PUSH_HIS}/api/qt/stock/kline/get?secid=${encodeURIComponent(secid)}` +
      `&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56` +
      `&klt=${KLT[interval]}&fqt=1&end=20500101&lmt=${RANGE_LIMIT[range]}`

    const data = await throttle(() =>
      withRetry(() => fetchJson<KlineResponse>(url, { headers: REFERER }, 15_000))
    )
    const klines = data.data?.klines ?? []
    if (klines.length === 0) {
      throw new MarketError(`未获取到 ${symbol} 的 K 线数据`, 'notfound')
    }

    const candles: Candle[] = []
    for (const line of klines) {
      // 字段顺序：日期,开,收,高,低,成交量（不是 OHLC，容易写反）
      const [time, open, close, high, low, volume] = line.split(',')
      const candle: Candle = {
        time: parseKlineTime(time ?? '', interval),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume) || 0
      }
      if (candle.time > 0 && Number.isFinite(candle.close)) {
        candles.push(candle)
      }
    }

    if (candles.length === 0) {
      throw new MarketError(`${symbol} 的 K 线数据无法解析`, 'parse')
    }
    return candles
  }

  async searchSymbols(query: string): Promise<SymbolHit[]> {
    const url = `${SEARCH}/api/suggest/get?input=${encodeURIComponent(query)}&type=14&count=15`
    const data = await throttle(() =>
      withRetry(() => fetchJson<SuggestResponse>(url, { headers: REFERER }))
    )
    return (data.QuotationCodeTable?.Data ?? [])
      .filter((item) => item.Classify === 'UsStock' && item.Code)
      .slice(0, 12)
      .map((item) => ({
        symbol: item.Code as string,
        name: item.Name ?? (item.Code as string),
        exchange: item.JYS ?? '',
        type: '美股'
      }))
  }

  async getQuote(): Promise<Quote[]> {
    throw new MarketError('东方财富不提供报价能力（报价由腾讯财经承担）', 'unsupported')
  }

  async getNews(): Promise<NewsItem[]> {
    throw new MarketError('东方财富不提供新闻能力', 'unsupported')
  }
}
