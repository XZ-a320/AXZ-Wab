import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkLicenses } from '../check-axz-licenses.mjs'

const row = (o = {}) => ({ id: 'probe', kind: 'texture', file: 'textures/probe.png', source: 'authored', license: 'authored', author: 'Brook Xiao', phase: '0', manifest: 'phase-0.json', ...o })
const credit = (o = {}) => ({ id: 'probe', author: 'Brook Xiao', license: 'authored', source: 'authored', phase: '0', ...o })
const page = '<details><summary>Credits</summary><ul><li>uv-probe · Brook Xiao · authored</li></ul></details>'

test('a clean manifest, credits and page pass', () => {
  assert.deepEqual(checkLicenses({ rows: [row()], credits: [credit()], pages: [page] }), [])
})

test('a licence outside the allowlist is a problem', () => {
  const p = checkLicenses({ rows: [row({ license: 'CC-BY-NC-4.0' })], credits: [credit({ license: 'CC-BY-NC-4.0' })], pages: [page] })
  assert.match(p.join('\n'), /probe: licence CC-BY-NC-4.0 is not allowed/)
})

test('a row missing author or source is a problem', () => {
  const p = checkLicenses({ rows: [row({ author: '' })], credits: [credit()], pages: [page] })
  assert.match(p.join('\n'), /probe: no author/)
})

test('a row absent from credits.json is a problem', () => {
  const p = checkLicenses({ rows: [row()], credits: [], pages: [page] })
  assert.match(p.join('\n'), /probe: not in credits.json/)
})

test('an author not rendered on every page is a problem', () => {
  const p = checkLicenses({ rows: [row()], credits: [credit()], pages: [page, '<p>no credits here</p>'] })
  assert.match(p.join('\n'), /probe: author "Brook Xiao" is not rendered on page 2/)
})

test('duplicate ids are a problem', () => {
  const p = checkLicenses({ rows: [row(), row({ manifest: 'phase-1.json' })], credits: [credit()], pages: [page] })
  assert.match(p.join('\n'), /probe: duplicate id/)
})

const ccby = (o = {}) => row({ id: 'wing', license: 'CC-BY-4.0', title: 'Wing', source: 'https://sketchfab.com/3d-models/wing-abc', authorUrl: 'https://sketchfab.com/someone', modified: 'repainted, rigged, Draco', ...o })
const ccbyCredit = credit({ id: 'wing', license: 'CC-BY-4.0' })

test('a complete CC BY row passes', () => {
  assert.deepEqual(checkLicenses({ rows: [ccby()], credits: [ccbyCredit], pages: [page] }), [])
})
test('a CC BY row without title, source URL, authorUrl or a modification note is a problem', () => {
  const p = checkLicenses({ rows: [ccby({ title: '', source: 'sketchfab', authorUrl: '', modified: '' })], credits: [ccbyCredit], pages: [page] })
  assert.match(p.join('\n'), /wing: CC BY row has no title/)
  assert.match(p.join('\n'), /wing: CC BY row source must be a URL/)
  assert.match(p.join('\n'), /wing: CC BY row has no authorUrl/)
  assert.match(p.join('\n'), /wing: CC BY row must say what was modified/)
})
test('Apache-2.0 decoders and authored rows need no attribution URL', () => {
  const dec = row({ id: 'draco', kind: 'decoder', license: 'Apache-2.0', author: 'Google (Draco)', source: 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/draco_decoder.wasm', file: 'decoders/draco/draco_decoder.wasm' })
  const pg = page + '<li>draco · Google (Draco) · Apache-2.0</li>'
  assert.deepEqual(checkLicenses({ rows: [dec], credits: [credit({ id: 'draco' })], pages: [pg] }), [])
})

test('an unfetched row is licence-checked but not required on the page or in credits', () => {
  const later = ccby({ id: 'later', fetched: false, author: 'Nobody Yet' })
  assert.deepEqual(checkLicenses({ rows: [later], credits: [], pages: ['<p>no credits</p>'] }), [])
  const bad = ccby({ id: 'later', fetched: false, license: 'CC-BY-NC-4.0' })
  assert.match(checkLicenses({ rows: [bad], credits: [], pages: [page] }).join('\n'), /later: licence CC-BY-NC-4.0 is not allowed/)
})
