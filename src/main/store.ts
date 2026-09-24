import { safeStorage } from 'electron'
import Store from 'electron-store'
import type { AiConfig, AppSettings } from '@shared/types'

/**
 * 配置持久化。API Key 落盘前用 safeStorage 加密（Windows 走 DPAPI，绑定当前用户）。
 * 系统不支持加密时降级为明文并在字段上加 `plain:` 前缀，方便后续识别与迁移。
 */

const DEFAULT_AI: AiConfig = {
  kind: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.3
}

export const DEFAULT_SETTINGS: AppSettings = {
  dataProvider: 'auto',
  finnhubKey: '',
  refreshIntervalMs: 10000,
  theme: 'dark',
  language: 'zh',
  watchlist: ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'SPY', 'QQQ'],
  ai: { ...DEFAULT_AI }
}

const SECRET_PREFIX = 'enc:'
const PLAIN_PREFIX = 'plain:'
const MASK = '****'

interface Schema {
  settings: AppSettings
}

const store = new Store<Schema>({
  name: 'stocklens-settings',
  defaults: { settings: DEFAULT_SETTINGS }
})

function encryptSecret(plain: string): string {
  if (!plain) return ''
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return SECRET_PREFIX + safeStorage.encryptString(plain).toString('base64')
    }
  } catch {
    // 加密子系统不可用时退化为明文，不阻断使用
  }
  return PLAIN_PREFIX + plain
}

function decryptSecret(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length)
  if (stored.startsWith(SECRET_PREFIX)) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(SECRET_PREFIX.length), 'base64'))
    } catch {
      return ''
    }
  }
  return stored
}

/** 渲染层永远拿到掩码，明文只在主进程内流转 */
export function maskSecret(secret: string): string {
  if (!secret) return ''
  if (secret.length <= 8) return MASK
  return `${secret.slice(0, 3)}${MASK}${secret.slice(-4)}`
}

function looksMasked(value: string): boolean {
  return value.includes(MASK)
}

/** 明文配置，仅供主进程内部（网络请求、AI 调用）使用 */
export function getSettings(): AppSettings {
  const raw = store.get('settings')
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    ai: { ...DEFAULT_AI, ...raw?.ai },
    finnhubKey: decryptSecret(raw?.finnhubKey ?? ''),
    watchlist: raw?.watchlist?.length ? raw.watchlist : DEFAULT_SETTINGS.watchlist
  }
}

/** 给渲染层的版本：所有密钥已掩码 */
export function getPublicSettings(): AppSettings {
  const s = getSettings()
  return {
    ...s,
    finnhubKey: maskSecret(s.finnhubKey),
    ai: { ...s.ai, apiKey: maskSecret(s.ai.apiKey) }
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const merged: AppSettings = {
    ...current,
    ...patch,
    ai: { ...current.ai, ...(patch.ai ?? {}) }
  }

  // 掩码值代表「用户没改这一项」，沿用已存的明文，避免把掩码写进配置
  if (patch.finnhubKey !== undefined && looksMasked(patch.finnhubKey)) {
    merged.finnhubKey = current.finnhubKey
  }
  if (patch.ai?.apiKey !== undefined && looksMasked(patch.ai.apiKey)) {
    merged.ai.apiKey = current.ai.apiKey
  }

  store.set('settings', {
    ...merged,
    finnhubKey: encryptSecret(merged.finnhubKey),
    ai: { ...merged.ai, apiKey: encryptSecret(merged.ai.apiKey) }
  })

  return getPublicSettings()
}

export function updateSettings(patch: Partial<AppSettings>): void {
  saveSettings(patch)
}
