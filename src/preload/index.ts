import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { StockLensApi } from '@shared/api'
import { IPC, IPC_PUSH } from '@shared/ipc'
import type { AiStreamChunk } from '@shared/types'

/**
 * 渲染进程与主进程之间唯一的通道。
 * 这里只做转发，不含业务逻辑；所有输入校验都在主进程侧再做一遍。
 */

/** Electron 会给跨进程异常加上 "Error invoking remote method 'x':" 前缀，这里剥掉，让界面能直接显示 */
function cleanErrorMessage(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err)
  const matched = raw.match(/Error:\s*([\s\S]+)$/)
  return new Error(matched ? matched[1].trim() : raw)
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (err) {
    throw cleanErrorMessage(err)
  }
}

const api: StockLensApi = {
  getAppInfo: () => invoke(IPC.appInfo),

  getSettings: () => invoke(IPC.settingsGet),
  saveSettings: (patch) => invoke(IPC.settingsSet, patch),

  getQuote: (symbols) => invoke(IPC.quoteGet, symbols),
  getCandles: (symbol, interval, range) => invoke(IPC.candlesGet, symbol, interval, range),
  searchSymbols: (query) => invoke(IPC.searchSymbols, query),
  getNews: (symbol) => invoke(IPC.newsGet, symbol),

  getBoard: (force) => invoke(IPC.boardGet, force),
  getSectorTrend: (code, days) => invoke(IPC.sectorTrend, code, days),
  getRotation: (limit, days) => invoke(IPC.rotationGet, limit, days),

  getLicense: () => invoke(IPC.licenseGet),
  activateLicense: (key, licensee) => invoke(IPC.licenseActivate, key, licensee),

  aiAnalyze: (req) => invoke(IPC.aiAnalyze, req),
  aiCancel: (requestId) => invoke(IPC.aiCancel, requestId),

  onAiChunk: (handler) => {
    const listener = (_event: IpcRendererEvent, chunk: AiStreamChunk): void => handler(chunk)
    ipcRenderer.on(IPC_PUSH.aiChunk, listener)
    return () => {
      ipcRenderer.removeListener(IPC_PUSH.aiChunk, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
