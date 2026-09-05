import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AssetHub } from '../../axz-src/js/sim3/assets.js'

const INDEX = {
  version: 1, builtAt: '2026-09-04T00:00:00Z', origin: 'http://assets.test',
  assets: { 'uv-probe': { kind: 'texture', url: 'textures/uv-probe.abcd1234.png', bytes: 5, sha256: 'x', license: 'authored', author: 'Brook Xiao', source: 'authored' } },
  credits: [{ id: 'uv-probe', author: 'Brook Xiao', license: 'authored', source: 'authored', phase: '0' }],
}
const fakeFetch = bodies => {
  const calls = []
  const f = async url => {
    calls.push(url)
    const b = bodies[url]
    if (b == null) return { ok: false, status: 404, json: async () => { throw new Error('404') }, arrayBuffer: async () => new ArrayBuffer(0) }
    return { ok: true, status: 200, json: async () => JSON.parse(b), arrayBuffer: async () => new TextEncoder().encode(b).buffer }
  }
  f.calls = calls
  return f
}

test('load() reads index.json from the origin and comes online', async () => {
  const fetchImpl = fakeFetch({ 'http://assets.test/index.json': JSON.stringify(INDEX) })
  const hub = new AssetHub({ origin: 'http://assets.test/', fetchImpl })
  const idx = await hub.load()
  assert.equal(hub.online, true)
  assert.equal(idx.assets['uv-probe'].bytes, 5)
  assert.equal(fetchImpl.calls[0], 'http://assets.test/index.json')
})

test('an unreachable origin leaves the hub offline instead of throwing', async () => {
  const hub = new AssetHub({ origin: 'http://assets.test', fetchImpl: async () => { throw new TypeError('Failed to fetch') } })
  assert.equal(await hub.load(), null)
  assert.equal(hub.online, false)
  assert.match(hub.error, /Failed to fetch/)
})

test('url() resolves an id against the origin and refuses unknown ids', async () => {
  const hub = new AssetHub({ origin: 'http://assets.test', fetchImpl: fakeFetch({ 'http://assets.test/index.json': JSON.stringify(INDEX) }) })
  await hub.load()
  assert.equal(hub.url('uv-probe'), 'http://assets.test/textures/uv-probe.abcd1234.png')
  assert.throws(() => hub.url('nope'), /unknown asset: nope/)
})

test('bytesOf() counts transferred bytes once per id and flags the budget', async () => {
  const fetchImpl = fakeFetch({ 'http://assets.test/index.json': JSON.stringify(INDEX), 'http://assets.test/textures/uv-probe.abcd1234.png': 'hello' })
  const hub = new AssetHub({ origin: 'http://assets.test', fetchImpl, budgetBytes: 4 })
  await hub.load()
  const a = await hub.bytesOf('uv-probe')
  const b = await hub.bytesOf('uv-probe')
  assert.equal(a.byteLength, 5)
  assert.equal(a, b)
  assert.equal(hub.transferred, 5)
  assert.equal(hub.overBudget, true)
  assert.equal(fetchImpl.calls.filter(u => u.endsWith('.png')).length, 1)
})

test('bytesOf() throws on a missing file', async () => {
  const hub = new AssetHub({ origin: 'http://assets.test', fetchImpl: fakeFetch({ 'http://assets.test/index.json': JSON.stringify(INDEX) }) })
  await hub.load()
  await assert.rejects(hub.bytesOf('uv-probe'), /uv-probe: 404/)
})

test('credits() lists every row sorted by id, and is empty offline', async () => {
  const on = new AssetHub({ origin: 'http://assets.test', fetchImpl: fakeFetch({ 'http://assets.test/index.json': JSON.stringify({ ...INDEX, credits: [{ id: 'b' }, { id: 'a' }] }) }) })
  await on.load()
  assert.deepEqual(on.credits().map(c => c.id), ['a', 'b'])
  const off = new AssetHub({ origin: 'http://assets.test', fetchImpl: fakeFetch({}) })
  await off.load()
  assert.deepEqual(off.credits(), [])
})

test('modelFor() finds the exterior for a fleet type and ignores cockpit-only rows for it', async () => {
  const idx = { ...INDEX, assets: { ...INDEX.assets,
    'b738-fg': { kind: 'model', url: 'models/b738-fg.x.glb', bytes: 1, types: ['b-737x', 'b-1717'], part: 'cockpit+exterior-fallback' },
    'b738-cockpit': { kind: 'model', url: 'models/c.glb', bytes: 1, types: ['b-737x'], part: 'cockpit' } } }
  const hub = new AssetHub({ origin: 'http://assets.test', fetchImpl: fakeFetch({ 'http://assets.test/index.json': JSON.stringify(idx) }) })
  await hub.load()
  assert.equal(hub.modelFor('b-1717').id, 'b738-fg')
  assert.equal(hub.modelFor('b-737x', 'cockpit').id, 'b738-cockpit')   // the dedicated deck beats the compound label
  assert.equal(hub.modelFor('conc'), null)
})

test('modelFor() prefers an exact part over a compound label', async () => {
  const idx = { ...INDEX, assets: { ...INDEX.assets,
    'b738-fg': { kind: 'model', url: 'a.glb', bytes: 1, types: ['b-737x'], part: 'exterior-fallback' },
    'b738-fg-cockpit': { kind: 'model', url: 'c.glb', bytes: 1, types: ['b-737x'], part: 'cockpit' } } }
  const hub = new AssetHub({ origin: 'http://assets.test', fetchImpl: fakeFetch({ 'http://assets.test/index.json': JSON.stringify(idx) }) })
  await hub.load()
  assert.equal(hub.modelFor('b-737x').id, 'b738-fg')
  assert.equal(hub.modelFor('b-737x', 'cockpit').id, 'b738-fg-cockpit')
})
