import type { StockLensApi } from '@shared/api'

/** preload 注入的唯一入口，全局只在这里取一次，方便后续替换/打桩 */
export const api: StockLensApi = window.api

export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  return '发生未知错误'
}

/** 统一的失败兜底：失败时回调提示并返回 null，调用方不必到处写 try/catch */
export async function safeCall<T>(
  action: () => Promise<T>,
  onError: (message: string) => void
): Promise<T | null> {
  try {
    return await action()
  } catch (err) {
    onError(errorMessage(err))
    return null
  }
}
