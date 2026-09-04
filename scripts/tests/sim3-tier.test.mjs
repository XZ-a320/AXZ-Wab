import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chooseTier, readTierOverride, LOW_END } from '../../axz-src/js/sim3/tier.js'

const desktop = { override: null, maxTouchPoints: 0, innerWidth: 1440, deviceMemory: 16, webgl2: true, renderer: 'ANGLE (Apple, Apple M1, OpenGL 4.1)' }

test('a desktop with WebGL2 gets 3.0', () => assert.equal(chooseTier(desktop), 'v3'))
test('?tier= overrides everything', () => {
  assert.equal(readTierOverride('?tier=3'), 'v3')
  assert.equal(readTierOverride('?tier=v3'), 'v3')
  assert.equal(readTierOverride('?tier=vintage'), 'vintage')
  assert.equal(readTierOverride('?tier=classic'), 'classic')
  assert.equal(readTierOverride('?tier=nonsense'), null)
  assert.equal(readTierOverride(''), null)
  assert.equal(chooseTier({ ...desktop, override: 'classic' }), 'classic')
})
test('no WebGL2 means classic, because Three.js 0.170 needs WebGL2', () => assert.equal(chooseTier({ ...desktop, webgl2: false }), 'classic'))
test('a phone (touch, narrow) gets vintage', () => assert.equal(chooseTier({ ...desktop, maxTouchPoints: 5, innerWidth: 390 }), 'vintage'))
test('a wide touch tablet gets 3.0', () => assert.equal(chooseTier({ ...desktop, maxTouchPoints: 5, innerWidth: 1024 }), 'v3'))
test('under 4 GB of device memory gets vintage; unknown memory does not', () => {
  assert.equal(chooseTier({ ...desktop, deviceMemory: 2 }), 'vintage')
  assert.equal(chooseTier({ ...desktop, deviceMemory: undefined }), 'v3')
})
test('a low-end GPU gets vintage', () => {
  for (const r of ['Mali-G52', 'Adreno (TM) 530', 'Intel(R) HD Graphics 4600']) {
    assert.ok(LOW_END.test(r), r)
    assert.equal(chooseTier({ ...desktop, renderer: r }), 'vintage')
  }
  assert.equal(chooseTier({ ...desktop, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' }), 'v3')
})
