#!/usr/bin/env node
/* ==========================================================================
   Generates axz-src/icons/sprite.svg.

   The two flags are drawn from their official geometry rather than eyeballed —
   national flags are worth getting right, and five-pointed stars placed by hand
   look wrong in a way people notice even at 16px.

   Everything else is a line icon on a 24x24 grid, stroke: currentColor, so it
   inherits the surrounding text colour and needs no per-theme variant.
   ========================================================================== */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'axz-src', 'icons')
const n = v => Math.round(v * 1000) / 1000

/** Five-pointed star as a polygon path. `rot` points the first vertex. */
function star(cx, cy, r, rot = -Math.PI / 2) {
  const inner = r * Math.sin(Math.PI / 10) / Math.sin(7 * Math.PI / 10)
  const pts = []
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : inner
    const a = rot + i * Math.PI / 5
    pts.push(`${n(cx + rad * Math.cos(a))},${n(cy + rad * Math.sin(a))}`)
  }
  return `M${pts.join('L')}Z`
}

/* --- 中华人民共和国国旗 ---------------------------------------------------
   Official construction: field 30x20. Large star centred (5,5), circumscribed
   radius 3. Four small stars, radius 1, centred (10,2) (12,4) (12,7) (10,9),
   each with one point aimed at the centre of the large star.               */
function flagCN() {
  const big = star(5, 5, 3)
  const smalls = [[10, 2], [12, 4], [12, 7], [10, 9]].map(([x, y]) => {
    const rot = Math.atan2(5 - y, 5 - x)   // aim a vertex at the large star
    return star(x, y, 1, rot)
  })
  return `<symbol id="i-flag-cn" viewBox="0 0 30 20">
    <rect width="30" height="20" fill="#EE1C25"/>
    <g fill="#FFDE00">${[big, ...smalls].map(d => `<path d="${d}"/>`).join('')}</g>
  </symbol>`
}

/* --- Flag of the United States --------------------------------------------
   13 stripes (7 red), canton 7 stripes tall and 2/5 of the fly. The 50 stars
   sit in the official 9-row 6/5 alternating pattern.                        */
function flagUS() {
  const W = 30, H = 20, stripe = H / 13
  const stripes = []
  for (let i = 0; i < 13; i += 2) {
    stripes.push(`<rect y="${n(i * stripe)}" width="${W}" height="${n(stripe)}" fill="#B22234"/>`)
  }
  const cw = W * 0.4, ch = stripe * 7
  const stars = []
  for (let row = 0; row < 9; row++) {
    const count = row % 2 === 0 ? 6 : 5
    const dx = cw / 6
    const y = ch * (row + 1) / 10
    for (let c = 0; c < count; c++) {
      const x = row % 2 === 0 ? dx * (c + 0.5) : dx * (c + 1)
      stars.push(`<path d="${star(x, y, stripe * 0.31)}"/>`)
    }
  }
  return `<symbol id="i-flag-us" viewBox="0 0 30 20">
    <rect width="${W}" height="${H}" fill="#FFFFFF"/>
    ${stripes.join('')}
    <rect width="${n(cw)}" height="${n(ch)}" fill="#3C3B6E"/>
    <g fill="#FFFFFF">${stars.join('')}</g>
  </symbol>`
}

/* --- Line icons, 24x24, stroke: currentColor ------------------------------ */
const line = (id, body) => `<symbol id="${id}" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`

const sunRays = Array.from({ length: 8 }, (_, i) => {
  const a = i * Math.PI / 4
  const [x1, y1] = [12 + 7.4 * Math.cos(a), 12 + 7.4 * Math.sin(a)]
  const [x2, y2] = [12 + 9.6 * Math.cos(a), 12 + 9.6 * Math.sin(a)]
  return `<path d="M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}"/>`
}).join('')

const ICONS = [
  flagCN(),
  flagUS(),
  line('i-sun', `<circle cx="12" cy="12" r="4.6"/>${sunRays}`),
  // Crescent as one path so it reads at 16px; a subtracted-circle moon turns to mush.
  line('i-moon', `<path d="M20 14.4A8.6 8.6 0 0 1 9.6 4a8.6 8.6 0 1 0 10.4 10.4Z"/>`),
  // Pause when motion is running (press to stop), play when it is stopped.
  // A single ambiguous glyph made the button's effect impossible to guess.
  line('i-pause', `<path d="M9 5.5v13"/><path d="M15 5.5v13"/>`),
  line('i-play', `<path d="M8 5.4 18.5 12 8 18.6Z"/>`),
  line('i-home', `<path d="M4 11.2 12 4.5l8 6.7"/><path d="M6.4 9.6V19h11.2V9.6"/><path d="M10 19v-5h4v5"/>`),
  line('i-guestbook', `<path d="M4 5.5h16v11H9l-5 3.5Z"/><path d="M8 9.5h8"/><path d="M8 12.8h5"/>`),
  line('i-logbook', `<path d="M6 3.5h11l3 3v14H6Z"/><path d="M6 3.5v17"/><path d="M9.5 9h7"/><path d="M9.5 12.5h7"/><path d="M9.5 16h4"/>`),
  line('i-a11y', `<circle cx="12" cy="5.2" r="1.9"/><path d="M4.5 9.2h15"/><path d="M12 9.2v6"/><path d="m12 15.2-3 5.3"/><path d="m12 15.2 3 5.3"/>`),
  line('i-external', `<path d="M14 4.5h5.5V10"/><path d="M19.5 4.5 11 13"/><path d="M17 14v5.5H4.5V7H10"/>`),
  line('i-drop', `<path d="M12 3.5v10.5"/><path d="m7.8 10 4.2 4 4.2-4"/><path d="M4.5 16.5v4h15v-4"/>`),
  line('i-route', `<circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="5.5" r="2"/><path d="M7.2 17.1 16.9 7.2" stroke-dasharray="2.4 2"/>`),
  line('i-fleet', `<path d="M12 3.2c.7 0 1.2 1.5 1.3 3.6v2.4l7.2 4.3v1.9l-7.2-2.1v3.6l2.4 1.7v1.4L12 19l-3.7 1v-1.4l2.4-1.7v-3.6L3.5 15.4v-1.9l7.2-4.3V6.8C10.8 4.7 11.3 3.2 12 3.2Z"/>`),
  line('i-hangar', `<path d="M3 20v-9.5L12 4l9 6.5V20"/><path d="M7 20v-6h10v6"/><path d="M7 17h10"/>`),
  // A departure board: the frame, the header rule, and three rows of flights.
  line('i-board', `<path d="M3.5 4.5h17v15h-17Z"/><path d="M3.5 8.5h17"/><path d="M7 12h10"/><path d="M7 15.5h10"/>`),
  // Dispatch: a release on a clipboard. The clip is what separates it from
  // i-logbook, which is a bound book with a spine.
  line('i-dispatch', `<path d="M9 5H5.5v15h13V5H15"/><path d="M9 3.4h6V6.6H9Z"/><path d="M8.8 11h6.4"/><path d="M8.8 14.6h4"/>`),
]

mkdirSync(OUT, { recursive: true })
const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
${ICONS.join('\n')}
</svg>`
writeFileSync(join(OUT, 'sprite.svg'), sprite)
console.log(`✓ sprite.svg — ${ICONS.length} symbols, ${(sprite.length / 1024).toFixed(1)} KB`)
