// English catalogue gate. The jokes and the one aviation fact that looks like
// a typo are load-bearing; this stops a future edit from "improving" them.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'axz-src', 'content')
const zh = JSON.parse(readFileSync(join(SRC, 'zh.json'), 'utf8'))
const en = JSON.parse(readFileSync(join(SRC, 'en.json'), 'utf8'))
const fails = []

// Search the actual string VALUES, not JSON.stringify output — inner quotes are
// backslash-escaped there, so a phrase containing "..." would never match.
// Keys starting with _ are developer notes, not prose.
function values(node, out = []) {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) node.forEach(n => values(n, out))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (!k.startsWith('_')) values(v, out)
  }
  return out
}
const enText = values(en).join('\n')

/* 1. Locked renderings must be present verbatim. */
const REQUIRED = [
  ['the Runway Shaker', '跑道震动器 — never "vibrator"'],
  ['the Runway Masseur', '跑道按摩师 — keep it literal and odd'],
  ["Incidents We'd Rather Not Discuss", '搞笑黑历史'],
  ['Notable Events', '重大事件 — the deadpan pair'],
  ['hard landing', '重着陆 — never "heavy landing"'],
  ["Does the fleet's grunt work", '搬砖人 — never "workhorse"'],
  ['making a break for it', '快递要逃逸'],
  ['eloping', '快递想私奔 — must stay distinct from the line above'],
  ['swore it would never lose its paint', '发誓永不退涂'],
  ['"painted" onto the cabin wall', '涂抹 — never "smeared"'],
  ['the elegant people-mover', '自称"优雅载客机"'],
  ['the old-timer', '元老机'],
  ['turned it into a meme', '做成表情包'],
  ['A virtual airline. For flight simulation only.', '虚拟航司 仅用于模拟飞行'],
  ['31,100 ft (9,500 m)', "VERIFIED CORRECT — China's metric RVSM level"],
  ['FLY ON TIME', 'never translated'],
]
for (const [s, why] of REQUIRED) if (!enText.includes(s)) fails.push(`missing locked rendering "${s}"  (${why})`)

/* 2. Strings that must never appear. */
const BANNED = [
  ['Runway Vibrator', 'the failure mode this whole table exists to prevent'],
  ['vibrator', 'see above'],
  ['workhorse', 'a compliment in aviation English; inverts the self-deprecation'],
  ['Dark History', 'wrong register for 搞笑黑历史'],
  ['Hall of Shame', 'wrong register'],
  ['heavy landing', 'collides with the wake-turbulence category'],
  ['linkage', '联动 is a collab'],
  ['smeared', 'reads as gore in English'],
  ['31,000 ft', '31,100 ft is correct and must not be "fixed"'],
  ['passion project', 'aviation/hobby cliché; the tone lock forbids framing'],
  ['labour of love', 'same'],
  ['labor of love', 'same'],
  ['takes flight', 'aviation cliché'],
  ['sky’s the limit', 'aviation cliché'],
  ['a new chapter', 'cliché'],
  ['testament', 'AI tell'],
  ['showcase', 'AI tell'],
  ['seamless', 'AI tell'],
  ['vibrant', 'AI tell'],
  ['delve', 'AI tell'],
  ['tapestry', 'AI tell'],
  ['boasts', 'promotional'],
  ['nestled', 'promotional'],
  ['stands as', 'inflated significance'],
  ['not just', 'negative parallelism — zero instances in the source'],
]
const lower = enText.toLowerCase()
for (const [s, why] of BANNED) if (lower.includes(s.toLowerCase())) fails.push(`banned string "${s}" present  (${why})`)

/* 3. The source contains no em dashes; the English must not invent any. */
const emZh = (values(zh).join('\n').match(/—/g) || []).length
const emEn = (enText.match(/—/g) || []).length
if (emEn > emZh) fails.push(`English has ${emEn} em dashes, Chinese has ${emZh} — do not introduce them`)

/* 4. Structural parity: same keys, same array lengths. */
function walk(a, b, path = '') {
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return fails.push(`${path}: array in zh, ${typeof b} in en`)
    if (a.length !== b.length) return fails.push(`${path}: ${a.length} items in zh, ${b.length} in en`)
    a.forEach((v, i) => walk(v, b[i], `${path}[${i}]`))
  } else if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object') return fails.push(`${path}: object in zh, ${typeof b} in en`)
    for (const k of Object.keys(a)) {
      if (!(k in b)) fails.push(`${path}.${k}: key missing from en.json`)
      else walk(a[k], b[k], `${path}.${k}`)
    }
  }
}
walk(zh, en)

/* 5. Values that must carry through UNCHANGED. */
for (const id of zh.routes._order) {
  zh.routes[id].legs.forEach((leg, i) => {
    const e = en.routes[id].legs[i]
    if (e.plan !== leg.plan) fails.push(`routes.${id}.legs[${i}].plan was altered: "${e.plan}"`)
    if (e.flight !== leg.flight) fails.push(`routes.${id}.legs[${i}].flight was altered`)
  })
}
for (const k of zh.fleet._order) {
  if (en.fleet[k].reg !== zh.fleet[k].reg) fails.push(`fleet.${k}.reg was altered`)
}
zh.guestbook.entries.forEach((e, i) => {
  const t = en.guestbook.entries[i]
  if (t.content !== e.content) fails.push(`guestbook.entries[${i}] was translated — these are user-authored and stay Chinese`)
  if (t.time !== e.time) fails.push(`guestbook.entries[${i}].time was altered`)
})
if (en.tools.routeQueryUrl !== zh.tools.routeQueryUrl) fails.push('tools.routeQueryUrl was altered')
// A URL is not prose. Translating one silently sends readers somewhere else,
// and the two catalogues must point at the same place.
zh.resources.links.forEach((l, i) => {
  const e = en.resources.links[i]
  if (e.url !== l.url) fails.push(`resources.links[${i}].url was altered: "${e.url}"`)
  if (!/^https:\/\//.test(e.url)) fails.push(`resources.links[${i}].url is not https: "${e.url}"`)
})
// The livery file's empty state is the point of that panel; it must stay empty.
if (zh.resources.livery.photoNone !== '无') fails.push('the livery photograph field lost its 无 empty state')

/* 6. No CJK punctuation leaking into English prose.
      Guestbook entries are deliberately Chinese and are excluded. */
const leaked = values({ ...en, guestbook: { ...en.guestbook, entries: [] } })
  .join('\n').match(/[，。、；？！（）《》【】]/g)
if (leaked) fails.push(`CJK punctuation in English prose: ${[...new Set(leaked)].join(' ')}`)

/* 6b. Stray HANZI in English prose. The punctuation check above missed a
   Chinese verb typed into an English sentence, because a hanzi is not
   punctuation. Ideographs are checked separately.

   Three things are Chinese in the English catalogue ON PURPOSE and are
   exempt: the guestbook entries, which are somebody else's words; the language
   switcher, which has to read 中文; and the April Fools terminal commands,
   which are the original page's own text and are preserved character for
   character, fake shell script and all. */
const hanziScope = {
  ...en,
  guestbook: { ...en.guestbook, entries: [] },
  langName: '',
  nav: { ...en.nav, langSwitch: '' },
  aprilfools: { ...en.aprilfools, commands: [] },
}
const hanzi = values(hanziScope).join('\n').match(/[\u4e00-\u9fff]/g)
if (hanzi) fails.push(`Chinese characters in English prose: ${[...new Set(hanzi)].join('')}`)

if (fails.length) {
  console.error(`✗ ${fails.length} English catalogue failures:\n`)
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log(`✓ ${REQUIRED.length} locked renderings intact, ${BANNED.length} banned strings absent, structure matches zh.json`)
