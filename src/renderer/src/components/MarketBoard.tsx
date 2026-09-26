import { useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { IndexQuote, MarketRegion, SectorKind, SectorSnapshot } from '@shared/types'
import { cnChangeClass, fmtAmount, fmtPercent, fmtPrice, fmtRelative } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'

/**
 * 市场看板：全球指数 + A股板块全景 + 产业轮动排行。
 *
 * 界面里的相对强度有两种含义，必须区分清楚，否则会把「今天涨得多」误读成「产业在崛起」：
 *   板块列表里的 = 当日相对沪深300 的超额收益
 *   轮动排行里的 = 近 N 日超额收益的累计值（历史不足时退回单日，并明确标注）
 */

const REGION_LABELS: Record<MarketRegion, string> = {
  CN: 'A股',
  HK: '香港',
  US: '美国',
  JP: '日本',
  EU: '欧洲',
  OTHER: '其他'
}

const REGION_ORDER: MarketRegion[] = ['CN', 'HK', 'US', 'JP', 'EU', 'OTHER']

type SortKey = 'relativeStrength' | 'changePercent' | 'amountShare' | 'amount'

const SORT_LABELS: Record<SortKey, string> = {
  relativeStrength: '相对强度',
  changePercent: '涨跌幅',
  amountShare: '成交占比',
  amount: '成交额'
}

function IndexCard({ index }: { index: IndexQuote }) {
  return (
    <div className="rounded border border-surface-700 bg-surface-800 px-3 py-2">
      {/* 名称独占一行：和涨跌幅挤在一行时会被截成「上...」，反而看不出是哪个指数 */}
      <div className="truncate text-xs text-slate-300">{index.name}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="num text-base font-semibold text-slate-100">{fmtPrice(index.price)}</span>
        <span className={`num shrink-0 text-sm ${cnChangeClass(index.changePercent)}`}>
          {fmtPercent(index.changePercent)}
        </span>
      </div>
    </div>
  )
}

function SectorRow({ sector, rank }: { sector: SectorSnapshot; rank: number }) {
  return (
    <tr className="border-b border-surface-800/70 hover:bg-surface-800/40">
      <td className="num px-2 py-1.5 text-right text-[11px] text-slate-600">{rank}</td>
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-slate-200">{sector.name}</span>
          <span className="shrink-0 rounded bg-surface-700 px-1 text-[10px] text-slate-500">
            {sector.memberCount}
          </span>
        </div>
      </td>
      <td className={`num px-2 py-1.5 text-right text-sm ${cnChangeClass(sector.changePercent)}`}>
        {fmtPercent(sector.changePercent)}
      </td>
      <td className={`num px-2 py-1.5 text-right text-sm ${cnChangeClass(sector.relativeStrength)}`}>
        {sector.relativeStrength == null ? '—' : fmtPercent(sector.relativeStrength)}
      </td>
      <td className="num px-2 py-1.5 text-right text-xs text-slate-400">
        {sector.amountShare == null ? '—' : `${sector.amountShare.toFixed(2)}%`}
      </td>
      <td className="num px-2 py-1.5 text-right text-xs text-slate-400">{fmtAmount(sector.amount)}</td>
      <td className="px-2 py-1.5">
        {sector.leader ? (
          <div className="flex items-center justify-end gap-2">
            <span className="truncate text-xs text-slate-300">{sector.leader.name}</span>
            <span className={`num shrink-0 text-xs ${cnChangeClass(sector.leader.changePercent)}`}>
              {fmtPercent(sector.leader.changePercent)}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-600">—</span>
        )}
      </td>
    </tr>
  )
}

function RotationList({
  title,
  sectors,
  tone
}: {
  title: string
  sectors: SectorSnapshot[]
  tone: 'up' | 'down'
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className={`mb-1.5 text-xs font-medium ${tone === 'up' ? 'text-bear' : 'text-bull'}`}>
        {title}
      </div>
      <div className="flex flex-col gap-0.5 overflow-y-auto">
        {sectors.length === 0 ? <span className="text-xs text-slate-600">暂无数据</span> : null}
        {sectors.map((sector) => (
          <div
            key={`${sector.kind}-${sector.code}`}
            className="flex items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-surface-800"
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-xs text-slate-200">{sector.name}</span>
              <span className="shrink-0 text-[10px] text-slate-600">
                {sector.kind === 'concept' ? '概念' : '行业'}
              </span>
            </span>
            <span className={`num shrink-0 text-xs ${cnChangeClass(sector.relativeStrength)}`}>
              {sector.relativeStrength == null ? '—' : fmtPercent(sector.relativeStrength)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function MarketBoard() {
  const board = useAppStore((s) => s.board)
  const rotation = useAppStore((s) => s.rotation)
  const loading = useAppStore((s) => s.boardLoading)
  const refreshBoard = useAppStore((s) => s.refreshBoard)

  const [kind, setKind] = useState<SectorKind>('industry')
  const [sortKey, setSortKey] = useState<SortKey>('relativeStrength')

  const sectors = useMemo(() => {
    if (!board) return []
    const list = kind === 'industry' ? board.industries : board.concepts
    return [...list].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      return (bv ?? Number.NEGATIVE_INFINITY) - (av ?? Number.NEGATIVE_INFINITY)
    })
  }, [board, kind, sortKey])

  const grouped = useMemo(() => {
    const map = new Map<MarketRegion, IndexQuote[]>()
    for (const index of board?.indices ?? []) {
      const list = map.get(index.region) ?? []
      list.push(index)
      map.set(index.region, list)
    }
    return REGION_ORDER.filter((r) => map.has(r)).map((r) => ({ region: r, items: map.get(r) ?? [] }))
  }, [board])

  if (!board) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-slate-500">
        {loading ? '正在抓取全球指数与板块数据…' : '暂无看板数据'}
      </div>
    )
  }

  const cumulative = rotation?.basis === 'cumulative'

  // 外层不滚动：轮动区固定高度、表格区自己滚，否则长轮动列表会把板块表格挤出视口
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-100">市场看板</span>
          <span className="text-[11px] text-slate-500">
            交易日 {board.tradeDate} · 更新于 {fmtRelative(board.fetchedAt)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">
            两市成交额 <span className="num text-slate-300">{fmtAmount(board.totalAmount)}</span>
          </span>
          <button
            type="button"
            onClick={() => void refreshBoard(true)}
            disabled={loading}
            title="重新抓取"
            className="rounded p-1.5 text-slate-400 transition hover:bg-surface-700 hover:text-slate-100 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <section className="mb-3 flex flex-col gap-2">
        {grouped.map(({ region, items }) => (
          <div key={region} className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-xs text-slate-500">{REGION_LABELS[region]}</span>
            <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
              {items.map((index) => (
                <IndexCard key={index.symbol} index={index} />
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="mb-3 shrink-0 rounded border border-surface-700 bg-surface-900/60 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">产业轮动</span>
          <span className="text-[11px] text-slate-500">
            {cumulative ? '按近 20 日相对强度累计' : '历史快照不足，暂按当日涨跌幅排'}
          </span>
          {!cumulative ? (
            <span className="flex items-center gap-1 text-[11px] text-amber-400/80">
              <AlertTriangle size={12} />
              已累积 {rotation?.historyDays ?? 0} 个交易日，趋势要攒几天才看得出来
            </span>
          ) : (
            <span className="text-[11px] text-slate-600">
              已累积 {rotation?.historyDays ?? 0} 个交易日
            </span>
          )}
        </div>
        <div className="flex max-h-72 gap-4">
          <RotationList title="资金流入（相对强势）" sectors={rotation?.rising ?? []} tone="up" />
          <RotationList title="资金流出（相对弱势）" sectors={rotation?.falling ?? []} tone="down" />
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded border border-surface-700 bg-surface-900/60">
        <div className="flex items-center gap-2 border-b border-surface-700 px-3 py-2">
          <span className="text-sm font-semibold text-slate-100">板块全景</span>
          <div className="flex items-center gap-0.5 rounded border border-surface-700 bg-surface-800 p-0.5">
            {(['industry', 'concept'] as SectorKind[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={`rounded px-2 py-0.5 text-xs transition ${
                  kind === option
                    ? 'bg-accent text-white'
                    : 'text-slate-400 hover:bg-surface-700 hover:text-slate-200'
                }`}
              >
                {option === 'industry' ? '行业' : '概念'}
              </button>
            ))}
          </div>
          <span className="num text-[11px] text-slate-500">共 {sectors.length} 个</span>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-[11px] text-slate-500">排序</span>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSortKey(key)}
                className={`rounded px-1.5 py-0.5 text-[11px] transition ${
                  sortKey === key
                    ? 'bg-surface-700 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {SORT_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-surface-900">
              <tr className="border-b border-surface-700 text-[11px] text-slate-500">
                <th className="w-8 px-2 py-1.5 text-right font-normal">#</th>
                <th className="px-2 py-1.5 text-left font-normal">板块</th>
                <th className="w-20 px-2 py-1.5 text-right font-normal">涨跌幅</th>
                <th className="w-20 px-2 py-1.5 text-right font-normal">相对沪深300</th>
                <th className="w-20 px-2 py-1.5 text-right font-normal">成交占比</th>
                <th className="w-20 px-2 py-1.5 text-right font-normal">成交额</th>
                <th className="w-40 px-2 py-1.5 text-right font-normal">领涨股</th>
              </tr>
            </thead>
            <tbody>
              {sectors.map((sector, index) => (
                <SectorRow
                  key={`${sector.kind}-${sector.code}`}
                  sector={sector}
                  rank={index + 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
