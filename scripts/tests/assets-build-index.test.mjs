import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { buildIndex, ALLOWED } from '../assets/build-index.mjs'

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), 'axz-assets-'))
  mkdirSync(join(repo, 'manifests')); mkdirSync(join(repo, 'raw', 'textures'), { recursive: true })
  writeFileSync(join(repo, 'raw', 'textures', 'probe.png'), Buffer.from('not-really-a-png'))
  writeFileSync(join(repo, 'manifests', 'phase-0.json'), JSON.stringify({
    phase: '0', approvedBy: 'Brook Xiao', approvedOn: '2026-09-04',
    rows: [{ id: 'probe', kind: 'texture', file: 'textures/probe.png', source: 'authored', license: 'authored', author: 'Brook Xiao' }],
  }))
  return repo
}

test('ALLOWED is the spec allowlist', () => {
  assert.deepEqual(ALLOWED, ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'PDM', 'Copernicus', 'ODbL', 'purchased', 'authored', 'Apache-2.0', 'MIT', 'GPL-2.0-or-later', 'GPL-3.0-or-later'])
})

test('buildIndex publishes content-hashed files and an index with credits', () => {
  const repo = fixture()
  const index = buildIndex(repo, { origin: 'http://assets.test', now: '2026-09-04T00:00:00Z' })
  const sha = createHash('sha256').update('not-really-a-png').digest('hex')
  assert.equal(index.assets.probe.url, `textures/probe.${sha.slice(0, 8)}.png`)
  assert.equal(index.assets.probe.bytes, 16)
  assert.equal(index.assets.probe.sha256, sha)
  assert.ok(existsSync(join(repo, 'public', index.assets.probe.url)))
  const onDisk = JSON.parse(readFileSync(join(repo, 'public', 'index.json'), 'utf8'))
  assert.deepEqual(onDisk, index)
  assert.deepEqual(JSON.parse(readFileSync(join(repo, 'public', 'credits.json'), 'utf8')),
    [{ id: 'probe', title: 'probe', author: 'Brook Xiao', authorUrl: '', license: 'authored', source: 'authored', modified: '', phase: '0' }])
})

test('buildIndex refuses a row whose raw file is missing', () => {
  const repo = fixture()
  writeFileSync(join(repo, 'manifests', 'phase-1.json'), JSON.stringify({ phase: '1', rows: [
    { id: 'ghost', kind: 'model', file: 'models/ghost.glb', source: 'x', license: 'CC0-1.0', author: 'y' }] }))
  assert.throws(() => buildIndex(repo), /missing raw file for ghost/)
})

test('buildIndex refuses a sha256 that does not match the manifest', () => {
  const repo = fixture()
  const m = JSON.parse(readFileSync(join(repo, 'manifests', 'phase-0.json'), 'utf8'))
  m.rows[0].sha256 = '0'.repeat(64)
  writeFileSync(join(repo, 'manifests', 'phase-0.json'), JSON.stringify(m))
  assert.throws(() => buildIndex(repo), /probe: sha256 mismatch/)
})

test('an approved row that is not fetched yet is skipped and listed as pending', () => {
  const repo = fixture()
  writeFileSync(join(repo, 'manifests', 'phase-1.json'), JSON.stringify({ phase: '1', rows: [
    { id: 'later', kind: 'model', file: 'models/later/later.glb', source: 'https://x', license: 'CC-BY-4.0', author: 'y', fetched: false }] }))
  const index = buildIndex(repo)
  assert.deepEqual(Object.keys(index.assets), ['probe']); assert.deepEqual(index.pending, ['later'])
})

test('a derived row is read from derived/, not raw/', () => {
  const repo = fixture()
  mkdirSync(join(repo, 'derived', 'models', 'conv'), { recursive: true })
  writeFileSync(join(repo, 'derived', 'models', 'conv', 'conv.glb'), Buffer.from('glb'))
  writeFileSync(join(repo, 'manifests', 'phase-1.json'), JSON.stringify({ phase: '1', rows: [
    { id: 'conv', kind: 'model', file: 'models/conv/conv.glb', derived: true, source: 'https://x', license: 'GPL-2.0-or-later', author: 'y' }] }))
  const index = buildIndex(repo)
  assert.equal(index.assets.conv.bytes, 3); assert.ok(existsSync(join(repo, 'public', index.assets.conv.url)))
})

test('a model row carries its fleet types and part into the index', () => {
  const repo = fixture()
  mkdirSync(join(repo, 'derived', 'models', 'b738'), { recursive: true })
  writeFileSync(join(repo, 'derived', 'models', 'b738', 'b738.glb'), Buffer.from('glb'))
  writeFileSync(join(repo, 'manifests', 'phase-1.json'), JSON.stringify({ phase: '1', rows: [
    { id: 'b738', kind: 'model', file: 'models/b738/b738.glb', derived: true, types: ['b-737x', 'b-1717'], part: 'exterior', source: 'https://x', license: 'GPL-2.0-or-later', author: 'y' }] }))
  const index = buildIndex(repo)
  assert.deepEqual(index.assets.b738.types, ['b-737x', 'b-1717']); assert.equal(index.assets.b738.part, 'exterior')
})

test('a derived row keeps the fetch tree hash as provenance and hashes the published file itself', () => {
  const repo = fixture()
  mkdirSync(join(repo, 'derived', 'models', 'd'), { recursive: true })
  writeFileSync(join(repo, 'derived', 'models', 'd', 'd.glb'), Buffer.from('glb'))
  writeFileSync(join(repo, 'manifests', 'phase-1.json'), JSON.stringify({ phase: '1', rows: [
    { id: 'd', kind: 'model', file: 'models/d/d.glb', derived: true, sha256: 'a'.repeat(64), source: 'https://x', license: 'GPL-2.0-or-later', author: 'y' }] }))
  const index = buildIndex(repo)
  assert.equal(index.assets.d.sourceSha256, 'a'.repeat(64))
  assert.equal(index.assets.d.sha256, createHash('sha256').update('glb').digest('hex'))
})

test('a publish:false row is credited but not served', () => {
  const repo = fixture()
  writeFileSync(join(repo, 'manifests', 'phase-1.json'), JSON.stringify({ phase: '1', rows: [
    { id: 'tex', kind: 'texture', file: 'textures/tex/', publish: false, source: 'https://polyhaven.com/a/tex', license: 'CC0-1.0', author: 'Poly Haven' }] }))
  const index = buildIndex(repo)
  assert.equal(index.assets.tex, undefined)
  assert.equal(index.credits.find(c => c.id === 'tex').published, false)
})

test('a derived row whose GLB is not built yet is credited and pending, not an error', () => {
  const repo = fixture()
  writeFileSync(join(repo, 'manifests', 'phase-4.json'), JSON.stringify({ phase: '4', rows: [
    { id: 'later', kind: 'model', file: 'models/later/later.glb', derived: true, source: 'https://x', license: 'GPL-2.0-or-later', author: 'FlightGear later authors' }] }))
  const index = buildIndex(repo)
  assert.equal(index.assets.later, undefined); assert.deepEqual(index.pending, ['later (not built)'])
  assert.equal(index.credits.find(c => c.id === 'later').published, false)
})
