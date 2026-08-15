// Contrast gate. Recomputes every ratio claimed in tokens.css from the actual
// hex values and fails if a claim is wrong or a pairing misses its WCAG floor.
// Ratios are never hand-written; this file is the authority.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, '..', 'axz-src', 'css', 'tokens.css'), 'utf8')

const srgb = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const lum = hex => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * srgb(n >> 16 & 255) + 0.7152 * srgb(n >> 8 & 255) + 0.0722 * srgb(n & 255)
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
const r2 = n => Math.round(n * 100) / 100

// Pull every `--token: #hex;` out of a named block.
function block(name) {
  const re = name === 'day'
    ? /:root\s*\{([\s\S]*?)\n\}/
    : name === 'night'
      ? /:root\[data-theme="night"\]\s*\{([\s\S]*?)\n\}/
      : /\.plate\s*\{([\s\S]*?)\n\}/
  const m = CSS.match(re)
  if (!m) throw new Error(`block ${name} not found in tokens.css`)
  const out = {}
  for (const [, k, v] of m[1].matchAll(/(--[\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) out[k] = v.toUpperCase()
  return out
}

const day = block('day')
const night = block('night')
const plate = block('plate')

// [tokenSet, foreground, background, floor, label]
// floor 4.5 = AA normal text | 3.0 = AA large text & non-text (1.4.11) | 0 = decorative
const CASES = [
  [day, '--ink', '--paper', 4.5, 'body text'],
  [day, '--ink-2', '--paper', 4.5, 'secondary prose'],
  [day, '--ink-3', '--paper', 4.5, 'meta / captions'],
  [day, '--cyan-ink', '--paper', 4.5, 'links'],
  [day, '--remark', '--paper', 4.5, 'remarks column'],
  [day, '--ink', '--paper-2', 4.5, 'body on inset cell'],
  [day, '--ink-2', '--paper-2', 4.5, 'secondary prose on inset cell (release, clocks)'],
  [day, '--ink-3', '--paper-2', 4.5, 'meta on inset cell'],
  [day, '--cyan-ink', '--paper-2', 4.5, 'links on inset cell'],
  [day, '--remark', '--paper-2', 4.5, 'remarks on inset cell'],
  [day, '--rule-struct', '--paper', 3.0, 'structural rule (1.4.11)'],
  [day, '--focus-outer', '--paper', 3.0, 'focus ring (1.4.11)'],
  [day, '--rule-hair', '--paper', 0, 'hairline rhythm (decorative)'],
  [day, '--paper-shade', '--paper', 0, 'print offset (decorative)'],

  [night, '--ink', '--paper', 4.5, 'body text'],
  [night, '--ink-2', '--paper', 4.5, 'secondary prose'],
  [night, '--ink-3', '--paper', 4.5, 'meta / captions'],
  [night, '--cyan-ink', '--paper', 4.5, 'links'],
  [night, '--cyan', '--paper', 4.5, 'brand cyan as text'],
  [night, '--remark', '--paper', 4.5, 'remarks column'],
  [night, '--ink', '--paper-2', 4.5, 'body on inset cell'],
  [night, '--ink-2', '--paper-2', 4.5, 'secondary prose on inset cell (release, clocks)'],
  [night, '--ink-3', '--paper-2', 4.5, 'meta on inset cell'],
  [night, '--cyan-ink', '--paper-2', 4.5, 'links on inset cell'],
  [night, '--remark', '--paper-2', 4.5, 'remarks on inset cell'],
  [night, '--rule-struct', '--paper', 3.0, 'structural rule (1.4.11)'],
  [night, '--focus-outer', '--paper', 3.0, 'focus ring (1.4.11)'],

  [plate, '--plate-ink', '--plate', 4.5, 'plate text'],
  [plate, '--plate-ink-2', '--plate', 4.5, 'plate caption text'],
]

// Tokens that may only ever be used as marks, never in a `color:` declaration.
// The traced chart is gone, so no mark-only tokens remain to police.
const MARK_ONLY = []

const fails = []
const rows = []
let setName = ''
for (const [set, fg, bg, floor, label] of CASES) {
  const n = set === day ? 'DAY' : set === night ? 'NIGHT' : 'PLATE'
  if (n !== setName) { rows.push(['', '', '', '', `--- ${n} ---`]); setName = n }
  if (!set[fg] || !set[bg]) { fails.push(`${n}: token ${set[fg] ? bg : fg} missing`); continue }
  const got = r2(ratio(set[fg], set[bg]))
  const ok = floor === 0 || got >= floor
  if (!ok) fails.push(`${n}: ${fg} on ${bg} = ${got}:1, needs ${floor}:1 (${label})`)
  rows.push([n, `${fg} on ${bg}`, `${got}:1`, floor ? `>=${floor}` : 'decorative', ok ? 'ok' : 'FAIL'])
}

// Cross-check: the day-mode brand cyan must NOT be usable as text.
const cyanDay = r2(ratio(day['--cyan'], day['--paper']))
if (cyanDay >= 4.5) fails.push(`DAY --cyan is ${cyanDay}:1 on paper — tokens.css claims it is fill-only; the comment is now wrong`)

// Verify every ratio written in a tokens.css comment matches the computed value.
// Scoped per block — the same token name exists in day, night and plate with
// different values, so a global scan would compare a night comment to a day hex.
function blockText(name) {
  const re = name === 'day'
    ? /:root\s*\{([\s\S]*?)\n\}/
    : name === 'night'
      ? /:root\[data-theme="night"\]\s*\{([\s\S]*?)\n\}/
      : /\.plate\s*\{([\s\S]*?)\n\}/
  return CSS.match(re)[1]
}
for (const [name, set] of [['day', day], ['night', night], ['plate', plate]]) {
  const bg = set === plate ? set['--plate'] : set['--paper']
  for (const [, tok, claimed] of blockText(name).matchAll(/(--[\w-]+):\s*#[0-9A-Fa-f]{6};\s*\/\*\s*([\d.]+)\s/g)) {
    if (!set[tok]) continue
    const got = r2(ratio(set[tok], bg))
    if (Math.abs(got - parseFloat(claimed)) > 0.05) {
      fails.push(`comment drift in ${name.toUpperCase()}: ${tok} claims ${claimed}:1 but computes ${got}:1`)
    }
  }
}

// Mark-only tokens must not appear in a color: declaration anywhere in the CSS.
const allCss = ['tokens', 'base', 'ledger', 'plate', 'pages']
  .map(f => { try { return readFileSync(join(HERE, '..', 'axz-src', 'css', `${f}.css`), 'utf8') } catch { return '' } })
  .join('\n')
for (const t of MARK_ONLY) {
  const re = new RegExp(`(^|[^-])color:\\s*var\\(${t}\\)`, 'gm')
  if (re.test(allCss)) fails.push(`tiering violation: ${t} is mark-only but is used in a color: declaration`)
}

for (const r of rows) {
  if (!r[0]) { console.log(`\n${r[4]}`); continue }
  console.log(`  ${r[1].padEnd(34)} ${r[2].padStart(9)}  ${r[3].padEnd(12)} ${r[4]}`)
}

if (fails.length) {
  console.error(`\n✗ ${fails.length} contrast failures:\n`)
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log(`\n✓ ${CASES.length} pairings verified, all comment ratios accurate, tiering rule holds`)
