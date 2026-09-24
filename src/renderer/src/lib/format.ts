import { format } from 'date-fns'

export function fmtPrice(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(digits)
}

export function fmtSigned(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
}

export function fmtPercent(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

/** 成交量按中文习惯缩写 */
export function fmtVolume(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value === 0) return '—'
  const abs = Math.abs(value)
  if (abs >= 1e8) return `${(value / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(value / 1e4).toFixed(2)}万`
  return value.toFixed(0)
}

/** 涨跌配色：美股口径，绿涨红跌 */
export function changeClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value) || value === 0) return 'text-slate-400'
  return value > 0 ? 'text-bull' : 'text-bear'
}

export function fmtClock(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return '—'
  return format(new Date(epochSeconds * 1000), 'MM-dd HH:mm')
}

export function fmtDateTime(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return '—'
  return format(new Date(epochSeconds * 1000), 'yyyy-MM-dd HH:mm:ss')
}

/** 美东时间，美股交易时段判断用 */
export function fmtEastern(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(epochSeconds * 1000))
}

export function fmtRelative(epochSeconds: number | null | undefined): string {
  if (!epochSeconds) return '—'
  const diff = Date.now() - epochSeconds * 1000
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function fmtDaysLeft(days: number | null | undefined): string {
  if (days == null) return '永久有效'
  if (days <= 0) return '已过期'
  return `剩余 ${days} 天`
}
