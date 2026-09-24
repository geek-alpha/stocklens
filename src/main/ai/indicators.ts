import type { Candle } from '@shared/types'

/**
 * 技术指标：全部在主进程用确定性算法算出精确值再交给模型。
 * 让 LLM 自己算 MA/RSI 会得到看似合理但错误的数字，这是产品级的硬伤。
 */

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null
  const slice = values.slice(-period)
  return slice.reduce((sum, v) => sum + v, 0) / period
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const out: number[] = [values[0]]
  for (let i = 1; i < values.length; i += 1) {
    out.push(values[i] * k + out[i - 1] * (1 - k))
  }
  return out
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

export interface MacdSnapshot {
  dif: number
  dea: number
  hist: number
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9): MacdSnapshot | null {
  if (values.length < slow + signal) return null
  const emaFast = emaSeries(values, fast)
  const emaSlow = emaSeries(values, slow)
  const difSeries = emaFast.map((v, i) => v - emaSlow[i])
  const deaSeries = emaSeries(difSeries, signal)
  const dif = difSeries[difSeries.length - 1]
  const dea = deaSeries[deaSeries.length - 1]
  return { dif, dea, hist: (dif - dea) * 2 }
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length <= period) return null
  const trs: number[] = []
  for (let i = 1; i < candles.length; i += 1) {
    const prevClose = candles[i - 1].close
    const { high, low } = candles[i]
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)))
  }
  return sma(trs, period)
}

export interface TechnicalSnapshot {
  price: number
  bars: number
  ma5: number | null
  ma10: number | null
  ma20: number | null
  ma60: number | null
  rsi14: number | null
  macd: MacdSnapshot | null
  atr14: number | null
  volumeRatio: number | null
  high20: number
  low20: number
  changePercent: number
  trend: '多头排列' | '空头排列' | '震荡'
}

export function buildTechnicalSnapshot(candles: Candle[]): TechnicalSnapshot | null {
  if (candles.length < 2) return null
  const closes = candles.map((c) => c.close)
  const volumes = candles.map((c) => c.volume)
  const last = closes[closes.length - 1]
  const prev = closes[closes.length - 2]

  const ma5 = sma(closes, 5)
  const ma10 = sma(closes, 10)
  const ma20 = sma(closes, 20)
  const ma60 = sma(closes, 60)

  const window20 = candles.slice(-20)
  const high20 = Math.max(...window20.map((c) => c.high))
  const low20 = Math.min(...window20.map((c) => c.low))

  const avgVolume = sma(volumes, 20)

  let trend: TechnicalSnapshot['trend'] = '震荡'
  if (ma5 != null && ma10 != null && ma20 != null) {
    if (ma5 > ma10 && ma10 > ma20) trend = '多头排列'
    else if (ma5 < ma10 && ma10 < ma20) trend = '空头排列'
  }

  return {
    price: last,
    bars: candles.length,
    ma5,
    ma10,
    ma20,
    ma60,
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    atr14: atr(candles, 14),
    volumeRatio: avgVolume ? volumes[volumes.length - 1] / avgVolume : null,
    high20,
    low20,
    changePercent: prev ? ((last - prev) / prev) * 100 : 0,
    trend
  }
}
