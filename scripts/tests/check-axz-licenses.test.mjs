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
