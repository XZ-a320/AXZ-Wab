#!/usr/bin/env node
/* ==========================================================================
   AXZ static build. Emits 10 documents (5 pages x 2 languages) from the
   content catalogue, with content-hashed asset filenames.

   Hash goes in the FILENAME, never a ?v= query token: the parent portfolio
   serves /(.*)\.(css|js) as immutable for a year, and a query token under a
   year-long immutable header is what broke that site's production once.
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { airframe, sideview, TYPES, scaleBase } from './airframe.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const SRC = join(ROOT, 'axz-src')
const OUT = join(ROOT, 'axz')
const BASE = '/axz'

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

const cssBundle = ['tokens', 'base', 'ledger', 'plate', 'pages']
  .map(f => readFileSync(join(SRC, 'css', `${f}.css`), 'utf8')).join('\n')
// Each file is wrapped in its own block and terminated, so one file can never
// be parsed as a call on the previous file's trailing expression.
const jsBundle = ['site', 'axzlog']
  .map(f => `;(function(){\n${readFileSync(join(SRC, 'js', `${f}.js`), 'utf8')}\n})();`).join('\n')

// Guard the same failure inside a single file: an IIFE that follows another
// with no separating semicolon parses cleanly and throws at runtime.
for (const f of ['site', 'axzlog']) {
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
  { key: 'accessibility', zhPath: 'accessibility', enPath: 'en/accessibility' },
  { key: 'aprilfools', zhPath: 'aprilfools', enPath: 'en/aprilfools' },
]
const urlFor = (key, lang) => {
  const p = PAGES.find(x => x.key === key)
  const seg = lang === 'zh-Hans' ? p.zhPath : p.enPath
  return seg ? `${BASE}/${seg}/` : `${BASE}/`
}

/* --- Shell ---------------------------------------------------------------- */
function shell({ c, lang, key, title, desc, body, noindex = false }) {
  const other = lang === 'zh-Hans' ? 'en' : 'zh-Hans'
  const otherCat = lang === 'zh-Hans' ? en : zh
  const P = s => parts(s, lang)

  const nav = ['home', 'guestbook', 'logbook', 'accessibility'].map(k =>
    `<a href="${urlFor(k, lang)}"${k === key ? ' aria-current="page"' : ''}>${P(c.nav[k])}</a>`
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
</head>
<body>
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
        <a lang="zh-Hans" hreflang="zh-Hans" href="${urlFor(key, 'zh-Hans')}"${lang === 'zh-Hans' ? ' aria-current="page"' : ''}>中文</a>
        <span aria-hidden="true">/</span>
        <a lang="en" hreflang="en" href="${urlFor(key, 'en')}"${lang === 'en' ? ' aria-current="page"' : ''}>English</a>
      </div>
      <button class="ctrl-btn" type="button" data-theme-toggle aria-pressed="false"
        data-label-day="${esc(c.nav.themeDay)}" data-label-night="${esc(c.nav.themeNight)}">${esc(c.nav.themeNight)}</button>
      <button class="ctrl-btn" type="button" data-motion-toggle aria-pressed="false"
        data-label-stop="${esc(c.nav.motionStop)}" data-label-resume="${esc(c.nav.motionResume)}">${esc(c.nav.motionStop)}</button>
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
        <span class="af-dims"><b class="code">${spec.len}</b> m &middot; <b class="code">${spec.span}</b> m</span>
      </div>
      <div class="af-draw" style="--af-w:${pct.toFixed(1)}%">
        <svg viewBox="${a.viewBox}" role="img" aria-label="${esc(spec.name)}, ${esc(c.fleet.labels.length)} ${spec.len} m, ${esc(c.fleet.labels.span)} ${spec.span} m" focusable="false">
          ${solid}<path class="af-fin" style="--i:7" d="${P.fin}"/>${door}
        </svg>
        ${svg2}
      </div>
    </li>`
  }).join('')

  return `<figure class="fleet-scale">
  <ul class="af-list">${rows}</ul>
  <figcaption>${parts(c.fleet.labels.silhouetteNote, lang)}</figcaption>
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
  const strips = rows.map(({ leg, r }) => `<li class="strip">
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
    <figcaption>${parts(c.ui.stripNote, lang)}</figcaption>
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
      <text class="prof-alt" x="${x0 + w / 2}" y="${(top - 8).toFixed(1)}" text-anchor="middle">${esc(r.altitude)}</text>
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
    ${mastheadShip()}
  </div>
</section>

<section class="sector wrap" aria-labelledby="s-routes">
  <div class="sector__head"><span class="sector__no">${esc(S.routes.no)}</span><h2 id="s-routes">${P(S.routes.name)}</h2></div>
  <div class="ledger">${c.routes._order.map(id => routeRow(c, lang, id)).join('')}</div>
  <h3 class="record__label">${esc(c.routes.labels.flights)}</h3>
  ${flightStrips(c, lang)}
  <h3 class="record__label">${esc(c.routes.labels.profile)}</h3>
  ${altitudeProfile(c, lang)}
</section>

<section class="sector wrap" aria-labelledby="s-fleet">
  <div class="sector__head"><span class="sector__no">${esc(S.fleet.no)}</span><h2 id="s-fleet">${P(S.fleet.name)}</h2></div>
  <p class="record__label">${esc(c.fleet.listTitle)}</p>
  ${fleetScale(c, lang)}
  <h3 class="record__label">${esc(c.fleet.groups.pax)}</h3>
  <div class="ledger">${pax.map(id => fleetRow(c, lang, id)).join('')}</div>
  <h3 class="record__label">${esc(c.fleet.groups.cargo)}</h3>
  <div class="ledger">${cargo.map(id => fleetRow(c, lang, id)).join('')}</div>
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

<section class="sector wrap" aria-labelledby="s-guest">
  <div class="sector__head"><span class="sector__no">${esc(S.guestbook.no)}</span><h2 id="s-guest">${P(S.guestbook.name)}</h2></div>
  <p class="prose">${P(c.guestbook.homeBody)}</p>
  <p><a class="btn" href="${urlFor('guestbook', lang)}">${esc(c.guestbook.cta)}</a></p>
  <h3 class="record__label">${esc(c.tools.title)}</h3>
  <p>
    <a class="btn" href="${esc(c.tools.routeQueryUrl)}" target="_blank" rel="noopener noreferrer" hreflang="zh">${esc(c.tools.routeQuery)}<span class="sr-only"> (${esc(c.tools.externalNote)})</span></a>
    <a class="btn" href="${urlFor('logbook', lang)}">${esc(c.logbook.title)}</a>
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
</section>`
  return shell({ c, lang, key: 'logbook', title: `${c.logbook.title} — ${c.meta.siteName}`, desc: c.logbook.intro, body })
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
const RENDER = { home, guestbook, logbook, accessibility: a11y, aprilfools }
let count = 0
for (const p of PAGES) {
  for (const [lang, cat, sub] of [['zh-Hans', zh, p.zhPath], ['en', en, p.enPath]]) {
    const dir = sub ? join(OUT, sub) : OUT
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), RENDER[p.key](cat, lang))
    count++
  }
}

// Favicon — the wordmark's own cyan, the first favicon this project has had.
writeFileSync(join(OUT, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0B0D10"/><text x="16" y="22" font-family="monospace" font-size="15" font-weight="700" font-style="italic" fill="#00A2E8" text-anchor="middle">AXZ</text></svg>`)

// Sitemap with xhtml alternates — the parent sitemap does not declare that
// namespace, so /axz/ carries its own, referenced from its own robots.txt.
const sm = PAGES.filter(p => p.key !== 'aprilfools').flatMap(p =>
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
