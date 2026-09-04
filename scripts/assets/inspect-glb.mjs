#!/usr/bin/env node
/* ==========================================================================
   What is inside a GLB, before anyone decides to use it.

   No dependencies: a GLB is a 12-byte header, a JSON chunk and a BIN chunk.
   The JSON says everything a rig needs to know — node names, whether the
   meshes carry UVs, how many triangles, what extensions — so a candidate
   can be judged against the rig contract without Three.js or a browser.
   ========================================================================== */
import { readFileSync } from 'node:fs'

export function parseGlb(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB (magic)')
  const version = dv.getUint32(4, true)
  let off = 12, json = null, bin = null
  while (off < u8.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true)
    const body = u8.subarray(off + 8, off + 8 + len)
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body))
    else if (type === 0x004e4942) bin = body
    off += 8 + len
  }
  if (!json) throw new Error('GLB has no JSON chunk')
  return { version, json, bin }
}

export function summarize(json) {
  const acc = json.accessors || [], meshes = json.meshes || [], nodes = json.nodes || []
  let triangles = 0, primitives = 0, withUv = 0, withNormals = 0
  const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (const m of meshes) for (const p of m.primitives || []) {
    primitives++
    const mode = p.mode == null ? 4 : p.mode
    const pos = acc[p.attributes.POSITION]
    const n = p.indices != null ? acc[p.indices].count : (pos ? pos.count : 0)
    if (mode === 4) triangles += n / 3
    else if (mode === 5 || mode === 6) triangles += Math.max(0, n - 2)
    if (p.attributes.TEXCOORD_0 != null) withUv++
    if (p.attributes.NORMAL != null) withNormals++
    if (pos && pos.min && pos.max) for (let i = 0; i < 3; i++) { bbox.min[i] = Math.min(bbox.min[i], pos.min[i]); bbox.max[i] = Math.max(bbox.max[i], pos.max[i]) }
  }
  const extent = bbox.min[0] === Infinity ? null : bbox.max.map((v, i) => +(v - bbox.min[i]).toFixed(3))
  return {
    generator: json.asset && json.asset.generator, version: json.asset && json.asset.version,
    extensionsUsed: json.extensionsUsed || [],
    nodes: nodes.length, meshes: meshes.length, primitives, triangles: Math.round(triangles),
    uvCoverage: primitives ? +(withUv / primitives).toFixed(2) : 0,
    normalCoverage: primitives ? +(withNormals / primitives).toFixed(2) : 0,
    materials: (json.materials || []).length, textures: (json.textures || []).length, images: (json.images || []).length,
    animations: (json.animations || []).length, skins: (json.skins || []).length,
    extent,                                   // size in the file's own units, x y z
    nodeNames: nodes.map(n => n.name || '').filter(Boolean),
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const file = process.argv[2]
  if (!file) { console.error('usage: node scripts/assets/inspect-glb.mjs <file.glb> [--names]'); process.exit(2) }
  const { version, json } = parseGlb(readFileSync(file))
  const s = summarize(json)
  console.log(`${file}: GLB v${version}, glTF ${s.version} by ${s.generator || 'unknown generator'}`)
  console.log(`  ${s.nodes} nodes, ${s.meshes} meshes, ${s.primitives} primitives, ${s.triangles.toLocaleString()} triangles`)
  console.log(`  UVs on ${Math.round(s.uvCoverage * 100)}% of primitives, normals on ${Math.round(s.normalCoverage * 100)}%`)
  console.log(`  ${s.materials} materials, ${s.textures} textures, ${s.images} images, ${s.animations} animations, ${s.skins} skins`)
  console.log(`  extent ${s.extent ? s.extent.join(' × ') : 'unknown'} (file units)  extensions: ${s.extensionsUsed.join(', ') || 'none'}`)
  if (process.argv.includes('--names')) for (const n of s.nodeNames) console.log(`    ${n}`)
  else console.log(`  named nodes: ${s.nodeNames.length} (pass --names to list)`)
}
