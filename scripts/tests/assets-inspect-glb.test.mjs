import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseGlb, summarize } from '../assets/inspect-glb.mjs'

/* A one-triangle GLB built by hand: POSITION + TEXCOORD_0 + indices. */
function tinyGlb({ uv = true } = {}) {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0])
  const uvs = new Float32Array([0, 0, 1, 0, 0, 1])
  const idx = new Uint16Array([0, 1, 2, 0])          // padded to 4 bytes
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(uvs.buffer), Buffer.from(idx.buffer)])
  const attributes = { POSITION: 0 }
  if (uv) attributes.TEXCOORD_0 = 1
  const json = {
    asset: { version: '2.0', generator: 'test' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 24 }, { buffer: 0, byteOffset: 60, byteLength: 6 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes, indices: 2 }] }],
    nodes: [{ name: 'gearL', mesh: 0 }, { name: 'fuselage' }],
    materials: [{}], scenes: [{ nodes: [0, 1] }], scene: 0,
  }
  let js = Buffer.from(JSON.stringify(json)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')])
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8)
  const c0 = Buffer.alloc(8); c0.writeUInt32LE(js.length, 0); c0.writeUInt32LE(0x4e4f534a, 4)
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(bin.length, 0); c1.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([head, c0, js, c1, bin])
}

test('parseGlb reads the JSON and BIN chunks', () => {
  const { version, json, bin } = parseGlb(tinyGlb())
  assert.equal(version, 2); assert.equal(json.asset.generator, 'test'); assert.equal(bin.length, 68)
})
test('summarize counts triangles, UV coverage, names and extent', () => {
  const s = summarize(parseGlb(tinyGlb()).json)
  assert.equal(s.triangles, 1); assert.equal(s.uvCoverage, 1); assert.equal(s.normalCoverage, 0)
  assert.deepEqual(s.nodeNames, ['gearL', 'fuselage']); assert.deepEqual(s.extent, [1, 2, 0]); assert.equal(s.materials, 1)
})
test('a mesh without UVs reports zero coverage', () => {
  assert.equal(summarize(parseGlb(tinyGlb({ uv: false })).json).uvCoverage, 0)
})
test('a non-GLB is refused', () => {
  assert.throws(() => parseGlb(Buffer.from('not a glb at all')), /not a GLB/)
})
