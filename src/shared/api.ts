import type {
  AiAnalyzeRequest,
  AiResult,
  AiStreamChunk,
  AppInfo,
  AppSettings,
  BarInterval,
  BarRange,
  CandleSeries,
  LicenseState,
  NewsItem,
  Quote,
  SymbolHit
} from './types'

/**
 * preload 通过 contextBridge 暴露给渲染进程的全部能力。
 * 渲染进程拿不到任何 Node / Electron 原生对象，也拿不到明文 API Key。
 */
export interface StockLensApi {
  getAppInfo(): Promise<AppInfo>

  getSettings(): Promise<AppSettings>
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>

  getQuote(symbols: string[]): Promise<Quote[]>
  getCandles(symbol: string, interval: BarInterval, range: BarRange): Promise<CandleSeries>
  searchSymbols(query: string): Promise<SymbolHit[]>
  getNews(symbol: string): Promise<NewsItem[]>

  getLicense(): Promise<LicenseState>
  activateLicense(key: string, licensee: string): Promise<LicenseState>

  aiAnalyze(req: AiAnalyzeRequest): Promise<AiResult>
  aiCancel(requestId: string): Promise<void>
  /** 订阅 AI 流式输出，返回取消订阅函数 */
  onAiChunk(handler: (chunk: AiStreamChunk) => void): () => void
}
