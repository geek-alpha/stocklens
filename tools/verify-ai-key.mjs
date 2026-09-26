/**
 * AI 密钥读写链路回归验证。
 *
 * store.ts 依赖 electron / electron-store，无法在纯 node 下 import，
 * 因此这里从源码里抠出函数与默认配置、注入 safeStorage / store 桩后执行——测的是真源码，不是抄一遍的副本。
 * 覆盖四类历史故障：
 *   1. 写时加密、读时不解密（Key 以 enc: 密文送进 OpenAI 客户端 → 401）
 *   2. 重复保存导致密文层层嵌套（enc:enc:…）
 *   3. 掩码形状误判（新 Key 粘在掩码后面被当成「没改」而静默丢弃）
 *   4. getSettings 解密能力被改回去（行为级断言，不是字符串匹配）
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/main/store.ts'), 'utf8')

/** 源码是 TS、桩沙箱是纯 JS：去掉参数与返回值的类型标注 */
function stripTypes(code) {
  return code.replace(/:\s*(string|boolean|number|void|AppSettings|AiConfig)\b/g, '')
}

function extractFunction(name) {
  const hit = source.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm'))
  if (!hit) throw new Error(`store.ts 里找不到函数 ${name}，脚本需要跟着改`)
  return stripTypes(hit[0].replace(/^export /, ''))
}

function extractConst(name) {
  const hit = source.match(new RegExp(`(?:export )?const ${name}[^=]*= \\{[\\s\\S]*?\\n\\}`, 'm'))
  if (!hit) throw new Error(`store.ts 里找不到常量 ${name}，脚本需要跟着改`)
  return stripTypes(hit[0].replace(/^export /, ''))
}

const constants = ['SECRET_PREFIX', 'PLAIN_PREFIX', 'MASK'].map((name) => {
  const hit = source.match(new RegExp(`const ${name} = ('[^']*')`))
  if (!hit) throw new Error(`store.ts 里找不到常量 ${name}`)
  return `const ${name} = ${hit[1]}`
})

const prelude = `
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from('ENC(' + plain + ')'),
    decryptString: (buf) => {
      const text = buf.toString()
      if (!text.startsWith('ENC(')) throw new Error('bad cipher')
      return text.slice(4, -1)
    }
  }
  ${constants.join('\n')}
  ${extractFunction('encryptSecret')}
  ${extractFunction('decryptSecret')}
  ${extractFunction('maskSecret')}
  ${extractFunction('isMaskShape')}
  ${extractFunction('resolveSecretInput')}
  ${extractFunction('unwrapSecret')}
`

/** fakeSettings 模拟 electron-store 里落盘的那份数据 */
function makeStore(fakeSettings) {
  return new Function(`${prelude}
    ${extractConst('DEFAULT_AI')}
    ${extractConst('DEFAULT_SETTINGS')}
    const store = { get: () => (${JSON.stringify(fakeSettings)}) }
    ${extractFunction('getSettings')}
    return { encryptSecret, maskSecret, isMaskShape, resolveSecretInput, unwrapSecret, getSettings }
  `)()
}

const store = makeStore(null)
const results = []

function check(name, run) {
  try {
    run()
    results.push(`  PASS  ${name}`)
  } catch (err) {
    results.push(`  FAIL  ${name}\n        ${err.message}`)
    process.exitCode = 1
  }
}

const cipher = store.encryptSecret('sk-live-abcdefghijklmn')

check('加密后能原样读回（写读对称）', () => {
  assert.equal(store.unwrapSecret(cipher), 'sk-live-abcdefghijklmn')
})

check('历史双层密文能剥干净', () => {
  const twice = store.encryptSecret(store.encryptSecret('sk-legacy-123456'))
  assert.equal(store.unwrapSecret(twice), 'sk-legacy-123456')
})

check('明文降级前缀 plain: 能读回', () => {
  assert.equal(store.unwrapSecret('plain:sk-plain-123456'), 'sk-plain-123456')
})

check('空串与无前缀明文原样返回', () => {
  assert.equal(store.unwrapSecret(''), '')
  assert.equal(store.unwrapSecret('sk-raw-123456'), 'sk-raw-123456')
})

check('掩码形状判定：真掩码为真，拼接串为假', () => {
  assert.equal(store.isMaskShape(store.maskSecret('sk-1234567890')), true)
  assert.equal(store.isMaskShape('****'), true)
  assert.equal(store.isMaskShape('sk-****abcdsk-newkey'), false)
  assert.equal(store.isMaskShape('sk-newkey-without-mask'), false)
})

check('纯掩码=用户没改，沿用已存明文', () => {
  assert.equal(store.resolveSecretInput(store.maskSecret('sk-1234567890'), 'sk-saved-real'), 'sk-saved-real')
})

check('填了新 Key 就用新 Key', () => {
  assert.equal(store.resolveSecretInput('sk-brand-new-key', 'sk-saved-real'), 'sk-brand-new-key')
})

check('掩码混进新 Key 时报错，不静默丢弃', () => {
  assert.throws(() => store.resolveSecretInput('sk-****7890sk-brand-new', 'sk-saved-real'), /掩码/)
})

check('落盘密文经 getSettings 读出来是明文（根因回归）', () => {
  const withCipher = makeStore({
    ai: {
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: cipher,
      model: 'gpt-4o-mini',
      temperature: 0.3
    },
    finnhubKey: store.encryptSecret('fh-secret')
  })
  const settings = withCipher.getSettings()
  assert.equal(settings.ai.apiKey, 'sk-live-abcdefghijklmn')
  assert.equal(settings.finnhubKey, 'fh-secret')
})

check('历史双层密文的配置也能读出明文', () => {
  const legacy = makeStore({
    ai: {
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: store.encryptSecret(store.encryptSecret('sk-double-wrapped')),
      model: 'gpt-4o-mini',
      temperature: 0.3
    }
  })
  assert.equal(legacy.getSettings().ai.apiKey, 'sk-double-wrapped')
})

check('空配置回落默认值，不炸', () => {
  const empty = makeStore(null)
  const settings = empty.getSettings()
  assert.equal(settings.ai.apiKey, '')
  assert.equal(settings.ai.baseUrl, 'https://api.openai.com/v1')
  assert.deepEqual(settings.watchlist, ['AAPL', 'NVDA', 'MSFT', 'TSLA', 'SPY', 'QQQ'])
})

console.log(results.join('\n'))
console.log(process.exitCode ? '\n❌ AI 密钥链路验证失败' : '\n✅ AI 密钥链路验证通过')
