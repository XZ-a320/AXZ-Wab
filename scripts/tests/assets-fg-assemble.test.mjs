import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseAc, toGltf, packGlb } from '../assets/ac2gltf.mjs'
import { parseGlb, summarize } from '../assets/inspect-glb.mjs'
import { mergeGlbs, assemble, offsetQuat, AC_TO_FG } from '../assets/fg-assemble.mjs'
import { probePng } from '../assets/make-probe.mjs'

const acText = (name, tex) => `AC3Db
MATERIAL "m" rgb 1 1 1  amb 1 1 1  emis 0 0 0  spec 0 0 0  shi 0  trans 0
OBJECT world
kids 1
OBJECT poly
name "${name}"
${tex ? `texture "${tex}"` : ''}
numvert 3
0 0 0
1 0 0
0 1 0
numsurf 1
SURF 0x10
mat 0
refs 3
0 0 0
1 1 0
2 0 1
kids 0
`
function partGlb(dir, name, tex) {
  const ac = parseAc(acText(name, tex))
  return parseGlb(packGlb(toGltf(ac, { textureDir: dir })))
}

import { rotateByQuat } from '../../axz-src/js/sim3/rig.js'
test('offsetQuat: no offsets is identity; AC_TO_FG sends AC3D (x, y, z) to FlightGear (x, −z, y)', () => {
  assert.deepEqual(offsetQuat(null), [0, 0, 0, 1])
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
  assert.ok(near(rotateByQuat(AC_TO_FG, [0, 1, 0]), [0, 0, 1]), 'AC3D up (y) becomes FlightGear up (z)')
  assert.ok(near(rotateByQuat(AC_TO_FG, [0, 0, 1]), [0, -1, 0]), 'AC3D +z (port) becomes FlightGear −y (port)')
  assert.ok(near(rotateByQuat(AC_TO_FG, [1, 0, 0]), [1, 0, 0]), 'aft stays aft')
  const q = offsetQuat({ x: 0, y: 0, z: 0, pitch: 0, roll: 0, heading: 90 })
  assert.ok(Math.abs(Math.abs(q[2]) - Math.SQRT1_2) < 1e-6)
})

test('mergeGlbs keeps every part under its own node, dedupes identical images, and remaps indices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axz-asm-'))
  writeFileSync(join(dir, 'skin.png'), probePng(8))
  const a = partGlb(dir, 'wingL', 'skin.png'), b = partGlb(dir, 'wingR', 'skin.png')
  const merged = mergeGlbs([{ name: 'L.xml', glb: a, offset: { x: 1, y: 2, z: 3, pitch: 0, roll: 0, heading: 0 } }, { name: 'R.xml', glb: b, offset: null }])
  const s = summarize(merged.json)
  assert.equal(s.images, 1); assert.equal(s.textures, 1); assert.equal(s.triangles, 2); assert.equal(s.materials, 2)
  assert.deepEqual(s.nodeNames.filter(n => n.startsWith('part:')), ['part:L.xml', 'part:R.xml'])
  const L = merged.json.nodes.find(n => n.name === 'part:L.xml'); assert.deepEqual(L.translation, [1, 2, 3])
  // every accessor's bufferView is in range, and every mesh material is in range
  for (const acc of merged.json.accessors) assert.ok(acc.bufferView < merged.json.bufferViews.length)
  for (const m of merged.json.meshes) for (const p of m.primitives) assert.ok(p.material < merged.json.materials.length)
})

test('assemble follows the rig, honours exclude, and embeds the rig in asset.extras', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axz-asm2-'))
  writeFileSync(join(dir, 'fuselage.glb'), packGlb(toGltf(parseAc(acText('fus')))))
  writeFileSync(join(dir, 'cockpit.glb'), packGlb(toGltf(parseAc(acText('deck')))))
  const rig = { id: 't', frame: 'fg', parts: [
    { xml: 'root.xml', ac: 'fuselage.ac', glb: 'fuselage.glb', dir: 'Models', offset: null, animations: [{ type: 'rotate', objects: ['fus'], property: 'x' }] },
    { xml: 'cockpit.xml', ac: 'cockpit.ac', glb: 'cockpit.glb', dir: 'Models', offset: { x: -18, y: 0, z: 0, pitch: 0, roll: 0, heading: 0 }, animations: [] }] }
  const all = assemble(rig, dir)
  assert.deepEqual(all.parts, ['root.xml', 'cockpit.xml'])
  const noDeck = assemble(rig, dir, { exclude: ['cockpit.xml'] })
  assert.deepEqual(noDeck.parts, ['root.xml'])
  assert.equal(noDeck.json.asset.extras.axzRig.parts.length, 1)
  assert.equal(noDeck.json.asset.extras.axzRig.parts[0].animations[0].property, 'x')
  const glb = parseGlb(packGlb(noDeck)); assert.equal(summarize(glb.json).triangles, 1)
})

test('a conditional include becomes a select on its own node, and an airfield-sized light volume is dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'axz-asm3-'))
  writeFileSync(join(dir, 'fuselage.glb'), packGlb(toGltf(parseAc(acText('fus')))))
  writeFileSync(join(dir, 'chute.glb'), packGlb(toGltf(parseAc(acText('canopy')))))
  const huge = acText('cone').replace('0 0 0\n1 0 0\n0 1 0', '0 0 0\n160 0 0\n0 160 0')
  writeFileSync(join(dir, 'cone.glb'), packGlb(toGltf(parseAc(huge))))
  const rig = { id: 't', frame: 'fg', parts: [
    { xml: 'root.xml', ac: 'fuselage.ac', glb: 'fuselage.glb', dir: 'Models', offset: null, animations: [] },
    { xml: 'dragchute.xml', ac: 'chute.ac', glb: 'chute.glb', dir: 'Models', name: 'chute', condition: { op: 'property', name: 'sim/model/f16/chute' }, offset: null, animations: [] },
    { xml: 'light-cone.xml', ac: 'cone.ac', glb: 'cone.glb', dir: 'Models', offset: null, animations: [] }] }
  const r = assemble(rig, dir)
  assert.deepEqual(r.parts, ['root.xml', 'dragchute.xml']); assert.equal(r.dropped.length, 1); assert.match(r.dropped[0], /light-cone/)
  const chute = r.json.asset.extras.axzRig.parts.find(p => p.part === 'dragchute.xml')
  assert.equal(chute.node, 'chute'); assert.equal(chute.animations[0].type, 'select'); assert.deepEqual(chute.animations[0].objects, ['chute'])
  assert.ok(r.json.nodes.some(n => n.name === 'chute' && n.extras && n.extras.part === 'dragchute.xml'))
})
