import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkOrigin } from '../check-axz-assets-live.mjs'

const INDEX = { version: 1, builtAt: 'x', assets: { probe: { url: 'textures/probe.abcd1234.png', bytes: 5 } }, credits: [] }
const respond = table => async (url, opts = {}) => {
  const row = table[url]
  if (!row) return { ok: false, status: 404, headers: new Headers() }
  return { ok: true, status: 200, headers: new Headers(row.headers), json: async () => row.body }
}
const good = {
  'http://o/index.json': { headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300, must-revalidate' }, body: INDEX },
  'http://o/textures/probe.abcd1234.png': { headers: { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable', 'content-length': '5' } },
}

test('a correct origin has no problems', async () => {
  const r = await checkOrigin('http://o', { fetchImpl: respond(good) })
  assert.deepEqual(r.problems, []); assert.equal(r.checked, 1)
})
test('a missing CORS header is a problem', async () => {
  const t = structuredClone(good); t['http://o/textures/probe.abcd1234.png'].headers = { 'cache-control': 'public, max-age=31536000, immutable', 'content-length': '5' }
  const r = await checkOrigin('http://o', { fetchImpl: respond(t) })
  assert.match(r.problems.join('\n'), /probe: no CORS header/)
})
test('a size that disagrees with the index is a problem', async () => {
  const t = structuredClone(good); t['http://o/textures/probe.abcd1234.png'].headers['content-length'] = '6'
  const r = await checkOrigin('http://o', { fetchImpl: respond(t) })
  assert.match(r.problems.join('\n'), /content-length 6 ≠ index bytes 5/)
})
test('missing cache headers are a problem unless --local', async () => {
  const t = structuredClone(good); t['http://o/textures/probe.abcd1234.png'].headers['cache-control'] = ''
  assert.match((await checkOrigin('http://o', { fetchImpl: respond(t) })).problems.join('\n'), /expected immutable/)
  assert.deepEqual((await checkOrigin('http://o', { fetchImpl: respond(t), local: true })).problems, [])
})
test('an unreachable index is the only problem reported', async () => {
  const r = await checkOrigin('http://o', { fetchImpl: respond({}) })
  assert.deepEqual(r.problems, ['index.json: 404']); assert.equal(r.index, null)
})
