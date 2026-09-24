import { useEffect, useState } from 'react'
import { CircleCheck, Copy, KeyRound, X } from 'lucide-react'
import { api, errorMessage } from '@renderer/lib/api'
import { fmtDateTime, fmtDaysLeft } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'

const STATUS_TEXT: Record<string, { label: string; className: string }> = {
  unactivated: { label: '未激活', className: 'bg-slate-600/20 text-slate-300' },
  active: { label: '已激活', className: 'bg-bull/20 text-emerald-300' },
  expired: { label: '已过期', className: 'bg-bear/20 text-rose-300' },
  invalid: { label: '无效', className: 'bg-bear/20 text-rose-300' }
}

export default function LicenseDialog() {
  const open = useAppStore((s) => s.licenseOpen)
  const setOpen = useAppStore((s) => s.setLicenseOpen)
  const license = useAppStore((s) => s.license)
  const refreshLicense = useAppStore((s) => s.refreshLicense)
  const setToast = useAppStore((s) => s.setToast)

  const [key, setKey] = useState('')
  const [licensee, setLicensee] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const status = STATUS_TEXT[license?.status ?? 'unactivated'] ?? STATUS_TEXT.unactivated

  const copyMachineCode = async (): Promise<void> => {
    if (!license?.machineCode) return
    try {
      await navigator.clipboard.writeText(license.machineCode)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setToast({ kind: 'error', message: '复制失败，请手动选择机器码复制' })
    }
  }

  const activate = async (): Promise<void> => {
    setError('')
    setBusy(true)
    try {
      await api.activateLicense(key, licensee)
      await refreshLicense()
      setKey('')
      setToast({ kind: 'info', message: '激活成功，感谢支持' })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[520px] overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex h-11 items-center gap-2 border-b border-surface-700 px-4">
          <KeyRound size={15} className="text-amber-400" />
          <span className="text-sm font-medium text-slate-200">许可证激活</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto rounded p-1 text-slate-500 hover:bg-surface-700 hover:text-slate-200"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="flex items-center gap-3 rounded border border-surface-700 bg-surface-800 px-3 py-2.5">
            <span className={`rounded px-2 py-0.5 text-[11px] ${status.className}`}>
              {status.label}
            </span>
            <div className="flex flex-col">
              <span className="text-xs text-slate-300">
                {license?.licensee || '尚未授权'}
              </span>
              <span className="text-[11px] text-slate-500">
                {license?.status === 'active'
                  ? `${license.plan.toUpperCase()} · ${fmtDaysLeft(license.daysLeft)}${
                      license.expiresAt ? `（${fmtDateTime(license.expiresAt / 1000)} 到期）` : ''
                    }`
                  : '购买后凭许可证密钥在本机激活'}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-slate-500">本机机器码（发给销售方）</label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={license?.machineCode ?? ''}
                className="num w-full rounded border border-surface-700 bg-surface-800 px-2 py-1.5 text-xs text-slate-300 outline-none"
              />
              <button
                type="button"
                onClick={() => void copyMachineCode()}
                className="flex items-center gap-1 rounded border border-surface-700 px-2 py-1.5 text-xs text-slate-400 transition hover:text-slate-100"
              >
                {copied ? <CircleCheck size={13} className="text-bull" /> : <Copy size={13} />}
                {copied ? '已复制' : '复制'}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-slate-500">许可证密钥</label>
            <textarea
              value={key}
              onChange={(event) => setKey(event.target.value)}
              rows={3}
              placeholder="粘贴销售方发给你的一整串密钥"
              className="w-full resize-none rounded border border-surface-700 bg-surface-800 px-2 py-1.5 font-mono text-[11px] text-slate-300 outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-slate-500">被授权人（可选，用于核对）</label>
            <input
              value={licensee}
              onChange={(event) => setLicensee(event.target.value)}
              placeholder="姓名或公司名"
              className="w-full rounded border border-surface-700 bg-surface-800 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-accent"
            />
          </div>

          {error ? (
            <div className="rounded border border-bear/40 bg-bear/10 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex h-14 items-center justify-end gap-2 border-t border-surface-700 px-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-surface-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            关闭
          </button>
          <button
            type="button"
            disabled={busy || !key.trim()}
            onClick={() => void activate()}
            className="rounded bg-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
          >
            {busy ? '激活中…' : '立即激活'}
          </button>
        </div>
      </div>
    </div>
  )
}
