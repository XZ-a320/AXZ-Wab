#!/usr/bin/env node
/* ==========================================================================
   manifests/*.json + raw/** → public/** for the axz-assets repo.

   Every published file traces to a manifest row, and a manifest row is
   written and approved before its bytes are fetched. The published path
   carries the content hash so the simulator can cache it for a year; the
   index carries the licence and author so the credits page cannot omit one.
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, rmSync } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'

export const ALLOWED = ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'PDM', 'Copernicus', 'ODbL', 'purchased', 'authored', 'Apache-2.0', 'MIT']
const KINDS = ['texture', 'model', 'decoder', 'terrain']

export function readManifests(repo) {
  const dir = join(repo, 'manifests')
  const rows = []
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    for (const r of m.rows || []) rows.push({ ...r, phase: m.phase, manifest: f })
  }
  return rows
}

export function buildIndex(repo, { origin = 'https://axz-assets.vercel.app', now = new Date().toISOString() } = {}) {
  const raw = join(repo, 'raw'), pub = join(repo, 'public')
  const rows = readManifests(repo)
  const assets = {}, credits = []
  const skipped = []
  for (const r of rows) {
    if (!KINDS.includes(r.kind)) throw new Error(`${r.id}: unknown kind ${r.kind}`)
    if (assets[r.id]) throw new Error(`${r.id}: duplicate id (${r.manifest})`)
    /* An approved row whose bytes have not arrived yet is not an error: the
       manifest is written before the fetch. It is simply not published. */
    if (r.fetched === false) { skipped.push(r.id); continue }
    const src = join(r.derived ? join(repo, 'derived') : raw, r.file)
    if (!existsSync(src)) throw new Error(`missing ${r.derived ? 'derived' : 'raw'} file for ${r.id}: ${r.file}`)
    const buf = readFileSync(src)
    const sha = createHash('sha256').update(buf).digest('hex')
    if (r.sha256 && r.sha256 !== sha) throw new Error(`${r.id}: sha256 mismatch`)
    const ext = extname(r.file), name = basename(r.file, ext)
    assets[r.id] = { kind: r.kind, url: `${r.kind}s/${name}.${sha.slice(0, 8)}${ext}`, bytes: buf.length, sha256: sha, license: r.license, author: r.author, source: r.source, _src: src }
    credits.push({ id: r.id, title: r.title || r.id, author: r.author, authorUrl: r.authorUrl || '', license: r.license, source: r.source, modified: r.modified || '', phase: r.phase })
  }
  // public/ is entirely generated: clear it, then write.
  rmSync(pub, { recursive: true, force: true })
  mkdirSync(pub, { recursive: true })
  for (const a of Object.values(assets)) {
    mkdirSync(join(pub, a.url.split('/')[0]), { recursive: true })
    copyFileSync(a._src, join(pub, a.url))
    delete a._src
  }
  const index = { version: 1, builtAt: now, origin, assets, credits, pending: skipped }
  writeFileSync(join(pub, 'index.json'), JSON.stringify(index, null, 2) + '\n')
  writeFileSync(join(pub, 'credits.json'), JSON.stringify(credits, null, 2) + '\n')
  return index
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const repo = process.argv[2] || process.env.AXZ_ASSETS || join(import.meta.dirname, '..', '..', '..', 'axz-assets')
  const index = buildIndex(repo, { origin: process.env.AXZ_ASSETS_ORIGIN || 'https://axz-assets.vercel.app' })
  const n = Object.keys(index.assets).length
  const bytes = Object.values(index.assets).reduce((s, a) => s + a.bytes, 0)
  console.log(`✓ ${n} asset${n === 1 ? '' : 's'}, ${(bytes / 1024).toFixed(1)} KB → ${join(repo, 'public')}${index.pending.length ? `  (${index.pending.length} approved row(s) not fetched yet: ${index.pending.join(', ')})` : ''}`)
}
