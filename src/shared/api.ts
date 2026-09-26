import type {
  AiAnalyzeRequest,
  AiConnectionCheck,
  AiConfig,
  AiResult,
  AiStreamChunk,
  AppInfo,
  AppSettings,
  BarInterval,
  BarRange,
  CandleSeries,
  LicenseState,
  MarketBoard,
  NewsItem,
  Quote,
  SectorRotation,
  SectorTrendPoint,
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

  /** 市场看板：全球指数 + A股板块快照，60 秒内复用同一份 */
  getBoard(force?: boolean): Promise<MarketBoard>
  /** 单个板块的相对强度轨迹；历史不足时返回空数组，别当成「该板块没数据」 */
  getSectorTrend(code: string, days?: number): Promise<SectorTrendPoint[]>
  /** 产业轮动排行，按近 N 日相对强度累计 */
  getRotation(limit?: number, days?: number): Promise<SectorRotation>

  getLicense(): Promise<LicenseState>
  activateLicense(key: string, licensee: string): Promise<LicenseState>

  /** AI 连通性自检：验证 Key / Base URL / 模型能否真的跑通；可带未保存的草稿 */
  aiTest(draft?: Partial<AiConfig>): Promise<AiConnectionCheck>

  aiAnalyze(req: AiAnalyzeRequest): Promise<AiResult>
  aiCancel(requestId: string): Promise<void>
  /** 订阅 AI 流式输出，返回取消订阅函数 */
  onAiChunk(handler: (chunk: AiStreamChunk) => void): () => void
}
