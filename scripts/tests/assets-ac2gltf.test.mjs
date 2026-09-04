import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAc, buildMesh, toGltf, packGlb } from '../assets/ac2gltf.mjs'
import { parseGlb, summarize } from '../assets/inspect-glb.mjs'

const AC = `AC3Db
MATERIAL "white" rgb 1 1 1  amb 0.2 0.2 0.2  emis 0 0 0  spec 0.5 0.5 0.5  shi 64  trans 0
MATERIAL "glass" rgb 0.2 0.3 0.4  amb 0 0 0  emis 0 0 0  spec 1 1 1  shi 128  trans 0.5
OBJECT world
kids 2
OBJECT group
name "gear"
loc 1 2 3
kids 1
OBJECT poly
name "wheel"
crease 30
numvert 4
0 0 0
1 0 0
1 1 0
0 1 0
numsurf 1
SURF 0x30
mat 0
refs 4
0 0 0
1 1 0
2 1 1
3 0 1
kids 0
OBJECT poly
name "canopy"
texture "missing.png"
numvert 3
0 0 0
1 0 0
0 0 1
numsurf 2
SURF 0x00
mat 1
refs 3
0 0 0
1 1 0
2 0 1
SURF 0x02
mat 1
refs 2
0 0 0
1 1 0
kids 0
`

test('parseAc reads materials, the object tree, names, loc and surfaces', () => {
  const ac = parseAc(AC)
  assert.equal(ac.materials.length, 2); assert.equal(ac.materials[1].trans, 0.5)
  assert.equal(ac.root.type, 'world'); assert.equal(ac.root.kids.length, 2)
  const gear = ac.root.kids[0]; assert.equal(gear.name, 'gear'); assert.deepEqual(gear.loc, [1, 2, 3])
  const wheel = gear.kids[0]; assert.equal(wheel.verts.length, 4); assert.equal(wheel.surfs[0].refs.length, 4); assert.equal(wheel.surfs[0].flags, 0x30)
})

test('buildMesh fan-triangulates polygons, flips V, and drops line surfaces', () => {
  const ac = parseAc(AC)
  const wheel = buildMesh(ac.root.kids[0].kids[0], ac.materials)
  assert.equal(wheel.length, 1); assert.equal(wheel[0].idx.length, 6); assert.equal(wheel[0].twoSided, true)
  assert.equal(wheel[0].uv[3], 1)           // v=0 at the second ref → 1 - 0
  const canopy = buildMesh(ac.root.kids[1], ac.materials)
  assert.equal(canopy.length, 1); assert.equal(canopy[0].idx.length, 3)
})

test('toGltf keeps names and hierarchy, and a missing texture is a warning not a failure', () => {
  const ac = parseAc(AC)
  const g = toGltf(ac, { textureDir: '/nonexistent' })
  const s = summarize(parseGlb(packGlb(g)).json)
  assert.deepEqual(s.nodeNames.sort(), ['canopy', 'gear', 'wheel', 'world'])
  assert.equal(s.triangles, 3); assert.equal(s.uvCoverage, 1); assert.equal(s.normalCoverage, 1)
  assert.equal(g.json.materials.length, 2)
  assert.equal(g.json.materials.find(m => m.doubleSided).name, 'white')
  assert.equal(g.json.materials.find(m => m.alphaMode === 'BLEND').pbrMetallicRoughness.baseColorFactor[3], 0.5)
  const gear = g.json.nodes.find(n => n.name === 'gear'); assert.deepEqual(gear.translation, [1, 2, 3]); assert.equal(gear.children.length, 1)
  assert.match(g.warnings.join('\n'), /missing.png: file not found/)
})
