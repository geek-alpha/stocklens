import type { BarInterval, BarRange, Candle, NewsItem, Quote, SymbolHit } from '@shared/types'

export type MarketErrorCode =
  | 'network'
  | 'timeout'
  | 'notfound'
  | 'auth'
  | 'ratelimit'
  | 'unsupported'
  | 'parse'
  | 'unknown'

export class MarketError extends Error {
  readonly code: MarketErrorCode

  constructor(message: string, code: MarketErrorCode = 'unknown') {
    super(message)
    this.name = 'MarketError'
    this.code = code
  }
}

/** 适配器具备的能力：MarketService 按能力组降级链，而不是按数据源整体切换 */
export type MarketCapability = 'quote' | 'candles' | 'search' | 'news'

export interface MarketProvider {
  readonly id: string
  readonly label: string
  readonly capabilities: readonly MarketCapability[]
  getQuote(symbols: string[]): Promise<Quote[]>
  getCandles(symbol: string, interval: BarInterval, range: BarRange): Promise<Candle[]>
  searchSymbols(query: string): Promise<SymbolHit[]>
  getNews(symbol: string): Promise<NewsItem[]>
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function toMarketError(err: unknown, what: string): MarketError {
  if (err instanceof MarketError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (message.toLowerCase().includes('abort')) {
    return new MarketError(`${what}超时`, 'timeout')
  }
  return new MarketError(`${what}失败：${message}`, 'network')
}

async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: '*/*',
        ...(init.headers ?? {})
      },
      signal: ac.signal
    })

    if (res.status === 401 || res.status === 403) {
      throw new MarketError('数据源拒绝了请求（无权限或需要密钥）', 'auth')
    }
    if (res.status === 404) {
      throw new MarketError('标的不存在', 'notfound')
    }
    if (res.status === 429) {
      throw new MarketError('请求过于频繁，请稍后再试', 'ratelimit')
    }
    if (!res.ok) {
      throw new MarketError(`数据源返回 HTTP ${res.status}`, 'network')
    }
    return res
  } catch (err) {
    throw toMarketError(err, '数据源请求')
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000
): Promise<T> {
  const res = await request(url, init, timeoutMs)
  try {
    return (await res.json()) as T
  } catch {
    throw new MarketError('数据源返回内容无法解析', 'parse')
  }
}

/** 部分国内接口（腾讯/新浪）返回 GBK，必须显式解码，否则中文全是乱码 */
export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12_000,
  encoding = 'utf-8'
): Promise<string> {
  const res = await request(url, init, timeoutMs)
  const buffer = await res.arrayBuffer()
  try {
    return new TextDecoder(encoding).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/** 同一数据源的最小请求间隔，避免高频调用被风控掐断（东财实测会直接断 TLS 连接） */
export function createThrottle(minIntervalMs: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let last = 0
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const wait = last + minIntervalMs - Date.now()
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
    last = Date.now()
    return fn()
  }
}

/** 带退避的重试；notfound/auth/unsupported 这类确定性失败不重试 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 400
): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (
        err instanceof MarketError &&
        (err.code === 'notfound' || err.code === 'auth' || err.code === 'unsupported')
      ) {
        break
      }
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)))
      }
    }
  }
  throw lastError
}
