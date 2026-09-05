#!/usr/bin/env node
/* ==========================================================================
   AXZ static build. Emits 10 documents (5 pages x 2 languages) from the
   content catalogue, with content-hashed asset filenames.

   Hash goes in the FILENAME, never a ?v= query token: the parent portfolio
   serves /(.*)\.(css|js) as immutable for a year, and a query token under a
   year-long immutable header is what broke that site's production once.
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseGlb, summarize } from './assets/inspect-glb.mjs'
import {
  airframe, sideview, TYPES, scaleBase,
  SIM_TYPES, AXZ_ORDER, SIM_ONLY, FLAP_SETS, liftSlope, speedsFor,
  ROTORCRAFT, HANGAR_ORDER, HANGAR_FLAGS,
} from './airframe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC = join(ROOT, 'axz-src')
const OUT = join(ROOT, 'axz')
const BASE = '/axz'

/* The recorder now ships FROM THIS SITE, at the owner's request, so a visitor
   can download it without being sent to GitHub.

   What made that possible is the zip. The bare .exe is a 107.8 MiB
   self-contained .NET build, over GitHub's 100 MiB per-file hard limit and too
   big to version; compressed it is 42.6 MiB, which every repo here accepts.
   The archive also spares the download itself a browser warning — a bare
   unsigned .exe trips one on the way down, a zip does not. The .exe inside is
   still unsigned, so SmartScreen will still speak up when it is RUN, and the
   page says so before the click rather than after.

   The published SHA-256 is the only integrity check an unsigned binary has.
   RECORDER_SHA is verified against the actual file at build time below, so the
   number on the page can never drift from the bytes being served. */
const RECORDER_FILE = 'AXZ-FlightLogRecorder.zip'
const RECORDER_URL = `${BASE}/downloads/${RECORDER_FILE}`
const RECORDER_SHA = 'e52e89fcfb772c33186bcb2e5fd1e642e66ead2bc9b00f83efeb3426a685dfb5'

const zh = JSON.parse(readFileSync(join(SRC, 'content', 'zh.json'), 'utf8'))
const enPath = join(SRC, 'content', 'en.json')
const en = existsSync(enPath) ? JSON.parse(readFileSync(enPath, 'utf8')) : null
if (!en) { console.error('✗ en.json missing — run the translation step first'); process.exit(1) }

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// On the ZH page the lockup is bilingual (小泽航空 Air Xiao Ze); on the EN page
// both names resolve to the same string, so pairing them would print it twice.
const bothNames = c => c.meta.siteNameEn && c.meta.siteNameEn !== c.meta.siteName
const nameLine = (c, sep) => bothNames(c) ? `${c.meta.siteName}${sep}${c.meta.siteNameEn}` : c.meta.siteName

/* --- Language-of-parts (SC 3.1.2) ----------------------------------------
   The lockup is bilingual on every page, in both versions, so Latin runs
   inside ZH pages and Chinese runs inside EN pages must both be tagged.
   Technical identifiers (ICAO, registrations, airways) are NOT tagged —
   they are not prose in either language and live in .code spans.           */
const LATIN_RUNS = ['Air Xiao Ze', 'FLY ON TIME', 'Minecraft']
const HANZI_RUNS = ['小泽航空', '小泽']

function parts(text, lang) {
  let s = esc(text)
  if (lang === 'zh-Hans') {
    for (const r of LATIN_RUNS) s = s.split(esc(r)).join(`<span lang="en">${esc(r)}</span>`)
  } else {
    for (const r of HANZI_RUNS) s = s.split(esc(r)).join(`<span lang="zh-Hans">${esc(r)}</span>`)
  }
  return s
}

/* --- Assets --------------------------------------------------------------- */
const hash = buf => createHash('sha256').update(buf).digest('hex').slice(0, 8)

rmSync(OUT, { recursive: true, force: true })
mkdirSync(join(OUT, 'assets'), { recursive: true })
mkdirSync(join(OUT, 'fonts'), { recursive: true })
mkdirSync(join(OUT, 'img', 'original'), { recursive: true })

// Icon sprite, inlined once per document so <use href="#i-..."> resolves
// without a network round trip and the symbols inherit currentColor.
const sprite = readFileSync(join(SRC, 'icons', 'sprite.svg'), 'utf8')
const icon = (id, cls = '') => `<svg class="icon ${cls}" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`

const cssBundle = ['tokens', 'base', 'ledger', 'plate', 'pages', 'panels']
  .map(f => readFileSync(join(SRC, 'css', `${f}.css`), 'utf8')).join('\n')
// Each file is wrapped in its own block and terminated, so one file can never
// be parsed as a call on the previous file's trailing expression.
const jsBundle = ['site', 'axzlog', 'panels', 'simload', 'hangarload', 'showroomload']
  .map(f => `;(function(){\n${readFileSync(join(SRC, 'js', `${f}.js`), 'utf8')}\n})();`).join('\n')

// Guard the same failure inside a single file: an IIFE that follows another
// with no separating semicolon parses cleanly and throws at runtime.
for (const f of ['site', 'axzlog', 'panels', 'simload', 'hangarload', 'showroomload']) {
  const src = readFileSync(join(SRC, 'js', `${f}.js`), 'utf8')
  if (/\}\)\(\)\s*(?:\/\*[\s\S]*?\*\/)?\s*\(function/.test(src)) {
    console.error(`✗ ${f}.js: an IIFE follows another with no separating semicolon — this throws at runtime`)
    process.exit(1)
  }
}

const cssName = `axz.${hash(cssBundle)}.css`
const jsName = `axz.${hash(jsBundle)}.js`
writeFileSync(join(OUT, 'assets', cssName), cssBundle)
writeFileSync(join(OUT, 'assets', jsName), jsBundle)

/* --- Simulator engine -----------------------------------------------------
   The engine is a set of ES modules that import each other by relative path,
   so the files cannot be hashed individually without rewriting every import.
   The DIRECTORY carries the hash instead: relative imports keep resolving
   inside it, and a changed engine lands on a new URL.

   That matters here more than usual. The parent site serves .js as immutable
   for a year, so a stable path would strand every returning visitor on the old
   build — the same trap that a `?v=` query token fell into once before.       */
const SIM_FILES = ['math', 'gl', 'tex', 'post', 'sound', 'world', 'model', 'fdm', 'particles', 'shadow', 'input', 'mobile', 'hud', 'main', 'boot']
const simSources = SIM_FILES.map(f => readFileSync(join(SRC, 'js', 'sim', `${f}.js`), 'utf8'))
const simDir = `sim-${hash(simSources.join('\n'))}`
mkdirSync(join(OUT, 'assets', simDir), { recursive: true })
SIM_FILES.forEach((f, i) => writeFileSync(join(OUT, 'assets', simDir, `${f}.js`), simSources[i]))
const SIM_ENTRY = `${BASE}/assets/${simDir}/boot.js`
const simBytes = simSources.reduce((n, s) => n + Buffer.byteLength(s), 0)

/* --- Simulator 2.0 ----------------------------------------------------------
   Its own engine directory. The files it changed live in js/sim2/; the ones
   it did not are copied in from js/sim/ so 1.0 stays exactly the 1.0 that
   ships on the archive page. The model library is the hangar's, copied in
   as models.js, so the aeroplane you fly is the aeroplane the hangar shows. */
const SIM2_OWN = ['scene', 'aircraft', 'main', 'boot', 'fdm', 'input', 'world', 'runway']
const SIM2_SHARED = ['math', 'tex', 'sound', 'particles', 'hud', 'mobile']
const sim2Files = [
  ...SIM2_OWN.map(f => [f, readFileSync(join(SRC, 'js', 'sim2', `${f}.js`), 'utf8')]),
  ...SIM2_SHARED.map(f => [f, readFileSync(join(SRC, 'js', 'sim', `${f}.js`), 'utf8')]),
  ['models', readFileSync(join(SRC, 'js', 'hangar', 'models.js'), 'utf8')],
]
const sim2Dir = `sim2-${hash(sim2Files.map(f => f[1]).join('\n'))}`
mkdirSync(join(OUT, 'assets', sim2Dir), { recursive: true })
for (const [f, src] of sim2Files) writeFileSync(join(OUT, 'assets', sim2Dir, `${f}.js`), src)
const SIM2_ENTRY = `${BASE}/assets/${sim2Dir}/boot.js`

/* --- Simulator 3.0 ----------------------------------------------------------
   Same arrangement as 2.0. Phase 0 owns only the entry, the tier chooser and
   the asset hub; the scene, aircraft, flight model and world are 2.0's,
   copied in, until a later phase replaces each one. The data it downloads
   lives in a separate repo on its own origin; the page carries that origin
   so the engine never guesses it. */
const SIM3_OWN = ['boot', 'tier', 'assets', 'rig', 'rigged', 'main']
const SIM3_FROM_SIM2 = ['scene', 'aircraft', 'fdm', 'input', 'world', 'runway']
const sim3Files = [
  ...SIM3_OWN.map(f => [f, readFileSync(join(SRC, 'js', 'sim3', `${f}.js`), 'utf8')]),
  ...SIM3_FROM_SIM2.map(f => [f, readFileSync(join(SRC, 'js', 'sim2', `${f}.js`), 'utf8')]),
  ...SIM2_SHARED.map(f => [f, readFileSync(join(SRC, 'js', 'sim', `${f}.js`), 'utf8')]),
  ['models', readFileSync(join(SRC, 'js', 'hangar', 'models.js'), 'utf8')],
]
const sim3Dir = `sim3-${hash(sim3Files.map(f => f[1]).join('\n'))}`
mkdirSync(join(OUT, 'assets', sim3Dir), { recursive: true })
for (const [f, src] of sim3Files) writeFileSync(join(OUT, 'assets', sim3Dir, `${f}.js`), src)
const SIM3_ENTRY = `${BASE}/assets/${sim3Dir}/boot.js`
const SIM3_TIER = `${BASE}/assets/${sim3Dir}/tier.js`
const ASSETS_ORIGIN = process.env.AXZ_ASSETS_ORIGIN || 'https://axz-assets.vercel.app'
const ASSETS_REPO = process.env.AXZ_ASSETS || join(ROOT, '..', 'axz-assets')
const CREDITS = existsSync(join(ASSETS_REPO, 'public', 'credits.json'))
  ? JSON.parse(readFileSync(join(ASSETS_REPO, 'public', 'credits.json'), 'utf8')) : []
/* A CC BY notice is title, author, source, licence and what changed, each a
   link where one exists. The same shape serves every other licence. */
const LICENSE_URLS = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/', 'CC-BY-3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/', 'PDM': 'https://creativecommons.org/publicdomain/mark/1.0/',
  'Apache-2.0': 'https://www.apache.org/licenses/LICENSE-2.0', 'MIT': 'https://opensource.org/license/mit',
  'GPL-2.0-or-later': 'https://www.gnu.org/licenses/old-licenses/gpl-2.0.html', 'GPL-3.0-or-later': 'https://www.gnu.org/licenses/gpl-3.0.html',
  'ODbL': 'https://opendatacommons.org/licenses/odbl/1-0/', 'Copernicus': 'https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice',
}
/* --- Showroom ------------------------------------------------------------
   The 3.0 models, viewed. Its own hashed directory: the viewer and entry are
   its own; the rig, rigged aeroplane and asset hub are the simulator's, copied
   in, so what moves in the showroom moves the same way on the runway. The
   model list is read from the published index so the page can never name a
   model the origin does not serve. */
const SHOWROOM_OWN = ['boot', 'viewer']
const showroomFiles = [
  ...SHOWROOM_OWN.map(f => [f, readFileSync(join(SRC, 'js', 'showroom', `${f}.js`), 'utf8')]),
  ...['rig', 'rigged', 'assets'].map(f => [f, readFileSync(join(SRC, 'js', 'sim3', `${f}.js`), 'utf8')]),
]
const showroomDir = `showroom-${hash(showroomFiles.map(f => f[1]).join('\n'))}`
mkdirSync(join(OUT, 'assets', showroomDir), { recursive: true })
for (const [f, src] of showroomFiles) writeFileSync(join(OUT, 'assets', showroomDir, `${f}.js`), src)
const SHOWROOM_ENTRY = `${BASE}/assets/${showroomDir}/boot.js`
const ASSET_INDEX = existsSync(join(ASSETS_REPO, 'public', 'index.json'))
  ? JSON.parse(readFileSync(join(ASSETS_REPO, 'public', 'index.json'), 'utf8')) : { assets: {}, credits: [] }
/* Fleet types that have a sourced exterior in the published index. */
const SOURCED_TYPES = new Map()
for (const [id, a] of Object.entries(ASSET_INDEX.assets)) if (a.kind === 'model' && Array.isArray(a.types) && /exterior/.test(a.part || '')) for (const t of a.types) if (!SOURCED_TYPES.has(t)) SOURCED_TYPES.set(t, id)

const creditLine = cr => {
  const link = (href, text) => /^https?:\/\//.test(href || '') ? `<a href="${esc(href)}" rel="noopener">${esc(text)}</a>` : esc(text)
  const lic = link(LICENSE_URLS[cr.license], cr.license)
  return `<li>${link(cr.source, cr.title || cr.id)} · ${link(cr.authorUrl, cr.author)} · ${lic}${cr.modified ? ` · ${esc(cr.modified)}` : ''}</li>`
}

/* --- Hangar ---------------------------------------------------------------
   The 3D fleet viewer. Same arrangement as the simulator: ES modules in a
   directory that carries the hash. Three.js itself comes from a CDN through
   an import map, pinned to one version, and only the hangar page carries the
   map — no other document loads a byte of it. */
const HANGAR_FILES = ['models', 'viewer', 'boot']
const hangarSources = HANGAR_FILES.map(f => readFileSync(join(SRC, 'js', 'hangar', `${f}.js`), 'utf8'))
const hangarDir = `hangar-${hash(hangarSources.join('\n'))}`
mkdirSync(join(OUT, 'assets', hangarDir), { recursive: true })
HANGAR_FILES.forEach((f, i) => writeFileSync(join(OUT, 'assets', hangarDir, `${f}.js`), hangarSources[i]))
const HANGAR_ENTRY = `${BASE}/assets/${hangarDir}/boot.js`
const THREE_VERSION = '0.170.0'
const THREE_CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`
const IMPORT_MAP = `<script type="importmap">${JSON.stringify({ imports: {
  three: `${THREE_CDN}/build/three.module.js`,
  'three/addons/': `${THREE_CDN}/examples/jsm/`,
} })}</script>`

/* --- Warning audio --------------------------------------------------------
   The five alerts the airline's owner supplied, cut to one repeat cycle each
   and re-encoded: 46 MB of screen recordings in, 48 KB of mono AAC out. These
   are the ONLY audio files on the site. The engine, the airflow, the wheels
   and the touchdown are still synthesised, because those are continuous
   functions of the flight state and a sample cannot follow them — but a
   recorded human voice saying PULL UP is a recording, and pretending to
   synthesise one would be worse than fetching it.

   Same directory-hash trick as the engine, for the same immutable-caching
   reason, and nothing here is fetched until the simulator starts. */
const audioSrc = join(SRC, 'audio')
const audioFiles = existsSync(audioSrc)
  ? readdirSync(audioSrc).filter(f => f.endsWith('.m4a')).sort() : []
let AUDIO_BASE = ''
let audioBytes = 0
if (audioFiles.length) {
  const stamp = audioFiles.map(f => f + ':' + statSync(join(audioSrc, f)).size).join('|')
  const audioDir = `audio-${hash(stamp)}`
  mkdirSync(join(OUT, 'assets', audioDir), { recursive: true })
  for (const f of audioFiles) {
    copyFileSync(join(audioSrc, f), join(OUT, 'assets', audioDir, f))
    audioBytes += statSync(join(audioSrc, f)).size
  }
  AUDIO_BASE = `${BASE}/assets/${audioDir}/`
}

// Fonts, already subset by subset-axz-fonts.mjs
const fontDir = join(SRC, 'fonts-out')
const fonts = existsSync(fontDir) ? readdirSync(fontDir).filter(f => f.endsWith('.woff2')) : []
for (const f of fonts) copyFileSync(join(fontDir, f), join(OUT, 'fonts', f))
// Per-language faces: an English page never renders the Chinese glyph set.
const fontFace = lang => {
  const sfx = lang === 'zh-Hans' ? 'zh' : 'en'
  const find = p => fonts.find(f => f.startsWith(p))
  const face = (family, file, weight) => file
    ? `@font-face{font-family:"${family}";src:url("${BASE}/fonts/${file}") format("woff2");font-weight:${weight};font-style:normal;font-display:swap;}`
    : ''
  return [
    face('AXZ Sans', find(`axz-sans-400-${sfx}`), 400),
    face('AXZ Sans', find(`axz-sans-700-${sfx}`), 700),
    face('AXZ Serif', find(`axz-serif-400-${sfx}`), 400),
    face('AXZ Mono', find('axz-mono-400'), 400),
    face('AXZ Mono', find('axz-mono-600'), 600),
  ].filter(Boolean).join('')
}
// Preload only the two faces that paint first: the record column and the mono
// that sets the masthead tagline.
const preloads = lang => {
  const sfx = lang === 'zh-Hans' ? 'zh' : 'en'
  return [fonts.find(f => f.startsWith(`axz-sans-400-${sfx}`)), fonts.find(f => f.startsWith('axz-mono-400'))]
    .filter(Boolean)
    .map(f => `<link rel="preload" as="font" type="font/woff2" href="${BASE}/fonts/${f}" crossorigin>`)
    .join('\n')
}

/* --- Images ---------------------------------------------------------------
   An explicit manifest, not a glob: a glob over the working directory shipped
   the 1.73 MB unoptimised original plus fourteen unreferenced variants. Every
   file here is referenced by the markup, and the build fails if one is
   missing rather than silently emitting a broken <img>.                     */
const IMAGES = [
  'B-2472-480.webp', 'B-2472-800.webp', 'B-2472-1200.webp', 'B-2472-1600.webp',
  'B-2472-1200.jpg',              // <picture> fallback
  'wordmark-light.webp', 'wordmark-dark.webp',
  'b738-top-480.webp', 'b738-top-800.webp', 'b738-top-1200.webp',
  'ksfo-ksns-480.jpg', 'ksfo-ksns-900.jpg', 'ksfo-ksns-927.jpg',
  'ksfo-ksns-480.webp', 'ksfo-ksns-900.webp', 'ksfo-ksns-927.webp',
  'zspd-zsnj-480.jpg', 'zspd-zsnj-900.jpg', 'zspd-zsnj-915.jpg',
  'zspd-zsnj-480.webp', 'zspd-zsnj-900.webp', 'zspd-zsnj-915.webp',
]
const imgSrc = join(SRC, 'img')
for (const f of IMAGES) {
  const from = join(imgSrc, f)
  if (!existsSync(from)) { console.error(`✗ missing image ${f} in axz-src/img/`); process.exit(1) }
  copyFileSync(from, join(OUT, 'img', f))
}
/* The logbook's "load sample" button points at /axz/fixtures/sample.axzlog.
   The build wipes OUT on every run, and nothing used to put this back — so the
   button 404'd on any freshly built deploy. The functional gate never saw it
   because it feeds the reader the SOURCE file through setInputFiles rather
   than fetching the URL the button actually uses; it now checks both. */
const fixSrc = join(SRC, 'fixtures')
mkdirSync(join(OUT, 'fixtures'), { recursive: true })
for (const f of ['sample.axzlog']) {
  if (!existsSync(join(fixSrc, f))) { console.error(`✗ missing fixture ${f} in axz-src/fixtures/`); process.exit(1) }
  copyFileSync(join(fixSrc, f), join(OUT, 'fixtures', f))
}

/* The recorder. Its size and checksum are both PRINTED ON THE PAGE, so both are
   read from the real file here rather than typed into the catalogue — a stated
   size that quietly stops matching the download is exactly the kind of small
   lie this site's gates exist to prevent. */
const dlSrc = join(SRC, 'downloads', RECORDER_FILE)
if (!existsSync(dlSrc)) { console.error(`✗ missing ${RECORDER_FILE} in axz-src/downloads/`); process.exit(1) }
const recorderBytes = readFileSync(dlSrc)
const recorderSha = createHash('sha256').update(recorderBytes).digest('hex')
if (recorderSha !== RECORDER_SHA) {
  console.error(`✗ ${RECORDER_FILE} does not match the published checksum\n  expected ${RECORDER_SHA}\n  actual   ${recorderSha}`)
  process.exit(1)
}
const recorderMB = (recorderBytes.length / 1048576).toFixed(1)
mkdirSync(join(OUT, 'downloads'), { recursive: true })
writeFileSync(join(OUT, 'downloads', RECORDER_FILE), recorderBytes)

// Full-size untouched copies stay available alongside the responsive variants.
const origSrc = join(SRC, 'reference')
for (const f of ['KSFO-KSNS.jpg', 'ZSPD-ZSNJ.jpg']) {
  if (!existsSync(join(origSrc, f))) { console.error(`✗ missing reference render ${f}`); process.exit(1) }
  copyFileSync(join(origSrc, f), join(OUT, 'img', 'original', f))
}

/* --- Page map ------------------------------------------------------------- */
const PAGES = [
  { key: 'home', zhPath: '', enPath: 'en' },
  { key: 'guestbook', zhPath: 'guestbook', enPath: 'en/guestbook' },
  { key: 'logbook', zhPath: 'logbook', enPath: 'en/logbook' },
  { key: 'dispatch', zhPath: 'dispatch', enPath: 'en/dispatch' },
  { key: 'sim', zhPath: 'sim', enPath: 'en/sim' },
  { key: 'simclassic', zhPath: 'sim/classic', enPath: 'en/sim/classic' },
  { key: 'simvintage', zhPath: 'sim/vintage', enPath: 'en/sim/vintage' },
  { key: 'sim3', zhPath: 'sim/v3', enPath: 'en/sim/v3' },
  { key: 'hangar', zhPath: 'hangar', enPath: 'en/hangar' },
  { key: 'showroom', zhPath: 'showroom', enPath: 'en/showroom' },
  { key: 'accessibility', zhPath: 'accessibility', enPath: 'en/accessibility' },
  { key: 'aprilfools', zhPath: 'aprilfools', enPath: 'en/aprilfools' },
]
const urlFor = (key, lang) => {
  const p = PAGES.find(x => x.key === key)
  const seg = lang === 'zh-Hans' ? p.zhPath : p.enPath
  return seg ? `${BASE}/${seg}/` : `${BASE}/`
}

/* --- Shell ---------------------------------------------------------------- */
function shell({ c, lang, key, title, desc, body, noindex = false, head = '' }) {
  const other = lang === 'zh-Hans' ? 'en' : 'zh-Hans'
  const otherCat = lang === 'zh-Hans' ? en : zh
  const P = s => parts(s, lang)

  const NAV_ICON = { home: 'i-home', guestbook: 'i-guestbook', logbook: 'i-logbook', dispatch: 'i-dispatch', sim: 'i-fleet', hangar: 'i-hangar', showroom: 'i-hangar', accessibility: 'i-a11y' }
  const nav = ['home', 'guestbook', 'logbook', 'dispatch', 'sim', 'hangar', 'showroom', 'accessibility'].map(k =>
    `<a href="${urlFor(k, lang)}"${k === key ? ' aria-current="page"' : ''}>${icon(NAV_ICON[k])}<span>${P(c.nav[k])}</span></a>`
  ).join('')

  return `<!DOCTYPE html>
<html lang="${lang}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
<link rel="canonical" href="https://xiaobrook.com${urlFor(key, lang)}">
<link rel="alternate" hreflang="zh-Hans" href="https://xiaobrook.com${urlFor(key, 'zh-Hans')}">
<link rel="alternate" hreflang="en" href="https://xiaobrook.com${urlFor(key, 'en')}">
<link rel="alternate" hreflang="x-default" href="https://xiaobrook.com${urlFor(key, 'zh-Hans')}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="${lang === 'zh-Hans' ? 'zh_CN' : 'en_US'}">
<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">
${preloads(lang)}
<style>${fontFace(lang)}</style>
<link rel="stylesheet" href="${BASE}/assets/${cssName}">
${head}
</head>
<body>
${sprite}
<a class="skip" href="#main">${P(c.nav.skip)}</a>
<header class="topbar">
  <div class="wrap topbar__in">
    <a class="topbar__mark" href="${urlFor('home', lang)}">
      <!-- The name lives on the link, not on an <img>: exactly one of the two
           marks is display:none per theme, so an alt on either would vanish. -->
      <span class="sr-only">${P(c.meta.siteName)} ${esc(c.meta.code)}</span>
      <img class="mark mark--light" src="${BASE}/img/wordmark-light.webp" alt="" aria-hidden="true" width="114" height="74">
      <img class="mark mark--dark" src="${BASE}/img/wordmark-dark.webp" alt="" aria-hidden="true" width="114" height="74">
    </a>
    <nav class="nav" aria-label="${esc(c.nav.label)}">${nav}</nav>
    <div class="controls">
      <div class="lang">
        <a lang="zh-Hans" hreflang="zh-Hans" href="${urlFor(key, 'zh-Hans')}"${lang === 'zh-Hans' ? ' aria-current="page"' : ''}>${icon('i-flag-cn', 'icon--flag')}<span>中文</span></a>
        <span class="lang__sep" aria-hidden="true">/</span>
        <a lang="en" hreflang="en" href="${urlFor(key, 'en')}"${lang === 'en' ? ' aria-current="page"' : ''}>${icon('i-flag-us', 'icon--flag')}<span>English</span></a>
      </div>
      <button class="ctrl-btn ctrl-btn--icon" type="button" data-theme-toggle aria-pressed="false"
        data-label-day="${esc(c.nav.themeDay)}" data-label-night="${esc(c.nav.themeNight)}">
        <svg class="icon" aria-hidden="true" focusable="false" data-theme-icon><use href="#i-moon"/></svg>
        <span class="sr-only" data-theme-label>${esc(c.nav.themeNight)}</span>
      </button>
      <button class="ctrl-btn ctrl-btn--icon" type="button" data-motion-toggle aria-pressed="false"
        data-label-stop="${esc(c.nav.motionStop)}" data-label-resume="${esc(c.nav.motionResume)}">
        <svg class="icon" aria-hidden="true" focusable="false" data-motion-icon><use href="#i-pause"/></svg>
        <span class="sr-only" data-motion-label>${esc(c.nav.motionStop)}</span>
      </button>
    </div>
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap">
    <nav class="foot__nav" aria-label="${esc(c.ui.footerNav)}">${nav}</nav>
    <p>${P(c.meta.copyright)}</p>
    <p>${P(c.meta.disclaimer)}</p>
    <p class="foot__credit">${P(c.meta.artCredit)} <a href="${esc(c.meta.artCreditLink)}" rel="license noopener noreferrer" target="_blank">${esc(c.ui.externalLink)}</a></p>
  </div>
</footer>
<script src="${BASE}/assets/${jsName}" defer></script>
</body>
</html>`
}

/* --- Home ----------------------------------------------------------------- */
const FLEET_BASE = scaleBase(Object.keys(TYPES))

/* --- Units ----------------------------------------------------------------
   Chinese reads metric, English reads imperial. Two things are deliberately
   NOT converted:

   - The altitudes. 5,500英尺 and 31100英尺 are the owner's own words, and
     31,100 ft is a real Chinese metric flight level (9,500 m) — rewriting it
     as metres would both edit his text and destroy the fact.
   - The route distances in Chinese, which he already wrote in 公里.

   Aviation measures distance in NAUTICAL miles, so the English uses nm rather
   than statute miles; "68 mi" between two airports would read as amateur to
   the audience this site is for.                                            */
const M_TO_FT = 3.280839895
const dim = (metres, lang) => lang === 'zh-Hans'
  ? `${metres} m`
  : `${(metres * M_TO_FT).toFixed(1)} ft`

function fleetScale(c, lang) {
  // One figure, all four types, one scale. A size comparison only works when
  // the things being compared are adjacent — repeating a 300px drawing above
  // each of four history paragraphs is bloat, not information.
  const rows = c.fleet._order.map(id => {
    const spec = TYPES[id]
    if (!spec) return ''
    const a = airframe(spec)
    const P = a.paths
    const pct = (spec.len / FLEET_BASE) * 100
    const solid = [P.fuse, ...P.wings, ...P.stabs, ...P.nacelles]
      .map((d, i) => `<path class="af-part" style="--i:${i}" d="${d}"/>`).join('')
    const door = P.door ? `<path class="af-door" d="${P.door}"/>` : ''

    // Side elevation, same metres-per-unit scale, so the two views of one type
    // line up and all four types stay comparable across both.
    const sv = sideview(spec)
    const S = sv.paths
    const svSolid = [S.fuse, S.wing, S.stab, S.fin, S.nacelle]
      .map((d, i) => `<path class="af-part" style="--i:${i}" d="${d}"/>`).join('')
    const svThin = [S.win, ...S.legs].map(d => `<path class="af-line" d="${d}"/>`).join('')
      + (S.door ? `<path class="af-door" d="${S.door}"/>` : '')
    const svg2 = `<svg viewBox="${sv.viewBox}" aria-hidden="true" focusable="false">
        ${svSolid}${svThin}<path class="af-ground" d="${S.ground}"/>
      </svg>`
    const f = c.fleet[id]
    return `<li class="af-row">
      <div class="af-meta">
        <span class="reg">${esc(f.reg)}</span>
        <span class="af-name">${parts(f.name, lang)}</span>
        <span class="af-dims"><b class="code">${dim(spec.len, lang)}</b> &middot; <b class="code">${dim(spec.span, lang)}</b></span>
      </div>
      <div class="af-draw" style="--af-w:${pct.toFixed(1)}%">
        <svg viewBox="${a.viewBox}" role="img" aria-label="${esc(spec.name)}, ${esc(c.fleet.labels.length)} ${dim(spec.len, lang)}, ${esc(c.fleet.labels.span)} ${dim(spec.span, lang)}" focusable="false">
          ${solid}<path class="af-fin" style="--i:7" d="${P.fin}"/>${door}
        </svg>
        ${svg2}
      </div>
    </li>`
  }).join('')

  return `<figure class="fleet-scale">
  <ul class="af-list">${rows}</ul>
</figure>`
}

/* --- Masthead aircraft ----------------------------------------------------
   A real technical drawing, not a generated outline: the top view from
   Julien.scavini's four-view of the 737-800 (Wikimedia Commons, CC BY-SA 3.0),
   isolated from the sheet and shipped as an alpha matte. Painted with CSS
   mask-image so the line colour comes from --ink and follows the theme.     */
function mastheadShip() {
  return `<div class="masthead__ship" aria-hidden="true"></div>`
}

/* --- Flight progress strips -----------------------------------------------
   The four flight numbers in the form every simmer knows: an ATC progress
   strip. Callsign block, level block, route block. Every value is already on
   the site — no aircraft is assigned to a leg, because the content says both
   B-737X and B-321X fly AXZ001/002 and picking one would be inventing.     */
function flightStrips(c, lang) {
  const rows = c.routes._order.flatMap(id => {
    const r = c.routes[id]
    return r.legs.map(leg => ({ leg, r }))
  })
  const strips = rows.map(({ leg, r }) => `<li class="strip" data-flight="${esc(leg.flight)}">
    <div class="strip__call">
      <span class="strip__no code">${esc(leg.flight)}</span>
      <span class="strip__dir">${esc(leg.dir)}</span>
    </div>
    <div class="strip__lvl">
      <span class="code">${esc(r.altitude)}</span>
      <span class="strip__t">${esc(r.duration)}</span>
    </div>
    <div class="strip__rte">
      <span class="strip__pair"><span class="code">${esc(leg.dir === r.legs[0].dir ? r.from : r.to)}</span>
        <span aria-hidden="true">&#8594;</span>
        <span class="code">${esc(leg.dir === r.legs[0].dir ? r.to : r.from)}</span></span>
      <span class="route-string">${esc(leg.plan).split(' ').map(t => `<span class="tok">${t}</span>`).join(' ')}</span>
    </div>
  </li>`).join('')
  return `<figure class="strips">
    <ul class="strip-list">${strips}</ul>
  </figure>`
}

/* --- Altitude profile -----------------------------------------------------
   Uses only figures already on the site: the two cruise altitudes and the two
   distances. 31,100 ft against 5,500 ft is a 5.7x difference that a table row
   hides completely; drawn to one scale it is the most striking fact here.   */
function altitudeProfile(c, lang) {
  const legs = [
    { id: 'ksfo-ksns', ft: 5500 },
    { id: 'zspd-zsnj', ft: 31100 },
  ]
  const W = 720, H = 210, PAD = 34
  const maxFt = 31100
  const y = ft => H - PAD - (ft / maxFt) * (H - PAD * 2)
  const rows = legs.map((leg, i) => {
    const r = c.routes[leg.id]
    const x0 = PAD + i * ((W - PAD * 2) / 2) + 10
    const w = (W - PAD * 2) / 2 - 40
    const top = y(leg.ft)
    const base = H - PAD
    const d = `M ${x0} ${base} L ${x0 + w * 0.22} ${top.toFixed(1)} L ${x0 + w * 0.78} ${top.toFixed(1)} L ${x0 + w} ${base}`
    return `<g class="prof-leg">
      <path class="prof-path" d="${d}"/>
      <text class="prof-alt" x="${x0 + w / 2}" y="${(top - 8).toFixed(1)}" text-anchor="middle">${esc(r.altitudeShort || r.altitude)}</text>
      <text class="prof-pair" x="${x0 + w / 2}" y="${base + 16}" text-anchor="middle">${esc(r.from)}&#8202;&#8596;&#8202;${esc(r.to)}</text>
    </g>`
  }).join('')
  return `<figure class="profile">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.ui.profileNote)}" focusable="false">
    <line class="prof-ground" x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}"/>
    <text class="prof-ground-l" x="${PAD}" y="${H - PAD + 16}">${esc(c.routes.labels.ground)}</text>
    ${rows}
  </svg>
  <figcaption>${parts(c.ui.profileNote, lang)}</figcaption>
</figure>`
}

/* --- Route network, both pairs on ONE scale --------------------------------
   Two things are combined here, and each comes from a different authority:

   - The BEARING of each leg is computed from the four airports' real published
     coordinates (below), so a leg points the way the aeroplane actually goes.
   - The LENGTH of each leg comes from the distance THIS SITE publishes, not
     from those coordinates. Great-circle KSFO-KSNS is nearer 126 km than the
     约110公里 in the routes section, and a figure that silently disagreed with
     the text beside it would just be a second, contradictory claim. The site's
     own number wins, and the caption says the drawing uses it.

   Both pairs share one km-per-unit scale, so 110 against 280 is visible as
   length — the same idiom as the altitude profile and the fleet comparison.  */
const AIRPORTS = {
  KSFO: [37.6189, -122.3750], KSNS: [36.6628, -121.6064],
  ZSPD: [31.1434, 121.8052], ZSNJ: [31.7420, 118.8622],
}
const bearing = (a, b) => {
  const [la1, lo1] = AIRPORTS[a].map(d => d * Math.PI / 180)
  const [la2, lo2] = AIRPORTS[b].map(d => d * Math.PI / 180)
  const y = Math.sin(lo2 - lo1) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}
const NET_KM = { 'ksfo-ksns': 110, 'zspd-zsnj': 280 }   // the site's own figures

function netMap(c, lang) {
  const N = c.netmap
  const W = 720, H = 230, PX_PER_KM = 0.62, SCALE_KM = 100
  const centres = { 'ksfo-ksns': [150, 112], 'zspd-zsnj': [520, 112] }

  const legs = c.routes._order.map(id => {
    const r = c.routes[id]
    const brg = bearing(r.from, r.to)
    const len = NET_KM[id] * PX_PER_KM
    const [cx, cy] = centres[id]
    const dx = Math.sin(brg * Math.PI / 180) * len
    const dy = -Math.cos(brg * Math.PI / 180) * len
    const x1 = cx - dx / 2, y1 = cy - dy / 2, x2 = cx + dx / 2, y2 = cy + dy / 2
    // Airport labels are pushed outward along the leg's own axis, so each one
    // sits beyond its end of the track rather than across it.
    const off = (x, y, sx, sy) => `x="${(x + sx * 9).toFixed(1)}" y="${(y + sy * 9).toFixed(1)}"`
    const anchor = d => d > 6 ? 'start' : d < -6 ? 'end' : 'middle'
    // The distance label goes PERPENDICULAR to the leg. Offsetting it straight
    // up or down put it on top of the near-vertical KSFO track.
    const px = -dy / len, py = dx / len
    const lx = cx + px * 17, ly = cy + py * 17 + 4
    return `<g class="net-leg" data-net-leg="${id}">
      <line class="net-track" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>
      <circle class="net-dot" cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="3.4"/>
      <circle class="net-dot" cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3.4"/>
      <text class="net-icao" ${off(x1, y1, -Math.sign(dx) || 1, -Math.sign(dy) || 1)} text-anchor="${anchor(-dx)}">${esc(r.from)}</text>
      <text class="net-icao" ${off(x2, y2, Math.sign(dx) || 1, Math.sign(dy) || 1)} text-anchor="${anchor(dx)}">${esc(r.to)}</text>
      <text class="net-km" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle">${esc(r.distance)}</text>
    </g>`
  }).join('')

  // One button per flight leg. The buttons are the interaction; the SVG is a
  // picture. That keeps every control keyboard-reachable and named in text.
  const buttons = c.routes._order.flatMap(id => c.routes[id].legs.map(leg =>
    `<button class="net-btn" type="button" data-net-select="${id}" data-net-flight="${esc(leg.flight)}"
      aria-pressed="false"><span class="code">${esc(leg.flight)}</span> <span class="net-btn__dir">${esc(leg.dir)}</span></button>`
  )).join('')

  const scalePx = (SCALE_KM * PX_PER_KM).toFixed(1)
  return `<figure class="netmap" data-netmap>
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(N.alt || N.title)}" focusable="false">
    ${legs}
    <g class="net-rose" transform="translate(${W - 26} 34)">
      <path class="net-north" d="M0 11 L0 -11 M-4.5 -4.5 L0 -11 L4.5 -4.5"/>
      <text class="net-km" x="0" y="24" text-anchor="middle">${esc(N.northLabel)}</text>
    </g>
    <g class="net-scale" transform="translate(24 ${H - 26})">
      <path class="net-bar" d="M0 0 h${scalePx} M0 -4 v8 M${scalePx} -4 v8"/>
      <text class="net-km" x="${(scalePx / 2)}" y="17" text-anchor="middle">${esc(N.scaleValue)}</text>
    </g>
  </svg>
  <p class="net-select__title" id="net-sel">${esc(N.selectTitle)}</p>
  <div class="net-select" role="group" aria-labelledby="net-sel">
    ${buttons}
    <button class="net-btn net-btn--all" type="button" data-net-clear>${esc(N.showAll)}</button>
  </div>
  ${N.note ? `<figcaption>${parts(N.note, lang)}</figcaption>` : ''}
</figure>`
}

/* --- Departure board -------------------------------------------------------
   A real FIDS carries a status column, and this one can only ever say 准点 /
   ON TIME. That is not a placeholder: no departure time exists anywhere in the
   owner's content, so a board with times would be inventing a schedule. What
   the airline does publish is a promise — FLY ON TIME — and a board that can
   print nothing else is the honest form of it.

   The clocks are the only live thing on the site. They are real: the two base
   time zones, converted through the reader's own device.                     */
function departureBoard(c, lang) {
  const B = c.board
  const rows = c.routes._order.flatMap(id => {
    const r = c.routes[id]
    return r.legs.map(leg => {
      const out = leg.dir === r.legs[0].dir
      return `<tr>
        <td class="bd-flight"><span class="code">${esc(leg.flight)}</span></td>
        <td class="bd-sector"><span class="code">${esc(out ? r.from : r.to)}</span> <span aria-hidden="true">&#8594;</span> <span class="code">${esc(out ? r.to : r.from)}</span></td>
        <td class="bd-level"><span class="code">${esc(r.altitudeShort || r.altitude)}</span></td>
        <td class="bd-block">${esc(r.duration)}</td>
        <td class="bd-status"><span class="bd-flap">${esc(B.status)}</span></td>
      </tr>`
    })
  }).join('')

  // Each clock renders its ZONE NAME server-side and is upgraded to a running
  // time by script. With no JS the cell still says something true.
  const clocks = B.bases.map(b => `<div class="clock">
    <span class="clock__icao code">${esc(b.icao)}</span>
    <span class="clock__name">${parts(b.name, lang)}</span>
    <span class="clock__time code" data-clock="${esc(b.zone)}">${esc(b.zone)}</span>
  </div>`).join('')

  return `<div class="board">
  <p class="prose">${parts(B.note, lang)}</p>
  <table class="bd">
    <caption class="sr-only">${parts(B.note, lang)}</caption>
    <thead><tr>
      <th scope="col">${esc(B.cols.flight)}</th>
      <th scope="col">${esc(B.cols.sector)}</th>
      <th scope="col">${esc(B.cols.level)}</th>
      <th scope="col">${esc(B.cols.block)}</th>
      <th scope="col">${esc(B.cols.status)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="bd-note">${parts(B.statusNote, lang)}</p>
  <h3 class="record__label">${esc(B.clocksTitle)}</h3>
  <div class="clocks">${clocks}</div>
  ${B.clockNote ? `<p class="bd-note">${parts(B.clockNote, lang)}</p>` : ''}
</div>`
}

/* --- Resources + the livery file -------------------------------------------
   The livery file has no photograph, and says so in the field rather than
   quietly omitting it. That empty state is the site's own schema: the C#
   recorder gives both remarks fields an explicit 无 checkbox, so "nothing
   here" is a value this airline already knows how to record.                 */
function resources(c, lang) {
  const R = c.resources, L = R.livery
  const links = R.links.map(l => `<li class="res-row">
    <a class="res-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${icon('i-external')}<span>${esc(l.name)}</span><span class="sr-only"> (${esc(c.tools.externalNote)})</span></a>
    <span class="res-desc">${parts(l.desc, lang)}</span>
  </li>`).join('')

  const rows = L.rows.map(r => `<dt>${parts(r.k, lang)}</dt><dd>${parts(r.v, lang)}</dd>`).join('')

  return `<div class="res">
  <h3 class="record__label">${esc(R.linksTitle)}</h3>
  <p class="prose">${parts(R.linksNote, lang)}</p>
  <ul class="res-list">${links}</ul>

  <h3 class="record__label">${parts(L.title, lang)}</h3>
  <div class="ledger">
    <article class="ledger__row reveal">
      <div class="ledger__record">
        <p class="prose">${parts(L.note, lang)}</p>
        <dl class="spec livery">${rows}</dl>
      </div>
      <aside class="ledger__remarks">
        <span class="ledger__remarks-label">${esc(L.photoLabel)}</span>
        <p class="remark-none">${esc(L.photoNone)}</p>
        ${L.photoNote ? `<p class="livery__note">${parts(L.photoNote, lang)}</p>` : ''}
      </aside>
    </article>
  </div>
</div>`
}

const CHART = {
  'ksfo-ksns': { base: 'ksfo-ksns', full: 927, orig: 'KSFO-KSNS.jpg', w: 927, h: 627 },
  'zspd-zsnj': { base: 'zspd-zsnj', full: 915, orig: 'ZSPD-ZSNJ.jpg', w: 915, h: 633 },
}

function routeRow(c, lang, id) {
  const r = c.routes[id], L = c.routes.labels, P = s => parts(s, lang)
  const ch = CHART[id]
  const legs = r.legs.map(leg => `
      <dt id="${leg.id}">${esc(leg.dir)} <span class="code">${esc(leg.flight)}</span></dt>
      <dd><span class="route-string">${esc(leg.plan).split(' ').map(t => `<span class="tok">${t}</span>`).join(' ')}</span></dd>`).join('')

  return `<article class="ledger__row reveal" id="${id}">
  <p class="ledger__no">${esc(r.from)} &#8596; ${esc(r.to)}</p>
  <div class="ledger__record">
    <h3 class="record__title"><span class="code">${esc(r.from)}</span> <span aria-hidden="true">&#8596;</span> <span class="code">${esc(r.to)}</span></h3>
    <p class="record__meta">${P(r.pair)}</p>
    <figure class="plate">
      <div class="plate__head"><span>${esc(c.ui.chartCaption)}</span><span class="plate__pair">${esc(r.from)}&#8202;&#8596;&#8202;${esc(r.to)}</span></div>
      <picture>
        <source type="image/webp" srcset="${BASE}/img/${ch.base}-480.webp 480w, ${BASE}/img/${ch.base}-900.webp 900w, ${BASE}/img/${ch.base}-${ch.full}.webp ${ch.full}w" sizes="(max-width: 700px) 100vw, 640px">
        <img class="plate__img" src="${BASE}/img/${ch.base}-900.jpg" alt="${esc(r.chartAlt)}" width="${ch.w}" height="${ch.h}" loading="lazy" decoding="async">
      </picture>
      <figcaption class="plate__note">${esc(c.home.routeNote)}</figcaption>
    </figure>
    <dl class="spec">
      <dt>${esc(L.distance)}</dt><dd>${esc(r.distance)}</dd>
      <dt>${esc(L.duration)}</dt><dd>${esc(r.duration)}</dd>
      <dt>${esc(L.altitude)}</dt><dd>${esc(r.altitude)}</dd>
      <dt>${esc(L.landmarks)}</dt><dd>${P(r.landmarks)}</dd>
      ${legs}
    </dl>
  </div>
  <aside class="ledger__remarks">
    <span class="ledger__remarks-label">${esc(L.plan)}</span>
    ${r.legs.map(leg => `<p class="remark-cell"><span class="code">${esc(leg.flight)}</span> ${esc(leg.dir)}</p>`).join('')}
  </aside>
</article>`
}

function fleetRow(c, lang, id) {
  const f = c.fleet[id], L = c.fleet.labels, P = s => parts(s, lang)
  return `<article class="ledger__row reveal" id="${id}">
  <p class="ledger__no">${esc(L.reg)} <span class="reg">${esc(f.reg)}</span></p>
  <div class="ledger__record">
    <h3 class="record__title">${P(f.name)}</h3>
    <p class="prose">${P(f.history)}</p>
    <p class="record__label">${esc(L.events)}</p>
    <ol class="record__events">${f.events.map(e => `<li>${P(e)}</li>`).join('')}</ol>
  </div>
  <aside class="ledger__remarks">
    <span class="ledger__remarks-label"><span aria-hidden="true">&#128514;</span> ${esc(L.funny)}</span>
    ${f.funny.map(e => `<p class="remark-cell">${P(e)}</p>`).join('')}
  </aside>
</article>`
}

function home(c, lang) {
  const P = s => parts(s, lang)
  const S = c.home.sectors
  const pax = c.fleet._order.filter(k => c.fleet[k].group === 'pax')
  const cargo = c.fleet._order.filter(k => c.fleet[k].group === 'cargo')

  const body = `
<section class="masthead">
  <div class="wrap masthead__in">
    <h1 class="sr-only">${P(nameLine(c, ' '))} (${esc(c.meta.code)})</h1>
    <p class="masthead__tagline" lang="en" aria-hidden="true">FLY<br>ON<br>TIME</p>
    <p class="masthead__remark">${P(c.meta.disclaimer)}</p>
    <p class="masthead__sub">${P(nameLine(c, ' · '))} · ${esc(c.meta.code)}</p>
    ${/* The way in. The simulator was reachable only from the navigation, which
          is where a reader looks for another PAGE, not for the thing the whole
          site is about. It is a link rather than a button because it goes
          somewhere, and it carries its own one-line explanation so the press is
          an informed one. */''}
    <p class="masthead__cta">
      <a class="btn btn--go" href="${urlFor('sim', lang)}">${icon('i-fleet')}${esc(c.home.simCta)}</a>
      <span class="masthead__ctanote">${esc(c.home.simCtaNote)}</span>
    </p>
    ${mastheadShip()}
  </div>
</section>

<section class="sector wrap" aria-labelledby="s-routes">
  <div class="sector__head"><span class="sector__no">${esc(S.routes.no)}</span>${icon('i-route', 'icon--head')}<h2 id="s-routes">${P(S.routes.name)}</h2></div>
  <div class="ledger">${c.routes._order.map(id => routeRow(c, lang, id)).join('')}</div>
  <h3 class="record__label">${esc(c.netmap.title)}</h3>
  ${netMap(c, lang)}
  <h3 class="record__label">${esc(c.routes.labels.flights)}</h3>
  ${flightStrips(c, lang)}
  <h3 class="record__label">${esc(c.routes.labels.profile)}</h3>
  ${altitudeProfile(c, lang)}
</section>

<section class="sector wrap" aria-labelledby="s-fleet">
  <div class="sector__head"><span class="sector__no">${esc(S.fleet.no)}</span>${icon('i-fleet', 'icon--head')}<h2 id="s-fleet">${P(S.fleet.name)}</h2></div>
  <p class="record__label">${esc(c.fleet.listTitle)}</p>
  ${fleetScale(c, lang)}
  <h3 class="record__label">${esc(c.fleet.groups.pax)}</h3>
  <div class="ledger">${pax.map(id => fleetRow(c, lang, id)).join('')}</div>
  <h3 class="record__label">${esc(c.fleet.groups.cargo)}</h3>
  <div class="ledger">${cargo.map(id => fleetRow(c, lang, id)).join('')}</div>
</section>

<section class="sector wrap" aria-labelledby="s-board">
  <div class="sector__head"><span class="sector__no">${esc(S.board.no)}</span>${icon('i-board', 'icon--head')}<h2 id="s-board">${P(S.board.name)}</h2></div>
  ${departureBoard(c, lang)}
</section>

<section class="sector wrap" aria-labelledby="s-record">
  <div class="sector__head"><span class="sector__no">${esc(S.record.no)}</span><h2 id="s-record">${P(S.record.name)}</h2></div>
  <div class="ledger">
    <article class="ledger__row reveal">
      <div class="ledger__record">
        <p class="record__label">${esc(c.record.labels.history)}</p>
        <p class="prose">${P(c.record.history)}</p>
        <p class="record__label">${esc(c.record.labels.events)}</p>
        <ol class="record__events">${c.record.events.map(e => `<li>${P(e)}</li>`).join('')}</ol>
      </div>
      <aside class="ledger__remarks">
        <span class="ledger__remarks-label"><span aria-hidden="true">&#128514;</span> ${esc(c.record.labels.blackHistory)}</span>
        ${c.record.blackHistory.map(e => `<p class="remark-cell">${P(e)}</p>`).join('')}
      </aside>
    </article>
  </div>
</section>

<section class="sector wrap" aria-labelledby="s-hot">
  <div class="sector__head"><span class="sector__no">${esc(S.hotspot.no)}</span><h2 id="s-hot">${P(S.hotspot.name)}</h2></div>
  <p class="prose">${P(c.hotspot.body)}</p>
  <figure class="print">
    <picture>
      <source type="image/webp" srcset="${BASE}/img/B-2472-480.webp 480w, ${BASE}/img/B-2472-800.webp 800w, ${BASE}/img/B-2472-1200.webp 1200w, ${BASE}/img/B-2472-1600.webp 1600w" sizes="(max-width: 700px) 100vw, 62ch">
      <img src="${BASE}/img/B-2472-1200.jpg" alt="${esc(c.hotspot.imageAlt)}" width="1200" height="800" loading="lazy" decoding="async">
    </picture>
    <figcaption>${P(c.hotspot.status)}</figcaption>
  </figure>
</section>

<section class="sector wrap" aria-labelledby="s-res">
  <div class="sector__head"><span class="sector__no">${esc(S.resources.no)}</span>${icon('i-external', 'icon--head')}<h2 id="s-res">${P(S.resources.name)}</h2></div>
  ${resources(c, lang)}
</section>

<section class="sector wrap" aria-labelledby="s-guest">
  <div class="sector__head"><span class="sector__no">${esc(S.guestbook.no)}</span>${icon('i-guestbook', 'icon--head')}<h2 id="s-guest">${P(S.guestbook.name)}</h2></div>
  <p class="prose">${P(c.guestbook.homeBody)}</p>
  <p class="btn-row"><a class="btn" href="${urlFor('guestbook', lang)}">${icon('i-guestbook')}${esc(c.guestbook.cta)}</a></p>
  <h3 class="record__label">${esc(c.tools.title)}</h3>
  <p class="btn-row">
    <a class="btn" href="${esc(c.tools.routeQueryUrl)}" target="_blank" rel="noopener noreferrer" hreflang="zh">${icon('i-external')}${esc(c.tools.routeQuery)}<span class="sr-only"> (${esc(c.tools.externalNote)})</span></a>
    <a class="btn" href="${urlFor('dispatch', lang)}">${icon('i-dispatch')}${esc(c.dispatch.title)}</a>
    <a class="btn" href="${urlFor('logbook', lang)}">${icon('i-logbook')}${esc(c.logbook.title)}</a>
  </p>
</section>`

  return shell({ c, lang, key: 'home', title: `${nameLine(c, ' ')} (${c.meta.code})`, desc: c.meta.description, body })
}

/* --- Guestbook ------------------------------------------------------------ */
function guestbook(c, lang) {
  const P = s => parts(s, lang)
  const body = `
<section class="sector wrap">
  <h1>${P(c.guestbook.title)}</h1>
  <p class="masthead__remark">${esc(c.guestbook.warning)}</p>
  <p class="notice">${P(c.guestbook.archiveNotice)}</p>
  <div class="ledger">
    ${c.guestbook.entries.map(e => `<div class="entry ledger__row"><div class="ledger__record">
      <time datetime="${esc(e.time.replace(' ', 'T'))}">${esc(e.time)}</time>
      <blockquote${lang === 'en' ? ' lang="zh-Hans"' : ''}>${esc(e.content)}</blockquote>
    </div></div>`).join('')}
  </div>
  <h2>${esc(c.guestbook.ceremonyTitle)}</h2>
  <p class="notice">${P(c.guestbook.ceremonyNote)}</p>
  <ul class="record__events">${c.guestbook.ceremony.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
  <p><a class="btn" href="${urlFor('home', lang)}">${esc(c.guestbook.back)}</a></p>
</section>`
  return shell({ c, lang, key: 'guestbook', title: `${c.guestbook.title} — ${c.meta.siteName}`, desc: c.guestbook.archiveNotice, body })
}

/* --- Logbook --------------------------------------------------------------
   Pilot login first, then the reader. The login is a MOCK: anything gets you
   in, nothing is checked, nothing is sent. It is kept because the original
   page had one, and the notice above it says plainly that it verifies nothing
   so that nobody types a password they actually use.

   The gate is applied BY JAVASCRIPT, not in the markup. With scripts off both
   sections simply render and the reader still works — a login that cannot be
   passed without JS would be a dead end, not a feature.                     */
function logbook(c, lang) {
  const P = s => parts(s, lang)
  const strings = JSON.stringify({
    bands: c.logbook.bands, fields: c.logbook.fields, noRemark: c.logbook.noRemark,
    errorFormat: c.logbook.errorFormat, errorEmpty: c.logbook.errorEmpty,
    errorRead: c.logbook.errorRead, unsupported: c.logbook.unsupported,
    sampleNotice: c.logbook.sampleNotice,
  })
  const body = `
<section class="sector wrap" data-axzlog data-strings="${esc(strings)}">
  <h1>${P(c.logbook.title)}</h1>
  <p class="prose">${P(c.logbook.intro)}</p>

  <section class="gate" data-gate>
    <h2>${esc(c.logbook.loginTitle)}</h2>
    <div class="notice">${P(c.logbook.loginDemoNotice)}</div>
    <form class="demo-gate" data-demo-gate autocomplete="off" novalidate
          data-welcome="${esc(c.logbook.welcome)}" data-note="${esc(c.logbook.welcomeNote)}">
      <div class="field">
        <label for="pilot">${esc(c.logbook.loginUser)}</label>
        <input id="pilot" name="pilot" type="text" autocomplete="off" placeholder="${esc(c.logbook.loginUserPlaceholder)}">
      </div>
      <div class="field">
        <label for="pilotpw">${esc(c.logbook.loginPass)}</label>
        <!-- Inert by construction: no name, no form action, never read, never
             stored, never sent. autocomplete/data-1p-ignore stop password
             managers offering to save anything typed here. -->
        <input id="pilotpw" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true"
               placeholder="${esc(c.logbook.loginPassPlaceholder)}">
      </div>
      <p class="status" role="status" data-demo-status></p>
      <button class="btn" type="submit">${esc(c.logbook.loginButton)}</button>
      <p class="record__meta">${esc(c.logbook.loginNoRegister)}</p>
    </form>
  </section>

  <div data-viewer>
    <h2 class="sr-only" id="viewer-h" tabindex="-1">${P(c.logbook.title)}</h2>
    <!-- The whole zone is the file control: a <label> wrapping a visually
         hidden input, so a click anywhere opens the picker and the file loads
         the moment it is chosen. No separate "load" step. -->
    <label class="dropzone" data-axzlog-zone>
      <input id="axzfile" type="file" accept=".axzlog" class="sr-only" data-axzlog-input>
      ${icon('i-drop', 'icon--drop')}
      <span class="dropzone__hint">${esc(c.logbook.dropzone)}</span>
    </label>
    <p class="dropzone__alt">
      <button class="btn" type="button" data-axzlog-sample="${BASE}/fixtures/sample.axzlog">${esc(c.logbook.sampleButton)}</button>
      <button class="btn" type="button" data-axzlog-clear>${esc(c.logbook.clearButton)}</button>
    </p>
    <p class="status" role="status" data-axzlog-status></p>
    <div class="ledger" data-axzlog-out hidden></div>

    <h2>${esc(c.logbook.formatTitle)}</h2>
    <p class="prose">${P(c.logbook.formatBody)}</p>

    <h2>${esc(c.logbook.legacyTitle)}</h2>
    <p class="notice">${P(c.logbook.legacyNote)}</p>
    <ul class="record__events">${c.logbook.legacy.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
  </div>

  <h2>${esc(c.logbook.toolTitle)}</h2>
  <p class="prose">${P(c.logbook.toolNote)}</p>
  <p class="btn-row">
    <!-- Same-origin now, so the download attribute applies and the browser
         saves the file under this name instead of navigating to it. -->
    <a class="btn" href="${RECORDER_URL}" download="${esc(RECORDER_FILE)}">${icon('i-drop')}${esc(c.logbook.toolDownload)}</a>
  </p>
  <p class="record__meta">${esc(c.logbook.toolMeta.replace('{SIZE}', recorderMB))} &middot; ${esc(c.logbook.toolHost)}</p>
  <p class="notice">${P(c.logbook.toolWarn)}</p>
  <dl class="spec sha">
    <dt>${esc(c.logbook.toolShaLabel)}</dt>
    <dd><span class="code sha__value">${esc(RECORDER_SHA)}</span></dd>
  </dl>
  <p class="record__meta">${esc(c.logbook.toolShaNote)}</p>

  <p class="btn-row btn-row--foot">
    <a class="btn" href="${urlFor('home', lang)}">${icon('i-home')}${esc(c.logbook.backHome)}</a>
  </p>
</section>`
  return shell({ c, lang, key: 'logbook', title: `${c.logbook.title} — ${c.meta.siteName}`, desc: c.logbook.intro, body })
}

/* --- Dispatch desk ---------------------------------------------------------
   Everything the release prints is already published in the routes section:
   the filed routing, the cruise level, the distance and the block time. The
   one derived figure is average groundspeed, which is distance over block
   time, and the arithmetic is printed on the page so it can be checked.

   There is deliberately no fuel figure. Fuel needs all-up weight, wind and an
   alternate; this site publishes none of the three, so any number here would
   be invented, and an invented number in a document shaped like a real release
   is worse than a missing one.                                               */
const DISPATCH_KM = { 'ksfo-ksns': 110, 'zspd-zsnj': 280 }
const DISPATCH_MIN = { 'ksfo-ksns': 30, 'zspd-zsnj': 50 }
const MI_PER_KM = 0.621371

function dispatchData(c, lang) {
  // The release is built in the browser from this table, so the same figures
  // drive the server-rendered default and every later selection.
  const out = {}
  for (const id of c.routes._order) {
    const r = c.routes[id]
    const km = DISPATCH_KM[id], min = DISPATCH_MIN[id]
    const speed = lang === 'zh-Hans'
      ? Math.round(km / (min / 60))
      : Math.round((km * MI_PER_KM) / (min / 60))
    for (const leg of r.legs) {
      const out2 = leg.dir === r.legs[0].dir
      out[leg.flight] = {
        flight: leg.flight, route: leg.plan, dir: leg.dir,
        sector: `${out2 ? r.from : r.to} - ${out2 ? r.to : r.from}`,
        level: r.altitude, distance: r.distance, block: r.duration,
        speed: `${speed} ${c.dispatch.speedUnit}`,
      }
    }
  }
  return out
}

function dispatchPage(c, lang) {
  const P = s => parts(s, lang), D = c.dispatch, LG = c.landing
  const F = D.fields
  const data = dispatchData(c, lang)
  const first = Object.keys(data)[0]

  const legOpts = c.routes._order.flatMap(id => c.routes[id].legs.map(leg =>
    `<option value="${esc(leg.flight)}">${esc(leg.flight)} · ${esc(leg.dir)} · ${esc(c.routes[id].from)}-${esc(c.routes[id].to)}</option>`)).join('')
  const acOpts = c.fleet._order.map(id =>
    `<option value="${esc(id)}">${esc(c.fleet[id].reg)} · ${esc(c.fleet[id].name)}</option>`).join('')
  const acData = Object.fromEntries(c.fleet._order.map(id => [id, { reg: c.fleet[id].reg, name: c.fleet[id].name }]))

  const row = (k, v, attr = '') => `<dt>${esc(k)}</dt><dd${attr}>${esc(v)}</dd>`
  const d0 = data[first], a0 = acData[c.fleet._order[0]]

  // Scoring table — the complete static equivalent of the landing game. It is
  // rendered whether or not the game ever runs, because the site's own rule is
  // that a motion which cannot be removed and leave the information behind is
  // not shipped.
  const bandRows = LG.bands.map(b => `<tr>
    <td class="code">${esc(b.range)}</td>
    <td class="lg-remark">${parts(b.remark, lang)}</td>
  </tr>`).join('')

  const body = `
<section class="sector wrap">
  <h1>${P(D.title)}</h1>
  <p class="record__meta">${esc(D.headerSub)}</p>
  <p class="prose">${P(D.intro)}</p>

  <div class="disp" data-dispatch
       data-legs="${esc(JSON.stringify(data))}"
       data-ac="${esc(JSON.stringify(acData))}"
       data-issued-label="${esc(F.issued)}">
    <div class="disp-controls">
      <div class="field">
        <label for="disp-leg">${esc(D.legLabel)}</label>
        <select id="disp-leg" data-disp-leg>${legOpts}</select>
      </div>
      <div class="field">
        <label for="disp-ac">${esc(D.acLabel)}</label>
        <select id="disp-ac" data-disp-ac>${acOpts}</select>
      </div>
    </div>
    <p class="prose">${P(D.releaseHint)}</p>

    <figure class="release" data-disp-release>
      <div class="release__head">
        <span>${esc(D.releaseTitle)}</span>
        <span class="release__code code" data-disp-flight>${esc(d0.flight)}</span>
      </div>
      <dl class="release__body">
        ${row(F.flight, d0.flight, ' class="code" data-disp-f="flight"')}
        ${row(F.aircraft, a0.name, ' data-disp-a="name"')}
        ${row(F.reg, a0.reg, ' class="code" data-disp-a="reg"')}
        ${row(F.sector, d0.sector, ' class="code" data-disp-f="sector"')}
        ${row(F.route, d0.route, ' class="route-string" data-disp-f="route"')}
        ${row(F.level, d0.level, ' class="code" data-disp-f="level"')}
        ${row(F.distance, d0.distance, ' data-disp-f="distance"')}
        ${row(F.block, d0.block, ' data-disp-f="block"')}
        ${row(F.speed, d0.speed, ' class="code" data-disp-f="speed"')}
        ${row(F.issued, D.issuedPending, ' class="code" data-disp-issued')}
      </dl>
    </figure>

    <p class="btn-row">
      <button class="btn" type="button" data-disp-download>${icon('i-drop')}${esc(D.downloadButton)}</button>
    </p>
    <p class="record__meta">${esc(D.downloadNote)}</p>
  </div>

  <p class="notice notice--quiet">${P(D.noscript)}</p>

  <h2>${esc(D.mathTitle)}</h2>
  <p class="prose">${esc(D.mathNote)}</p>
  <ul class="record__events">${D.mathRows.map(m => `<li class="code">${esc(m)}</li>`).join('')}</ul>
  <p class="prose">${P(D.mathTail)}</p>
</section>

<section class="sector wrap" data-landing
  data-no-flare="${esc(LG.noFlare)}" data-too-high="${esc(LG.tooHigh)}" data-too-late="${esc(LG.tooLate)}">
  <h2>${P(LG.title)}</h2>
  <p class="prose">${P(LG.intro)}</p>

  <div class="lg" hidden data-lg-game>
    <!-- viewBox is cropped to the band the aeroplane actually uses. At the full
         0-200 height half the frame was empty sky and the aircraft read as a
         speck once the figure stretched across the measure. -->
    <svg class="lg-view" viewBox="0 40 640 156" role="img" aria-label="${esc(LG.intro)}" focusable="false">
      <line class="lg-ground" x1="0" y1="170" x2="640" y2="170"/>
      <rect class="lg-rwy" x="180" y="167" width="420" height="6"/>
      <g data-lg-ship><g transform="scale(1.6)">
        <path class="lg-ship" d="M-16 0 L10 0 L18 -3 L10 3 Z"/><path class="lg-ship" d="M-4 0 l-6 -9 l4 0 l9 9 Z"/><path class="lg-ship" d="M-4 0 l-6 9 l4 0 l9 -9 Z"/><path class="lg-ship" d="M-15 0 l-3 -6 l2 0 l4 6 Z"/>
      </g></g>
    </svg>
    <p class="lg-readout">
      <span class="lg-readout__k">${esc(LG.radioLabel)}</span>
      <span class="lg-readout__v code" data-lg-alt>—</span>
    </p>
    <p class="btn-row">
      <button class="btn" type="button" data-lg-start data-again="${esc(LG.againButton)}">${esc(LG.startButton)}</button>
      <button class="btn" type="button" data-lg-flare hidden>${esc(LG.flareButton)}</button>
    </p>
    <p class="record__meta">${esc(LG.hint)}</p>
    <div class="lg-result" role="status" data-lg-result></div>
  </div>

  <h3 class="record__label">${esc(LG.tableTitle)}</h3>
  <p class="prose">${P(LG.tableNote)}</p>
  <table class="bd lg-table">
    <thead><tr><th scope="col">${esc(LG.colVs)} (${esc(LG.vsUnit)})</th><th scope="col">${esc(LG.colRemark)}</th></tr></thead>
    <tbody>${bandRows}</tbody>
  </table>

  <p class="btn-row btn-row--foot">
    <a class="btn" href="${urlFor('home', lang)}">${icon('i-home')}${esc(D.backHome)}</a>
  </p>
</section>`

  return shell({ c, lang, key: 'dispatch', title: `${D.title} — ${c.meta.siteName}`, desc: D.intro, body })
}

/* --- Flight simulator ------------------------------------------------------
   Everything on this page that carries information is server-rendered: what
   the simulator is, every control on both a keyboard and a pad, what the
   assist does, and the scoring bands. The engine is a dynamic import behind a
   button, so a reader who never presses it downloads none of it — and a
   browser with no WebGL still gets the whole reference.

   The aircraft table handed to the engine is the SAME one that draws the plan
   views in sector 02. The thing you fly is dimensioned from the figures the
   fleet page publishes.                                                      */
function simPage(c, lang, version = '2.0') {
  const P = s => parts(s, lang), S = c.sim, LG = c.landing
  const modern = version !== 'classic'          // 2.0, vintage and 3.0 share the 2.0 controls, weathers and flags
  const v3 = version === '3.0'
  const vintage = version === 'vintage'
  const pageTitle = v3 ? S.v3Title : vintage ? S.vintageTitle : modern ? S.title : S.classicTitle
  /* The simulator's roster is NOT the airline's fleet. AXZ operates four
     aircraft; the other four are types the simulator can fly, and the page
     says which is which. Names for the AXZ four come from the catalogue so
     they read the same as sector 02; the rest carry the manufacturer's. */
  const fleet = {}
  const order = [...AXZ_ORDER, ...SIM_ONLY]
  for (const id of order) {
    const t = SIM_TYPES[id]
    if (!t) continue
    fleet[id] = {
      len: t.len, span: t.span, dia: t.dia, h: t.h, engines: t.engines,
      mass: t.mass, wingArea: t.wingArea, thrust: t.thrust, vne: t.vne,
      prop: !!t.prop, upperDeck: !!t.upperDeck, rakedTips: !!t.rakedTips,
      highWing: !!t.highWing, strut: !!t.strut, fixedGear: !!t.fixedGear,
      dihedral: t.dihedral,
      /* Aerodynamics travel WITH the type rather than being written a second
         time inside the engine. The lift-curve slope in particular is derived
         here, from the published span and wing area, so the roster table and
         the aeroplane can never quote different physics. */
      clAlpha: Math.round(liftSlope(t.span, t.wingArea) * 1e4) / 1e4,
      mdd: t.mdd, waveDrag: t.waveDrag, machInlet: t.machInlet,
      cl0: t.cl0, cd0: t.cd0, oswald: t.oswald, stallDeg: t.stallDeg,
      flapSet: t.flapSet, engine: t.engine, shape: t.shape,
      thrustAB: t.thrustAB || 0, mmo: t.mmo, ceiling: t.ceiling,
      tailStrikeDeg: t.tailStrikeDeg, lowVis: !!t.lowVis, cargo: !!t.cargo,
      track: t.track,
      /* How each type FEELS, and the reason it is three published numbers
         rather than a hand-tuned constant: the maximum roll rate, the
         certification limit load factor that sets the speed it is quoted at,
         and how far the aerodynamic centre runs aft through the transonic. */
      rollRate: t.rollRate, nLimit: t.nLimit, acShift: t.acShift,
      twinFin: !!t.twinFin, chined: !!t.chined, lapse: t.lapse,
      armed: t.armed || '', hardpoints: t.hardpoints || 0,
      warnPack: t.warnPack || '',
      name: t.axz ? c.fleet[id].name : t.name,
      reg: t.axz ? c.fleet[id].reg : t.reg,
      axz: !!t.axz,
      // 2.0 draws the hangar's models, which need the drawing flags too.
      ...(modern ? (HANGAR_FLAGS[id] || {}) : {}),
    }
  }
  fleet._order = order

  // Only the strings the engine actually prints, so the attribute stays small.
  const labels = {
    ...S.hud, ...S.units,
    cameras: S.cameras, phases: S.phases, scenarios: S.scenarios,
    loading: S.loading, unsupported: S.unsupported, failed: S.failed,
    centreline: S.centreline, paused: S.paused, resumed: S.resumed,
    assistLabel: S.assistLabel, timeLabel: S.timeLabel, soundLabel: S.soundLabel,
    crashReasons: S.crashReasons, crashTips: S.crashTips,
    tipLabel: S.tipLabel, restart: S.restart,
    gyroscope: S.gyroscope, gyroOn: S.gyroOn, gyroUnavailable: S.gyroUnavailable,
    recentre: S.touch.recentre, exit: S.touch.exit,
    fullscreen: S.fullscreenButton,
    flapsDown: S.touch.flapsDown, flapsUp: S.touch.flapsUp, view: S.touch.view,
    pause: S.actions.pause,
    machUp: S.machUp, machDown: S.machDown,
    sysNames: S.sysNames, failWhy: S.failWhy,
    keyboard: S.keyboard, gamepad: S.gamepad,
    score: S.score, autopilotLabel: S.autopilotLabel, lightsLabel: S.lightsLabel, reverseLabel: S.reverseLabel,
    ...(v3 ? { tierLabel: S.tierLabel, tiers: S.tiers, tierAuto: S.tierAuto, assetsLabel: S.assetsLabel, assetsOffline: S.assetsOffline, modelLabel: S.modelLabel, model3: S.model3, model2: S.model2 } : {}),
  }
  const bands = LG.bands.map(b => b.remark)

  const flOpts = ['AXZ001', 'AXZ002', 'AXZ003', 'AXZ004'].map(k =>
    `<option value="${esc(k)}">${esc(S.flights[k])}</option>`).join('')
  // Grouped, because "which of these does the airline actually own" is a
  // question the picker should answer without anybody having to ask.
  const acOpt = id => {
    const t = SIM_TYPES[id]
    const reg = t.axz ? c.fleet[id].reg : t.reg
    const nm = t.axz ? c.fleet[id].name : t.name
    /* 3.0 says which aeroplanes are sourced models and which still fly the 2.0 airframe. */
    const sourced = v3 && SOURCED_TYPES.has(id)
    const tag = v3 ? ` · ${sourced ? S.model3 : S.model2}` : ''
    return `<option value="${esc(id)}"${v3 ? ` data-model="${sourced ? '3.0' : '2.0'}"` : ''}>${esc(reg)} · ${esc(nm)}${esc(tag)}</option>`
  }
  const acOpts =
    `<optgroup label="${esc(S.fleetGroup)}">${AXZ_ORDER.map(acOpt).join('')}</optgroup>` +
    `<optgroup label="${esc(S.otherGroup)}">${SIM_ONLY.map(acOpt).join('')}</optgroup>`
  /* The starting positions name the fields of the SELECTED FLIGHT. They used
     to say KSFO and KSNS whatever was chosen, so on the two Shanghai legs the
     picker described somewhere the aeroplane was not. The server renders the
     first flight's version and the engine rewrites them on every change. */
  const legOf = { AXZ001: ['KSFO', 'KSNS'], AXZ002: ['KSNS', 'KSFO'],
    AXZ003: ['ZSPD', 'ZSNJ'], AXZ004: ['ZSNJ', 'ZSPD'] }
  const scName = (k, from, to) =>
    S.scenarios[k].replace('{from}', from).replace('{to}', to)
  const scOpts = ['takeoff', 'runway', 'approach', 'cruise'].map(k =>
    `<option value="${esc(k)}"${k === 'takeoff' ? ' selected' : ''}>${esc(scName(k, 'KSFO', 'KSNS'))}</option>`).join('')

  /* Conditions. Midday and STILL AIR, because the first thing anyone flies
     here should not be a crosswind landing they did not ask for. The wind was
     on for everybody at 250/8 with gusts, which is a fair day and a poor
     default. Everything is one press away in the row below. */
  const todOpts = ['dawn', 'noon', 'dusk', 'night'].map(k =>
    `<option value="${esc(k)}"${k === 'noon' ? ' selected' : ''}>${esc(S.times[k])}</option>`).join('')
  // Eight points, named the way a METAR names them: the direction it comes FROM.
  const wdOpts = [0, 45, 90, 135, 180, 225, 250, 270, 315].map(d =>
    `<option value="${d}"${d === 250 ? ' selected' : ''}>${String(d).padStart(3, '0')}°</option>`).join('')
  const wsOpts = [0, 5, 8, 15, 25, 35].map(v =>
    `<option value="${v}"${v === 0 ? ' selected' : ''}>${v === 0 ? esc(S.windCalm) : v + ' kt'}</option>`).join('')
  /* Failures per flight HOUR. None is the default, because the simulator has
     always been one where the only way to break an aeroplane is to fly it
     badly, and that should stay true unless somebody asks for otherwise. High
     is about one an hour, which is far worse than any real aeroplane. */
  const frOpts = [['none', 0], ['low', 0.12], ['med', 0.4], ['high', 1.1]].map(([k, v]) =>
    `<option value="${v}"${k === 'none' ? ' selected' : ''}>${esc(S.failLevels[k])}</option>`).join('')
  const tbOpts = [['none', 0], ['light', 0.35], ['moderate', 0.7], ['severe', 1]].map(([k, v]) =>
    `<option value="${v}"${k === 'none' ? ' selected' : ''}>${esc(S.turbLevels[k])}</option>`).join('')

  const wxOpts = ['clear', 'scattered', 'overcast', 'rain'].map(k =>
    `<option value="${esc(k)}"${k === 'scattered' ? ' selected' : ''}>${esc(S.weathers[k])}</option>`).join('')

  const ctlRows = (modern ? [...S.controls, ...(S.controls2 || [])] : S.controls).map(r => `<tr>
    <th scope="row">${P(r.a)}</th>
    <td class="code">${esc(r.k)}</td>
    <td class="code">${esc(r.p)}</td>
  </tr>`).join('')

  /* Roster table. Every number is DERIVED from SIM_TYPES rather than written
     out, so the page and the aeroplane can never disagree: wing loading and
     aspect ratio are arithmetic on the published figures, and the approach
     speed comes out of `speedsFor`, which is the same function the flight
     model's own stall equation is written from. Thrust-to-weight is printed
     because it is the number that says what an aeroplane FEELS like, and it
     is the one place a fighter and a freighter are obviously not the same
     machine. */
  const G = 9.80665
  const rosterRows = [...AXZ_ORDER, ...SIM_ONLY].map(id => {
    const t = SIM_TYPES[id]
    const AR = (t.span * t.span) / t.wingArea
    const wl = t.mass / t.wingArea
    const nEng = t.engines || 1
    const maxT = (t.thrustAB || t.thrust) * nEng
    const twr = maxT / (t.mass * G)
    const nm = t.axz ? c.fleet[id].name : t.name
    const reg = t.axz ? c.fleet[id].reg : t.reg
    const power = t.prop
      ? `${(t.thrust / 1000).toFixed(1)} kN ×1`
      : `${Math.round(t.thrust / 1000)} kN ×${nEng}${t.thrustAB ? ` (${Math.round(t.thrustAB / 1000)} ${esc(S.reheatShort)})` : ''}`
    return `<tr>
      <th scope="row"><span class="code">${esc(reg)}</span> ${P(nm)}
        <span class="ros-tag${t.axz ? ' is-own' : ''}">${esc(t.axz ? S.rosterOwn : S.rosterSim)}</span></th>
      <td class="code">${t.len.toFixed(1)} × ${t.span.toFixed(1)} m</td>
      <td class="code">${(t.mass / 1000).toFixed(t.mass < 5000 ? 2 : 0)} t</td>
      <td class="code">${power}</td>
      <td class="code">${Math.round(wl)} kg/m² · ${AR.toFixed(1)}</td>
      <td class="code">${twr.toFixed(2)}</td>
      <td class="code">${Math.round(speedsFor(t).vrefKt)} kt</td>
    </tr>`
  }).join('')

  const fieldOrder = modern
    ? ['flight', 'ias', 'gs', 'mach', 'alt', 'agl', 'vs', 'hdg', 'n1', 'fuel', 'wind', 'papi',
      'dist', 'dest', 'camera', 'autopilot', 'time', 'assist', 'input', 'fps']
    : ['flight', 'ias', 'mach', 'alt', 'agl', 'vs', 'hdg', 'wind', 'papi',
      'dist', 'dest', 'camera', 'time', 'assist', 'input', 'fps']
  const fieldCells = fieldOrder.map(k => `<div class="sim-cell">
    <span class="sim-cell__k">${esc(S.fields[k])}</span>
    <span class="sim-cell__v code" data-sim-field="${k}">—</span>
  </div>`).join('')

  const bandRows = LG.bands.map(b => `<tr>
    <td class="code">${esc(b.range)}</td>
    <td class="lg-remark">${parts(b.remark, lang)}</td>
  </tr>`).join('')

  const link = (key, text) => `<a href="${urlFor(key, lang)}">${esc(text)}</a>`
  const versionNote = v3
    ? `<p class="notice sim-version"><span>${esc(S.v3Note)}</span>${link('simvintage', S.vintageLink)}${link('simclassic', S.classicLink)}</p>`
    : vintage
      ? `<p class="notice sim-version"><span>${esc(S.vintageNote)}</span>${link('sim', S.currentLink)}${link('simclassic', S.classicLink)}</p>`
      : modern
        ? `<p class="notice notice--quiet sim-version"><span>${esc(S.v2Title)}</span>${link('simclassic', S.classicLink)}${link('sim3', S.v3Link)}</p>`
        : `<p class="notice sim-version"><span>${esc(S.classicNote)}</span>${link('sim', S.currentLink)}</p>`
  const body = `
<section class="sector wrap">
  <h1>${P(pageTitle)}</h1>
  <p class="record__meta">${esc(S.headerSub)}</p>
  <p class="prose">${P(S.intro)}</p>
  ${v3 ? `<p class="prose">${P(S.v3Body)}</p>` : modern ? `<p class="prose">${P(S.v2Body)}</p>` : ''}
  ${versionNote}

  <div class="sim" data-sim-stage data-sim-version="${v3 ? '3.0' : modern ? '2.0' : '1.0'}"
       data-sim-src="${esc(v3 ? SIM3_ENTRY : modern ? SIM2_ENTRY : SIM_ENTRY)}"${v3 ? `
       data-sim-tier-src="${esc(SIM3_TIER)}"
       data-sim-assets="${esc(ASSETS_ORIGIN)}"
       data-sim-vintage-href="${urlFor('simvintage', lang)}"
       data-sim-classic-href="${urlFor('simclassic', lang)}"
       data-sim-models="${esc(JSON.stringify(Object.fromEntries([...SOURCED_TYPES].map(([t, id]) => [t, { id, title: (ASSET_INDEX.credits.find(cr => cr.id === id) || {}).title || id, license: ASSET_INDEX.assets[id].license }]))))}"` : ''}
       data-sim-labels="${esc(JSON.stringify(labels))}"
       data-sim-fleet="${esc(JSON.stringify(fleet))}"
       data-sim-flaps="${esc(JSON.stringify(FLAP_SETS))}"
       data-sim-audio="${esc(AUDIO_BASE)}"
       data-sim-bands="${esc(JSON.stringify(bands))}">
    <div class="sim-setup">
    <div class="sim-controls">
      <div class="field">
        <label for="sim-fl">${esc(S.flightLabel)}</label>
        <select id="sim-fl" data-sim-flight>${flOpts}</select>
      </div>
      <div class="field">
        <label for="sim-ac">${esc(S.aircraftLabel)}</label>
        <select id="sim-ac" data-sim-aircraft>${acOpts}</select>
      </div>
      <div class="field">
        <label for="sim-sc">${esc(S.scenarioLabel)}</label>
        <select id="sim-sc" data-sim-scenario>${scOpts}</select>
      </div>
    </div>
    ${/* Conditions. Every one of these was already a quantity the engine used —
          a sun vector, a wind direction, a wind speed, a gust amplitude — and
          all four were constants nobody could reach. */''}
    <div class="sim-controls sim-controls--wx">
      <div class="field">
        <label for="sim-tod">${esc(S.setup.time)}</label>
        <select id="sim-tod" data-sim-time>${todOpts}</select>
      </div>
      <div class="field">
        <label for="sim-wd">${esc(S.setup.windDir)}</label>
        <select id="sim-wd" data-sim-winddir>${wdOpts}</select>
      </div>
      <div class="field">
        <label for="sim-ws">${esc(S.setup.windSpeed)}</label>
        <select id="sim-ws" data-sim-windspeed>${wsOpts}</select>
      </div>
      <div class="field">
        <label for="sim-tb">${esc(S.setup.turbulence)}</label>
        <select id="sim-tb" data-sim-turb>${tbOpts}</select>
      </div>
      <div class="field">
        <label for="sim-fr">${esc(S.setup.failure)}</label>
        <select id="sim-fr" data-sim-failrate>${frOpts}</select>
      </div>
      ${modern ? `<div class="field">
        <label for="sim-wx">${esc(S.setup.weather)}</label>
        <select id="sim-wx" data-sim-weather>${wxOpts}</select>
      </div>` : ''}
    </div>
    </div>
    <p class="btn-row">
      <button class="btn btn--go" type="button" data-sim-start>${icon('i-fleet')}${esc(S.startButton)}</button>
      <button class="btn" type="button" data-sim-fullscreen hidden aria-pressed="false">${esc(S.fullscreenButton)}</button>
      <button class="btn" type="button" data-sim-phone hidden aria-pressed="false">${esc(S.phoneButton)}</button>
    </p>
    <p class="status" role="status" data-sim-status></p>
    ${v3 ? `<p class="notice notice--quiet" data-sim-tier hidden></p>` : ''}
    <p class="record__meta">${esc(S.startNote)}</p>

    <div class="sim-stage" data-sim-mount>
      <button class="sim-fs-hint" type="button" data-sim-fsexit>${esc(S.exitFullscreen)}</button>
    </div>
    <div class="sim-crash" data-sim-crash hidden role="alert"></div>

    <div class="sim-panel" data-sim-panel hidden>
      <div class="sim-bar">
        ${(modern ? ['pause', 'reset', 'camera', 'assist', 'autopilot', 'lights', 'sound'] : ['pause', 'reset', 'camera', 'assist', 'sound']).map(a =>
    `<button class="btn sim-tog" type="button" data-sim-action="${a}"${
      ['assist', 'sound'].includes(a) ? ' aria-pressed="true"' : ['autopilot', 'lights'].includes(a) ? ' aria-pressed="false"' : ''
    }>${esc(S.actions[a])}${
      /* Assist and Sound are STATES, and a button that only carries a verb
         cannot say which way it is set. The word rides in the corner so the
         setting is readable without pressing it to find out. */
      ['assist', 'sound', 'autopilot', 'lights'].includes(a)
        ? `<span class="sim-tog__st" data-sim-state="${a}">${esc(['autopilot', 'lights'].includes(a) ? S.hud.off : S.hud.on)}</span>` : ''
    }</button>`).join('')}
      </div>
      <h2 class="record__label">${esc(S.readoutTitle)}</h2>
      <div class="sim-grid">${fieldCells}</div>
      <div class="sim-loghead">
        <h2 class="record__label">${esc(S.logTitle)}</h2>
        <button class="btn btn--sm" type="button" data-sim-clearlog
          aria-label="${esc(S.clearLogLabel)}">${esc(S.clearLog)}</button>
      </div>
      <ul class="sim-log" data-sim-log aria-live="polite"></ul>
    </div>
  </div>

  <h2>${esc(S.controlsTitle)}</h2>
  <p class="prose">${P(S.controlsNote)}</p>
  <table class="bd sim-keys">
    <thead><tr>
      <th scope="col">${esc(S.colAction)}</th>
      <th scope="col">${esc(S.colKey)}</th>
      <th scope="col">${esc(S.colPad)}</th>
    </tr></thead>
    <tbody>${ctlRows}</tbody>
  </table>

  <h2>${esc(S.assistTitle)}</h2>
  <p class="prose">${P(S.assistBody)}</p>

  <h2>${esc(S.rosterTitle)}</h2>
  <p class="prose">${P(S.rosterNote)}</p>
  <table class="bd sim-roster">
    <thead><tr>
      <th scope="col">${esc(S.rosterCols.type)}</th>
      <th scope="col">${esc(S.rosterCols.dims)}</th>
      <th scope="col">${esc(S.rosterCols.mass)}</th>
      <th scope="col">${esc(S.rosterCols.power)}</th>
      <th scope="col">${esc(S.rosterCols.wing)}</th>
      <th scope="col">${esc(S.rosterCols.twr)}</th>
      <th scope="col">${esc(S.rosterCols.vref)}</th>
    </tr></thead>
    <tbody>${rosterRows}</tbody>
  </table>

  <h2>${esc(S.screenTitle)}</h2>
  <p class="prose">${P(S.screenBody)}</p>

  <h2>${esc(S.cockpitTitle)}</h2>
  <p class="prose">${P(S.cockpitBody)}</p>

  <h2>${esc(S.weatherTitle2)}</h2>
  <p class="prose">${P(S.weatherBody2)}</p>

  <h2>${esc(S.phoneTitle)}</h2>
  <p class="prose">${P(S.phoneBody)}</p>

  <h2>${esc(S.runwaysTitle)}</h2>
  <p class="prose">${P(S.runwaysBody)}</p>

  <h2>${esc(S.reheatTitle)}</h2>
  <p class="prose">${P(S.reheatBody)}</p>

  <h2>${esc(S.newTypesTitle)}</h2>
  <p class="prose">${P(S.newTypesBody)}</p>

  <h2>${esc(S.machTitle)}</h2>
  <p class="prose">${P(S.machBody)}</p>

  <h2>${esc(S.crashTitle)}</h2>
  <p class="prose">${P(S.crashBody)}</p>

  <h2>${esc(S.soundTitle)}</h2>
  <p class="prose">${P(S.soundBody)}</p>

  <h2>${esc(S.calloutTitle)}</h2>
  <p class="prose">${P(S.calloutBody)}</p>

  <h2>${esc(S.failTitle)}</h2>
  <p class="prose">${P(S.failBody)}</p>

  <h2>${esc(S.papiTitle)}</h2>
  <p class="prose">${P(S.papiBody)}</p>

  <h2>${esc(S.weatherTitle)}</h2>
  <p class="prose">${P(S.weatherBody)}</p>

  <h2>${esc(S.effectsTitle)}</h2>
  <p class="prose">${P(S.effectsBody)}</p>

  <h2>${esc(S.scoringTitle)}</h2>
  <p class="prose">${P(S.scoringNote)}</p>
  <table class="bd lg-table">
    <thead><tr><th scope="col">${esc(LG.colVs)} (${esc(LG.vsUnit)})</th><th scope="col">${esc(LG.colRemark)}</th></tr></thead>
    <tbody>${bandRows}</tbody>
  </table>

  ${v3 ? `<details class="prose sim-credits"><summary>${esc(S.creditsTitle)}</summary>${
    CREDITS.length
      ? `<ul>${CREDITS.map(creditLine).join('')}</ul>`
      : `<p>${esc(S.creditsNone)}</p>`}</details>` : ''}

  <p class="btn-row btn-row--foot">
    <a class="btn" href="${urlFor('dispatch', lang)}">${icon('i-dispatch')}${esc(c.dispatch.title)}</a>
    <a class="btn" href="${urlFor('home', lang)}">${icon('i-home')}${esc(S.backHome)}</a>
  </p>
</section>`

  return shell({
    c, lang, key: v3 ? 'sim3' : vintage ? 'simvintage' : modern ? 'sim' : 'simclassic',
    title: `${pageTitle} — ${c.meta.siteName}`, desc: S.intro, body,
    head: modern ? IMPORT_MAP : '',
    noindex: v3,
  })
}

/* --- Hangar -----------------------------------------------------------------
   The roster handed to the viewer is built from the SAME rows the simulator
   flies and the fleet page draws, plus a helicopter and the drawing flags a
   3D model needs and a flight model does not. Names for the airline's four
   come from the catalogue, so they read the same as everywhere else. */
function hangarRoster(c) {
  const roster = {}
  for (const id of HANGAR_ORDER) {
    const t = SIM_TYPES[id] || ROTORCRAFT[id]
    if (!t) continue
    const flags = HANGAR_FLAGS[id] || {}
    roster[id] = {
      id, kind: flags.kind || t.kind || 'airliner',
      name: t.axz ? c.fleet[id].name : t.name,
      reg: t.axz ? c.fleet[id].reg : (t.reg || ''),
      axz: !!t.axz,
      len: t.len, span: t.span, dia: t.dia, h: t.h, engines: t.engines,
      mass: t.mass, wingArea: t.wingArea, track: t.track,
      ...flags,
      note: c.hangar.notes[id] || '',
    }
  }
  return roster
}

function hangarPage(c, lang) {
  const P = s => parts(s, lang), H = c.hangar
  const roster = hangarRoster(c)
  const labels = { loading: H.loading, unsupported: H.unsupported, failed: H.failed, canvas: H.canvas }
  const picks = HANGAR_ORDER.filter(id => roster[id]).map((id, i) => {
    const t = roster[id]
    return `<button class="btn hangar-pick" type="button" data-hangar-pick="${id}" aria-pressed="${i === 0 ? 'true' : 'false'}">${P(t.name)}${t.reg ? ` <span class="code">${esc(t.reg)}</span>` : ''}<span class="ros-tag${t.axz ? ' is-own' : ''}">${P(t.axz ? H.tagOwn : H.tagGuest)}</span></button>`
  }).join('')
  const first = roster[HANGAR_ORDER[0]]
  const fields = ['type', 'reg', 'length', 'span', 'height', 'engines', 'mass']
  const initial = {
    type: first.name, reg: first.reg || '—', length: `${first.len.toFixed(2)} m`, span: `${first.span.toFixed(2)} m`,
    height: `${first.h.toFixed(2)} m`, engines: first.engineNote || String(first.engines),
    mass: first.mass ? `${(first.mass / 1000).toFixed(first.mass < 10000 ? 2 : 0)} t` : '—',
  }
  const cells = fields.map(k => `<div class="sim-cell">
    <span class="sim-cell__k">${esc(H.fields[k])}</span>
    <span class="sim-cell__v code" data-hangar-field="${k}">${esc(initial[k])}</span>
  </div>`).join('')
  const body = `
<section class="sector wrap">
  <h1>${P(H.title)}</h1>
  <p class="record__meta">${esc(H.headerSub)}</p>
  <p class="prose">${P(H.intro)}</p>

  <div class="hangar" data-hangar-stage
       data-hangar-src="${esc(HANGAR_ENTRY)}"
       data-hangar-initial="${esc(HANGAR_ORDER[0])}"
       data-hangar-labels="${esc(JSON.stringify(labels))}"
       data-hangar-roster="${esc(JSON.stringify(roster))}">
    <div class="hangar-picker" role="group" aria-label="${esc(H.pickLabel)}">${picks}</div>
    <p class="status" role="status" data-hangar-status></p>
    <div class="hangar-stage" data-hangar-mount>
      <noscript><p class="hangar-nojs">${P(H.unsupported)}</p></noscript>
    </div>
    <p class="record__meta">${P(H.hint)}</p>
    <div class="sim-grid hangar-readout">${cells}</div>
    <p class="prose hangar-desc" data-hangar-desc>${P(first.note)}</p>
  </div>

  <h2>${esc(H.aboutTitle)}</h2>
  <p class="prose">${P(H.aboutBody)}</p>

  <p class="btn-row btn-row--foot">
    <a class="btn" href="${BASE}/hangar/h145.html" hreflang="en">${icon('i-hangar')}${esc(H.standalone)}</a>
    <a class="btn" href="${urlFor('sim', lang)}">${icon('i-fleet')}${esc(c.sim.title)}</a>
    <a class="btn" href="${urlFor('home', lang)}">${icon('i-home')}${esc(H.backHome)}</a>
  </p>
</section>`
  return shell({ c, lang, key: 'hangar', title: `${H.title} — ${c.meta.siteName}`, desc: H.intro, body, head: IMPORT_MAP })
}

/* --- Showroom -------------------------------------------------------------
   The sourced models, each named with its author and licence, in a curated
   order: the airline's own type first, then the best-built of the rest. */
const SHOWROOM_ORDER = ['b738-fg', 'c172-fg', 'f16-fg', 'a32x-fg', 'b789-fg', 'b744-fg', 'f22-fg', 'f35-fg', 'conc-fg']
function showroomModels(c) {
  const out = []
  for (const id of SHOWROOM_ORDER) {
    const a = ASSET_INDEX.assets[id]
    if (!a || a.kind !== 'model') continue
    const cr = ASSET_INDEX.credits.find(x => x.id === id) || {}
    const type = (a.types || [])[0]
    const t = SIM_TYPES[type] || {}
    let stats = { parts: null, triangles: null, textures: null, animations: null }
    const glbPath = join(ASSETS_REPO, 'public', a.url)
    if (existsSync(glbPath)) {
      const { json } = parseGlb(readFileSync(glbPath))
      const sm = summarize(json)
      const rig = json.asset && json.asset.extras && json.asset.extras.axzRig
      stats = { parts: sm.nodeNames.filter(n => n.startsWith('part:')).length, triangles: sm.triangles, textures: sm.images, animations: rig ? rig.parts.reduce((n, p) => n + p.animations.length, 0) : 0 }
    }
    out.push({ id, bytes: a.bytes, url: a.url, types: a.types, title: cr.title || id, author: cr.author, authorUrl: cr.authorUrl, license: a.license, source: a.source, modified: cr.modified,
      name: t.axz ? c.fleet[type].name : t.name, reg: t.axz ? c.fleet[type].reg : t.reg, axz: !!t.axz,
      spec: { len: t.len, span: t.span, dia: t.dia, h: t.h, engines: t.engines, track: t.track, name: t.name },
      ...stats, creditHtml: creditLine({ ...cr, license: a.license, source: a.source }).replace(/^<li>|<\/li>$/g, '') })
  }
  return out
}
function showroomPage(c, lang) {
  const P = s => parts(s, lang), R = c.showroom
  const models = showroomModels(c)
  const labels = { loading: R.loading, offline: R.offline, unsupported: R.unsupported, failed: R.failed, canvasLabel: R.canvas }
  const picks = models.map((m, i) => `<button class="btn hangar-pick" type="button" data-showroom-pick="${esc(m.id)}" aria-pressed="${i === 0 ? 'true' : 'false'}">${P(m.name)}${m.reg ? ` <span class="code">${esc(m.reg)}</span>` : ''}<span class="ros-tag${m.axz ? ' is-own' : ''}">${esc(R.tagNew)} · ${esc(m.license)}</span></button>`).join('')
  const first = models[0]
  const fields = ['length', 'parts', 'triangles', 'animated', 'textures', 'size']
  const initial = first ? { length: `${first.spec.len.toFixed(2)} m`, parts: String(first.parts ?? '—'), triangles: (first.triangles ?? 0).toLocaleString('en-US'), animated: String(first.animations ?? '—'), textures: String(first.textures ?? '—'), size: `${(first.bytes / 1048576).toFixed(1)} MB` } : {}
  const cells = fields.map(k => `<div class="sim-cell"><span class="sim-cell__k">${esc(R.fields[k])}</span><span class="sim-cell__v code" data-showroom-field="${k}">${esc(initial[k] || '—')}</span></div>`).join('')
  const body = `
<section class="sector wrap">
  <h1>${P(R.title)}</h1>
  <p class="record__meta">${esc(R.headerSub)}</p>
  <p class="prose">${P(R.intro)}</p>

  <div class="hangar" data-showroom-stage
       data-showroom-src="${esc(SHOWROOM_ENTRY)}"
       data-showroom-assets="${esc(ASSETS_ORIGIN)}"
       data-showroom-initial="${esc(first ? first.id : '')}"
       data-showroom-labels="${esc(JSON.stringify(labels))}"
       data-showroom-models="${esc(JSON.stringify(models))}">
    <div class="hangar-picker" role="group" aria-label="${esc(R.pickLabel)}">${picks}</div>
    <p class="status" role="status" data-showroom-status></p>
    <div class="hangar-stage" data-showroom-mount>
      <noscript><p class="hangar-nojs">${P(R.unsupported)}</p></noscript>
    </div>
    <p class="record__meta">${P(R.hint)}</p>
    <p class="btn-row">
      <button class="btn" type="button" data-showroom-motion aria-pressed="true">${esc(R.motion)}</button>
      <button class="btn" type="button" data-showroom-rig aria-pressed="true">${esc(R.rig)}</button>
    </p>
    <div class="sim-grid hangar-readout">${cells}</div>
    <h2>${esc(R.creditTitle)}</h2>
    <p class="prose" data-showroom-credit>${first ? first.creditHtml : ''}</p>
  </div>

  <h2>${esc(R.aboutTitle)}</h2>
  <p class="prose">${P(R.aboutBody)}</p>

  <p class="btn-row btn-row--foot">
    <a class="btn" href="${urlFor('sim3', lang)}">${icon('i-fleet')}${esc(R.openSim)}</a>
    <a class="btn" href="${urlFor('hangar', lang)}">${icon('i-hangar')}${esc(c.hangar.title)}</a>
    <a class="btn" href="${urlFor('home', lang)}">${icon('i-home')}${esc(R.backHome)}</a>
  </p>
</section>`
  return shell({ c, lang, key: 'showroom', title: `${R.title} — ${c.meta.siteName}`, desc: R.intro, body, head: IMPORT_MAP })
}

/* --- Accessibility -------------------------------------------------------- */
function a11y(c, lang) {
  const P = s => parts(s, lang), A = c.accessibility
  const body = `
<section class="sector wrap">
  <h1>${esc(A.title)}</h1>
  <p class="prose">${esc(A.target)}</p>
  <h2>${esc(A.sections.status)}</h2><p class="prose">${P(A.statusBody)}</p>
  <h2>${esc(A.sections.tested)}</h2><p class="prose">${P(A.testedBody)}</p>
  <h2>${esc(A.sections.known)}</h2><p class="prose">${P(A.knownBody)}</p>
  <p class="notice">${P(A.motionNote)}</p>
  <h2>${esc(A.sections.contact)}</h2><p class="prose">${P(A.contactBody)}</p>
</section>`
  return shell({ c, lang, key: 'accessibility', title: `${A.title} — ${c.meta.siteName}`, desc: A.target, body })
}

/* --- April Fools ----------------------------------------------------------
   Disclosure ABOVE the fold in both languages, before any ransom text. The
   original renders only after a real button press, verbatim, in its own crude
   styling — that mismatch is the joke. BTC address, onion string and contact
   email are removed. noindex, out of the sitemap, self-disclosing title.    */
function aprilfools(c, lang) {
  const P = s => parts(s, lang), A = c.aprilfools
  const body = `
<section class="sector wrap">
  <p class="record__meta">${esc(A.date)}</p>
  <h1>${esc(A.gateHeading)}</h1>
  <p class="prose">${P(A.gateBody)}</p>
  <p>
    <button class="btn" type="button" data-af-enter aria-expanded="false" aria-controls="af">${esc(A.gateButton)}</button>
    <a class="btn" href="${urlFor('home', lang)}">${esc(A.exitButton)}</a>
  </p>
</section>
<section id="af" class="aprilfools" hidden>
  <div class="af-box">
    <h2 class="af-h">${esc(A.heading)}</h2>
    <p class="af-org">${esc(A.org)}</p>
    <pre class="af-ascii" role="img" aria-label="${esc(A.asciiAlt)}">${esc(`███████╗ █████╗ ███████╗██╗   ██╗    ██╗███████╗    ██████╗
██╔════╝██╔══██╗██╔════╝╚██╗ ██╔╝    ██║██╔════╝    ╚════██╗
█████╗  ███████║███████╗ ╚████╔╝     ██║█████╗       █████╔╝
██╔══╝  ██╔══██║╚════██║  ╚██╔╝      ██║██╔══╝      ██╔═══╝
██║     ██║  ██║███████║   ██║       ██║███████╗    ███████╗
╚═╝     ╚═╝  ╚═╝╚══════╝   ╚═╝       ╚═╝╚══════╝    ╚══════╝`)}</pre>
    <div class="af-term">${A.terminal.map(t => `<p>${esc(t.task)} <span class="af-ok">${esc(t.state)}</span></p>`).join('')}</div>
    <div class="af-term">
      <p>${esc(A.ransom[0])}</p>
      <p>${esc(A.ransom[1])} <span class="af-mark">${esc(A.removedOnion)}</span></p>
      <p>${esc(A.ransom[2])} <span class="af-mark">${esc(A.removedBtc)}</span></p>
      <p>${esc(A.ransom[3])} <span class="af-ok">${esc(A.removedEmail)}</span> ${esc(A.ransom[4])}</p>
      <p>${esc(A.ransom[5])}</p>
    </div>
    <p class="af-cmd"><span class="af-ok">${esc(A.prompt)}</span> <span data-af-cmd>${esc(A.commands[0])}</span></p>
    <p>
      <button class="af-btn" type="button" data-af-decrypt>${esc(A.decryptButton)}</button>
      <a class="af-btn" href="${urlFor('home', lang)}">${esc(A.exitButton)}</a>
    </p>
    <p class="af-foot">${esc(A.footerNote)}<br>${P(A.footerSign)}</p>
  </div>
</section>`
  return shell({
    c, lang, key: 'aprilfools', noindex: true,
    title: `${A.date} ${A.title}（${A.gateHeading}） — ${c.meta.siteName}`,
    desc: A.gateBody, body,
  })
}

/* --- Emit ----------------------------------------------------------------- */
const RENDER = { home, guestbook, logbook, dispatch: dispatchPage, sim: simPage, simclassic: (c, lang) => simPage(c, lang, 'classic'), simvintage: (c, lang) => simPage(c, lang, 'vintage'), sim3: (c, lang) => simPage(c, lang, '3.0'), hangar: hangarPage, showroom: showroomPage, accessibility: a11y, aprilfools }
let count = 0
for (const p of PAGES) {
  for (const [lang, cat, sub] of [['zh-Hans', zh, p.zhPath], ['en', en, p.enPath]]) {
    const dir = sub ? join(OUT, sub) : OUT
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), RENDER[p.key](cat, lang))
    count++
  }
}

/* --- The H145 on its own ----------------------------------------------------
   One self-contained HTML file: the model library and the viewer inlined, and
   Three.js from the CDN through the same pinned import map. It is the same
   code the hangar runs, so the two cannot drift; the page just has no site
   chrome around it. */
{
  const strip = src => src.replace(/^export /gm, '')
  const h145 = ROTORCRAFT.h145
  const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Airbus H145 — a procedural Three.js model · Air Xiao Ze</title>
<meta name="description" content="An interactive Airbus H145 helicopter built entirely from Three.js primitives and lofted geometry: no model files, no textures. Orbit, zoom and pan; the rotors turn.">
<link rel="canonical" href="https://xiaobrook.com${BASE}/hangar/h145.html">
<link rel="icon" href="${BASE}/favicon.svg" type="image/svg+xml">
<meta name="color-scheme" content="dark light">
${IMPORT_MAP}
<style>
  :root { color-scheme: dark; --ink: #e9e5dc; --ink-2: #a8b0b9; --paper: #0b0d10; --line: #2b3138; --cyan: #00a2e8; --focus: #7cc4ff; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--paper); color: var(--ink); font: 15px/1.45 Archivo, "Noto Sans SC", system-ui, sans-serif; overflow: hidden; }
  #stage { position: fixed; inset: 0; }
  canvas { display: block; width: 100%; height: 100%; outline: none; touch-action: none; }
  canvas:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; }
  .panel { position: fixed; inset-inline-start: 16px; inset-block-start: 16px; max-width: min(360px, calc(100vw - 32px));
    padding: 14px 16px; background: rgba(11, 13, 16, .72); border: 1px solid var(--line); backdrop-filter: blur(6px); }
  h1 { margin: 0 0 2px; font-size: 20px; letter-spacing: .01em; }
  .sub { margin: 0 0 10px; color: var(--ink-2); font-size: 13px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 0 0 12px; font-size: 13px; }
  dt { color: var(--ink-2); } dd { margin: 0; font-variant-numeric: tabular-nums; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; }
  button { font: inherit; font-size: 13px; color: var(--ink); background: transparent; border: 1px solid var(--ink-2); padding: 8px 12px; min-height: 40px; cursor: pointer; }
  button[aria-pressed="true"] { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .hint { position: fixed; inset-inline: 16px; inset-block-end: 14px; color: var(--ink-2); font-size: 12px; text-align: center; }
  .hint p { margin: 0; }
  .status { position: fixed; inset: 0; display: grid; place-content: center; text-align: center; padding: 24px; color: var(--ink-2); pointer-events: none; }
  .status[hidden] { display: none; }
  a { color: var(--cyan); }
  @media (prefers-reduced-motion: reduce) { .panel { backdrop-filter: none; } }
</style>
</head>
<body>
<main id="stage" aria-label="Model viewer"></main>
<p class="status" id="status" role="status">Loading Three.js…</p>
<aside class="panel" aria-labelledby="t">
  <h1 id="t">Airbus H145</h1>
  <p class="sub">Procedural Three.js model · Air Xiao Ze hangar</p>
  <dl>
    <dt>Length</dt><dd>${h145.len.toFixed(2)} m, rotors turning</dd>
    <dt>Rotor</dt><dd>${h145.span.toFixed(2)} m, four blades</dd>
    <dt>Height</dt><dd>${h145.h.toFixed(2)} m</dd>
    <dt>Engines</dt><dd>${h145.engineNote}</dd>
    <dt>Tail</dt><dd>Fenestron, 1.00 m, ten blades</dd>
  </dl>
  <div class="row">
    <button type="button" id="rotors" aria-pressed="true">Rotors</button>
    <button type="button" id="theme" aria-pressed="true">Night</button>
    <button type="button" id="reset">Reset view</button>
  </div>
</aside>
<footer class="hint"><p>Drag to orbit · scroll to zoom · right-drag or two fingers to pan · arrow keys pan. <a href="${BASE}/hangar/">Back to the hangar</a></p></footer>
<script type="module">
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

${strip(hangarSources[0])}

${strip(hangarSources[1])}

const stage = document.getElementById('stage')
const status = document.getElementById('status')
const canvas = document.createElement('canvas')
canvas.tabIndex = 0
canvas.setAttribute('role', 'img')
canvas.setAttribute('aria-label', '3D model: Airbus H145 in rescue configuration')
stage.appendChild(canvas)

let rotors = !matchMedia('(prefers-reduced-motion: reduce)').matches
let night = true
const rotorBtn = document.getElementById('rotors')
const themeBtn = document.getElementById('theme')
rotorBtn.setAttribute('aria-pressed', String(rotors))

let viewer
try {
  const hangar = createHangar(THREE)
  viewer = createViewer(THREE, { OrbitControls, RoomEnvironment }, hangar, {
    el: stage, canvas, theme: () => (night ? 'night' : 'day'), motionOn: () => rotors,
  })
  viewer.show(${JSON.stringify({ ...h145, kind: 'h145' })})
  status.hidden = true
  window.__axzHangar = { viewer }
} catch (e) {
  status.textContent = 'This browser has no WebGL available, so the model cannot be drawn.'
  console.error(e)
}
rotorBtn.addEventListener('click', () => { rotors = !rotors; rotorBtn.setAttribute('aria-pressed', String(rotors)) })
themeBtn.addEventListener('click', () => {
  night = !night
  themeBtn.setAttribute('aria-pressed', String(night))
  themeBtn.textContent = night ? 'Night' : 'Day'
  document.documentElement.style.colorScheme = night ? 'dark' : 'light'
  if (viewer) viewer.applyTheme()
})
document.getElementById('reset').addEventListener('click', () => { if (viewer && viewer.current) viewer.show(${JSON.stringify({ ...h145, kind: 'h145' })}) })
</script>
</body>
</html>
`
  writeFileSync(join(OUT, 'hangar', 'h145.html'), page)
}

// Favicon — the wordmark's own cyan, the first favicon this project has had.
writeFileSync(join(OUT, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0B0D10"/><text x="16" y="22" font-family="monospace" font-size="15" font-weight="700" font-style="italic" fill="#00A2E8" text-anchor="middle">AXZ</text></svg>`)

// Sitemap with xhtml alternates — the parent sitemap does not declare that
// namespace, so /axz/ carries its own, referenced from its own robots.txt.
const sm = PAGES.filter(p => p.key !== 'aprilfools' && p.key !== 'sim3').flatMap(p =>
  ['zh-Hans', 'en'].map(lang => `  <url><loc>https://xiaobrook.com${urlFor(p.key, lang)}</loc>
    <xhtml:link rel="alternate" hreflang="zh-Hans" href="https://xiaobrook.com${urlFor(p.key, 'zh-Hans')}"/>
    <xhtml:link rel="alternate" hreflang="en" href="https://xiaobrook.com${urlFor(p.key, 'en')}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="https://xiaobrook.com${urlFor(p.key, 'zh-Hans')}"/>
  </url>`)).join('\n')
writeFileSync(join(OUT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${sm}\n</urlset>\n`)
writeFileSync(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /axz/\nDisallow: /axz/aprilfools/\nDisallow: /axz/en/aprilfools/\n\nSitemap: https://xiaobrook.com/axz/sitemap.xml\n`)

console.log(`✓ ${count} documents`)
console.log(`  css ${cssName} (${(cssBundle.length / 1024).toFixed(1)} KB)`)
console.log(`  js  ${jsName} (${(jsBundle.length / 1024).toFixed(1)} KB)`)
console.log(`  fonts: ${fonts.length}`)
