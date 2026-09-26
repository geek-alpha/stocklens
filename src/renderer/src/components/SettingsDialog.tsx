import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { AiConnectionCheck, AiProviderKind, AppSettings } from '@shared/types'
import { api, errorMessage } from '@renderer/lib/api'
import { useAppStore } from '@renderer/store/useAppStore'

const PROVIDER_PRESETS: Record<AiProviderKind, { label: string; baseUrl: string; model: string }> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  moonshot: { label: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' }
}

const REFRESH_OPTIONS = [
  { value: 5000, label: '5 秒' },
  { value: 10000, label: '10 秒' },
  { value: 30000, label: '30 秒' },
  { value: 60000, label: '60 秒' }
]

const DATA_PROVIDERS = [
  { id: 'auto', label: '智能（推荐）', desc: '国内直连优先，自动降级' },
  { id: 'yahoo', label: 'Yahoo Finance', desc: '免密钥，海外线路' },
  { id: 'finnhub', label: 'Finnhub', desc: '需 API Key' }
] as const

const inputClass =
  'w-full rounded border border-surface-700 bg-surface-800 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-accent'

export default function SettingsDialog() {
  const open = useAppStore((s) => s.settingsOpen)
  const setOpen = useAppStore((s) => s.setSettingsOpen)
  const settings = useAppStore((s) => s.settings)
  const persistSettings = useAppStore((s) => s.persistSettings)
  const setToast = useAppStore((s) => s.setToast)

  const [draft, setDraft] = useState<AppSettings | null>(settings)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<AiConnectionCheck | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(settings)
      setTestResult(null)
    }
  }, [open, settings])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open || !draft) return null

  const patch = (partial: Partial<AppSettings>): void => {
    setDraft({ ...draft, ...partial })
  }

  const patchAi = (partial: Partial<AppSettings['ai']>): void => {
    setDraft({ ...draft, ai: { ...draft.ai, ...partial } })
  }

  const changeProvider = (kind: AiProviderKind): void => {
    const preset = PROVIDER_PRESETS[kind]
    patchAi({ kind, baseUrl: preset.baseUrl, model: preset.model })
  }

  const testConnection = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await api.aiTest(draft.ai))
    } catch (err) {
      setTestResult({
        ok: false,
        message: errorMessage(err),
        baseUrl: draft.ai.baseUrl,
        model: draft.ai.model
      })
    } finally {
      setTesting(false)
    }
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await persistSettings({
        dataProvider: draft.dataProvider,
        finnhubKey: draft.finnhubKey,
        refreshIntervalMs: draft.refreshIntervalMs,
        theme: draft.theme,
        language: draft.language,
        ai: draft.ai
      })
      setToast({ kind: 'info', message: '设置已保存' })
      setOpen(false)
    } catch (err) {
      setToast({ kind: 'error', message: errorMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="flex max-h-[85vh] w-[560px] flex-col overflow-hidden rounded-lg border border-surface-700 bg-surface-900 shadow-2xl">
        <div className="flex h-11 items-center border-b border-surface-700 px-4">
          <span className="text-sm font-medium text-slate-200">设置</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto rounded p-1 text-slate-500 hover:bg-surface-700 hover:text-slate-200"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-slate-400">行情数据源</h3>
            <div className="flex gap-2">
              {DATA_PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => patch({ dataProvider: provider.id })}
                  className={`flex-1 rounded border px-2 py-2 text-xs transition ${
                    draft.dataProvider === provider.id
                      ? 'border-accent bg-accent/15 text-slate-100'
                      : 'border-surface-700 bg-surface-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div>{provider.label}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{provider.desc}</div>
                </button>
              ))}
            </div>
            {draft.dataProvider === 'finnhub' ? (
              <div className="space-y-1">
                <label className="text-[11px] text-slate-500">
                  Finnhub API Key（免费套餐不含 K 线，K 线会自动走 Yahoo）
                </label>
                <input
                  value={draft.finnhubKey}
                  onChange={(event) => patch({ finnhubKey: event.target.value })}
                  placeholder="例如 c1234567890abcdef"
                  className={inputClass}
                />
              </div>
            ) : null}

            <div className="flex items-center gap-3 pt-1">
              <label className="text-[11px] text-slate-500">行情刷新间隔</label>
              <select
                value={draft.refreshIntervalMs}
                onChange={(event) => patch({ refreshIntervalMs: Number(event.target.value) })}
                className="rounded border border-surface-700 bg-surface-800 px-2 py-1 text-xs text-slate-200 outline-none"
              >
                {REFRESH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="space-y-2 border-t border-surface-700 pt-4">
            <h3 className="text-xs font-medium text-slate-400">AI 助手</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-slate-500">服务商</label>
                <select
                  value={draft.ai.kind}
                  onChange={(event) => changeProvider(event.target.value as AiProviderKind)}
                  className="w-full rounded border border-surface-700 bg-surface-800 px-2 py-1.5 text-xs text-slate-200 outline-none"
                >
                  {(Object.keys(PROVIDER_PRESETS) as AiProviderKind[]).map((kind) => (
                    <option key={kind} value={kind}>
                      {PROVIDER_PRESETS[kind].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] text-slate-500">模型</label>
                <input
                  value={draft.ai.model}
                  onChange={(event) => patchAi({ model: event.target.value })}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-500">Base URL</label>
              <input
                value={draft.ai.baseUrl}
                onChange={(event) => patchAi({ baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
                className={inputClass}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-500">
                API Key（本地加密保存，界面只显示掩码；留空表示不改动已存的密钥）
              </label>
              <input
                value={draft.ai.apiKey}
                onChange={(event) => patchAi({ apiKey: event.target.value })}
                onFocus={() => {
                  // 掩码只是占位：不清掉的话新密钥会被粘在掩码后面，保存时被当成「没改」
                  if (draft.ai.apiKey.includes('****')) patchAi({ apiKey: '' })
                }}
                placeholder="sk-..."
                className={inputClass}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={testing}
                onClick={() => void testConnection()}
                className="rounded border border-surface-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-accent hover:text-slate-100 disabled:opacity-50"
              >
                {testing ? '测试中…' : '测试连接'}
              </button>
              {testResult ? (
                <span
                  className={`text-[11px] ${testResult.ok ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {testResult.ok ? '✓ ' : '✕ '}
                  {testResult.message}
                </span>
              ) : (
                <span className="text-[10px] text-slate-600">填好 Key 后点这里验证是否生效</span>
              )}
            </div>

            {testResult && !testResult.ok && (
              <p className="text-[10px] text-slate-600">
                实际请求：{testResult.baseUrl || '默认端点'} · {testResult.model || '未填模型名'}
              </p>
            )}

            <div className="flex items-center gap-3">
              <label className="text-[11px] text-slate-500">温度 {draft.ai.temperature.toFixed(1)}</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={draft.ai.temperature}
                onChange={(event) => patchAi({ temperature: Number(event.target.value) })}
                className="flex-1 accent-accent"
              />
              <span className="text-[10px] text-slate-600">越低越保守</span>
            </div>
          </section>

          <section className="space-y-2 border-t border-surface-700 pt-4">
            <h3 className="text-xs font-medium text-slate-400">外观</h3>
            <div className="flex gap-2">
              {(['dark', 'light'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  onClick={() => patch({ theme })}
                  className={`flex-1 rounded border px-3 py-2 text-xs transition ${
                    draft.theme === theme
                      ? 'border-accent bg-accent/15 text-slate-100'
                      : 'border-surface-700 bg-surface-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {theme === 'dark' ? '深色（推荐）' : '浅色'}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="flex h-14 items-center justify-end gap-2 border-t border-surface-700 px-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-surface-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded bg-accent px-4 py-1.5 text-xs font-medium text-white transition hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
