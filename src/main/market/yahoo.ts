import type { BarInterval, BarRange, Candle, NewsItem, Quote, SymbolHit } from '@shared/types'
import { fetchJson, MarketError, withRetry, type MarketProvider } from './types'

/**
 * Yahoo Finance 适配器：免 API Key，K 线数据质量好，作为默认数据源与兜底源。
 * 报价走 chart 接口的 meta 字段，避开需要 crumb/cookie 的 /v7/quote 接口。
 */

const BASE = 'https://query1.finance.yahoo.com'

const INTERVAL_MAP: Record<BarInterval, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '60m',
  '1d': '1d',
  '1wk': '1wk',
  '1mo': '1mo'
}

interface YahooMeta {
  symbol?: string
  currency?: string
  exchangeName?: string
  fullExchangeName?: string
  longName?: string
  shortName?: string
  regularMarketPrice?: number
  regularMarketTime?: number
  regularMarketDayHigh?: number
  regularMarketDayLow?: number
  regularMarketVolume?: number
  chartPreviousClose?: number
  previousClose?: number
  fiftyTwoWeekHigh?: number
  fiftyTwoWeekLow?: number
}

interface YahooChartResponse {
  chart?: {
    error?: { code?: string; description?: string } | null
    result?: Array<{
      meta?: YahooMeta
      timestamp?: number[]
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>
          high?: Array<number | null>
          low?: Array<number | null>
          close?: Array<number | null>
          volume?: Array<number | null>
        }>
      }
    }>
  }
}

interface YahooQuoteHit {
  symbol?: string
  longname?: string
  shortname?: string
  exchDisp?: string
  exchange?: string
  quoteType?: string
  typeDisp?: string
}

interface YahooNewsHit {
  uuid?: string
  title?: string
  publisher?: string
  link?: string
  providerPublishTime?: number
}

interface YahooSearchResponse {
  quotes?: YahooQuoteHit[]
  news?: YahooNewsHit[]
}

async function chartRequest(
  symbol: string,
  interval: string,
  range: string
): Promise<YahooChartResponse> {
  const url =
    `${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=false&events=div%2Csplit`
  const data = await fetchJson<YahooChartResponse>(url)
  const error = data.chart?.error
  if (error) {
    throw new MarketError(error.description ?? `行情源错误：${error.code ?? 'unknown'}`, 'notfound')
  }
  return data
}

function parseCandles(res: YahooChartResponse): Candle[] {
  const result = res.chart?.result?.[0]
  const quote = result?.indicators?.quote?.[0]
  if (!result?.timestamp || !quote) return []

  const candles: Candle[] = []
  for (let i = 0; i < result.timestamp.length; i += 1) {
    const open = quote.open?.[i]
    const high = quote.high?.[i]
    const low = quote.low?.[i]
    const close = quote.close?.[i]
    if (open == null || high == null || low == null || close == null) continue
    candles.push({
      time: result.timestamp[i],
      open,
      high,
      low,
      close,
      volume: quote.volume?.[i] ?? 0
    })
  }
  return candles
}

function parseQuote(symbol: string, res: YahooChartResponse): Quote {
  const meta = res.chart?.result?.[0]?.meta
  if (!meta) {
    throw new MarketError(`未获取到 ${symbol} 的报价`, 'notfound')
  }
  const price = meta.regularMarketPrice ?? 0
  const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? price
  const change = price - previousClose
  return {
    symbol: meta.symbol ?? symbol,
    name: meta.longName ?? meta.shortName ?? meta.symbol ?? symbol,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
    currency: meta.currency ?? 'USD',
    price,
    previousClose,
    change,
    changePercent: previousClose ? (change / previousClose) * 100 : 0,
    dayHigh: meta.regularMarketDayHigh ?? price,
    dayLow: meta.regularMarketDayLow ?? price,
    volume: meta.regularMarketVolume ?? 0,
    fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? 0,
    fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? 0,
    marketTime: meta.regularMarketTime ?? Math.floor(Date.now() / 1000),
    stale: false
  }
}

export class YahooProvider implements MarketProvider {
  readonly id = 'yahoo'
  readonly label = 'Yahoo Finance'
  readonly capabilities: MarketProvider['capabilities'] = ['quote', 'candles', 'search', 'news']

  async getQuote(symbols: string[]): Promise<Quote[]> {
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]
    const quotes: Quote[] = []

    // Yahoo 对并发很敏感，分批 + 退避重试，避免整批被 429
    const batchSize = 4
    for (let i = 0; i < unique.length; i += batchSize) {
      const batch = unique.slice(i, i + batchSize)
      const results = await Promise.all(
        batch.map(async (symbol) => {
          try {
            const res = await withRetry(() => chartRequest(symbol, '1d', '1d'), 2, 600)
            return parseQuote(symbol, res)
          } catch {
            return null
          }
        })
      )
      quotes.push(...results.filter((q): q is Quote => q !== null))
    }

    if (quotes.length === 0) {
      throw new MarketError('Yahoo 未返回任何报价（可能被限流）', 'ratelimit')
    }

    return quotes
  }

  async getCandles(symbol: string, interval: BarInterval, range: BarRange): Promise<Candle[]> {
    const res = await chartRequest(symbol, INTERVAL_MAP[interval], range)
    return parseCandles(res)
  }

  async searchSymbols(query: string): Promise<SymbolHit[]> {
    const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(
      query
    )}&quotesCount=12&newsCount=0&listsCount=0`
    const data = await fetchJson<YahooSearchResponse>(url)
    return (data.quotes ?? [])
      .filter((hit) => Boolean(hit.symbol))
      .map((hit) => ({
        symbol: hit.symbol as string,
        name: hit.longname ?? hit.shortname ?? (hit.symbol as string),
        exchange: hit.exchDisp ?? hit.exchange ?? '',
        type: hit.quoteType ?? hit.typeDisp ?? ''
      }))
  }

  async getNews(symbol: string): Promise<NewsItem[]> {
    const url = `${BASE}/v1/finance/search?q=${encodeURIComponent(
      symbol
    )}&quotesCount=0&newsCount=15&listsCount=0`
    const data = await fetchJson<YahooSearchResponse>(url)
    return (data.news ?? []).map((item) => ({
      id: item.uuid ?? item.link ?? item.title ?? '',
      title: item.title ?? '',
      publisher: item.publisher ?? '',
      link: item.link ?? '',
      publishedAt: item.providerPublishTime ?? 0,
      summary: ''
    }))
  }
}
