import { useEffect, useRef } from 'react'
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type UTCTimestamp
} from 'lightweight-charts'
import type { BarInterval, Candle } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'

const MA_CONFIG = [
  { period: 5, color: '#f59e0b' },
  { period: 10, color: '#3b82f6' },
  { period: 20, color: '#a855f7' }
]

const UP_COLOR = '#26a69a'
const DOWN_COLOR = '#ef5350'

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

/**
 * 日线及以上用日期字符串，避免 lightweight-charts 把 UTC 秒按本地时区渲染而偏移一天；
 * 日内周期才用秒级时间戳。
 */
function toChartTime(time: number, interval: BarInterval): UTCTimestamp | string {
  if (interval === '1d' || interval === '1wk' || interval === '1mo') {
    const date = new Date(time * 1000)
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  }
  return time as UTCTimestamp
}

function movingAverage(
  candles: Candle[],
  period: number,
  interval: BarInterval
): LineData[] {
  const result: LineData[] = []
  let sum = 0
  for (let i = 0; i < candles.length; i += 1) {
    sum += candles[i].close
    if (i >= period) sum -= candles[i - period].close
    if (i >= period - 1) {
      result.push({
        time: toChartTime(candles[i].time, interval) as UTCTimestamp,
        value: sum / period
      })
    }
  }
  return result
}

export default function ChartPanel() {
  const candles = useAppStore((s) => s.candles)
  const loading = useAppStore((s) => s.loadingCandles)
  const activeSymbol = useAppStore((s) => s.activeSymbol)
  const interval = useAppStore((s) => s.interval)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const maSeriesRef = useRef<Array<ISeriesApi<'Line'>>>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#0f1319' },
        textColor: '#8b98a9',
        fontSize: 11
      },
      grid: {
        vertLines: { color: 'rgba(42,50,62,0.5)' },
        horzLines: { color: 'rgba(42,50,62,0.5)' }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3b82f6', width: 1, style: 3, labelBackgroundColor: '#1f2630' },
        horzLine: { color: '#3b82f6', width: 1, style: 3, labelBackgroundColor: '#1f2630' }
      },
      rightPriceScale: { borderColor: '#2a323e', scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderColor: '#2a323e', timeVisible: true, secondsVisible: false },
      handleScroll: true,
      handleScale: true,
      autoSize: true
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR
    })

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume'
    })
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 }
    })

    const maSeries = MA_CONFIG.map((config) =>
      chart.addLineSeries({
        color: config.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false
      })
    )

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries
    maSeriesRef.current = maSeries

    return () => {
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
      volumeSeriesRef.current = null
      maSeriesRef.current = []
    }
  }, [])

  useEffect(() => {
    const candleSeries = candleSeriesRef.current
    const volumeSeries = volumeSeriesRef.current
    const chart = chartRef.current
    if (!candleSeries || !volumeSeries || !chart) return

    if (candles.length === 0) {
      candleSeries.setData([])
      volumeSeries.setData([])
      maSeriesRef.current.forEach((series) => series.setData([]))
      return
    }

    candleSeries.setData(
      candles.map((candle) => ({
        time: toChartTime(candle.time, interval) as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close
      }))
    )

    volumeSeries.setData(
      candles.map((candle) => ({
        time: toChartTime(candle.time, interval) as UTCTimestamp,
        value: candle.volume,
        color: candle.close >= candle.open ? 'rgba(38,166,154,0.45)' : 'rgba(239,83,80,0.45)'
      }))
    )

    MA_CONFIG.forEach((config, index) => {
      const series = maSeriesRef.current[index]
      if (series) series.setData(movingAverage(candles, config.period, interval))
    })

    chart.timeScale().fitContent()
  }, [candles, interval])

  return (
    <div className="relative min-h-0 flex-1 bg-surface-900">
      <div className="pointer-events-none absolute left-3 top-2 z-10 flex items-center gap-3 text-[11px]">
        <span className="num text-slate-400">{activeSymbol}</span>
        {MA_CONFIG.map((config) => (
          <span key={config.period} style={{ color: config.color }}>
            MA{config.period}
          </span>
        ))}
      </div>

      <div ref={containerRef} className="h-full w-full" />

      {loading ? (
        <div className="absolute right-3 top-2 z-10 rounded bg-surface-800/90 px-2 py-1 text-[11px] text-slate-400">
          加载中…
        </div>
      ) : null}

      {!loading && candles.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-600">
          暂无 K 线数据
        </div>
      ) : null}
    </div>
  )
}
