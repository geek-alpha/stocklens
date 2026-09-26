import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { KeyRound, PanelLeft, PanelRight, RefreshCw, Search, Settings } from 'lucide-react'
import type { BarInterval, BarRange, SymbolHit } from '@shared/types'
import { api } from '@renderer/lib/api'
import { changeClass, fmtPercent, fmtPrice } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'

interface IntervalOption {
  key: BarInterval
  label: string
  range: BarRange
}

const VIEW_OPTIONS: Array<{ key: 'stock' | 'board'; label: string }> = [
  { key: 'stock', label: '个股' },
  { key: 'board', label: '市场看板' }
]

const INTERVAL_OPTIONS: IntervalOption[] = [
  { key: '1m', label: '1分', range: '1d' },
  { key: '5m', label: '5分', range: '5d' },
  { key: '15m', label: '15分', range: '1mo' },
  { key: '30m', label: '30分', range: '1mo' },
  { key: '1h', label: '1时', range: '3mo' },
  { key: '1d', label: '日', range: '6mo' },
  { key: '1wk', label: '周', range: '2y' },
  { key: '1mo', label: '月', range: '5y' }
]

export default function Toolbar() {
  const interval = useAppStore((s) => s.interval)
  const changeInterval = useAppStore((s) => s.changeInterval)
  const refreshQuotes = useAppStore((s) => s.refreshQuotes)
  const loadCandles = useAppStore((s) => s.loadCandles)
  const refreshing = useAppStore((s) => s.refreshing)
  const quotes = useAppStore((s) => s.quotes)
  const selectSymbol = useAppStore((s) => s.selectSymbol)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const setLicenseOpen = useAppStore((s) => s.setLicenseOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const toggleAiPanel = useAppStore((s) => s.toggleAiPanel)
  const setToast = useAppStore((s) => s.setToast)
  const activeView = useAppStore((s) => s.activeView)
  const setView = useAppStore((s) => s.setView)

  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SymbolHit[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const keyword = query.trim()
    if (keyword.length < 1) {
      setHits([])
      setOpen(false)
      return undefined
    }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.searchSymbols(keyword)
        if (cancelled) return
        setHits(result)
        setHighlight(0)
        setOpen(result.length > 0)
      } catch {
        if (!cancelled) setHits([])
      }
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const onClickOutside = (event: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const choose = async (hit: SymbolHit): Promise<void> => {
    setQuery('')
    setOpen(false)
    setHits([])
    await selectSymbol(hit.symbol)
    await useAppStore.getState().addSymbol(hit.symbol)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!open || hits.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((prev) => (prev + 1) % hits.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((prev) => (prev - 1 + hits.length) % hits.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      void choose(hits[highlight])
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  const manualRefresh = async (): Promise<void> => {
    setToast({ kind: 'info', message: '正在刷新行情…' })
    await Promise.all([refreshQuotes(), loadCandles()])
    setToast(null)
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-surface-700 bg-surface-900 px-3">
      <button
        type="button"
        onClick={toggleSidebar}
        title="切换自选股栏"
        className="rounded p-1.5 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100"
      >
        <PanelLeft size={16} />
      </button>

      <div className="mr-1 flex items-center gap-2">
        <span className="text-sm font-semibold tracking-wide text-slate-100">StockLens</span>
        <div className="flex items-center gap-0.5 rounded border border-surface-700 bg-surface-800 p-0.5">
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setView(option.key)}
              className={`rounded px-2 py-0.5 text-xs transition ${
                activeView === option.key
                  ? 'bg-accent text-white'
                  : 'text-slate-400 hover:bg-surface-700 hover:text-slate-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* 搜索与周期选择只对个股视图有意义，看板视图下收起，不占宽度 */}
      <div ref={boxRef} className={activeView === 'stock' ? 'relative w-72' : 'hidden'}>
        <div className="flex items-center gap-2 rounded border border-surface-700 bg-surface-800 px-2 py-1.5 focus-within:border-accent">
          <Search size={14} className="text-slate-500" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => hits.length > 0 && setOpen(true)}
            placeholder="搜索代码或公司名，如 AAPL"
            className="w-full bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
          />
        </div>

        {open && hits.length > 0 ? (
          <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded border border-surface-700 bg-surface-800 py-1 shadow-2xl">
            {hits.map((hit, index) => {
              const quote = quotes[hit.symbol]
              return (
                <button
                  key={`${hit.symbol}-${index}`}
                  type="button"
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => void choose(hit)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left ${
                    index === highlight ? 'bg-surface-700' : ''
                  }`}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="num text-sm font-medium text-slate-100">{hit.symbol}</span>
                    <span className="truncate text-xs text-slate-500">
                      {hit.name}
                      {hit.exchange ? ` · ${hit.exchange}` : ''}
                    </span>
                  </span>
                  {quote ? (
                    <span className="flex flex-col items-end">
                      <span className="num text-xs text-slate-300">{fmtPrice(quote.price)}</span>
                      <span className={`num text-[11px] ${changeClass(quote.changePercent)}`}>
                        {fmtPercent(quote.changePercent)}
                      </span>
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div
        className={
          activeView === 'stock'
            ? 'ml-2 flex items-center gap-0.5 rounded border border-surface-700 bg-surface-800 p-0.5'
            : 'hidden'
        }
      >
        {INTERVAL_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => void changeInterval(option.key, option.range)}
            className={`rounded px-2 py-1 text-xs transition ${
              interval === option.key
                ? 'bg-accent text-white'
                : 'text-slate-400 hover:bg-surface-700 hover:text-slate-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={() => void manualRefresh()}
          title="立即刷新"
          className="rounded p-1.5 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={() => setLicenseOpen(true)}
          title="许可证激活"
          className="rounded p-1.5 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100"
        >
          <KeyRound size={16} />
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="设置"
          className="rounded p-1.5 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100"
        >
          <Settings size={16} />
        </button>
        <button
          type="button"
          onClick={toggleAiPanel}
          title="切换 AI 助手"
          className="rounded p-1.5 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100"
        >
          <PanelRight size={16} />
        </button>
      </div>
    </header>
  )
}
