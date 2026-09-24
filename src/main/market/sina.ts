import type { Candle, NewsItem, Quote, SymbolHit } from '@shared/types'
import { createThrottle, fetchText, MarketError, withRetry, type MarketProvider } from './types'

/**
 * 新浪财经报价：作为腾讯之外的第二个国内报价源。
 * 返回 GBK 文本，字段位置见 FIELD；时间戳字段是美东时间字符串。
 */

const BASE = 'https://hq.sinajs.cn/list='

const FIELD = {
  name: 0,
  price: 1,
  changePercent: 2,
  time: 3,
  change: 4,
  open: 5,
  high: 6,
  low: 7,
  fiftyTwoWeekHigh: 8,
  fiftyTwoWeekLow: 9,
  volume: 10,
  marketCap: 12,
  previousClose: 26
} as const

const throttle = createThrottle(220)

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

function parseLine(line: string): Quote | null {
  const matched = line.match(/hq_str_gb_([a-z0-9.\-]+)="([^"]*)"/i)
  if (!matched) return null

  const symbol = matched[1].toUpperCase()
  const fields = matched[2].split(',')
  if (fields.length < 27) return null

  const price = toNumber(fields, FIELD.price)
  if (price <= 0) return null

  const previousClose = toNumber(fields, FIELD.previousClose) || price
  const change = toNumber(fields, FIELD.change)

  return {
    symbol,
    name: fields[FIELD.name] || symbol,
    exchange: 'US',
    currency: 'USD',
    price,
    previousClose,
    change: change || price - previousClose,
    changePercent: toNumber(fields, FIELD.changePercent),
    dayHigh: toNumber(fields, FIELD.high) || price,
    dayLow: toNumber(fields, FIELD.low) || price,
    volume: toNumber(fields, FIELD.volume),
    fiftyTwoWeekHigh: toNumber(fields, FIELD.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: toNumber(fields, FIELD.fiftyTwoWeekLow),
    marketTime: easternTimeToEpoch(fields[FIELD.time] ?? ''),
    stale: false
  }
}

export class SinaProvider implements MarketProvider {
  readonly id = 'sina'
  readonly label = '新浪财经'
  readonly capabilities: MarketProvider['capabilities'] = ['quote']

  async getQuote(symbols: string[]): Promise<Quote[]> {
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
    if (unique.length === 0) return []

    const url = `${BASE}${unique.map((s) => `gb_${s.toLowerCase()}`).join(',')}`
    const text = await throttle(() =>
      withRetry(() =>
        fetchText(url, { headers: { Referer: 'https://finance.sina.com.cn' } }, 12_000, 'gbk')
      )
    )

    const quotes: Quote[] = []
    for (const line of text.split('\n')) {
      const quote = parseLine(line)
      if (quote) quotes.push(quote)
    }

    if (quotes.length === 0) {
      throw new MarketError('新浪财经未返回任何报价', 'notfound')
    }
    return quotes
  }

  async getCandles(): Promise<Candle[]> {
    throw new MarketError('新浪财经不提供 K 线能力', 'unsupported')
  }

  async searchSymbols(): Promise<SymbolHit[]> {
    throw new MarketError('新浪财经不提供搜索能力', 'unsupported')
  }

  async getNews(): Promise<NewsItem[]> {
    throw new MarketError('新浪财经不提供新闻能力', 'unsupported')
  }
}
