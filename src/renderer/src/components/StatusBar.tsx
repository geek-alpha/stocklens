import { useAppStore } from '@renderer/store/useAppStore'

export default function StatusBar() {
  const settings = useAppStore((s) => s.settings)
  const appInfo = useAppStore((s) => s.appInfo)
  const license = useAppStore((s) => s.license)
  const quotes = useAppStore((s) => s.quotes)
  const refreshing = useAppStore((s) => s.refreshing)
  const setLicenseOpen = useAppStore((s) => s.setLicenseOpen)

  const quoteCount = Object.keys(quotes).length
  const delayed = Object.values(quotes).some((quote) => quote.stale)

  const providerLabel =
    settings?.dataProvider === 'finnhub'
      ? 'Finnhub'
      : settings?.dataProvider === 'yahoo'
        ? 'Yahoo'
        : '智能（腾讯/东财）'

  const licenseLabel =
    license?.status === 'active'
      ? `${license.plan.toUpperCase()} 已授权`
      : license?.status === 'expired'
        ? '授权已过期'
        : license?.status === 'invalid'
          ? '授权无效'
          : '未激活'

  const licenseClass =
    license?.status === 'active'
      ? 'text-emerald-400'
      : license?.status === 'unactivated'
        ? 'text-amber-400'
        : 'text-rose-400'

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-surface-700 bg-surface-900 px-3 text-[11px] text-slate-500">
      <span>
        数据源：<span className="text-slate-400">{providerLabel}</span>
      </span>
      <span>
        刷新：
        <span className="text-slate-400">
          {settings ? `${Math.round(settings.refreshIntervalMs / 1000)}s` : '—'}
        </span>
      </span>
      <span>
        标的：
        <span className="text-slate-400">{quoteCount}</span>
      </span>

      {refreshing ? <span className="text-sky-400">正在刷新行情…</span> : null}
      {delayed ? <span className="text-amber-400">部分行情为缓存值</span> : null}

      <button
        type="button"
        onClick={() => setLicenseOpen(true)}
        className={`ml-auto ${licenseClass} transition hover:underline`}
      >
        {licenseLabel}
      </button>

      <span>v{appInfo?.version ?? '0.0.0'}</span>
      <span>{appInfo?.packaged ? '正式版' : '开发版'}</span>
    </footer>
  )
}
