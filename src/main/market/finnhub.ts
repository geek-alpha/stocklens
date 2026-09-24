import type { Candle, NewsItem, Quote, SymbolHit } from '@shared/types'
import { fetchJson, MarketError, type MarketProvider } from './types'

/**
 * Finnhub 适配器：报价与新闻质量高，但免费套餐不含 K 线，
 * 因此 supportsCandles=false，由 MarketService 自动回落到 Yahoo。
 */

const BASE = 'https://finnhub.io/api/v1'

interface FinnhubQuote {
  c: number
  d: number
  dp: number
  h: number
  l: number
  o: number
  pc: number
  t: number
}

interface FinnhubSearchResponse {
  result?: Array<{
    symbol?: string
    displaySymbol?: string
    description?: string
    type?: string
  }>
}

interface FinnhubNewsItem {
  id?: number
  headline?: string
  source?: string
  url?: string
  datetime?: number
  summary?: string
}

export class FinnhubProvider implements MarketProvider {
  readonly id = 'finnhub'
  readonly label = 'Finnhub（需 API Key）'
  readonly capabilities: MarketProvider['capabilities'] = ['quote', 'search', 'news']

  constructor(private readonly apiKey: () => string) {}

  private token(): string {
    const key = this.apiKey().trim()
    if (!key) {
      throw new MarketError('尚未配置 Finnhub API Key，请到设置里填写', 'auth')
    }
    return key
  }

  async getQuote(symbols: string[]): Promise<Quote[]> {
    const token = this.token()
    const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]

    const results = await Promise.all(
      unique.map(async (symbol): Promise<Quote | null> => {
        const url = `${BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`
        const q = await fetchJson<FinnhubQuote>(url)
        if (!q || typeof q.c !== 'number' || q.c === 0) return null
        const previousClose = q.pc || q.c
        const change = typeof q.d === 'number' ? q.d : q.c - previousClose
        return {
          symbol,
          name: symbol,
          exchange: '',
          currency: 'USD',
          price: q.c,
          previousClose,
          change,
          changePercent: typeof q.dp === 'number' ? q.dp : previousClose ? (change / previousClose) * 100 : 0,
          dayHigh: q.h ?? q.c,
          dayLow: q.l ?? q.c,
          volume: 0,
          fiftyTwoWeekHigh: 0,
          fiftyTwoWeekLow: 0,
          marketTime: q.t || Math.floor(Date.now() / 1000),
          stale: false
        }
      })
    )

    return results.filter((q): q is Quote => q !== null)
  }

  async getCandles(): Promise<Candle[]> {
    throw new MarketError('Finnhub 免费套餐不含 K 线数据，K 线已由东方财富/Yahoo 承担', 'unsupported')
  }

  async searchSymbols(query: string): Promise<SymbolHit[]> {
    const token = this.token()
    const url = `${BASE}/search?q=${encodeURIComponent(query)}&token=${encodeURIComponent(token)}`
    const data = await fetchJson<FinnhubSearchResponse>(url)
    return (data.result ?? [])
      .filter((hit) => Boolean(hit.symbol))
      .slice(0, 12)
      .map((hit) => ({
        symbol: hit.displaySymbol ?? hit.symbol ?? '',
        name: hit.description ?? hit.symbol ?? '',
        exchange: '',
        type: hit.type ?? ''
      }))
  }

  async getNews(symbol: string): Promise<NewsItem[]> {
    const token = this.token()
    const to = new Date()
    const from = new Date(to.getTime() - 14 * 24 * 3600 * 1000)
    const fmt = (d: Date): string => d.toISOString().slice(0, 10)
    const url =
      `${BASE}/company-news?symbol=${encodeURIComponent(symbol)}` +
      `&from=${fmt(from)}&to=${fmt(to)}&token=${encodeURIComponent(token)}`
    const data = await fetchJson<FinnhubNewsItem[]>(url)
    return (Array.isArray(data) ? data : []).slice(0, 15).map((item) => ({
      id: String(item.id ?? item.url ?? item.headline ?? ''),
      title: item.headline ?? '',
      publisher: item.source ?? '',
      link: item.url ?? '',
      publishedAt: item.datetime ?? 0,
      summary: item.summary ?? ''
    }))
  }
}
