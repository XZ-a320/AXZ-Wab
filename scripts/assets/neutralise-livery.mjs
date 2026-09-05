#!/usr/bin/env node
/* ==========================================================================
   Paint out a real airline's marks. Saturated pixels (a speedmarque, a
   titles block, a tail flash) become the surrounding paint; greys, whites,
   dark window lines, shadows and panel lines are untouched. This is an
   authored modification and is recorded as one in the manifest.

     node scripts/assets/neutralise-livery.mjs in.png out.png [--sat=0.28] [--fill=r,g,b]
   ========================================================================== */
import { readFileSync, writeFileSync } from 'node:fs'
import { decodePng, encodePng } from './png.mjs'

export function neutralise(img, { sat = 0.28, fill = null } = {}) {
  const { width, height, rgba } = img
  const out = Buffer.from(rgba)
  // The paint colour: the median of low-saturation bright pixels, unless given.
  let f = fill
  if (!f) {
    const samples = []
    for (let i = 0; i < rgba.length; i += 4 * 97) { const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx > 150 && (mx - mn) / (mx || 1) < 0.08) samples.push([r, g, b]) }
    samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))
    f = samples.length ? samples[samples.length >> 1] : [235, 235, 235]
  }
  let changed = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    const s = mx ? (mx - mn) / mx : 0
    if (s > sat && mx > 40) { const k = Math.min(1, (s - sat) / 0.12); out[i] = r + (f[0] - r) * k; out[i + 1] = g + (f[1] - g) * k; out[i + 2] = b + (f[2] - b) * k; changed++ }
  }
  return { img: { width, height, rgba: out, hadAlpha: img.hadAlpha }, changed, fill: f }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [inp, out] = process.argv.slice(2).filter(a => !a.startsWith('--'))
  if (!out) { console.error('usage: node scripts/assets/neutralise-livery.mjs in.png out.png [--sat=0.28] [--fill=r,g,b]'); process.exit(2) }
  const satArg = process.argv.find(a => a.startsWith('--sat=')), fillArg = process.argv.find(a => a.startsWith('--fill='))
  const img = decodePng(readFileSync(inp))
  const r = neutralise(img, { sat: satArg ? parseFloat(satArg.slice(6)) : 0.28, fill: fillArg ? fillArg.slice(7).split(',').map(Number) : null })
  writeFileSync(out, encodePng(r.img))
  console.log(`✓ ${inp} → ${out}: ${img.width}×${img.height}, ${r.changed.toLocaleString()} pixels (${(100 * r.changed / (img.width * img.height)).toFixed(1)}%) painted to rgb(${r.fill.map(Math.round).join(',')})`)
}
