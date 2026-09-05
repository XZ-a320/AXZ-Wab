import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseAc, toGltf, packGlb } from '../assets/ac2gltf.mjs'
import { parseGlb, summarize } from '../assets/inspect-glb.mjs'
import { probePng } from '../assets/make-probe.mjs'
import { compressGlb } from '../assets/compress.mjs'

const AC = `AC3Db
MATERIAL "m" rgb 1 1 1  amb 1 1 1  emis 0 0 0  spec 0 0 0  shi 0  trans 0
OBJECT world
kids 2
OBJECT group
name "gearL"
kids 1
OBJECT poly
name "wheel"
texture "skin.png"
numvert 4
0 0 0
1 0 0
1 1 0
0 1 0
numsurf 1
SURF 0x10
mat 0
refs 4
0 0 0
1 1 0
2 1 1
3 0 1
kids 0
OBJECT poly
name "flapL"
numvert 3
0 0 0
2 0 0
0 2 0
numsurf 1
SURF 0x10
mat 0
refs 3
0 0 0
1 1 0
2 0 1
kids 0
`

test('compressGlb keeps every node name and asset.extras, and adds Draco and WebP', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'axz-cmp-'))
  writeFileSync(join(dir, 'skin.png'), probePng(256))
  const g = toGltf(parseAc(AC), { textureDir: dir })
  g.json.asset.extras = { axzRig: { id: 't', parts: [{ part: 'x', animations: [{ type: 'rotate', objects: ['flapL'], property: 'controls/flight/flaps', axis: [0, 1, 0] }] }] } }
  const before = packGlb(g)
  const r = await compressGlb(before, { max: 128 })
  assert.ok(r.after < r.before, `expected smaller: ${r.after} vs ${r.before}`)
  const { json } = parseGlb(r.glb)
  const s = summarize(json)
  assert.deepEqual(s.nodeNames.sort(), ['flapL', 'gearL', 'wheel', 'world'])
  assert.equal(json.asset.extras.axzRig.parts[0].animations[0].objects[0], 'flapL')
  assert.ok(json.extensionsUsed.includes('KHR_draco_mesh_compression'))
  assert.ok(json.extensionsUsed.includes('EXT_texture_webp'))
  assert.equal(json.images[0].mimeType, 'image/webp')
})
