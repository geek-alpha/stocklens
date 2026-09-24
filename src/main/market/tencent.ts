import type { Candle, NewsItem, Quote, SymbolHit } from '@shared/types'
import { createThrottle, fetchText, MarketError, withRetry, type MarketProvider } from './types'

/**
 * 腾讯财经报价：国内直连、免密钥、一次可拿多只股票，字段是明文数值（无需按小数位缩放）。
 * 字段位置经实测确认（见下方 FIELD 常量），GBK 编码。
 */

const BASE = 'https://qt.gtimg.cn/q='

const FIELD = {
  name: 1,
  code: 2,
  price: 3,
  previousClose: 4,
  open: 5,
  time: 30,
  change: 31,
  changePercent: 32,
  high: 33,
  low: 34,
  currency: 35,
  volume: 36,
  amount: 37,
  marketCap: 44,
  englishName: 46,
  fiftyTwoWeekHigh: 48,
  fiftyTwoWeekLow: 49
} as const

const throttle = createThrottle(180)

/**
 * 腾讯返回的是美东时间字符串，没有时区标记。
 * 按月份近似判断夏令时（3 月第二个周日至 11 月第一个周日），误差最多 1 小时且只影响时间显示。
 */
function easternTimeToEpoch(value: string): number {
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return Math.floor(Date.now() / 1000)
  }
  const month = Number(trimmed.slice(5, 7))
  const offset = month >= 4 && month <= 10 ? '-04:00' : '-05:00'
  const parsed = Date.parse(`${trimmed.replace(' ', 'T')}${offset}`)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000)
}

function toNumber(fields: string[], index: number): number {
  const value = Number.parseFloat(fields[index] ?? '')
  return Number.isFinite(value) ? value : 0
}

function parseQuoteLine(line: string): Quote | null {
  const matched = line.match(/v_us([A-Za-z0-9.\-]+)="([^"]*)"/)
  if (!matched) return null

  const symbol = matched[1].toUpperCase()
  const fields = matched[2].split('~')
  if (fields.length < 50) return null

  const price = toNumber(fields, FIELD.price)
  if (price <= 0) return null

  const previousClose = toNumber(fields, FIELD.previousClose) || price
  const change = toNumber(fields, FIELD.change)
  const changePercent = toNumber(fields, FIELD.changePercent)

  return {
    symbol,
    name: fields[FIELD.name] || fields[FIELD.englishName] || symbol,
    exchange: (fields[FIELD.code] ?? '').split('.').pop() === 'OQ' ? 'NASDAQ' : 'US',
    currency: fields[FIELD.currency] || 'USD',
    price,
    previousClose,
    change: change || price - previousClose,
    changePercent,
    dayHigh: toNumber(fields, FIELD.high) || price,
    dayLow: toNumber(fields, FIELD.low) || price,
    volume: toNumber(fields, FIELD.volume),
    fiftyTwoWeekHigh: toNumber(fields, FIELD.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: toNumber(fields, FIELD.fiftyTwoWeekLow),
    marketTime: easternTimeToEpoch(fields[FIELD.time] ?? ''),
    stale: false
  }
}

export class TencentProvider implements MarketProvider {
  readonly id = 'tencent'
  readonly label = '腾讯财经'
  readonly capabilities = ['quote'] as const

  async getQuote(symbols: string[]): Promise<Quote[]> {
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
    if (unique.length === 0) return []

    // 一次请求拿全部，显著降低被风控的概率
    const quotes: Quote[] = []
    const batchSize = 40
    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize)
      const url = `${BASE}${batch.map((s) => `us${s}`).join(',')}`
      const text = await throttle(() =>
        withRetry(() => fetchText(url, { headers: { Referer: 'https://gu.qq.com/' } }, 12_000, 'gbk'))
      )
      for (const line of text.split('\n')) {
        const quote = parseQuoteLine(line)
        if (quote) quotes.push(quote)
      }
    }

    if (quotes.length === 0) {
      throw new MarketError('腾讯财经未返回任何报价', 'notfound')
    }
    return quotes
  }

  async getCandles(): Promise<Candle[]> {
    throw new MarketError('腾讯财经不提供 K 线能力', 'unsupported')
  }

  async searchSymbols(): Promise<SymbolHit[]> {
    throw new MarketError('腾讯财经不提供搜索能力', 'unsupported')
  }

  async getNews(): Promise<NewsItem[]> {
    throw new MarketError('腾讯财经不提供新闻能力', 'unsupported')
  }
}
