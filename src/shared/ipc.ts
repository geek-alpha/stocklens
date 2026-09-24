/** IPC 通道名集中定义：主进程与 preload 共用，禁止在别处硬编码字符串。 */
export const IPC = {
  quoteGet: 'market:quote',
  candlesGet: 'market:candles',
  searchSymbols: 'market:search',
  newsGet: 'market:news',
  settingsGet: 'app:settings:get',
  settingsSet: 'app:settings:set',
  licenseGet: 'license:get',
  licenseActivate: 'license:activate',
  aiAnalyze: 'ai:analyze',
  aiCancel: 'ai:cancel',
  appInfo: 'app:info'
} as const

/** 主进程 → 渲染进程的单向推送通道 */
export const IPC_PUSH = {
  aiChunk: 'ai:chunk'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export type IpcPushChannel = (typeof IPC_PUSH)[keyof typeof IPC_PUSH]
