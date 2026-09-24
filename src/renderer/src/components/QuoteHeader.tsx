import { changeClass, fmtClock, fmtPercent, fmtPrice, fmtVolume } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'

function Metric({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-slate-600">{label}</span>
      <span className={`num text-xs text-slate-300 ${valueClass ?? ''}`}>{value}</span>
    </div>
  )
}

export default function QuoteHeader() {
  const activeSymbol = useAppStore((s) => s.activeSymbol)
  const quote = useAppStore((s) => s.quotes[s.activeSymbol])
  const candleSource = useAppStore((s) => s.candleSource)

  if (!activeSymbol) {
    return (
      <div className="flex h-20 items-center justify-center border-b border-surface-700 bg-surface-900 text-xs text-slate-600">
        从左侧自选股中选择一个标的
      </div>
    )
  }

  const color = changeClass(quote?.changePercent)

  return (
    <div className="flex h-20 shrink-0 items-center gap-6 border-b border-surface-700 bg-surface-900 px-4">
      <div className="flex flex-col">
        <div className="flex items-baseline gap-2">
          <span className="num text-lg font-semibold text-slate-100">{activeSymbol}</span>
          <span className="max-w-[220px] truncate text-xs text-slate-500">
            {quote?.name ?? ''}
          </span>
          {quote?.exchange ? (
            <span className="rounded bg-surface-700 px-1.5 py-0.5 text-[10px] text-slate-400">
              {quote.exchange}
            </span>
          ) : null}
          {quote?.stale ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
              数据延迟
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex items-baseline gap-3">
          <span className={`num text-2xl font-semibold ${color}`}>
            {quote ? fmtPrice(quote.price) : '—'}
          </span>
          <span className={`num text-sm ${color}`}>
            {quote ? `${quote.change >= 0 ? '+' : ''}${fmtPrice(quote.change)}` : '—'}
          </span>
          <span className={`num text-sm ${color}`}>
            {quote ? fmtPercent(quote.changePercent) : '—'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-x-5 gap-y-1.5">
        <Metric label="昨收" value={quote ? fmtPrice(quote.previousClose) : '—'} />
        <Metric label="今高" value={quote ? fmtPrice(quote.dayHigh) : '—'} />
        <Metric label="今低" value={quote ? fmtPrice(quote.dayLow) : '—'} />
        <Metric label="成交量" value={quote ? fmtVolume(quote.volume) : '—'} />
        <Metric
          label="52周高"
          value={quote ? fmtPrice(quote.fiftyTwoWeekHigh) : '—'}
          valueClass="text-bull/80"
        />
        <Metric
          label="52周低"
          value={quote ? fmtPrice(quote.fiftyTwoWeekLow) : '—'}
          valueClass="text-bear/80"
        />
      </div>

      <div className="ml-auto flex flex-col items-end gap-1">
        <span className="text-[10px] text-slate-600">数据时间</span>
        <span className="num text-xs text-slate-400">{fmtClock(quote?.marketTime)}</span>
        <span className="text-[10px] text-slate-600">K线源：{candleSource || '—'}</span>
      </div>
    </div>
  )
}
