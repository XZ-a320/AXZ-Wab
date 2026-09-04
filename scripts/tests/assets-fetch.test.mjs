import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { parseSvnListing, treeHash, fetchRow, fetchManifest } from '../assets/fetch.mjs'

const sha = s => createHash('sha256').update(s).digest('hex')
const respond = table => async url => {
  const b = table[url]
  if (b == null) return { ok: false, status: 404 }
  return { ok: true, status: 200, text: async () => b, arrayBuffer: async () => new TextEncoder().encode(b).buffer }
}
const repoDir = () => { const r = mkdtempSync(join(tmpdir(), 'axz-fetch-')); mkdirSync(join(r, 'manifests')); mkdirSync(join(r, 'raw')); return r }

test('parseSvnListing separates files and subdirectories and ignores parent/absolute links', () => {
  const html = '<a href="../">..</a><a href="a.ac">a.ac</a><a href="Liveries/">Liveries/</a><a href="/p/x">x</a><a href="b%20c.png">b c.png</a>'
  assert.deepEqual(parseSvnListing(html), { files: ['a.ac', 'b c.png'], dirs: ['Liveries/'] })
})

test('treeHash is stable and counts files', () => {
  const d = mkdtempSync(join(tmpdir(), 'axz-tree-')); mkdirSync(join(d, 'sub'))
  writeFileSync(join(d, 'b.txt'), 'B'); writeFileSync(join(d, 'sub', 'a.txt'), 'A')
  const t1 = treeHash(d), t2 = treeHash(d)
  assert.equal(t1.files, 2); assert.equal(t1.sha256, t2.sha256)
})

test('a url row is downloaded, hashed and written under raw/', async () => {
  const repo = repoDir()
  const row = { id: 'dec', kind: 'decoder', file: 'decoders/x.wasm', fetched: false, fetch: { type: 'url', url: 'http://cdn/x.wasm' } }
  const r = await fetchRow(row, { repo, fetchImpl: respond({ 'http://cdn/x.wasm': 'WASM' }) })
  assert.equal(r.bytes, 4); assert.equal(r.sha256, sha('WASM')); assert.ok(existsSync(join(repo, 'raw', 'decoders', 'x.wasm')))
})

test('a declared sha256 that does not match is refused', async () => {
  const repo = repoDir()
  const row = { id: 'dec', file: 'decoders/x.wasm', fetched: false, sha256: '0'.repeat(64), fetch: { type: 'url', url: 'http://cdn/x.wasm' } }
  await assert.rejects(fetchRow(row, { repo, fetchImpl: respond({ 'http://cdn/x.wasm': 'WASM' }) }), /sha256 mismatch/)
})

test('an svn-dir row walks subdirectories and honours exclude', async () => {
  const repo = repoDir()
  const base = 'http://svn/Models/'
  const table = {
    [base]: '<a href="../">..</a><a href="m.ac">m.ac</a><a href="Liveries/">Liveries/</a><a href="Interior/">Interior/</a>',
    [base + 'm.ac']: 'AC3Db', [base + 'Interior/']: '<a href="../">..</a><a href="i.ac">i.ac</a>', [base + 'Interior/i.ac']: 'AC3Dc',
    [base + 'Liveries/']: '<a href="big.png">big.png</a>', [base + 'Liveries/big.png']: 'PNG'.repeat(100),
  }
  const row = { id: 'fg', file: 'models/fg/', fetched: false, fetch: { type: 'svn-dir', url: base, into: 'models/fg', exclude: ['Liveries/'] } }
  const r = await fetchRow(row, { repo, fetchImpl: respond(table) })
  assert.equal(r.files, 2); assert.equal(r.bytes, 10)
  assert.ok(existsSync(join(repo, 'raw', 'models', 'fg', 'Interior', 'i.ac'))); assert.ok(!existsSync(join(repo, 'raw', 'models', 'fg', 'Liveries')))
})

test('a manual row reports what it is waiting for, and verifies when the file exists', async () => {
  const repo = repoDir()
  const row = { id: 'sk', file: 'models/sk/source.zip', fetched: false, fetch: { type: 'manual', instructions: 'download from Sketchfab' } }
  const r1 = await fetchRow(row, { repo })
  assert.equal(r1.manual, true); assert.equal(r1.expect, 'models/sk/source.zip')
  mkdirSync(join(repo, 'raw', 'models', 'sk'), { recursive: true }); writeFileSync(join(repo, 'raw', 'models', 'sk', 'source.zip'), 'ZIP')
  const r2 = await fetchRow(row, { repo })
  assert.equal(r2.sha256, sha('ZIP'))
})

test('fetchManifest refuses an unapproved manifest and writes back fetched rows', async () => {
  const repo = repoDir()
  const p = join(repo, 'manifests', 'p.json')
  writeFileSync(p, JSON.stringify({ phase: '9', rows: [{ id: 'dec', file: 'decoders/x.wasm', fetched: false, fetch: { type: 'url', url: 'http://cdn/x.wasm' } }] }))
  await assert.rejects(fetchManifest(p, { repo, fetchImpl: respond({}) , log: () => {} }), /not approved/)
  writeFileSync(p, JSON.stringify({ phase: '9', approvedBy: 'Brook Xiao', approvedOn: '2026-09-04', rows: [
    { id: 'dec', file: 'decoders/x.wasm', fetched: false, fetch: { type: 'url', url: 'http://cdn/x.wasm' } },
    { id: 'gone', file: 'decoders/y.wasm', fetched: false, fetch: { type: 'url', url: 'http://cdn/y.wasm' } },
    { id: 'done', file: 'z', fetched: true }] }))
  const report = await fetchManifest(p, { repo, fetchImpl: respond({ 'http://cdn/x.wasm': 'WASM' }), log: () => {} })
  assert.deepEqual(report.map(r => r.state), ['fetched', 'error', 'already'])
  const m = JSON.parse(readFileSync(p, 'utf8'))
  assert.equal(m.rows[0].fetched, true); assert.equal(m.rows[0].sha256, sha('WASM')); assert.equal(m.rows[1].fetched, false)
})
