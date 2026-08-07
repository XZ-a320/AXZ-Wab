#!/usr/bin/env node
/* ==========================================================================
   Mirror the built /axz/ into the portfolio repo so Vercel serves it at
   xiaobrook.com/axz/ — standalone, reachable by URL, and NOT surfaced anywhere
   in the portfolio itself.

   Invisible-but-reachable is achieved by omission, not by blocking:
     - the root sitemap.xml lists only project-*.html pages, so a subdirectory
       is already absent from it
     - nothing in the portfolio links to /axz/
     - /axz/ ships its own sitemap + robots, referenced from neither
   Deliberately NOT noindex'd site-wide: the owner should be able to share the
   link and have it work normally. Only the April Fools page is noindex.
   ========================================================================== */
import { cpSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'axz')
const PORTFOLIO = '/Users/brookxiao/New/Xiao/Website'
const DEST = join(PORTFOLIO, 'axz')

if (!existsSync(SRC)) { console.error('✗ build /axz/ first: node scripts/build-axz.mjs'); process.exit(1) }
if (!existsSync(PORTFOLIO)) { console.error(`✗ portfolio repo not found at ${PORTFOLIO}`); process.exit(1) }

rmSync(DEST, { recursive: true, force: true })
cpSync(SRC, DEST, { recursive: true })

function walk(d, base = '') {
  let n = 0, bytes = 0
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    const s = statSync(p)
    if (s.isDirectory()) { const r = walk(p, base + f + '/'); n += r.n; bytes += r.bytes }
    else { n++; bytes += s.size }
  }
  return { n, bytes }
}
const { n, bytes } = walk(DEST)

/* --- Redirects ------------------------------------------------------------
   Every internal link in the ORIGINAL site points at AXZ.html; nothing points
   at index.html. Anyone who saved or shared a link in QQ/WeChat has the old
   filenames, so ship the redirects or those links break.                    */
const vjPath = join(PORTFOLIO, 'vercel.json')
const vj = JSON.parse(readFileSync(vjPath, 'utf8'))
const REDIRECTS = [
  { source: '/axz/AXZ.html', destination: '/axz/', permanent: true },
  { source: '/axz/index.html', destination: '/axz/', permanent: true },
  { source: '/axz/message.html', destination: '/axz/guestbook/', permanent: true },
  { source: '/axz/flightlog.html', destination: '/axz/logbook/', permanent: true },
  { source: '/axz/%E5%BD%A9%E8%9B%8B/:path*', destination: '/axz/aprilfools/', permanent: true },
  { source: '/axz/彩蛋/:path*', destination: '/axz/aprilfools/', permanent: true },
]
vj.redirects = [
  ...(vj.redirects || []).filter(r => !r.source.startsWith('/axz/')),
  ...REDIRECTS,
]

/* Fonts need a long-lived immutable header like the CSS/JS already have.
   The filenames are content-hashed, so this is safe. */
const FONT_HEADER = {
  source: '/axz/fonts/(.*)',
  headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
}
vj.headers = [...(vj.headers || []).filter(h => h.source !== FONT_HEADER.source), FONT_HEADER]

writeFileSync(vjPath, JSON.stringify(vj, null, 2) + '\n')

/* --- .vercelignore --------------------------------------------------------
   Source, scripts and unsubset originals must not deploy. Comments go on
   their OWN line — a trailing `# note` becomes part of the pattern and
   silently stops matching.                                                  */
const viPath = join(PORTFOLIO, '.vercelignore')
let vi = existsSync(viPath) ? readFileSync(viPath, 'utf8') : ''
const BLOCK = `
# AXZ standalone case: ship the built output only
axz-src
axz-wab-source
`
if (!vi.includes('axz-wab-source')) {
  vi = vi.replace(/\s*$/, '\n') + BLOCK
  writeFileSync(viPath, vi)
}

console.log(`✓ mirrored ${n} files (${(bytes / 1024).toFixed(0)} KB) to ${DEST}`)
console.log(`✓ ${REDIRECTS.length} redirects + font cache header written to vercel.json`)
console.log(`  live at https://xiaobrook.com/axz/  (zh) and /axz/en/ (en)`)
