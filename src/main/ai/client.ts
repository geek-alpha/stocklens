import OpenAI from 'openai'
import type {
  AiAnalyzeRequest,
  AiContextPayload,
  AiResult,
  AiStreamChunk,
  AppSettings,
  MarketBoard,
  SectorRotation
} from '@shared/types'
import { buildMessages } from './prompts'

/**
 * AI 服务：OpenAI 兼容协议，因此 OpenAI / DeepSeek / Moonshot / 自建网关都能直接用。
 * 流式输出逐段推给渲染进程；支持按 requestId 取消（用户点「停止生成」）。
 */
export class AiService {
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly settings: () => AppSettings,
    private readonly emit: (chunk: AiStreamChunk) => void,
    /** 看板数据按需加载：一次抓取要打三个接口，闲聊不该付这个成本 */
    private readonly loadBoard?: () => Promise<{ board: MarketBoard; rotation: SectorRotation }>
  ) {}

  async analyze(req: AiAnalyzeRequest): Promise<AiResult> {
    const config = this.settings().ai
    if (!config.apiKey.trim()) {
      const error = '尚未配置 AI API Key，请到「设置 → AI」里填写'
      this.emit({ requestId: req.requestId, delta: '', done: true, error })
      return { requestId: req.requestId, ok: false, error }
    }

    const controller = new AbortController()
    this.controllers.set(req.requestId, controller)

    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        timeout: 120_000,
        maxRetries: 1
      })

      const stream = await client.chat.completions.create(
        {
          model: config.model,
          temperature: config.temperature,
          stream: true,
          messages: buildMessages({ ...req, context: await this.resolveContext(req) })
        },
        { signal: controller.signal }
      )

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          this.emit({ requestId: req.requestId, delta, done: false })
        }
      }

      this.emit({ requestId: req.requestId, delta: '', done: true })
      return { requestId: req.requestId, ok: true }
    } catch (err) {
      const message = normalizeAiError(err)
      this.emit({ requestId: req.requestId, delta: '', done: true, error: message })
      return { requestId: req.requestId, ok: false, error: message }
    } finally {
      this.controllers.delete(req.requestId)
    }
  }

  /**
   * 看板数据由主进程现取，不用渲染进程传的。
   * 取失败时降级成无看板数据，由提示词明确告知模型——不能让模型把「没拿到数据」当成「没有异动」。
   */
  private async resolveContext(req: AiAnalyzeRequest): Promise<AiContextPayload | undefined> {
    if (!req.includeBoard || !this.loadBoard) return req.context
    try {
      const { board, rotation } = await this.loadBoard()
      return { ...req.context, board, rotation }
    } catch {
      return req.context
    }
  }

  cancel(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (controller) {
      controller.abort()
      this.controllers.delete(requestId)
    }
  }

  cancelAll(): void {
    this.controllers.forEach((controller) => controller.abort())
    this.controllers.clear()
  }
}

function normalizeAiError(err: unknown): string {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401) return 'AI 服务认证失败：API Key 无效'
    if (err.status === 429) return 'AI 服务限流或余额不足，请稍后再试'
    if (err.status === 404) return `模型不存在或 Base URL 有误：${err.message}`
    return `AI 服务返回错误（${err.status ?? 'unknown'}）：${err.message}`
  }
  const message = err instanceof Error ? err.message : String(err)
  if (message.toLowerCase().includes('abort')) return '已取消生成'
  if (message.toLowerCase().includes('fetch failed')) {
    return 'AI 服务连接失败，请检查网络或 Base URL'
  }
  return `AI 调用失败：${message}`
}
