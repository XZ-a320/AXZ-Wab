#!/usr/bin/env node
/* Writes raw/textures/uv-probe.png into the assets repo: a 256×256 UV checker
   with a red→green gradient, so a texture that reaches the GPU is visibly
   oriented. Pure Node — a PNG is a zlib stream with a CRC, nothing more. */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const REPO = process.env.AXZ_ASSETS || join(import.meta.dirname, '..', '..', '..', 'axz-assets')
const SIZE = 256

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buf => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

export function probePng(size = SIZE) {
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0                       // filter: none
    for (let x = 0; x < size; x++) {
      const i = y * (size * 3 + 1) + 1 + x * 3
      const check = ((x >> 5) + (y >> 5)) & 1
      raw[i] = Math.round(255 * x / (size - 1))       // R = u
      raw[i + 1] = Math.round(255 * y / (size - 1))   // G = v
      raw[i + 2] = check ? 200 : 40                   // B = checker
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0   // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const out = join(REPO, 'raw', 'textures', 'uv-probe.png')
  mkdirSync(join(REPO, 'raw', 'textures'), { recursive: true })
  const png = probePng()
  writeFileSync(out, png)
  console.log(`✓ wrote ${out} (${png.length} bytes)`)
}
