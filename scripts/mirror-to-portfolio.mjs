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

/* --- vercel.json ---------------------------------------------------------
   VERIFY, never rewrite. JSON.stringify would reformat the whole file — the
   portfolio's vercel.json uses a compact one-line style for header entries,
   and reflowing it produced a 65-line diff across unrelated security headers.
   The /axz/ config is committed by hand; this only checks it is still there.

   The redirects matter because every internal link in the ORIGINAL site points
   at AXZ.html and nothing points at index.html, so links already circulating
   in QQ and WeChat carry the old filenames.                                  */
const vj = JSON.parse(readFileSync(join(PORTFOLIO, 'vercel.json'), 'utf8'))
const wantRedirects = ['/axz/AXZ.html', '/axz/index.html', '/axz/message.html', '/axz/flightlog.html']
const haveRedirects = (vj.redirects || []).map(r => r.source)
const missing = wantRedirects.filter(r => !haveRedirects.includes(r))
const hasFontHeader = (vj.headers || []).some(h => h.source === '/axz/fonts/(.*)')

if (missing.length || !hasFontHeader) {
  console.error('✗ vercel.json is missing required /axz/ config — add by hand, do not let a script reflow this file:')
  for (const m of missing) console.error(`    redirect ${m}`)
  if (!hasFontHeader) console.error('    header  /axz/fonts/(.*)  Cache-Control immutable')
  process.exit(1)
}

/* Nothing to add to .vercelignore: only the built axz/ is ever copied into the
   portfolio. axz-src/, scripts/ and fonts-src/ live in this repo and never
   reach the deploy, so a pattern for them there would guard nothing. */

console.log(`✓ mirrored ${n} files (${(bytes / 1024).toFixed(0)} KB) to ${DEST}`)
console.log(`✓ vercel.json verified: ${haveRedirects.filter(r => r.startsWith('/axz/')).length} /axz/ redirects + font cache header`)
console.log(`  live at https://xiaobrook.com/axz/  (zh) and /axz/en/ (en)`)
