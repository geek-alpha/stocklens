/**
 * 主进程与渲染进程共享的类型契约。
 * 这里是唯一的真相来源：改这里，两侧同时红。
 */

export type BarInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo'

export type BarRange =
  | '1d'
  | '5d'
  | '1mo'
  | '3mo'
  | '6mo'
  | '1y'
  | '2y'
  | '5y'
  | '10y'
  | 'max'

export interface Candle {
  /** epoch 秒，lightweight-charts 的 time 口径 */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Quote {
  symbol: string
  name: string
  exchange: string
  currency: string
  price: number
  previousClose: number
  change: number
  changePercent: number
  dayHigh: number
  dayLow: number
  volume: number
  fiftyTwoWeekHigh: number
  fiftyTwoWeekLow: number
  /** 交易所最新成交时间，epoch 秒 */
  marketTime: number
  /** 数据源降级标记：拿到的是缓存/上一次成功值 */
  stale: boolean
}

export interface SymbolHit {
  symbol: string
  name: string
  exchange: string
  type: string
}

export interface NewsItem {
  id: string
  title: string
  publisher: string
  link: string
  publishedAt: number
  summary: string
}

export interface CandleSeries {
  symbol: string
  interval: BarInterval
  range: BarRange
  candles: Candle[]
  source: string
}

export type AiProviderKind = 'openai' | 'deepseek' | 'moonshot' | 'custom'

export interface AiConfig {
  kind: AiProviderKind
  baseUrl: string
  /** 明文仅存在于主进程；渲染层读到的是掩码串 */
  apiKey: string
  model: string
  temperature: number
}

export interface AppSettings {
  /** auto=国内直连优先（腾讯/东财）并自动降级；yahoo/finnhub=指定源优先 */
  dataProvider: 'auto' | 'yahoo' | 'finnhub'
  finnhubKey: string
  refreshIntervalMs: number
  theme: 'dark' | 'light'
  language: 'zh' | 'en'
  watchlist: string[]
  ai: AiConfig
}

export interface LicenseState {
  status: 'unactivated' | 'active' | 'expired' | 'invalid'
  plan: 'trial' | 'pro' | 'lifetime'
  licensee: string
  expiresAt: number | null
  daysLeft: number | null
  /** 本机机器码，用于一机一码激活 */
  machineCode: string
}

export interface AppInfo {
  version: string
  electron: string
  node: string
  platform: string
  packaged: boolean
}

export type AiTask = 'brief' | 'technical' | 'news' | 'screen' | 'chat'

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiAnalyzeRequest {
  /** 每次请求唯一 id，用于取消与流式对齐 */
  requestId: string
  task: AiTask
  symbol?: string
  prompt?: string
  history?: AiChatMessage[]
  /** 结构化上下文：行情快照、K线摘要等，由主进程序列化给模型 */
  context?: AiContextPayload
}

export interface AiContextPayload {
  quote?: Quote
  candles?: Candle[]
  news?: NewsItem[]
  watchlistQuotes?: Quote[]
}

export interface AiStreamChunk {
  requestId: string
  delta: string
  done: boolean
  error?: string
}

export interface AiResult {
  requestId: string
  ok: boolean
  error?: string
}
