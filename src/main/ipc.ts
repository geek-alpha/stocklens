import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC, IPC_PUSH } from '@shared/ipc'
import type {
  AiAnalyzeRequest,
  AiTask,
  AppInfo,
  AppSettings,
  BarInterval,
  BarRange
} from '@shared/types'
import { AiService } from './ai/client'
import { activateLicense, getLicenseState } from './license'
import { MarketService } from './market'
import { MarketBoardService } from './market/board'
import { getPublicSettings, getSettings, saveSettings } from './store'

const VALID_INTERVALS: BarInterval[] = ['1m', '5m', '15m', '30m', '1h', '1d', '1wk', '1mo']
const VALID_RANGES: BarRange[] = ['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']
const VALID_TASKS: AiTask[] = ['brief', 'technical', 'news', 'screen', 'chat']

/** 渲染进程传来的数值一律夹到合法区间，避免 NaN / 超大值穿透到数据层 */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

/**
 * IPC 路由。渲染进程传来的一切都当作不可信输入，逐项校验后再用。
 */
export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const market = new MarketService(() => getSettings())
  const board = new MarketBoardService()
  const ai = new AiService(() => getSettings(), (chunk) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_PUSH.aiChunk, chunk)
    }
  })

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    packaged: app.isPackaged
  }))

  ipcMain.handle(IPC.settingsGet, (): AppSettings => getPublicSettings())

  ipcMain.handle(IPC.settingsSet, (_event, patch: unknown): AppSettings => {
    if (!patch || typeof patch !== 'object') {
      throw new Error('参数错误：设置内容必须是对象')
    }
    const clean: Partial<AppSettings> = { ...(patch as Partial<AppSettings>) }
    if (clean.refreshIntervalMs !== undefined) {
      const value = Number(clean.refreshIntervalMs)
      clean.refreshIntervalMs = Number.isFinite(value)
        ? Math.min(Math.max(value, 3000), 300_000)
        : 10_000
    }
    if (clean.watchlist !== undefined) {
      if (!Array.isArray(clean.watchlist)) throw new Error('参数错误：自选股必须是数组')
      clean.watchlist = clean.watchlist
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 200)
    }
    return saveSettings(clean)
  })

  ipcMain.handle(IPC.quoteGet, async (_event, symbols: unknown) => {
    if (!Array.isArray(symbols)) throw new Error('参数错误：symbols 必须是数组')
    const list = symbols.filter((s): s is string => typeof s === 'string').slice(0, 120)
    return market.getQuotes(list)
  })

  ipcMain.handle(IPC.candlesGet, async (_event, symbol: unknown, interval: unknown, range: unknown) => {
    if (typeof symbol !== 'string' || !symbol.trim()) throw new Error('参数错误：缺少股票代码')
    if (!VALID_INTERVALS.includes(interval as BarInterval)) throw new Error('参数错误：K 线周期不合法')
    if (!VALID_RANGES.includes(range as BarRange)) throw new Error('参数错误：时间范围不合法')
    return market.getCandles(symbol.trim().toUpperCase(), interval as BarInterval, range as BarRange)
  })

  ipcMain.handle(IPC.searchSymbols, async (_event, query: unknown) => {
    if (typeof query !== 'string') throw new Error('参数错误：搜索关键词必须是字符串')
    return market.searchSymbols(query.slice(0, 60))
  })

  ipcMain.handle(IPC.newsGet, async (_event, symbol: unknown) => {
    if (typeof symbol !== 'string' || !symbol.trim()) throw new Error('参数错误：缺少股票代码')
    return market.getNews(symbol.trim().toUpperCase())
  })

  ipcMain.handle(IPC.boardGet, async (_event, force: unknown) => board.getBoard(force === true))

  ipcMain.handle(IPC.sectorTrend, async (_event, code: unknown, days: unknown) => {
    if (typeof code !== 'string' || !code.trim()) throw new Error('参数错误：缺少板块代码')
    return board.getSectorTrend(code.trim().slice(0, 40), clampInt(days, 2, 250, 60))
  })

  ipcMain.handle(IPC.rotationGet, async (_event, limit: unknown, days: unknown) =>
    board.getRotation(clampInt(limit, 5, 100, 20), clampInt(days, 2, 250, 20))
  )

  ipcMain.handle(IPC.licenseGet, () => getLicenseState())

  ipcMain.handle(IPC.licenseActivate, (_event, key: unknown, licensee: unknown) => {
    if (typeof key !== 'string' || !key.trim()) throw new Error('请输入许可证密钥')
    return activateLicense(key, typeof licensee === 'string' ? licensee : '')
  })

  ipcMain.handle(IPC.aiAnalyze, async (_event, req: unknown) => {
    if (!req || typeof req !== 'object') throw new Error('参数错误：AI 请求体不合法')
    const request = req as AiAnalyzeRequest
    if (typeof request.requestId !== 'string' || !request.requestId) {
      throw new Error('参数错误：缺少 requestId')
    }
    if (!VALID_TASKS.includes(request.task)) {
      throw new Error('参数错误：未知的 AI 任务类型')
    }
    return ai.analyze({
      ...request,
      prompt: typeof request.prompt === 'string' ? request.prompt.slice(0, 8000) : undefined,
      history: Array.isArray(request.history) ? request.history.slice(-20) : undefined
    })
  })

  ipcMain.handle(IPC.aiCancel, (_event, requestId: unknown) => {
    if (typeof requestId === 'string') ai.cancel(requestId)
  })

  app.on('before-quit', () => ai.cancelAll())
}
