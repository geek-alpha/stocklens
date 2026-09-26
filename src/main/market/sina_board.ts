import type { SectorKind, SectorSnapshot } from '@shared/types'
import { createThrottle, fetchText, MarketError, withRetry } from './types'

/**
 * 新浪板块行情：一次请求拿到全部行业（约 500 个）或概念（约 500 个）板块的涨跌幅、
 * 成交额与领涨股。判断产业轮动最省请求的入口——东财 push2 的板块接口字段更全，
 * 但实测请求过密会整段掐断 TLS（curl exit 56，静默 60s 也不恢复），不适合做常驻轮询。
 *
 * 返回 GBK 文本，形如 var S_Finance_bankuai_sinaindustry = {"new_blhy":"a,b,c",...}
 */

const INDUSTRY_URL = 'https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php'
const CONCEPT_URL = 'https://vip.stock.finance.sina.com.cn/q/view/newFLJK.php?param=class'

/**
 * 字段位置经实测校验：
 * new_blhy,玻璃行业,19,17.4321,-0.4147,-2.3238,1008720579,17402360459,sh603601,4.644,10.590,0.470,再升科技
 * 板块：-0.4147/(17.4321+0.4147) = -2.3238% ✔
 * 领涨：0.470/(10.590-0.470) = 4.644% ✔
 */
const FIELD = {
  code: 0,
  name: 1,
  memberCount: 2,
  changePercent: 5,
  amount: 7,
  leaderSymbol: 8,
  leaderChangePercent: 9,
  leaderName: 12
} as const

const MIN_FIELDS = 13

const throttle = createThrottle(600)

function toNumber(fields: string[], index: number): number {
  const value = Number.parseFloat(fields[index] ?? '')
  return Number.isFinite(value) ? value : 0
}

export function parseSectorBlock(text: string, kind: SectorKind): SectorSnapshot[] {
  const body = text.match(/\{([\s\S]*)\}/)
  if (!body) return []

  const sectors: SectorSnapshot[] = []
  for (const entry of body[1].matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)) {
    const fields = entry[2].split(',')
    if (fields.length < MIN_FIELDS) continue

    const name = fields[FIELD.name]?.trim()
    if (!name) continue

    const leaderSymbol = fields[FIELD.leaderSymbol]?.trim() ?? ''
    sectors.push({
      code: fields[FIELD.code]?.trim() || entry[1],
      name,
      kind,
      memberCount: toNumber(fields, FIELD.memberCount),
      changePercent: toNumber(fields, FIELD.changePercent),
      amount: toNumber(fields, FIELD.amount),
      leader: leaderSymbol
        ? {
            symbol: leaderSymbol,
            name: fields[FIELD.leaderName]?.trim() || leaderSymbol,
            changePercent: toNumber(fields, FIELD.leaderChangePercent)
          }
        : null,
      relativeStrength: null,
      amountShare: null
    })
  }
  return sectors
}

export class SinaBoardProvider {
  readonly id = 'sina-board'
  readonly label = '新浪板块'

  async getSectors(kind: SectorKind): Promise<SectorSnapshot[]> {
    const url = kind === 'industry' ? INDUSTRY_URL : CONCEPT_URL
    const text = await throttle(() =>
      withRetry(() =>
        fetchText(url, { headers: { Referer: 'https://finance.sina.com.cn/' } }, 15_000, 'gbk')
      )
    )

    const sectors = parseSectorBlock(text, kind)
    if (sectors.length === 0) {
      throw new MarketError(`${this.label}未返回${kind === 'industry' ? '行业' : '概念'}板块`, 'notfound')
    }
    return sectors
  }
}
