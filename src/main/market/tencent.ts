import type { Candle, IndexQuote, MarketRegion, NewsItem, Quote, SymbolHit } from '@shared/types'
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

/**
 * 全球主要指数。腾讯变量名前缀即市场归属，实测有效的只有沪深/香港/美国三地：
 * 日经与欧洲指数的代码（jpNI225 / ukFTSE / deDAX / frCAC / krKOSPI / auXJO）
 * 一律返回 v_pv_none_match，即该源不提供，不要凭想象往清单里加。
 */
export const GLOBAL_INDICES: ReadonlyArray<{
  symbol: string
  name: string
  region: MarketRegion
}> = [
  { symbol: 'sh000001', name: '上证指数', region: 'CN' },
  { symbol: 'sz399001', name: '深证成指', region: 'CN' },
  { symbol: 'sz399006', name: '创业板指', region: 'CN' },
  { symbol: 'sh000688', name: '科创50', region: 'CN' },
  { symbol: 'sh000300', name: '沪深300', region: 'CN' },
  { symbol: 'sz399005', name: '中小100', region: 'CN' },
  { symbol: 'hkHSI', name: '恒生指数', region: 'HK' },
  { symbol: 'hkHSTECH', name: '恒生科技指数', region: 'HK' },
  { symbol: 'hkHSCEI', name: '国企指数', region: 'HK' },
  { symbol: 'usDJI', name: '道琼斯', region: 'US' },
  { symbol: 'usIXIC', name: '纳斯达克', region: 'US' },
  { symbol: 'usINX', name: '标普500', region: 'US' }
]

/** 实测单次请求超过 12 个代码会被静默截断（第 13 个起不返回），指数与个股都受此限制 */
export const TENCENT_BATCH_SIZE = 12

const PREFIX_REGION: Record<string, MarketRegion> = {
  sh: 'CN',
  sz: 'CN',
  hk: 'HK',
  us: 'US'
}

/**
 * 指数时间实测有三种格式，猜错时区会让「最新交易日」错一天，进而让快照写到错误日期：
 *   沪深 20260924161401（北京时间）
 *   港股 2026/09/25 18:31:13（北京时间）
 *   美股 2026-09-25 17:05:01（美东时间，无时区标记）
 */
function indexTimeToEpoch(value: string, region: MarketRegion): number {
  const trimmed = value.trim()
  const fallback = Math.floor(Date.now() / 1000)

  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)
  if (compact) {
    const parsed = Date.parse(
      `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}+08:00`
    )
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback
  }

  const slashed = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}:\d{2})$/)
  if (slashed) {
    const parsed = Date.parse(`${slashed[1]}-${slashed[2]}-${slashed[3]}T${slashed[4]}+08:00`)
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback
  }

  return region === 'US' ? easternTimeToEpoch(trimmed) : fallback
}

function parseIndexLine(line: string): IndexQuote | null {
  const matched = line.match(/v_([a-z]{2})([A-Za-z0-9.\-]+)="([^"]*)"/)
  if (!matched) return null

  const fields = matched[3].split('~')
  if (fields.length < 36) return null

  const price = toNumber(fields, FIELD.price)
  if (price <= 0) return null

  const region = PREFIX_REGION[matched[1]] ?? 'OTHER'
  const previousClose = toNumber(fields, FIELD.previousClose) || price
  const change = toNumber(fields, FIELD.change)

  // 成交额单位：沪深/港股是万元；美股同位置的数值口径无法确认，宁可为 0 也不编造单位
  const rawAmount = toNumber(fields, FIELD.amount)
  const amount = region === 'CN' || region === 'HK' ? rawAmount * 10_000 : 0

  return {
    symbol: `${matched[1]}${matched[2]}`,
    name: fields[FIELD.name] || `${matched[1]}${matched[2]}`,
    region,
    price,
    previousClose,
    change: change || price - previousClose,
    changePercent: toNumber(fields, FIELD.changePercent),
    amount,
    marketTime: indexTimeToEpoch(fields[FIELD.time] ?? '', region),
    stale: false
  }
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

  /**
   * 指数报价。与个股共用同一接口，但变量名前缀是市场代码而不是 us，
   * 所以必须走独立正则——parseQuoteLine 写死了 /v_us/，A股/港股会被整条丢弃。
   */
  async getIndices(symbols: readonly string[] = GLOBAL_INDICES.map((i) => i.symbol)): Promise<
    IndexQuote[]
  > {
    if (symbols.length === 0) return []

    const quotes: IndexQuote[] = []
    for (let i = 0; i < symbols.length; i += TENCENT_BATCH_SIZE) {
      const batch = symbols.slice(i, i + TENCENT_BATCH_SIZE)
      const url = `${BASE}${batch.join(',')}`
      const text = await throttle(() =>
        withRetry(() => fetchText(url, { headers: { Referer: 'https://gu.qq.com/' } }, 12_000, 'gbk'))
      )
      for (const line of text.split('\n')) {
        const quote = parseIndexLine(line)
        if (quote) quotes.push(quote)
      }
    }

    if (quotes.length === 0) {
      throw new MarketError('腾讯财经未返回任何指数行情', 'notfound')
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
