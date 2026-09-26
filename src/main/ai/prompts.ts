import type {
  AiAnalyzeRequest,
  AiChatMessage,
  AiContextPayload,
  Quote,
  SectorSnapshot
} from '@shared/types'
import { buildTechnicalSnapshot, type TechnicalSnapshot } from './indicators'

/**
 * 提示词工程：模型的输出质量一半靠这里。
 * 原则——数字全部由主进程算好塞进去，模型只做解释与判断，不做算术。
 */

const BASE_PERSONA = `你是一位有 15 年 A股与美股实战经验的资深交易员兼分析师，熟悉全球资金流向与产业轮动，服务对象是专业散户。
要求：
1. 只依据我给你的数据说话，数据里没有的事实一律不要编造；确实需要补充时明确标注「需自行核实」。
2. 每个结论都要给出依据（哪个指标、哪个价位、哪条新闻）。
3. 给出明确的操作参考区间（支撑位、压力位、止损参考），但不要给出「一定涨/一定跌」这类绝对承诺。
4. 用简体中文，Markdown 结构，信息密度高，不要客套话。
5. 结尾用一行提醒：以上为技术分析参考，不构成投资建议。`

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(digits)
}

function fmtBig(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || n === 0) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}万亿`
  if (abs >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(n / 1e4).toFixed(2)}万`
  return n.toFixed(0)
}

function quoteBlock(quote: Quote): string {
  return [
    `标的：${quote.name}（${quote.symbol}）｜${quote.exchange}｜${quote.currency}`,
    `最新价：${fmt(quote.price)}（${quote.change >= 0 ? '+' : ''}${fmt(quote.change)}，${
      quote.changePercent >= 0 ? '+' : ''
    }${fmt(quote.changePercent)}%）`,
    `昨收：${fmt(quote.previousClose)}｜今开区间：${fmt(quote.dayLow)} - ${fmt(quote.dayHigh)}`,
    `成交量：${fmtBig(quote.volume)}｜52周区间：${fmt(quote.fiftyTwoWeekLow)} - ${fmt(
      quote.fiftyTwoWeekHigh
    )}`,
    `数据时间：${new Date(quote.marketTime * 1000).toISOString()}${quote.stale ? '（数据可能延迟）' : ''}`
  ].join('\n')
}

function technicalBlock(snapshot: TechnicalSnapshot | null): string {
  if (!snapshot) return '（K 线数据不足，无法计算技术指标）'
  const { ma5, ma10, ma20, ma60, rsi14, macd, atr14, volumeRatio } = snapshot
  return [
    `均线：MA5=${fmt(ma5)}｜MA10=${fmt(ma10)}｜MA20=${fmt(ma20)}｜MA60=${fmt(ma60)}`,
    `均线形态：${snapshot.trend}`,
    `RSI(14)：${fmt(rsi14, 1)}`,
    macd
      ? `MACD：DIF=${fmt(macd.dif, 3)}｜DEA=${fmt(macd.dea, 3)}｜柱=${fmt(macd.hist, 3)}`
      : 'MACD：数据不足',
    `ATR(14)：${fmt(atr14)}（占现价 ${atr14 ? fmt((atr14 / snapshot.price) * 100, 2) : '—'}%）`,
    `量比（当前量/20日均量）：${fmt(volumeRatio, 2)}`,
    `近 20 根 K 线区间：${fmt(snapshot.low20)} - ${fmt(snapshot.high20)}`,
    `区间涨幅：${fmt(snapshot.changePercent)}%（基于最近两根 K 线）`
  ].join('\n')
}

function newsBlock(context: AiContextPayload | undefined): string {
  const news = context?.news ?? []
  if (news.length === 0) return '（暂无新闻数据）'
  return news
    .slice(0, 12)
    .map((item, i) => {
      const when = item.publishedAt
        ? new Date(item.publishedAt * 1000).toISOString().slice(0, 16).replace('T', ' ')
        : '时间未知'
      return `${i + 1}. [${when}] ${item.title}（${item.publisher}）`
    })
    .join('\n')
}

function watchlistBlock(context: AiContextPayload | undefined): string {
  const list = context?.watchlistQuotes ?? []
  if (list.length === 0) return '（自选股列表为空）'
  return list
    .map(
      (q) =>
        `${q.symbol.padEnd(6)} ${fmt(q.price).padStart(10)}  ${
          q.changePercent >= 0 ? '+' : ''
        }${fmt(q.changePercent)}%  量:${fmtBig(q.volume)}`
    )
    .join('\n')
}

function pct(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function sectorLine(s: SectorSnapshot): string {
  const leader = s.leader ? `领涨 ${s.leader.name} ${pct(s.leader.changePercent)}` : '无领涨股'
  return `${s.name}(${s.code}) ${pct(s.changePercent)} 超额${pct(s.relativeStrength)} 占比${fmt(
    s.amountShare,
    1
  )}% ${leader}`
}

/**
 * 看板块。数字全部由主进程算好，模型只做解释。
 *
 * 行业板块全给（49 个，是「资金主战场」的完整全景）；概念板块有 175 个且成分股高度重叠，
 * 只给超额最强/最弱各 15 个，否则光这一块就几千 token。
 */
function boardBlock(context: AiContextPayload | undefined): string | null {
  const board = context?.board
  if (!board) return null

  const lines: string[] = [
    `交易日：${board.tradeDate}｜数据源：${board.source}`,
    '',
    '### 全球指数'
  ]
  for (const i of board.indices) {
    lines.push(
      `${i.region} ${i.name} ${fmt(i.price)} ${pct(i.changePercent)} 成交额${fmtBig(i.amount)}`
    )
  }

  const byStrength = (a: SectorSnapshot, b: SectorSnapshot): number =>
    (b.relativeStrength ?? 0) - (a.relativeStrength ?? 0)

  lines.push('', `### A股行业板块（共 ${board.industries.length} 个，按超额收益从强到弱）`)
  lines.push(`全市场成交额（行业合计）：${fmtBig(board.totalAmount)}`)
  for (const s of [...board.industries].sort(byStrength)) lines.push(sectorLine(s))

  const concepts = [...board.concepts].sort(byStrength)
  lines.push(
    '',
    `### A股概念板块（共 ${concepts.length} 个，只列超额最强 15 / 最弱 15）`
  )
  for (const s of concepts.slice(0, 15)) lines.push(sectorLine(s))
  lines.push('…（中间略）')
  for (const s of concepts.slice(-15)) lines.push(sectorLine(s))

  lines.push('', '### 资金主战场（行业成交额前 10）')
  for (const s of [...board.industries].sort((a, b) => b.amount - a.amount).slice(0, 10)) {
    lines.push(`${s.name} 占比${fmt(s.amountShare, 1)}% 成交额${fmtBig(s.amount)} ${pct(s.changePercent)}`)
  }

  const rotation = context?.rotation
  if (rotation) {
    const basisText =
      rotation.basis === 'cumulative'
        ? `近 20 日相对强度累计，已累积 ${rotation.historyDays} 个交易日`
        : `单日超额收益，仅累积 ${rotation.historyDays} 个交易日`
    lines.push('', `### 产业轮动（口径：${basisText}）`, '相对走强：')
    for (const s of rotation.rising) lines.push(sectorLine(s))
    lines.push('相对走弱：')
    for (const s of rotation.falling) lines.push(sectorLine(s))
    if (rotation.basis === 'single-day') {
      lines.push(
        '数据限制：历史不足 2 个交易日，单日超额分不清「持续走强」和「一日反弹」，不要据此断言产业趋势。'
      )
    }
  }

  return lines.join('\n')
}

function taskInstruction(req: AiAnalyzeRequest): string {
  const hasTech = Boolean(req.context?.candles?.length)
  switch (req.task) {
    case 'brief':
      return `【任务】盘面速读。用 5 行以内说清：当前多空状态、关键价位、量能是否配合、最需要注意的风险。最后给一条可执行的操作参考。`
    case 'technical':
      return `【任务】技术面深度分析。逐个解读均线系统、RSI、MACD、ATR 与量比，指出背离与关键支撑压力位，给出未来 1-2 周的情景推演（乐观/中性/悲观三种，各带触发条件）。${
        hasTech ? '' : '注意：本次没有 K 线数据。'
      }`
    case 'news':
      return `【任务】新闻面解读。挑出对股价影响最大的 3 条，说明影响方向、力度与持续性，并指出哪些消息可能已被市场定价。`
    case 'rotation':
      return `【任务】产业轮动研判。基于下面的全球指数与 A股板块数据回答三件事：①当前资金在往哪些产业集中、从哪些产业撤出（成交额占比与超额收益一起看，不要只看涨跌幅）；②哪些变化有持续性证据、哪些只是单日噪音；③给出接下来 1-4 周值得跟踪的 3 个产业方向，每个方向写清触发条件与证伪信号。数据不足以支撑趋势判断时直接说不足。`
    case 'screen':
      return `【任务】智能选股。根据用户给出的条件，从下面自选股列表中筛选并排序，逐个给出入选理由与不符合的说明。条件里没提到的维度不要自己加。`
    case 'chat':
    default:
      return `【任务】回答用户的问题。`
  }
}

export function buildMessages(req: AiAnalyzeRequest): AiChatMessage[] {
  const context = req.context
  const snapshot = context?.candles?.length ? buildTechnicalSnapshot(context.candles) : null

  const sections: string[] = [taskInstruction(req)]

  const board = boardBlock(context)
  if (board) {
    sections.push(`## 市场看板（全球指数 + A股板块全景）\n${board}`)
  } else if (req.includeBoard) {
    sections.push('## 市场看板\n（看板数据获取失败，本轮不要对板块与产业轮动作出判断）')
  }

  if (context?.quote) {
    sections.push(`## 行情快照\n${quoteBlock(context.quote)}`)
  }
  if (snapshot) {
    sections.push(`## 技术指标（已由系统精确计算）\n${technicalBlock(snapshot)}`)
  }
  if (req.task === 'news' || context?.news?.length) {
    sections.push(`## 相关新闻\n${newsBlock(context)}`)
  }
  if (req.task === 'screen') {
    sections.push(`## 自选股列表\n${watchlistBlock(context)}`)
  }
  if (req.prompt) {
    sections.push(`## 用户补充\n${req.prompt}`)
  }

  const messages: AiChatMessage[] = [{ role: 'system', content: BASE_PERSONA }]

  const history = (req.history ?? []).filter((m) => m.role !== 'system')
  if (req.task === 'chat' && history.length > 0) {
    messages.push(...history.slice(-10))
  }

  messages.push({ role: 'user', content: sections.join('\n\n') })
  return messages
}
