import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { arch, cpus, hostname, networkInterfaces, platform } from 'node:os'
import Store from 'electron-store'
import type { LicenseState } from '@shared/types'
import { LICENSE_PUBLIC_KEY_PEM } from './public-key'

/**
 * 离线许可证：Ed25519 签名 + 一机一码。
 * 应用只带公钥，只能验签不能签发；私钥在发行方手里。
 */

export interface LicensePayload {
  v: number
  licensee: string
  plan: 'trial' | 'pro' | 'lifetime'
  issuedAt: number
  expiresAt: number | null
  /** null 表示不绑定设备（通用许可证） */
  machine: string | null
}

interface LicenseStoreShape {
  key: string
  activatedAt: number
}

const store = new Store<LicenseStoreShape>({
  name: 'stocklens-license',
  defaults: { key: '', activatedAt: 0 }
})

export function getMachineCode(): string {
  const macs: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.mac && item.mac !== '00:00:00:00:00:00' && !item.internal) {
        macs.push(item.mac)
      }
    }
  }
  macs.sort()
  const raw = [hostname(), platform(), arch(), cpus()[0]?.model ?? '', macs[0] ?? ''].join('|')
  const digest = createHash('sha256').update(raw).digest('hex').toUpperCase().slice(0, 16)
  return digest.match(/.{4}/g)?.join('-') ?? digest
}

function fromBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(normalized, 'base64')
}

/** 只做「格式 + 签名」校验，设备绑定与过期由调用方判断 */
export function parseLicenseKey(key: string): { payload: LicensePayload } | { error: string } {
  const parts = key.trim().split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { error: '许可证格式不正确' }
  }

  let payloadBytes: Buffer
  let payload: LicensePayload
  try {
    payloadBytes = fromBase64Url(parts[0])
    payload = JSON.parse(payloadBytes.toString('utf8')) as LicensePayload
  } catch {
    return { error: '许可证内容无法解析' }
  }

  if (!payload || typeof payload.licensee !== 'string') {
    return { error: '许可证内容不完整' }
  }

  try {
    const publicKey = createPublicKey(LICENSE_PUBLIC_KEY_PEM)
    const valid = cryptoVerify(null, payloadBytes, publicKey, fromBase64Url(parts[1]))
    if (!valid) {
      return { error: '签名校验失败：许可证可能被篡改或来自其他发行方' }
    }
  } catch {
    return { error: '签名校验过程异常' }
  }

  return { payload }
}

export function getLicenseState(): LicenseState {
  const machineCode = getMachineCode()
  const stored = store.get('key')

  if (!stored) {
    return {
      status: 'unactivated',
      plan: 'trial',
      licensee: '',
      expiresAt: null,
      daysLeft: null,
      machineCode
    }
  }

  const parsed = parseLicenseKey(stored)
  if ('error' in parsed) {
    return {
      status: 'invalid',
      plan: 'trial',
      licensee: '',
      expiresAt: null,
      daysLeft: null,
      machineCode
    }
  }

  const { payload } = parsed
  if (payload.machine && payload.machine !== machineCode) {
    return {
      status: 'invalid',
      plan: payload.plan,
      licensee: payload.licensee,
      expiresAt: payload.expiresAt,
      daysLeft: null,
      machineCode
    }
  }

  const daysLeft = payload.expiresAt
    ? Math.max(0, Math.ceil((payload.expiresAt - Date.now()) / 86_400_000))
    : null

  if (payload.expiresAt && Date.now() > payload.expiresAt) {
    return {
      status: 'expired',
      plan: payload.plan,
      licensee: payload.licensee,
      expiresAt: payload.expiresAt,
      daysLeft: 0,
      machineCode
    }
  }

  return {
    status: 'active',
    plan: payload.plan,
    licensee: payload.licensee,
    expiresAt: payload.expiresAt,
    daysLeft,
    machineCode
  }
}

export function activateLicense(key: string, licensee: string): LicenseState {
  const parsed = parseLicenseKey(key)
  if ('error' in parsed) {
    throw new Error(parsed.error)
  }

  const { payload } = parsed
  const machineCode = getMachineCode()

  if (payload.machine && payload.machine !== machineCode) {
    throw new Error(`该许可证绑定设备 ${payload.machine}，与本机（${machineCode}）不一致`)
  }
  if (payload.expiresAt && Date.now() > payload.expiresAt) {
    throw new Error('该许可证已过期')
  }
  if (licensee.trim() && payload.licensee.trim() && licensee.trim() !== payload.licensee.trim()) {
    throw new Error(`被授权人不匹配：许可证属于「${payload.licensee}」`)
  }

  store.set('key', key.trim())
  store.set('activatedAt', Date.now())
  return getLicenseState()
}
