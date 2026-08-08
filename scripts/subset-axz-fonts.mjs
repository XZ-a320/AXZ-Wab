#!/usr/bin/env node
/* ==========================================================================
   Subset the four faces to exactly the glyphs this site renders.

   The whole site is ~600 unique hanzi, so a real Chinese typeface is
   affordable here in a way it normally is not: unsubset Noto Sans SC is
   17.7 MB. Each face is scoped to its ROLE, not to the whole corpus —
   the remarks face never renders a nav label, so it never carries one.

   Requires fonttools (pyftsubset) and the unsubset originals in fonts-src/.
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'axz-src')
const IN = join(SRC, 'fonts-src')
const OUT = join(SRC, 'fonts-out')
const TMP = join(SRC, '.font-tmp')

const zh = JSON.parse(readFileSync(join(SRC, 'content', 'zh.json'), 'utf8'))
const enPath = join(SRC, 'content', 'en.json')
const en = existsSync(enPath) ? JSON.parse(readFileSync(enPath, 'utf8')) : {}

// Walk a catalogue subtree and collect all string values.
function collect(node, out = []) {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) node.forEach(n => collect(n, out))
  else if (node && typeof node === 'object') Object.values(node).forEach(n => collect(n, out))
  return out
}

const LATIN = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('')

// Role -> the catalogue subtrees that role actually renders, PER LANGUAGE.
// Splitting by language matters: an English page renders no hanzi at all
// (except the untranslated guestbook entries), so shipping it the Chinese
// glyph set would be ~150 KB it can never draw.
const remarksOf = c => [
  c.record?.blackHistory, c.meta?.disclaimer, c.home?.routeHint,
  ...(c.fleet?._order || []).map(k => c.fleet?.[k]?.funny),
  c.fleet?.labels?.funny, c.record?.labels?.blackHistory,
  c.logbook?.noRemark, c.logbook?.fields?.CruiseRemark,
]
const displayOf = c => [
  c.meta, c.nav, c.home, c.record?.labels, c.fleet?.labels, c.fleet?.groups,
  c.routes?.labels, c.guestbook, c.logbook?.bands, c.accessibility?.sections, c.ui,
]
// The English guestbook still shows the three real entries in Chinese.
const enWithEntries = [en, zh.guestbook?.entries]

const ROLES = {
  'sans-400-zh': [zh],
  'sans-400-en': enWithEntries,
  'sans-700-zh': displayOf(zh),
  'sans-700-en': displayOf(en),
  'serif-400-zh': remarksOf(zh),
  'serif-400-en': remarksOf(en),
  // Codes, waypoints, altitudes, timestamps: Latin, digits and symbols only.
  'mono-400': [],
  'mono-600': [],
}

const FILES = {
  'sans-400-zh': ['NotoSansSC.ttf', 400],
  'sans-400-en': ['NotoSansSC.ttf', 400],
  'sans-700-zh': ['NotoSansSC.ttf', 700],
  'sans-700-en': ['NotoSansSC.ttf', 700],
  'serif-400-zh': ['NotoSerifSC.ttf', 400],
  'serif-400-en': ['NotoSerifSC.ttf', 400],
  'mono-400': ['IBMPlexMono-Regular.ttf', null],
  'mono-600': ['IBMPlexMono-SemiBold.ttf', null],
}

function charsetFor(role) {
  const chars = new Set(LATIN)
  for (const c of '↔✈⚠⭐★‸°′″№…—～·、，。：；！？（）《》“”‘’〜｜') chars.add(c)
  if (role.startsWith('mono')) return [...chars].join('')   // mono carries no hanzi
  for (const sub of ROLES[role]) {
    if (!sub) continue
    for (const s of collect(sub)) for (const ch of s) chars.add(ch)
  }
  return [...chars].join('')
}

rmSync(OUT, { recursive: true, force: true })
rmSync(TMP, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
mkdirSync(TMP, { recursive: true })

const missing = Object.values(FILES).map(f => f[0]).filter(f => !existsSync(join(IN, f)))
if (missing.length) {
  console.error(`✗ missing originals in axz-src/fonts-src/: ${[...new Set(missing)].join(', ')}`)
  process.exit(1)
}

const rows = []
for (const [role, [file, weight]] of Object.entries(FILES)) {
  const charset = charsetFor(role)
  const txt = join(TMP, `${role}.txt`)
  writeFileSync(txt, charset)

  // Pin the variable axis before subsetting — instancing roughly halves the
  // result, because an unpinned wght axis keeps every delta for every glyph.
  let source = join(IN, file)
  if (weight) {
    const pinned = join(TMP, `${role}.ttf`)
    execFileSync('python3', ['-c', `
from fontTools import ttLib
from fontTools.varLib import instancer
t = ttLib.TTFont(${JSON.stringify(source)})
if 'fvar' in t:
    instancer.instantiateVariableFont(t, {'wght': ${weight}}, inplace=True, updateFontNames=False)
t.save(${JSON.stringify(pinned)})
`])
    source = pinned
  }

  const out = join(TMP, `${role}.woff2`)
  execFileSync('pyftsubset', [
    source, `--text-file=${txt}`, '--flavor=woff2',
    '--layout-features=', '--no-hinting', '--desubroutinize',
    '--drop-tables+=DSIG', `--output-file=${out}`,
  ])

  const buf = readFileSync(out)
  const h = createHash('sha256').update(buf).digest('hex').slice(0, 8)
  const name = `axz-${role}.${h}.woff2`
  writeFileSync(join(OUT, name), buf)
  rows.push([role, [...charset].length, (buf.length / 1024).toFixed(1), name])
}

rmSync(TMP, { recursive: true, force: true })

let total = 0
for (const [role, glyphs, kb, name] of rows) {
  total += parseFloat(kb)
  console.log(`  ${role.padEnd(10)} ${String(glyphs).padStart(5)} glyphs  ${kb.padStart(7)} KB  ${name}`)
}
console.log(`✓ ${rows.length} faces, ${total.toFixed(1)} KB total`)
