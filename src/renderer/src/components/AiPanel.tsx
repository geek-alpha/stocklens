import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ChartLine,
  CircleStop,
  Eraser,
  LoaderCircle,
  Newspaper,
  Search,
  Send,
  Sparkles
} from 'lucide-react'
import type { AiTask } from '@shared/types'
import { TASK_LABELS, useAppStore, type AiMessage } from '@renderer/store/useAppStore'

const QUICK_TASKS: Array<{ task: AiTask; label: string; icon: typeof Sparkles }> = [
  { task: 'brief', label: '盘面速读', icon: Sparkles },
  { task: 'technical', label: '技术面', icon: ChartLine },
  { task: 'news', label: '新闻解读', icon: Newspaper },
  { task: 'screen', label: '智能选股', icon: Search }
]

/** 极简 Markdown 渲染：加粗、行内代码、代码块、标题、列表，够用且不引第三方库 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let cursor = 0
  let match = pattern.exec(text)
  let index = 0

  while (match !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold text-slate-100">
          {token.slice(2, -2)}
        </strong>
      )
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c${index}`}
          className="rounded bg-surface-700 px-1 py-0.5 font-mono text-[11px] text-amber-200"
        >
          {token.slice(1, -1)}
        </code>
      )
    }
    cursor = match.index + token.length
    index += 1
    match = pattern.exec(text)
  }

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

function MarkdownBlock({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.split('\n')
    const output: ReactNode[] = []
    let codeBuffer: string[] = []
    let inCode = false

    lines.forEach((line, index) => {
      if (line.trim().startsWith('```')) {
        if (inCode) {
          output.push(
            <pre
              key={`code-${index}`}
              className="my-2 overflow-x-auto rounded bg-surface-950 p-2 font-mono text-[11px] leading-5 text-emerald-200"
            >
              {codeBuffer.join('\n')}
            </pre>
          )
          codeBuffer = []
        }
        inCode = !inCode
        return
      }

      if (inCode) {
        codeBuffer.push(line)
        return
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/)
      if (heading) {
        const level = heading[1].length
        const size = level <= 2 ? 'text-sm font-semibold text-slate-100' : 'text-xs font-medium text-slate-200'
        output.push(
          <div key={`h-${index}`} className={`mt-3 first:mt-0 ${size}`}>
            {renderInline(heading[2], `h${index}`)}
          </div>
        )
        return
      }

      const bullet = line.match(/^\s*[-*]\s+(.*)$/)
      if (bullet) {
        output.push(
          <div key={`li-${index}`} className="flex gap-2 pl-1">
            <span className="text-slate-600">•</span>
            <span className="min-w-0 flex-1">{renderInline(bullet[1], `li${index}`)}</span>
          </div>
        )
        return
      }

      if (line.trim() === '') {
        output.push(<div key={`gap-${index}`} className="h-1.5" />)
        return
      }

      output.push(
        <div key={`p-${index}`} className="leading-6">
          {renderInline(line, `p${index}`)}
        </div>
      )
    })

    if (inCode && codeBuffer.length > 0) {
      output.push(
        <pre
          key="code-tail"
          className="my-2 overflow-x-auto rounded bg-surface-950 p-2 font-mono text-[11px] leading-5 text-emerald-200"
        >
          {codeBuffer.join('\n')}
        </pre>
      )
    }

    return output
  }, [text])

  return <div className="text-xs text-slate-300">{blocks}</div>
}

function MessageItem({ message }: { message: AiMessage }) {
  if (message.role === 'user') {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent/20 px-3 py-1.5 text-xs text-sky-100">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-lg border border-surface-700 bg-surface-800/60 p-3">
      {message.task ? (
        <div className="mb-2 text-[10px] uppercase tracking-wide text-slate-500">
          {TASK_LABELS[message.task]}
        </div>
      ) : null}

      {message.error ? (
        <div className="rounded border border-bear/40 bg-bear/10 px-2 py-1.5 text-xs text-rose-200">
          {message.error}
        </div>
      ) : (
        <MarkdownBlock text={message.content} />
      )}

      {message.streaming ? (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
          <LoaderCircle size={12} className="animate-spin" />
          生成中…
        </div>
      ) : null}
    </div>
  )
}

export default function AiPanel() {
  const messages = useAppStore((s) => s.aiMessages)
  const streaming = useAppStore((s) => s.aiStreaming)
  const runAi = useAppStore((s) => s.runAi)
  const stopAi = useAppStore((s) => s.stopAi)
  const clearAi = useAppStore((s) => s.clearAi)
  const activeSymbol = useAppStore((s) => s.activeSymbol)
  const settings = useAppStore((s) => s.settings)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages])

  const configured = Boolean(settings?.ai.apiKey)

  const submit = async (): Promise<void> => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    await runAi('chat', text)
  }

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-surface-700 bg-surface-900">
      <div className="flex h-10 items-center gap-2 border-b border-surface-700 px-3">
        <Sparkles size={14} className="text-accent" />
        <span className="text-xs font-medium text-slate-300">AI 决策助手</span>
        <span className="num text-[11px] text-slate-600">{activeSymbol}</span>
        <button
          type="button"
          onClick={clearAi}
          title="清空对话"
          className="ml-auto rounded p-1 text-slate-500 transition hover:bg-surface-700 hover:text-slate-200"
        >
          <Eraser size={14} />
        </button>
      </div>

      {!configured ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-300">
          还没配置 AI 密钥。到「设置 → AI 助手」填一个 OpenAI 兼容的 API Key 就能用全部 AI 功能。
        </div>
      ) : null}

      <div className="grid grid-cols-4 gap-1 border-b border-surface-700 p-2">
        {QUICK_TASKS.map(({ task, label, icon: Icon }) => (
          <button
            key={task}
            type="button"
            disabled={streaming}
            onClick={() => void runAi(task)}
            className="flex flex-col items-center gap-1 rounded border border-surface-700 bg-surface-800 py-2 text-[11px] text-slate-300 transition hover:border-accent hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="mt-8 px-4 text-center text-xs leading-6 text-slate-600">
            点上面的快捷按钮做一次分析，
            <br />
            或者直接问：这只票现在能追吗？
          </div>
        ) : (
          messages.map((message) => <MessageItem key={message.id} message={message} />)
        )}
      </div>

      <div className="border-t border-surface-700 p-2">
        <div className="flex items-end gap-2 rounded border border-surface-700 bg-surface-800 p-1.5 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            rows={2}
            placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
            className="max-h-32 min-h-[38px] w-full resize-none bg-transparent px-1 text-xs text-slate-200 outline-none placeholder:text-slate-600"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stopAi}
              title="停止生成"
              className="rounded bg-bear/20 p-2 text-rose-300 transition hover:bg-bear/30"
            >
              <CircleStop size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!input.trim()}
              title="发送"
              className="rounded bg-accent/20 p-2 text-sky-300 transition hover:bg-accent/30 disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
