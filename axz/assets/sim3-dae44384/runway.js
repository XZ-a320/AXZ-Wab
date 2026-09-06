/* ==========================================================================
   AXZ sim — the runway as a surface, not a set of painted polygons.

   The old strip drew its centreline, piano keys and aiming points as thin
   flat triangles. Geometry cannot be mip-mapped: from a kilometre out a
   0.9 m stripe is a fraction of a pixel, and every frame it lands on a
   different one, which is the shimmer you see on the take-off roll. A
   texture can be mip-mapped and filtered anisotropically, so the paint here
   is drawn ONCE onto canvases, at build, with the ICAO dimensions:

     - a 50 m tile along the runway: asphalt grain, the 30 m centreline
       stripe and 20 m gap, the edge stripes, tyre rubber near the middle
     - one soft-edged square for the threshold bars and aiming points
     - one canvas per designator ("28R"), so the numbers are real numbers

   The surface is one quad per runway with a repeating tile; the decals sit
   3 cm above it. Both get mipmaps, trilinear filtering and 16× anisotropy.
   ========================================================================== */
import { AIRPORTS, AP_LIST, hdgVec, rwyCentre } from './world.js'

const TILE_M = 50          // one tile along the runway: 30 m stripe + 20 m gap
const CANVAS = 1024

function ctx2d(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')] }

/** The repeating surface tile. u = 50 m along, v = the full width across. */
export function runwayTile(widthM = 61, size = CANVAS) {
  const [c, g] = ctx2d(size, size)
  const mpx = TILE_M / size                  // metres per pixel along
  // Asphalt: mid grey with fine grain and the darker rubber in the touchdown lanes.
  g.fillStyle = '#2a2b2d'; g.fillRect(0, 0, size, size)
  const img = g.getImageData(0, 0, size, size), d = img.data
  let seed = 7
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n + (rnd() - 0.5) * 4 }
  g.putImageData(img, 0, 0)
  // Rubber: two soft dark lanes either side of the centreline where the mains touch.
  for (const s of [-1, 1]) {
    const grad = g.createLinearGradient(0, size / 2 + s * size * 0.06, 0, size / 2 + s * size * 0.22)
    grad.addColorStop(0, 'rgba(18,18,20,0)'); grad.addColorStop(0.5, 'rgba(18,18,20,0.45)'); grad.addColorStop(1, 'rgba(18,18,20,0)')
    g.fillStyle = grad; g.fillRect(0, Math.min(size / 2 + s * size * 0.06, size / 2 + s * size * 0.22), size, size * 0.16)
  }
  // Paint: centreline 30 m of every 50, 0.9 m wide; edge stripes 0.9 m in from the edge.
  const paint = '#e6e3d8'
  g.fillStyle = paint
  const stripeW = Math.max(3, Math.round(0.9 / (widthM / size)))
  g.fillRect(0, (size - stripeW) / 2, Math.round(30 / mpx), stripeW)
  g.fillRect(0, Math.round(0.9 / (widthM / size)), size, stripeW)
  g.fillRect(0, size - Math.round(0.9 / (widthM / size)) - stripeW, size, stripeW)
  // Paint wears: knock the paint back slightly where the rubber is.
  g.globalAlpha = 0.18; g.fillStyle = '#1a1a1c'; g.fillRect(0, size * 0.42, size, size * 0.16); g.globalAlpha = 1
  return c
}

/** A white square with a soft edge, for bars and blocks. */
export function decalSquare(size = 256) {
  const [c, g] = ctx2d(size, size)
  g.clearRect(0, 0, size, size)
  const m = size * 0.04
  g.fillStyle = '#e6e3d8'
  g.filter = `blur(${size * 0.01}px)`
  g.fillRect(m, m, size - 2 * m, size - 2 * m)
  return c
}

/** The designator, painted as ICAO does: tall narrow digits, the letter beneath. */
export function designatorTex(text, size = 256) {
  const [c, g] = ctx2d(size, size)
  g.clearRect(0, 0, size, size)
  g.fillStyle = '#e6e3d8'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  const digits = text.replace(/[LRC]$/, ''), side = /[LRC]$/.test(text) ? text.slice(-1) : ''
  g.font = `bold ${side ? size * 0.5 : size * 0.7}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`
  g.save(); g.translate(size / 2, side ? size * 0.32 : size / 2); g.scale(0.72, 1.0); g.fillText(digits, 0, 0); g.restore()
  if (side) { g.font = `bold ${size * 0.42}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`; g.save(); g.translate(size / 2, size * 0.76); g.scale(0.72, 1); g.fillText(side, 0, 0); g.restore() }
  return c
}

/**
 * Geometry for one airport's runways: the textured surface quads (uv along
 * and across) and the decal quads (threshold bars, aiming blocks,
 * designators), each decal carrying which texture it wants.
 */
export function runwaySurfaces(ap) {
  const surf = { pos: [], normal: [], uv: [] }
  const decals = { pos: [], normal: [], uv: [], tex: [] }   // tex: 0 = square, 1+ = designator index
  const designators = []
  const y = ap.elev + 0.06, py = y + 0.03
  const quad = (out, a, b, c, d, uvs, tex) => {
    const tri = (p, q, r, tp, tq, tr) => { for (const [pt, t] of [[p, tp], [q, tq], [r, tr]]) { out.pos.push(pt.x, pt.y, pt.z); out.normal.push(0, 1, 0); out.uv.push(t[0], t[1]); if (out.tex) out.tex.push(tex) } }
    tri(a, c, b, uvs[0], uvs[2], uvs[1]); tri(a, d, c, uvs[0], uvs[3], uvs[2])
  }
  for (const R of ap.rwys) {
    const dir = hdgVec(R.hdg), rgt = { x: -dir.z, y: 0, z: dir.x }
    const half = R.width / 2, c = rwyCentre(ap, R)
    const at = (u, v, yy = y) => ({ x: c.x + dir.x * u + rgt.x * v, y: yy, z: c.z + dir.z * u + rgt.z * v })
    const u0 = -R.len / 2, u1 = R.len / 2
    const tiles = R.len / TILE_M
    quad(surf, at(u0, -half), at(u1, -half), at(u1, half), at(u0, half), [[0, 0], [tiles, 0], [tiles, 1], [0, 1]])
    // Threshold bars (piano keys) at both ends, and the aiming blocks 300 m in.
    for (const [base, sign] of [[u0, 1], [u1, -1]]) {
      const n = R.width >= 60 ? 12 : R.width >= 45 ? 8 : 6
      const keyW = (R.width - 6) / n
      for (let k = 0; k < n; k++) {
        const v = -half + 3 + k * keyW
        const ua = base + sign * 6, ub = base + sign * 36
        quad(decals, at(Math.min(ua, ub), v, py), at(Math.max(ua, ub), v, py), at(Math.max(ua, ub), v + keyW - 1.6, py), at(Math.min(ua, ub), v + keyW - 1.6, py), [[0, 0], [1, 0], [1, 1], [0, 1]], 0)
      }
      for (const s of [-1, 1]) {
        const ua = base + sign * 300, ub = base + sign * 345
        quad(decals, at(Math.min(ua, ub), s * 4 + (s < 0 ? -5 : 0), py), at(Math.max(ua, ub), s * 4 + (s < 0 ? -5 : 0), py), at(Math.max(ua, ub), s * 4 + (s < 0 ? 0 : 5), py), at(Math.min(ua, ub), s * 4 + (s < 0 ? 0 : 5), py), [[0, 0], [1, 0], [1, 1], [0, 1]], 0)
      }
      // The designator, 60 m in, read by the arriving pilot: this end's number.
      const num = sign > 0 ? R.id : reciprocal(R.id)
      designators.push(num)
      const idx = designators.length
      const ua = base + sign * 60, ub = base + sign * 78, w = 9
      const A = at(sign > 0 ? ua : ub, -w, py), B = at(sign > 0 ? ub : ua, -w, py), C = at(sign > 0 ? ub : ua, w, py), D = at(sign > 0 ? ua : ub, w, py)
      // Text reads toward the arriving aeroplane: rotate uvs for the far end.
      const uvs = sign > 0 ? [[0, 1], [0, 0], [1, 0], [1, 1]] : [[1, 0], [1, 1], [0, 1], [0, 0]]
      quad(decals, A, B, C, D, uvs, idx)
    }
  }
  return { surf, decals, designators }
}

/** "28R" seen from the other end is "10L". */
export function reciprocal(id) {
  const n = parseInt(id, 10), side = id.replace(/^\d+/, '')
  const r = ((n + 18 - 1) % 36) + 1
  const flip = { L: 'R', R: 'L', C: 'C', '': '' }[side]
  return String(r).padStart(2, '0') + flip
}

export { AIRPORTS, AP_LIST }
