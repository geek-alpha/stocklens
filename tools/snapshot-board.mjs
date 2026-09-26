#!/usr/bin/env node
/**
 * 收盘后抓一次板块快照并落盘。不依赖 Electron，可直接挂 cron。
 *
 * 与 app 内 getBoard 共用 composeBoard，口径完全一致；区别只在这里没有 UI，
 * 且落盘前多一道质检——脏数据一旦写进序列，之后算出来的「相对强度斜率」全是假的，
 * 而假斜率会直接误导「哪个产业在崛起」的判断。宁可今天没有数据，也不写脏的。
 *
 * 用法：
 *   npm run snapshot:board
 *   STOCKLENS_SECTOR_DIR=/tmp/x node tools/snapshot-board.mjs
 */
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const require = createRequire(import.meta.url)

let TencentProvider, SinaBoardProvider, SectorHistory, composeBoard
try {
  ;({ TencentProvider } = require('../.logs/verify-build/main/market/tencent.js'))
  ;({ SinaBoardProvider } = require('../.logs/verify-build/main/market/sina_board.js'))
  ;({ SectorHistory } = require('../.logs/verify-build/main/market/snapshot.js'))
  ;({ composeBoard } = require('../.logs/verify-build/main/market/compose.js'))
} catch (err) {
  console.error('找不到编译产物，先跑：npx tsc -p tools/tsconfig.verify.json')
  console.error(String(err.message))
  process.exit(2)
}

const dir =
  process.env.STOCKLENS_SECTOR_DIR || join(homedir(), '.config', 'stocklens', 'sector-history')
const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ')
const log = (msg) => console.log(`[${stamp}] ${msg}`)

function bail(reason) {
  console.error(`[${stamp}] 放弃落盘：${reason}`)
  process.exit(1)
}

let indices, industries, concepts
try {
  const sectors = new SinaBoardProvider()
  ;[indices, industries, concepts] = await Promise.all([
    new TencentProvider().getIndices(),
    sectors.getSectors('industry'),
    sectors.getSectors('concept')
  ])
} catch (err) {
  bail(`抓取失败：${String(err?.message ?? err)}`)
}

if (indices.length < 10) bail(`指数只拿到 ${indices.length} 个`)
const regions = new Set(indices.map((i) => i.region))
if (!['CN', 'HK', 'US'].every((r) => regions.has(r))) {
  bail(`指数缺少地区：${[...regions].join(',')}`)
}
if (indices.some((i) => !(i.price > 0) || !(i.marketTime > 0))) {
  bail('指数存在无价格或无时间的条目')
}
if (industries.length < 40) bail(`行业板块只拿到 ${industries.length} 个`)
if (!industries.every((s) => s.amount > 0)) bail('行业板块存在成交额为 0 的条目')
if (!industries.some((s) => s.changePercent !== 0)) bail('行业涨跌幅全为 0（源返回占位数据）')

const board = composeBoard(indices, industries, concepts)
const totalYi = board.totalAmount / 1e8
if (totalYi < 1000) bail(`全市场成交额仅 ${totalYi.toFixed(0)} 亿，数据不完整`)

await new SectorHistory(dir).save(board)

// 落盘后读回：证明写进去的确实是这份数据，而不是一个空文件
let savedCount = -1
try {
  const saved = JSON.parse(await readFile(join(dir, `${board.tradeDate}.json`), 'utf-8'))
  savedCount = saved.sectors.length
} catch (err) {
  bail(`落盘后读回失败：${String(err?.message ?? err)}`)
}
const expected = board.industries.length + board.concepts.length
if (savedCount !== expected) bail(`读回校验不一致：落盘 ${savedCount} 个板块，应为 ${expected}`)

const benchmark = board.indices.find((i) => i.symbol === 'sh000300')?.changePercent ?? 0
const strongest = [...board.industries].sort(
  (a, b) => (b.relativeStrength ?? 0) - (a.relativeStrength ?? 0)
)[0]

log(
  `已落盘 ${board.tradeDate}：指数 ${board.indices.length}｜行业 ${board.industries.length}｜概念 ${board.concepts.length}`
)
log(
  `全市场成交额 ${totalYi.toFixed(0)} 亿｜沪深300 ${benchmark.toFixed(2)}%｜最强行业 ${strongest.name} ${strongest.changePercent.toFixed(2)}%（超额 ${(strongest.relativeStrength ?? 0).toFixed(2)}pp）`
)
log(`目录 ${dir}`)
