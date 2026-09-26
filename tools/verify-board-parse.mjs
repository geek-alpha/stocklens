#!/usr/bin/env node
/**
 * 市场看板解析离线验证：把真实抓到的响应字节喂给解析器，逐字段核对口径。
 *
 * 为什么必须离线：腾讯单次请求超过 12 个代码会静默截断（第 13 个起不返回），
 * 而这类截断在真实环境里表现为「少了几条数据」，不会报错——只能靠固定样本卡住。
 * 样本是 2026-09-24/25 的真实响应原始字节（GBK 未转码），字段值可与公开行情核对。
 *
 * 用法：
 *   npx tsc -p tools/tsconfig.verify.json
 *   node tools/verify-board-parse.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let SinaBoardProvider, TencentProvider
try {
  ;({ SinaBoardProvider } = require('../.logs/verify-build/main/market/sina_board.js'))
  ;({ TencentProvider } = require('../.logs/verify-build/main/market/tencent.js'))
} catch (err) {
  console.error('找不到编译产物，先跑：npx tsc -p tools/tsconfig.verify.json')
  console.error(String(err.message))
  process.exit(2)
}

const sample = (name) => readFileSync(new URL(`./samples/${name}`, import.meta.url))

const SAMPLES = {
  industry: sample('sina-industry.gbk.txt'),
  concept: sample('sina-concept.gbk.txt'),
  indices: sample('tencent-indices.gbk.txt')
}

const requested = []
global.fetch = async (url) => {
  const target = String(url)
  requested.push(target)

  let body
  if (target.includes('newSinaHy')) body = SAMPLES.industry
  else if (target.includes('newFLJK')) body = SAMPLES.concept
  else if (target.includes('qt.gtimg.cn')) body = SAMPLES.indices
  else throw new Error(`未预期的请求：${target}`)

  return new Response(body, { status: 200 })
}

const failures = []
function check(name, actual, expected) {
  const ok = actual === expected
  if (!ok) failures.push(`${name}: 期望 ${expected}，实际 ${actual}`)
  console.log(`${ok ? '✔' : '✘'} ${name} = ${actual}${ok ? '' : `（期望 ${expected}）`}`)
}

/* ---------- 板块 ---------- */
const board = new SinaBoardProvider()
const industries = await board.getSectors('industry')
const concepts = await board.getSectors('concept')

// 新浪只提供粗分类：49 个行业 + 175 个概念。东财的 496/504 更全但实测被封 IP，
// 所以断言用下限而不是精确值——数量随新浪调整会变，关键板块的字段口径才是要卡住的东西。
check('行业板块数 >= 40', industries.length >= 40, true)
check('概念板块数 >= 150', concepts.length >= 150, true)
console.log(`  （实际：行业 ${industries.length} 个，概念 ${concepts.length} 个）`)

const glass = industries.find((s) => s.code === 'new_blhy')
check('玻璃行业存在', Boolean(glass), true)
if (glass) {
  check('玻璃行业名称', glass.name, '玻璃行业')
  check('玻璃行业成分股数', glass.memberCount, 19)
  check('玻璃行业涨跌幅', glass.changePercent, -2.3238668200183)
  check('玻璃行业成交额', glass.amount, 17402360459)
  check('玻璃行业领涨股代码', glass.leader?.symbol, 'sh603601')
  check('玻璃行业领涨股名称', glass.leader?.name, '再升科技')
  check('玻璃行业领涨股涨幅', glass.leader?.changePercent, 4.644)
  // 相对强度由 MarketBoardService 回填，provider 层必须留空，否则会被误当成真实值
  check('provider 层相对强度为空', glass.relativeStrength, null)
}

const huawei = concepts.find((s) => s.code === 'gn_hwqc')
check('华为汽车概念存在', Boolean(huawei), true)
if (huawei) {
  check('华为汽车成分股数', huawei.memberCount, 97)
  check('华为汽车涨跌幅', huawei.changePercent, -2.3233898745694)
  check('华为汽车成交额', huawei.amount, 28685781469)
  check('华为汽车领涨股', huawei.leader?.symbol, 'sz000829')
  check('华为汽车领涨股名称', huawei.leader?.name, '天音控股')
}

/* ---------- 全球指数 ---------- */
const tencent = new TencentProvider()
const indices = await tencent.getIndices()

check('指数条数', indices.length, 12)

const byId = new Map(indices.map((i) => [i.symbol, i]))

const sh = byId.get('sh000001')
check('上证指数存在', Boolean(sh), true)
if (sh) {
  check('上证 name', sh.name, '上证指数')
  check('上证 region', sh.region, 'CN')
  check('上证 price', sh.price, 3888.37)
  check('上证 previousClose', sh.previousClose, 3936.52)
  check('上证 change', sh.change, -48.15)
  check('上证 changePercent', sh.changePercent, -1.22)
  // 成交额字段单位是万元：78361300 万元 = 7836.13 亿元
  check('上证 amount(元)', sh.amount, 783613000000)
  // A股时间格式 20260924161401 必须按北京时间解析，差 8 小时会让交易日跨天
  check('上证 marketTime', sh.marketTime, Date.parse('2026-09-24T16:14:01+08:00') / 1000)
}

const hsi = byId.get('hkHSI')
check('恒生指数存在', Boolean(hsi), true)
if (hsi) {
  check('恒生 region', hsi.region, 'HK')
  check('恒生 price', hsi.price, 24510.09)
  check('恒生 changePercent', hsi.changePercent, -1.01)
  // 港股是斜杠时间格式，漏掉这条分支会静默退回当前时间
  check('恒生 marketTime', hsi.marketTime, Date.parse('2026-09-25T18:31:13+08:00') / 1000)
}

const dji = byId.get('usDJI')
check('道琼斯存在', Boolean(dji), true)
if (dji) {
  check('道指 region', dji.region, 'US')
  check('道指 price', dji.price, 51828.62)
  check('道指 changePercent', dji.changePercent, 0.93)
  // 美股成交额口径无法确认，必须是 0 而不是猜出来的天文数字
  check('道指 amount 未提供', dji.amount, 0)
  check('道指 marketTime(美东夏令时)', dji.marketTime, Date.parse('2026-09-25T17:05:01-04:00') / 1000)
}

check('分三地覆盖', [...new Set(indices.map((i) => i.region))].sort().join(','), 'CN,HK,US')

/* ---------- 请求分批 ---------- */
check('指数请求数（12 个正好一批）', requested.filter((u) => u.includes('qt.gtimg.cn')).length, 1)

if (failures.length > 0) {
  console.error(`\n${failures.length} 项不通过`)
  process.exit(1)
}
console.log('\n全部通过：板块与全球指数字段口径、三种时间格式、成交额单位均正确')
