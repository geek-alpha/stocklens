#!/usr/bin/env node
/**
 * 市场看板真实网络端到端验证（不走 mock）。
 *
 * 与 verify-board-parse.mjs 的分工：那个用固定样本卡字段口径，这个证明「此刻真的能连上」。
 * 两者都不能省——样本测试在网络全挂时依然通过，真实测试才能发现源改版或 IP 被封。
 *
 * 用法：
 *   npx tsc -p tools/tsconfig.verify.json
 *   node tools/verify-board-live.mjs
 */
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

const failures = []
function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name}${detail ? `（${detail}）` : ''}`)
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` = ${detail}` : ''}`)
}

console.log('— 全球指数（腾讯）—')
const indices = await new TencentProvider().getIndices()
check('指数条数 >= 10', indices.length >= 10, String(indices.length))
check(
  '三地齐全',
  ['CN', 'HK', 'US'].every((r) => indices.some((i) => i.region === r)),
  [...new Set(indices.map((i) => i.region))].join(',')
)
check(
  '全部有价格与时间',
  indices.every((i) => i.price > 0 && i.marketTime > 0),
  `price/time 缺失 ${indices.filter((i) => !(i.price > 0) || !(i.marketTime > 0)).length} 个`
)
// marketTime 落在未来说明时区解析错了
const now = Math.floor(Date.now() / 1000)
check(
  '时间不在未来',
  indices.every((i) => i.marketTime <= now + 3600),
  `未来时间 ${indices.filter((i) => i.marketTime > now + 3600).length} 个`
)
for (const i of indices) {
  console.log(
    `   ${i.region.padEnd(2)} ${i.symbol.padEnd(10)} ${i.name.padEnd(8)} ${i.price} ${i.changePercent}%`
  )
}

console.log('\n— A股板块（新浪）—')
const sectors = new SinaBoardProvider()
const industries = await sectors.getSectors('industry')
const concepts = await sectors.getSectors('concept')

check('行业板块 >= 40', industries.length >= 40, String(industries.length))
check('概念板块 >= 150', concepts.length >= 150, String(concepts.length))
check(
  '行业全部有成交额',
  industries.every((s) => s.amount > 0),
  `缺 ${industries.filter((s) => !(s.amount > 0)).length} 个`
)
check(
  '涨跌幅不是全 0（源可能返回占位数据）',
  industries.some((s) => s.changePercent !== 0),
  `非零 ${industries.filter((s) => s.changePercent !== 0).length}/${industries.length}`
)

const top = [...industries].sort((a, b) => b.changePercent - a.changePercent).slice(0, 5)
const bottom = [...industries].sort((a, b) => a.changePercent - b.changePercent).slice(0, 5)
console.log('   涨幅前 5：')
for (const s of top) console.log(`     ${s.name.padEnd(10)} ${s.changePercent.toFixed(2)}%  领涨 ${s.leader?.name ?? '—'}`)
console.log('   跌幅前 5：')
for (const s of bottom) console.log(`     ${s.name.padEnd(10)} ${s.changePercent.toFixed(2)}%  领涨 ${s.leader?.name ?? '—'}`)

const total = industries.reduce((sum, s) => sum + s.amount, 0)
console.log(`   行业成交额合计：${(total / 1e8).toFixed(0)} 亿元`)

if (failures.length > 0) {
  console.error(`\n${failures.length} 项不通过`)
  process.exit(1)
}
console.log('\n全部通过：两个真实数据源此刻都可用，字段与时间口径正常')
