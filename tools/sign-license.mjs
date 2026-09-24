#!/usr/bin/env node
/**
 * 许可证签发工具（发行方专用，绝不随应用分发）。
 *
 * 用法：
 *   node tools/sign-license.mjs --licensee "张三" --plan pro --days 365 --machine A1B2-C3D4-E5F6-7890
 *   node tools/sign-license.mjs --licensee "某某公司" --plan lifetime            # 不绑机器
 *
 * 参数：
 *   --licensee  被授权人/公司名（必填）
 *   --plan      trial | pro | lifetime（默认 pro）
 *   --days      有效天数，省略或传 0 表示永久
 *   --machine   绑定机器码；省略表示通用许可证
 */
import { createPrivateKey, sign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const privateKeyPath = resolve(here, '../.keys/license-private.pem')

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1]
  }
  return fallback
}

const licensee = arg('licensee').trim()
const plan = arg('plan', 'pro').trim()
const days = Number.parseInt(arg('days', '0'), 10) || 0
const machine = arg('machine').trim() || null

if (!licensee) {
  console.error('缺少 --licensee 参数')
  process.exit(1)
}
if (!['trial', 'pro', 'lifetime'].includes(plan)) {
  console.error('--plan 只能是 trial / pro / lifetime')
  process.exit(1)
}
if (!existsSync(privateKeyPath)) {
  console.error(`找不到私钥：${privateKeyPath}`)
  process.exit(1)
}

const now = Date.now()
const payload = {
  v: 1,
  licensee,
  plan,
  issuedAt: now,
  expiresAt: days > 0 ? now + days * 86_400_000 : null,
  machine
}

const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8')
const privateKey = createPrivateKey(readFileSync(privateKeyPath, 'utf8'))
const signature = sign(null, payloadBytes, privateKey)

const toBase64Url = (buffer) =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const licenseKey = `${toBase64Url(payloadBytes)}.${toBase64Url(signature)}`

console.log('--- 许可证信息 ---')
console.log(`被授权人：${licensee}`)
console.log(`套餐：${plan}`)
console.log(`到期：${payload.expiresAt ? new Date(payload.expiresAt).toISOString() : '永久'}`)
console.log(`绑定机器：${machine ?? '不绑定（通用）'}`)
console.log('--- 许可证密钥（发给客户） ---')
console.log(licenseKey)
