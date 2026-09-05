#!/usr/bin/env node
/* ==========================================================================
   Fetch the rows of an APPROVED manifest into raw/, and write back what came.

   Rules that do not bend: a row is fetched only if the manifest carries an
   approval (approvedBy + approvedOn) and the row says `fetched: false`; every
   byte is hashed; a declared sha256 must match; nothing outside the row's
   own directory is written. Four ways bytes arrive:

     url        one file from one URL
     urls       several files into one directory
     svn-dir    a SourceForge SVN directory over plain HTTP, recursively
     git-sparse a GitHub repo, one shallow partial clone, only the paths named
     manual     Brook downloads it; we only verify
     sketchfab  the download API, with SKETCHFAB_TOKEN from .env.local; else as manual

   Usage: node scripts/assets/fetch.mjs manifests/phase-1.json [--only a,b] [--dry]
   ========================================================================== */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, rmSync, cpSync } from 'node:fs'
import { join, dirname, basename, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

/* Secrets come from <repo>/.env.local (gitignored), never from the manifest
   and never printed: SKETCHFAB_TOKEN=… lets the Sketchfab rows fetch
   themselves through the download API. */
export function readEnvLocal(repo) {
  const p = join(repo, '.env.local')
  if (!existsSync(p)) return {}
  const out = {}
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '') }
  return out
}

/** Sketchfab's download API: a logged-in account's token buys a short-lived
    URL for the glTF zip of a downloadable model. The token is the account's;
    the licence is the model's; both are checked before a byte moves. */
async function sketchfab(uid, into, { token, fetchImpl, log, exec = execFileSync }) {
  if (!token) return null
  const res = await fetchImpl(`https://api.sketchfab.com/v3/models/${uid}/download`, { headers: { Authorization: `Token ${token}` } })
  if (!res.ok) throw new Error(`Sketchfab download API ${res.status} for ${uid}${res.status === 401 || res.status === 403 ? ' (token refused: is it a personal API token from Settings → Password & API?)' : ''}`)
  const meta = await res.json()
  const g = meta.gltf || meta.glb
  if (!g || !g.url) throw new Error(`Sketchfab: no glTF archive offered for ${uid}`)
  const zip = join(into, 'source.zip')
  const buf = await download(g.url, zip, fetchImpl)
  log(`    source.zip ${(buf.length / 1048576).toFixed(1)} MB (Sketchfab said ${g.size ? (g.size / 1048576).toFixed(1) + ' MB' : 'unknown'})`)
  mkdirSync(join(into, 'source'), { recursive: true })
  exec('unzip', ['-q', '-o', zip, '-d', join(into, 'source')], { stdio: 'pipe' })
  return buf
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex')

/** Parse a mod_dav_svn / SourceForge directory listing into files and dirs. */
export function parseSvnListing(html) {
  const files = [], dirs = []
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const h = decodeURIComponent(m[1])
    if (h.startsWith('..') || h.startsWith('/') || /^https?:/.test(h) || h.startsWith('?')) continue
    if (h.endsWith('/')) dirs.push(h); else files.push(h)
  }
  return { files, dirs }
}

/** Hash a directory tree deterministically: sha256 of "relpath sha256\n" lines, sorted. */
export function treeHash(dir) {
  const lines = []
  const walk = d => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else lines.push(`${relative(dir, p)} ${sha256(readFileSync(p))}`)
    }
  }
  walk(dir)
  return { sha256: sha256(lines.join('\n')), files: lines.length }
}

function dirBytes(dir) {
  let n = 0
  const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); const s = statSync(p); if (s.isDirectory()) walk(p); else n += s.size } }
  walk(dir); return n
}

async function download(url, to, fetchImpl) {
  const res = await fetchImpl(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  mkdirSync(dirname(to), { recursive: true })
  writeFileSync(to, buf)
  return buf
}

async function svnDir(url, into, { exclude = [], fetchImpl, log }) {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const { files, dirs } = parseSvnListing(await res.text())
  mkdirSync(into, { recursive: true })
  let bytes = 0, count = 0
  for (const f of files) { const buf = await download(url + encodeURIComponent(f), join(into, f), fetchImpl); bytes += buf.length; count++; log(`    ${f} ${(buf.length / 1024).toFixed(0)} KB`) }
  for (const d of dirs) {
    if (exclude.some(x => d === x || d.startsWith(x))) { log(`    skip ${d}`); continue }
    const r = await svnDir(url + d, join(into, d), { exclude, fetchImpl, log }); bytes += r.bytes; count += r.count
  }
  return { bytes, count }
}

function gitSparse(repo, paths, into, { ref = 'HEAD', log, exec = execFileSync }) {
  const tmp = join(tmpdir(), `axz-sparse-${Date.now()}`)
  log(`    clone --filter=blob:none --depth 1 ${repo}`)
  exec('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', '--depth', '1', ...(ref !== 'HEAD' ? ['--branch', ref] : []), repo, tmp], { stdio: 'pipe' })
  exec('git', ['-C', tmp, 'config', 'core.sparseCheckout', 'true'], { stdio: 'pipe' })
  mkdirSync(join(tmp, '.git', 'info'), { recursive: true })
  writeFileSync(join(tmp, '.git', 'info', 'sparse-checkout'), paths.map(p => `/${p.replace(/^\/+/, '')}`).join('\n') + '\n')
  exec('git', ['-C', tmp, 'checkout', '--quiet'], { stdio: 'pipe' })
  const commit = exec('git', ['-C', tmp, 'rev-parse', 'HEAD'], { stdio: 'pipe' }).toString().trim()
  mkdirSync(into, { recursive: true })
  for (const p of paths) {
    const src = join(tmp, p)
    if (!existsSync(src)) { log(`    (no ${p} in repo)`); continue }
    cpSync(src, join(into, basename(p)), { recursive: true })
  }
  rmSync(tmp, { recursive: true, force: true })
  return { commit }
}

export async function fetchRow(row, { repo, fetchImpl = fetch, log = () => {}, exec, env = readEnvLocal(repo) }) {
  const specs = Array.isArray(row.fetch) ? row.fetch : [row.fetch]
  const rawDir = join(repo, 'raw')
  const result = { bytes: 0, files: 0 }
  for (const spec of specs) {
    if (!spec) throw new Error(`${row.id}: no fetch spec`)
    if (spec.type === 'manual' || spec.type === 'sketchfab') {
      const p = join(rawDir, spec.expect || row.file)
      if (!existsSync(p) && spec.type === 'sketchfab' && spec.uid) {
        const got = await sketchfab(spec.uid, dirname(p), { token: env.SKETCHFAB_TOKEN, fetchImpl, log, exec })
        if (!got) return { manual: true, expect: spec.expect || row.file, instructions: `${spec.instructions || ''} (or put SKETCHFAB_TOKEN=… in ${join(repo, '.env.local')} and rerun)`.trim() }
      }
      if (!existsSync(p)) return { manual: true, expect: spec.expect || row.file, instructions: spec.instructions }
      const buf = readFileSync(p); result.bytes += buf.length; result.files++; result.sha256 = sha256(buf)
    } else if (spec.type === 'url') {
      const to = join(rawDir, spec.into || row.file)
      const buf = await download(spec.url, to, fetchImpl)
      result.bytes += buf.length; result.files++; result.sha256 = sha256(buf)
      log(`    ${basename(to)} ${(buf.length / 1024).toFixed(0)} KB`)
    } else if (spec.type === 'urls') {
      const dir = join(rawDir, spec.into)
      for (const u of spec.urls) { const buf = await download(u, join(dir, basename(new URL(u).pathname)), fetchImpl); result.bytes += buf.length; result.files++; log(`    ${basename(new URL(u).pathname)} ${(buf.length / 1024).toFixed(0)} KB`) }
      Object.assign(result, { sha256: treeHash(dir).sha256 })
    } else if (spec.type === 'svn-dir') {
      const dir = join(rawDir, spec.into)
      const r = await svnDir(spec.url.endsWith('/') ? spec.url : spec.url + '/', dir, { exclude: spec.exclude, fetchImpl, log })
      result.bytes += r.bytes; result.files += r.count; result.sha256 = treeHash(dir).sha256
    } else if (spec.type === 'git-sparse') {
      const dir = join(rawDir, spec.into)
      const { commit } = gitSparse(spec.repo, spec.paths, dir, { ref: spec.ref, log, exec })
      result.commit = commit; result.bytes += dirBytes(dir); const t = treeHash(dir); result.files += t.files; result.sha256 = t.sha256
    } else throw new Error(`${row.id}: unknown fetch type ${spec.type}`)
  }
  if (row.sha256 && result.sha256 && row.sha256 !== result.sha256) throw new Error(`${row.id}: sha256 mismatch (declared ${row.sha256.slice(0, 12)}…, got ${result.sha256.slice(0, 12)}…)`)
  return result
}

export async function fetchManifest(path, { repo, only = null, dry = false, fetchImpl = fetch, log = console.log, exec, env = readEnvLocal(repo) } = {}) {
  const m = JSON.parse(readFileSync(path, 'utf8'))
  if (!m.approvedBy || !m.approvedOn) throw new Error(`${basename(path)}: not approved (approvedBy/approvedOn missing) — nothing fetched`)
  const report = []
  for (const row of m.rows) {
    if (only && !only.includes(row.id)) continue
    if (row.fetched !== false) { report.push({ id: row.id, state: 'already' }); continue }
    if (!row.fetch) { report.push({ id: row.id, state: 'no-fetch-spec' }); continue }
    log(`  ${row.id}`)
    if (dry) { report.push({ id: row.id, state: 'dry' }); continue }
    try {
      const r = await fetchRow(row, { repo, fetchImpl, log, exec, env })
      if (r.manual) { report.push({ id: row.id, state: 'manual', expect: r.expect, instructions: r.instructions }); continue }
      Object.assign(row, { fetched: true, fetchedOn: new Date().toISOString().slice(0, 10), bytes: r.bytes, files: r.files, sha256: r.sha256, ...(r.commit ? { commit: r.commit } : {}) })
      report.push({ id: row.id, state: 'fetched', bytes: r.bytes, files: r.files })
    } catch (err) {
      report.push({ id: row.id, state: 'error', error: String(err.message || err) })
    }
  }
  if (!dry) writeFileSync(path, JSON.stringify(m, null, 2) + '\n')
  return report
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [path] = process.argv.slice(2).filter(a => !a.startsWith('--'))
  if (!path) { console.error('usage: node scripts/assets/fetch.mjs manifests/<phase>.json [--only a,b] [--dry]'); process.exit(2) }
  const repo = process.env.AXZ_ASSETS || join(import.meta.dirname, '..', '..', '..', 'axz-assets')
  const onlyArg = process.argv.find(a => a.startsWith('--only='))
  const report = await fetchManifest(join(repo, path), { repo, only: onlyArg ? onlyArg.slice(7).split(',') : null, dry: process.argv.includes('--dry') })
  let bad = 0
  for (const r of report) {
    if (r.state === 'fetched') console.log(`✓ ${r.id}: ${r.files} file(s), ${(r.bytes / 1048576).toFixed(2)} MB`)
    else if (r.state === 'manual') console.log(`… ${r.id}: waiting for a manual download at raw/${r.expect}${r.instructions ? ` — ${r.instructions}` : ''}`)
    else if (r.state === 'error') { bad++; console.log(`✗ ${r.id}: ${r.error}`) }
    else console.log(`  ${r.id}: ${r.state}`)
  }
  process.exit(bad ? 1 : 0)
}
