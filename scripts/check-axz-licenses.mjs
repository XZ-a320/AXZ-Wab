#!/usr/bin/env node
/* ==========================================================================
   Gate 6: every asset the simulator downloads has a licence we may
   redistribute under, an author, a source, a row in credits.json, and its
   author rendered on the 3.0 page in both languages. A row that fails any of
   these fails the build. Nothing here estimates: it reads the manifests the
   fetch script fetched from and the HTML the build wrote.
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ALLOWED, readManifests } from './assets/build-index.mjs'

export function checkLicenses({ rows, credits, pages }) {
  const problems = []
  const seen = new Set()
  const creditIds = new Set(credits.map(c => c.id))
  for (const r of rows) {
    if (seen.has(r.id)) problems.push(`${r.id}: duplicate id (${r.manifest})`)
    seen.add(r.id)
    if (!ALLOWED.includes(r.license)) problems.push(`${r.id}: licence ${r.license} is not allowed (allowed: ${ALLOWED.join(', ')})`)
    if (!r.author) problems.push(`${r.id}: no author`)
    if (!r.source) problems.push(`${r.id}: no source`)
    if (!r.file) problems.push(`${r.id}: no file`)
    if (r.fetched !== false && !creditIds.has(r.id)) problems.push(`${r.id}: not in credits.json`)
    /* CC BY is a contract: title, author, source link, licence, and what we
       changed. A row that cannot fill those in cannot be attributed. */
    if (/^CC-BY/.test(r.license)) {
      if (!r.title) problems.push(`${r.id}: CC BY row has no title`)
      if (!/^https?:\/\//.test(r.source || '')) problems.push(`${r.id}: CC BY row source must be a URL`)
      if (!/^https?:\/\//.test(r.authorUrl || '')) problems.push(`${r.id}: CC BY row has no authorUrl`)
      if (!r.modified) problems.push(`${r.id}: CC BY row must say what was modified`)
    }
    if (r.fetched !== false) pages.forEach((html, i) => {
      if (r.author && !html.includes(r.author)) problems.push(`${r.id}: author "${r.author}" is not rendered on page ${i + 1}`)
    })
  }
  return problems
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const ROOT = join(import.meta.dirname, '..')
  const repo = process.env.AXZ_ASSETS || join(ROOT, '..', 'axz-assets')
  const creditsPath = join(repo, 'public', 'credits.json')
  if (!existsSync(creditsPath)) { console.error(`✗ ${creditsPath} missing — run scripts/assets/build-index.mjs`); process.exit(1) }
  const pagePaths = ['sim/v3/index.html', 'en/sim/v3/index.html'].map(p => join(ROOT, 'axz', p))
  for (const p of pagePaths) if (!existsSync(p)) { console.error(`✗ ${p} missing — run scripts/build-axz.mjs`); process.exit(1) }
  const rows = readManifests(repo)
  const problems = checkLicenses({ rows, credits: JSON.parse(readFileSync(creditsPath, 'utf8')), pages: pagePaths.map(p => readFileSync(p, 'utf8')) })
  for (const p of problems) console.error(`✗ ${p}`)
  if (problems.length) process.exit(1)
  console.log(`✓ ${rows.length} asset row${rows.length === 1 ? '' : 's'}: licences allowed, authors credited on both 3.0 pages`)
}
