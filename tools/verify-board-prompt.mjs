#!/usr/bin/env node
/**
 * 验证「AI 真的能拿到看板数字」：真实抓数据 → 组装 → 跑 buildMessages → 检查进模型的原文。
 *
 * 编译通过证明不了这件事：字段名拼错一个，prompt 里就是一片「—」，模型照样一本正经地编。
 * 用法：
 *   npx tsc -p tools/tsconfig.verify.json
 *   node tools/verify-board-prompt.mjs
 */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { homedir } from 'node:os'

const require = createRequire(import.meta.url)

let buildMessages, TencentProvider, SinaBoardProvider, SectorHistory, composeBoard, computeRotation
try {
  ;({ buildMessages } = require('../.logs/verify-build/main/ai/prompts.js'))
  ;({ TencentProvider } = require('../.logs/verify-build/main/market/tencent.js'))
  ;({ SinaBoardProvider } = require('../.logs/verify-build/main/market/sina_board.js'))
  ;({ SectorHistory } = require('../.logs/verify-build/main/market/snapshot.js'))
  ;({ composeBoard, computeRotation } = require('../.logs/verify-build/main/market/compose.js'))
} catch (err) {
  console.error('找不到编译产物，先跑：npx tsc -p tools/tsconfig.verify.json')
  console.error(String(err.message))
  process.exit(2)
}

const failures = []
function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name}${detail ? `（${detail}）` : ''}`)
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` = ${detail}` : ''}`)
}

const dir =
  process.env.STOCKLENS_SECTOR_DIR || join(homedir(), '.config', 'stocklens', 'sector-history')
const sectors = new SinaBoardProvider()
const [indices, industries, concepts] = await Promise.all([
  new TencentProvider().getIndices(),
  sectors.getSectors('industry'),
  sectors.getSectors('concept')
])

const board = composeBoard(indices, industries, concepts)
const history = new SectorHistory(dir)
const rotation = await computeRotation(history, board.industries, board.concepts, 10, 20)

console.log('— 轮动口径 —')
check(
  'basis 与历史天数自洽',
  rotation.basis === 'cumulative' ? rotation.historyDays >= 2 : rotation.historyDays < 2,
  `basis=${rotation.basis} historyDays=${rotation.historyDays}`
)

const messages = buildMessages({
  requestId: 'verify',
  task: 'rotation',
  symbol: 'sh000001',
  includeBoard: true,
  context: { board, rotation }
})

console.log('\n— 进模型的原文 —')
check('消息条数 = 2（system + user）', messages.length === 2, String(messages.length))
check(
  'system 是分析师人格且覆盖 A股',
  messages[0].role === 'system' && messages[0].content.includes('A股'),
  messages[0].content.slice(0, 24)
)

const user = messages[1].content
const mustHave = [
  ['任务指令', '产业轮动研判'],
  ['看板标题', '市场看板'],
  ['全球指数段', '### 全球指数'],
  ['行业段', '### A股行业板块'],
  ['概念段', '### A股概念板块'],
  ['资金主战场段', '### 资金主战场'],
  ['轮动段', '### 产业轮动'],
  ['基准指数名', '沪深300'],
  ['最强板块名', rotation.rising[0]?.name ?? ''],
  ['最弱板块名', rotation.falling[0]?.name ?? '']
]
for (const [label, needle] of mustHave) {
  check(`含${label}`, needle.length > 0 && user.includes(needle), needle)
}

if (rotation.basis === 'single-day') {
  check('单日口径写明了「不要据此断言产业趋势」', user.includes('不要据此断言产业趋势'))
}

const boardSection = user.split('## 市场看板')[1]?.split(/\n## /)[0] ?? ''
const dashes = (boardSection.match(/—/g) ?? []).length
check(
  '看板块的「—」（取不到的字段）不超过指数条数',
  dashes <= board.indices.length,
  `${dashes} 个 / 指数 ${board.indices.length} 个`
)

console.log('\n— 降级路径 —')
const degraded = buildMessages({ requestId: 'v2', task: 'rotation', includeBoard: true })
check(
  '取不到看板时明确告知模型别下结论',
  degraded[1].content.includes('看板数据获取失败'),
  ''
)

console.log('\n— 体量 —')
console.log(
  `看板块 ${boardSection.length} 字符（中文约 ${Math.round(boardSection.length / 1.6)} token）`
)
console.log(
  `行业 ${board.industries.length} 个全给；概念 ${board.concepts.length} 个只给超额最强/最弱各 15`
)

await history.save(board)
const stats = await history.stats()
console.log(`快照目录已累积 ${stats.days} 个交易日：${stats.from} → ${stats.to}`)

if (failures.length > 0) {
  console.error(`\n${failures.length} 项不通过`)
  process.exit(1)
}
console.log('\n全部通过：模型拿到的看板数字与数据源一致，口径提醒到位')
