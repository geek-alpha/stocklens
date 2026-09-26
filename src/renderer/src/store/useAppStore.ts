import { create } from 'zustand'
import type {
  AiChatMessage,
  AiStreamChunk,
  AiTask,
  AppInfo,
  AppSettings,
  BarInterval,
  BarRange,
  Candle,
  LicenseState,
  MarketBoard,
  Quote,
  SectorRotation
} from '@shared/types'
import { api, errorMessage, newRequestId } from '@renderer/lib/api'

export interface AiMessage {
  id: string
  requestId?: string
  role: 'user' | 'assistant'
  content: string
  task?: AiTask
  streaming?: boolean
  error?: string
}

export interface Toast {
  kind: 'error' | 'info'
  message: string
}

export const TASK_LABELS: Record<AiTask, string> = {
  brief: '盘面速读',
  technical: '技术面分析',
  news: '新闻解读',
  screen: '智能选股',
  rotation: '产业轮动研判',
  chat: '自由对话'
}

interface AppState {
  ready: boolean
  settings: AppSettings | null
  appInfo: AppInfo | null
  license: LicenseState | null
  quotes: Record<string, Quote>
  activeSymbol: string
  candles: Candle[]
  candleSource: string
  interval: BarInterval
  range: BarRange
  refreshing: boolean
  loadingCandles: boolean
  toast: Toast | null
  aiMessages: AiMessage[]
  aiStreaming: boolean
  activeRequestId: string | null
  settingsOpen: boolean
  licenseOpen: boolean
  sidebarOpen: boolean
  aiPanelOpen: boolean
  /** stock=个股看盘，board=市场看板 */
  activeView: 'stock' | 'board'
  board: MarketBoard | null
  rotation: SectorRotation | null
  boardLoading: boolean

  bootstrap: () => Promise<void>
  refreshQuotes: () => Promise<void>
  loadCandles: () => Promise<void>
  selectSymbol: (symbol: string) => Promise<void>
  changeInterval: (interval: BarInterval, range: BarRange) => Promise<void>
  addSymbol: (symbol: string) => Promise<void>
  removeSymbol: (symbol: string) => Promise<void>
  persistSettings: (patch: Partial<AppSettings>) => Promise<void>
  setToast: (toast: Toast | null) => void
  setSettingsOpen: (open: boolean) => void
  setLicenseOpen: (open: boolean) => void
  toggleSidebar: () => void
  toggleAiPanel: () => void
  setView: (view: 'stock' | 'board') => void
  refreshBoard: (force?: boolean) => Promise<void>
  refreshLicense: () => Promise<void>
  runAi: (task: AiTask, prompt?: string) => Promise<void>
  stopAi: () => void
  applyAiChunk: (chunk: AiStreamChunk) => void
  clearAi: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  settings: null,
  appInfo: null,
  license: null,
  quotes: {},
  activeSymbol: 'AAPL',
  candles: [],
  candleSource: '',
  interval: '1d',
  range: '6mo',
  refreshing: false,
  loadingCandles: false,
  toast: null,
  aiMessages: [],
  aiStreaming: false,
  activeRequestId: null,
  settingsOpen: false,
  licenseOpen: false,
  sidebarOpen: true,
  aiPanelOpen: true,
  activeView: 'stock',
  board: null,
  rotation: null,
  boardLoading: false,

  bootstrap: async () => {
    try {
      const [settings, appInfo, license] = await Promise.all([
        api.getSettings(),
        api.getAppInfo(),
        api.getLicense()
      ])
      const watchlist = settings.watchlist ?? []
      set({
        settings,
        appInfo,
        license,
        activeSymbol: watchlist[0] ?? 'AAPL',
        ready: true
      })
      await get().refreshQuotes()
      await get().loadCandles()
    } catch (err) {
      set({ ready: true })
      get().setToast({ kind: 'error', message: errorMessage(err) })
    }
  },

  refreshQuotes: async () => {
    const { settings } = get()
    const symbols = settings?.watchlist ?? []
    if (symbols.length === 0) return
    set({ refreshing: true })
    try {
      const quotes = await api.getQuote(symbols)
      const merged: Record<string, Quote> = { ...get().quotes }
      quotes.forEach((quote) => {
        merged[quote.symbol] = quote
      })
      set({ quotes: merged })
    } catch (err) {
      get().setToast({ kind: 'error', message: `行情刷新失败：${errorMessage(err)}` })
    } finally {
      set({ refreshing: false })
    }
  },

  loadCandles: async () => {
    const { activeSymbol, interval, range } = get()
    if (!activeSymbol) return
    set({ loadingCandles: true })
    try {
      const series = await api.getCandles(activeSymbol, interval, range)
      set({ candles: series.candles, candleSource: series.source })
    } catch (err) {
      set({ candles: [] })
      get().setToast({ kind: 'error', message: `K 线加载失败：${errorMessage(err)}` })
    } finally {
      set({ loadingCandles: false })
    }
  },

  selectSymbol: async (symbol: string) => {
    const clean = symbol.trim().toUpperCase()
    if (!clean || clean === get().activeSymbol) return
    set({ activeSymbol: clean, candles: [] })
    await Promise.all([get().refreshQuotes(), get().loadCandles()])
  },

  changeInterval: async (interval: BarInterval, range: BarRange) => {
    set({ interval, range })
    await get().loadCandles()
  },

  addSymbol: async (symbol: string) => {
    const clean = symbol.trim().toUpperCase()
    if (!clean) return
    const settings = get().settings
    if (!settings) return
    if (settings.watchlist.includes(clean)) {
      get().setToast({ kind: 'info', message: `${clean} 已在自选列表中` })
      return
    }
    await get().persistSettings({ watchlist: [...settings.watchlist, clean] })
    await get().refreshQuotes()
  },

  removeSymbol: async (symbol: string) => {
    const settings = get().settings
    if (!settings) return
    const watchlist = settings.watchlist.filter((s) => s !== symbol)
    await get().persistSettings({ watchlist })
    const quotes = { ...get().quotes }
    delete quotes[symbol]
    set({ quotes })
    if (get().activeSymbol === symbol) {
      const next = watchlist[0] ?? ''
      set({ activeSymbol: next, candles: [] })
      if (next) await get().loadCandles()
    }
  },

  persistSettings: async (patch: Partial<AppSettings>) => {
    try {
      const settings = await api.saveSettings(patch)
      set({ settings })
    } catch (err) {
      get().setToast({ kind: 'error', message: `设置保存失败：${errorMessage(err)}` })
    }
  },

  setToast: (toast) => set({ toast }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setLicenseOpen: (open) => set({ licenseOpen: open }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleAiPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),

  setView: (view) => {
    set({ activeView: view })
    // 只在首次切到看板时自动拉，之后靠手动刷新，免得来回切视图反复打接口
    if (view === 'board' && !get().board) void get().refreshBoard()
  },

  refreshBoard: async (force = false) => {
    if (get().boardLoading) return
    set({ boardLoading: true })
    try {
      // 轮动列表取 10 条：看板同时要展示板块全景，取太多会把表格挤出视口
      const [board, rotation] = await Promise.all([api.getBoard(force), api.getRotation(10, 20)])
      set({ board, rotation })
    } catch (err) {
      get().setToast({ kind: 'error', message: `市场看板加载失败：${errorMessage(err)}` })
    } finally {
      set({ boardLoading: false })
    }
  },

  refreshLicense: async () => {
    try {
      set({ license: await api.getLicense() })
    } catch (err) {
      get().setToast({ kind: 'error', message: errorMessage(err) })
    }
  },

  runAi: async (task: AiTask, prompt?: string) => {
    if (get().aiStreaming) {
      get().setToast({ kind: 'info', message: '上一轮分析还在生成中' })
      return
    }

    const { activeSymbol, candles, quotes, activeView } = get()
    const requestId = newRequestId()
    const assistantId = newRequestId()
    const userText = prompt?.trim() || TASK_LABELS[task]

    const history: AiChatMessage[] = get()
      .aiMessages.filter((m) => !m.error && m.content.trim())
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }))

    set((state) => ({
      aiMessages: [
        ...state.aiMessages,
        { id: newRequestId(), role: 'user', content: userText, task },
        { id: assistantId, requestId, role: 'assistant', content: '', task, streaming: true }
      ],
      aiStreaming: true,
      activeRequestId: requestId,
      aiPanelOpen: true
    }))

    try {
      const result = await api.aiAnalyze({
        requestId,
        task,
        symbol: activeSymbol,
        prompt,
        history,
        // 看板视图下随口问「什么产业在崛起」也得答得出来；其余场景不带，省 token
        includeBoard: task === 'rotation' || activeView === 'board',
        context: {
          quote: quotes[activeSymbol],
          candles,
          watchlistQuotes: Object.values(quotes)
        }
      })
      if (!result.ok && result.error) {
        set((state) => ({
          aiMessages: state.aiMessages.map((m) =>
            m.id === assistantId ? { ...m, error: result.error, streaming: false } : m
          )
        }))
      }
    } catch (err) {
      set((state) => ({
        aiMessages: state.aiMessages.map((m) =>
          m.id === assistantId ? { ...m, error: errorMessage(err), streaming: false } : m
        )
      }))
    } finally {
      set({ aiStreaming: false, activeRequestId: null })
    }
  },

  stopAi: () => {
    const requestId = get().activeRequestId
    if (requestId) {
      void api.aiCancel(requestId)
    }
    set((state) => ({
      aiStreaming: false,
      activeRequestId: null,
      aiMessages: state.aiMessages.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    }))
  },

  applyAiChunk: (chunk) => {
    set((state) => {
      const index = state.aiMessages.findIndex(
        (m) => m.requestId === chunk.requestId && m.role === 'assistant'
      )
      if (index === -1) return state

      const messages = [...state.aiMessages]
      const target = { ...messages[index] }
      if (chunk.delta) target.content += chunk.delta
      if (chunk.done) {
        target.streaming = false
        if (chunk.error) target.error = chunk.error
      }
      messages[index] = target

      return {
        aiMessages: messages,
        aiStreaming: chunk.done ? false : state.aiStreaming
      }
    })
  },

  clearAi: () => set({ aiMessages: [], aiStreaming: false, activeRequestId: null })
}))
