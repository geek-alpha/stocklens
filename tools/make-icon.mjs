#!/usr/bin/env node
/**
 * 生成应用图标 build/icon.png（512x512，RGBA）。
 * 本机没有 ImageMagick / PIL，所以直接用 zlib 手写 PNG——零依赖，改设计只需改下面的坐标常量。
 *
 * 用法：node tools/make-icon.mjs
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../build/icon.png')

const SIZE = 512
const SS = 3 // 超采样倍数，用于抗锯齿
const W = SIZE * SS

const BG_TOP = [22, 32, 43]
const BG_BOTTOM = [10, 13, 18]
const BULL = [38, 166, 154]
const BEAR = [239, 83, 80]
const ACCENT = [59, 130, 246]

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function segmentDistance(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0
  const dy = y1 - y0
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lengthSq))
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
}

// 四根蜡烛：[中心x, 实体上沿y, 实体下沿y, 是否上涨]
const CANDLES = [
  [0.26, 0.56, 0.78, true],
  [0.42, 0.44, 0.70, true],
  [0.58, 0.34, 0.62, false],
  [0.74, 0.20, 0.52, true]
]
const BODY_HALF = 0.052
const WICK_HALF = 0.008

const TREND = [
  [0.16, 0.86],
  [0.40, 0.66],
  [0.62, 0.50],
  [0.86, 0.22]
]

function sampleColor(x, y) {
  // 圆角背景 + 垂直渐变
  if (!inRoundRect(x, y, 0, 0, 1, 1, 0.22)) return null
  const t = y
  let color = [
    BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t,
    BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t,
    BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t
  ]

  for (const [cx, top, bottom, up] of CANDLES) {
    const bodyColor = up ? BULL : BEAR
    const inWick =
      Math.abs(x - cx) <= WICK_HALF && y >= top - 0.1 && y <= bottom + 0.1
    const inBody = Math.abs(x - cx) <= BODY_HALF && y >= top && y <= bottom
    if (inBody) color = bodyColor
    else if (inWick) color = bodyColor.map((c) => c * 0.8)
  }

  // 上升趋势线压在蜡烛之上，作为「透镜」的视线引导
  let minDistance = Infinity
  for (let i = 0; i < TREND.length - 1; i += 1) {
    const [x0, y0] = TREND[i]
    const [x1, y1] = TREND[i + 1]
    minDistance = Math.min(minDistance, segmentDistance(x, y, x0, y0, x1, y1))
  }
  if (minDistance <= 0.016) {
    color = ACCENT
  }

  return color
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0

    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const nx = (x * SS + sx + 0.5) / W
        const ny = (y * SS + sy + 0.5) / W
        const color = sampleColor(nx, ny)
        if (color) {
          r += color[0]
          g += color[1]
          b += color[2]
          a += 255
        }
      }
    }

    const samples = SS * SS
    const alpha = a / samples
    const covered = a / 255
    const index = (y * SIZE + x) * 4
    pixels[index] = covered > 0 ? Math.round(r / covered) : 0
    pixels[index + 1] = covered > 0 ? Math.round(g / covered) : 0
    pixels[index + 2] = covered > 0 ? Math.round(b / covered) : 0
    pixels[index + 3] = Math.round(alpha)
  }
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // color type: RGBA
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0 // filter: none
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`图标已生成：${OUT}（${SIZE}x${SIZE}，${(png.length / 1024).toFixed(1)} KB）`)
