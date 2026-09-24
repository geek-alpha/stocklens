import { useMemo, useState } from 'react'
import { ChevronDown, Plus, Star, TrendingDown, TrendingUp, X } from 'lucide-react'
import { changeClass, fmtPercent, fmtPrice } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'

type SortKey = 'manual' | 'change' | 'price' | 'symbol'

const SORT_LABELS: Record<SortKey, string> = {
  manual: '自定义',
  change: '涨跌幅',
  price: '价格',
  symbol: '代码'
}

export default function WatchList() {
  const settings = useAppStore((s) => s.settings)
  const quotes = useAppStore((s) => s.quotes)
  const activeSymbol = useAppStore((s) => s.activeSymbol)
  const selectSymbol = useAppStore((s) => s.selectSymbol)
  const addSymbol = useAppStore((s) => s.addSymbol)
  const removeSymbol = useAppStore((s) => s.removeSymbol)

  const [sortKey, setSortKey] = useState<SortKey>('manual')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const watchlist = settings?.watchlist ?? []

  const rows = useMemo(() => {
    const list = watchlist.map((symbol) => ({ symbol, quote: quotes[symbol] }))
    if (sortKey === 'manual') return list
    const sorted = [...list]
    sorted.sort((a, b) => {
      if (sortKey === 'symbol') return a.symbol.localeCompare(b.symbol)
      if (sortKey === 'price') return (b.quote?.price ?? 0) - (a.quote?.price ?? 0)
      return (b.quote?.changePercent ?? 0) - (a.quote?.changePercent ?? 0)
    })
    return sorted
  }, [watchlist, quotes, sortKey])

  const submitDraft = async (): Promise<void> => {
    const value = draft.trim().toUpperCase()
    if (!value) {
      setAdding(false)
      return
    }
    setDraft('')
    setAdding(false)
    await addSymbol(value)
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-surface-700 bg-surface-900">
      <div className="flex h-10 items-center gap-2 border-b border-surface-700 px-3">
        <Star size={14} className="text-amber-400" />
        <span className="text-xs font-medium text-slate-300">自选股</span>
        <span className="text-[11px] text-slate-600">{watchlist.length}</span>

        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              className="appearance-none rounded border border-surface-700 bg-surface-800 py-0.5 pl-1.5 pr-5 text-[11px] text-slate-300 outline-none"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
            <ChevronDown
              size={11}
              className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-slate-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setAdding((prev) => !prev)}
            title="添加自选"
            className="rounded p-1 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {adding ? (
        <div className="flex items-center gap-1 border-b border-surface-700 px-3 py-2">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitDraft()
              if (event.key === 'Escape') {
                setAdding(false)
                setDraft('')
              }
            }}
            placeholder="输入代码后回车"
            className="w-full rounded border border-surface-700 bg-surface-800 px-2 py-1 text-xs uppercase text-slate-200 outline-none focus:border-accent"
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs leading-6 text-slate-600">
            还没有自选股
            <br />
            点右上角 + 添加代码
          </div>
        ) : (
          rows.map(({ symbol, quote }) => {
            const active = symbol === activeSymbol
            const up = (quote?.changePercent ?? 0) >= 0
            return (
              <div
                key={symbol}
                onClick={() => void selectSymbol(symbol)}
                className={`group flex cursor-pointer items-center gap-2 border-l-2 px-2.5 py-2 transition ${
                  active
                    ? 'border-accent bg-surface-800'
                    : 'border-transparent hover:bg-surface-800/60'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="num truncate text-sm font-medium text-slate-100">
                      {symbol}
                    </span>
                    {quote?.stale ? (
                      <span className="rounded bg-amber-500/15 px-1 text-[9px] text-amber-400">
                        延迟
                      </span>
                    ) : null}
                  </div>
                  <div className="truncate text-[11px] text-slate-500">
                    {quote?.name ?? '加载中…'}
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <span className="num text-sm text-slate-200">
                    {quote ? fmtPrice(quote.price) : '—'}
                  </span>
                  <span className={`num text-[11px] ${changeClass(quote?.changePercent)}`}>
                    {quote ? fmtPercent(quote.changePercent) : '—'}
                  </span>
                </div>

                <span className={`${up ? 'text-bull' : 'text-bear'} opacity-70`}>
                  {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                </span>

                <button
                  type="button"
                  title="从自选移除"
                  onClick={(event) => {
                    event.stopPropagation()
                    void removeSymbol(symbol)
                  }}
                  className="hidden rounded p-0.5 text-slate-500 hover:bg-surface-700 hover:text-bear group-hover:block"
                >
                  <X size={13} />
                </button>
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
