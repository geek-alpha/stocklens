#!/usr/bin/env node
/**
 * 行情解析离线验证：用真实抓取到的东财响应样本喂给解析器，检查字段口径。
 *
 * 为什么需要它：东财接口对高频访问会临时封 IP（实测会直接断 TLS），
 * 网络不通时仍然要能验证「解析逻辑对不对」。样本取自 2026-09-24 的真实响应，
 * 其中的开/高/低/收可与腾讯报价交叉核对（今开 336.72 / 高 338.91 / 低 334.30 / 现价 335.92）。
 *
 * 用法：
 *   npx tsc -p tools/tsconfig.verify.json
 *   node tools/verify-market-parse.mjs
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const SUGGEST_SAMPLE = {
  QuotationCodeTable: {
    Data: [
      { Code: 'AAPL', Name: '苹果', JYS: 'NASDAQ', Classify: 'UsStock', QuoteID: '105.AAPL' }
    ]
  }
}

const KLINE_SAMPLE = {
  rc: 0,
  data: {
    code: 'AAPL',
    market: 105,
    name: '苹果',
    decimal: 3,
    dktotal: 10595,
    preKPrice: 337.0,
    klines: [
      '2026-09-18,337.905,336.130,338.490,332.530,86588203,29099784704.000',
      '2026-09-21,335.280,338.980,339.640,333.050,34999229,11825994496.000',
      '2026-09-22,340.135,339.750,345.340,338.750,40711786,13881350400.000',
      '2026-09-23,341.075,337.020,341.800,335.500,31658823,10682679040.000',
      '2026-09-24,336.720,335.920,338.910,334.300,24358816,8201883136.000'
    ]
  }
}

let { EastMoneyProvider } = {}
try {
  ;({ EastMoneyProvider } = require('../.logs/verify-build/main/market/eastmoney.js'))
} catch (err) {
  console.error('找不到编译产物，先跑：npx tsc -p tools/tsconfig.verify.json')
  console.error(String(err.message))
  process.exit(2)
}

const requested = []
global.fetch = async (url) => {
  requested.push(String(url))
  const body = String(url).includes('suggest') ? SUGGEST_SAMPLE : KLINE_SAMPLE
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

const failures = []
function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failures.push(`${name}: 期望 ${expected}，实际 ${actual}`)
  console.log(`${ok ? '✔' : '✘'} ${name} = ${actual}${ok ? '' : `（期望 ${expected}）`}`)
}

const provider = new EastMoneyProvider()
const candles = await provider.getCandles('AAPL', '1d', '6mo')

check('K 线条数', candles.length, 5)

const last = candles[candles.length - 1]
// 字段顺序必须是 日期,开,收,高,低,量 —— 写成 OHLC 会让高低互换，这里就是护栏
check('最后一条 open', last.open, 336.72)
check('最后一条 close', last.close, 335.92)
check('最后一条 high', last.high, 338.91)
check('最后一条 low', last.low, 334.3)
check('最后一条 volume', last.volume, 24358816)
check('最后一条 time(UTC 午夜)', last.time, Date.UTC(2026, 8, 24) / 1000)

const first = candles[0]
check('首条 close', first.close, 336.13)
check('首条 high', first.high, 338.49)

check('secid 解析走搜索接口', requested.some((u) => u.includes('105.AAPL')), true)

if (failures.length > 0) {
  console.error(`\n${failures.length} 项不通过`)
  process.exit(1)
}
console.log('\n全部通过：东财 K 线字段口径与时间转换正确')
