/* ==========================================================================
   A PNG reader and writer with no dependencies: 8-bit RGB/RGBA/grey, any
   filter, no interlace. Enough to read a livery texture, edit its pixels,
   and write it back. Used to neutralise real-airline marks on sourced
   models before they are served.
   ========================================================================== */
import { inflateSync, deflateSync } from 'node:zlib'

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) }

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let off = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0
  const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (depth !== 8 || interlace) throw new Error(`PNG: only 8-bit non-interlaced supported (depth ${depth}, interlace ${interlace})`)
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype]
  if (!ch) throw new Error(`PNG: colour type ${ctype} (palette) not supported`)
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * ch
  const out = Buffer.alloc(width * height * 4)
  let prev = Buffer.alloc(stride), cur = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0
      let v = line[i]
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      cur[i] = v & 255
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, i = x * ch
      if (ch === 1) { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = 255 }
      else if (ch === 2) { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = cur[i + 1] }
      else if (ch === 3) { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = 255 }
      else { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = cur[i + 3] }
    }
    const t = prev; prev = cur; cur = t
  }
  return { width, height, rgba: out, hadAlpha: ch === 2 || ch === 4 }
}

export function encodePng({ width, height, rgba, hadAlpha }) {
  const ch = hadAlpha ? 4 : 3
  const raw = Buffer.alloc((width * ch + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * ch + 1)] = 0
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, i = y * (width * ch + 1) + 1 + x * ch
      raw[i] = rgba[o]; raw[i + 1] = rgba[o + 1]; raw[i + 2] = rgba[o + 2]; if (ch === 4) raw[i + 3] = rgba[o + 3]
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
