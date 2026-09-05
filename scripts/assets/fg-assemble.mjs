#!/usr/bin/env node
/* ==========================================================================
   Part GLBs + a rig → one GLB for one aircraft, in FlightGear's frame.

   Each converted .ac is in AC3D coordinates; FlightGear's animation XML
   speaks in the model frame (x aft, y starboard, z up). Every part gets a
   node that turns AC3D into that frame and carries the part's <offsets>, so
   the animation centres and axes in the embedded rig apply to the assembled
   file directly, with no conversion left for the runtime.

   Images that repeat across parts (fuselage.png embedded three times) are
   kept once. The rig goes into asset.extras.axzRig: one file, one fetch.
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { parseGlb } from './inspect-glb.mjs'
import { packGlb } from './ac2gltf.mjs'

/* AC3D (x, y, z) → FlightGear (x, −z, y): a rotation of +90° about x
   (R_x(90°) sends (x, y, z) to (x, −z, y)). Quaternion (sin 45°, 0, 0, cos 45°).
   The sign was measured wrong once and buried a 737 in the runway. */
export const AC_TO_FG = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]

const deg = d => d * Math.PI / 180
function quatMul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]
}
const quatAxis = (axis, rad) => { const s = Math.sin(rad / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)] }

/** FlightGear <offsets>: heading about z, pitch about y, roll about x, then translate. */
export function offsetQuat(off) {
  if (!off) return [0, 0, 0, 1]
  let q = [0, 0, 0, 1]
  if (off.heading) q = quatMul(quatAxis([0, 0, 1], deg(-off.heading)), q)   // FG heading is clockwise seen from above (z up)
  if (off.pitch) q = quatMul(quatAxis([0, 1, 0], deg(-off.pitch)), q)         // nose up = negative rotation about +y (starboard)
  if (off.roll) q = quatMul(quatAxis([1, 0, 0], deg(off.roll)), q)
  return q.map(v => +v.toFixed(7))
}

/** Merge several parsed GLBs into one document; returns { json, bin }. */
export function mergeGlbs(parts) {
  const out = { asset: { version: '2.0', generator: 'axz fg-assemble' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }] }
  const chunks = []; let binLen = 0
  const imageByHash = new Map()
  const addView = (bytes, target) => { while (binLen % 4) { chunks.push(Buffer.alloc(1)); binLen++ } out.bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: bytes.length, ...(target ? { target } : {}) }); chunks.push(bytes); binLen += bytes.length; return out.bufferViews.length - 1 }
  for (const part of parts) {
    const { json, bin } = part.glb
    const viewMap = new Map(), imgMap = new Map(), texMap = new Map(), matMap = new Map(), accMap = new Map()
    const viewOf = i => {
      if (viewMap.has(i)) return viewMap.get(i)
      const v = json.bufferViews[i]
      const bytes = Buffer.from(bin.buffer, bin.byteOffset + (v.byteOffset || 0), v.byteLength)
      const idx = addView(bytes, v.target); viewMap.set(i, idx); return idx
    }
    const imageOf = i => {
      if (imgMap.has(i)) return imgMap.get(i)
      const im = json.images[i]
      const v = json.bufferViews[im.bufferView]
      const bytes = Buffer.from(bin.buffer, bin.byteOffset + (v.byteOffset || 0), v.byteLength)
      const h = createHash('sha256').update(bytes).digest('hex')
      if (!imageByHash.has(h)) { out.images.push({ mimeType: im.mimeType, bufferView: addView(bytes), name: im.name }); imageByHash.set(h, out.images.length - 1) }
      imgMap.set(i, imageByHash.get(h)); return imageByHash.get(h)
    }
    const textureOf = i => {
      if (texMap.has(i)) return texMap.get(i)
      const t = json.textures[i]
      const src = imageOf(t.source)
      let idx = out.textures.findIndex(x => x.source === src)
      if (idx < 0) { out.textures.push({ source: src, sampler: 0 }); idx = out.textures.length - 1 }
      texMap.set(i, idx); return idx
    }
    const materialOf = i => {
      if (matMap.has(i)) return matMap.get(i)
      const m = JSON.parse(JSON.stringify(json.materials[i]))
      if (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture) m.pbrMetallicRoughness.baseColorTexture.index = textureOf(m.pbrMetallicRoughness.baseColorTexture.index)
      out.materials.push(m); matMap.set(i, out.materials.length - 1); return out.materials.length - 1
    }
    const accessorOf = i => {
      if (accMap.has(i)) return accMap.get(i)
      const a = { ...json.accessors[i], bufferView: viewOf(json.accessors[i].bufferView) }
      out.accessors.push(a); accMap.set(i, out.accessors.length - 1); return out.accessors.length - 1
    }
    const meshBase = out.meshes.length
    for (const m of json.meshes) out.meshes.push({ name: m.name, primitives: m.primitives.map(p => ({ attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, v]) => [k, accessorOf(v)])), ...(p.indices != null ? { indices: accessorOf(p.indices) } : {}), ...(p.material != null ? { material: materialOf(p.material) } : {}) })) })
    const nodeBase = out.nodes.length
    for (const n of json.nodes) out.nodes.push({ ...n, ...(n.mesh != null ? { mesh: meshBase + n.mesh } : {}), ...(n.children ? { children: n.children.map(c => nodeBase + c) } : {}) })
    // The part node: AC3D → FlightGear frame, then the package's <offsets>.
    const off = part.offset || null
    const q = quatMul(offsetQuat(off), AC_TO_FG)
    const partNode = { name: part.nodeName || `part:${part.name}`, rotation: q, children: json.scenes[json.scene || 0].nodes.map(c => nodeBase + c), extras: { part: part.name, xml: part.xml || null, ac: part.ac || null } }
    if (off && (off.x || off.y || off.z)) partNode.translation = [off.x, off.y, off.z]
    out.nodes.push(partNode)
    out.scenes[0].nodes.push(out.nodes.length - 1)
  }
  if (!out.textures.length) { delete out.textures; delete out.images; delete out.samplers }
  const bin = Buffer.concat(chunks)
  out.buffers[0].byteLength = bin.length
  return { json: out, bin }
}

/** Local extent of a parsed part GLB, for spotting light volumes and other junk. */
function partExtent(glb) {
  const { json } = glb
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  for (const a of json.accessors) if (a.min && a.type === 'VEC3' && a.max) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a.min[i]); mx[i] = Math.max(mx[i], a.max[i]) }
  return mn[0] === Infinity ? 0 : Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2])
}

export function assemble(rig, glbDir, { include = null, exclude = [] } = {}) {
  const parts = []
  const dropped = []
  for (const p of rig.parts) {
    if (!p.glb) continue
    if (include && !include.includes(p.xml || p.ac)) continue
    if (exclude.some(x => (p.xml || '') === x || (p.ac || '') === x || (p.dir || '').split('/').includes(x))) continue
    const file = [join(glbDir, p.dir || '', p.glb), join(glbDir, p.glb)].find(existsSync)
    if (!file) continue
    const glb = parseGlb(readFileSync(file))
    parts.push({ name: p.xml || p.ac, nodeName: p.name || null, xml: p.xml, ac: p.ac, offset: p.offset, condition: p.condition || null, glb, extent: partExtent(glb) })
  }
  /* A light volume the size of an airfield is not an aeroplane part. Anything
     more than 2.5× the largest real part is dropped and reported. */
  const first = parts[0] ? parts[0].extent : 0
  const body = Math.max(first, ...parts.filter(p => !/light|strobe|beacon|cone|flash/i.test(p.name)).map(p => p.extent))
  const kept = parts.filter(p => { const ok = !(body > 0 && p.extent > body * 2.5); if (!ok) dropped.push(`${p.name} (${p.extent.toFixed(0)} m across, airframe ${body.toFixed(0)} m)`); return ok })
  const merged = mergeGlbs(kept)
  const rigParts = rig.parts.filter(p => kept.some(q => q.name === (p.xml || p.ac))).map(p => {
    const animations = [...p.animations]
    // A conditional include becomes a select on its own node, so the runtime can hide it exactly as FlightGear would.
    if (p.condition) animations.unshift({ type: 'select', objects: [p.name || `part:${p.xml || p.ac}`], condition: p.condition })
    return { part: p.xml || p.ac, node: p.name || `part:${p.xml || p.ac}`, animations }
  })
  merged.json.asset.extras = { axzRig: { id: rig.id, frame: rig.frame, parts: rigParts } }
  return { ...merged, parts: kept.map(p => p.name), dropped }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const [rigPath, glbDir, out] = args
  if (!rigPath || !glbDir || !out) { console.error('usage: node scripts/assets/fg-assemble.mjs <rig.json> <glbDir> <out.glb> [--exclude=a.xml,b.xml,DirName]'); process.exit(2) }
  const ex = process.argv.find(a => a.startsWith('--exclude='))
  const rig = JSON.parse(readFileSync(rigPath, 'utf8'))
  const r = assemble(rig, glbDir, { exclude: ex ? ex.slice(10).split(',') : [] })
  const glb = packGlb(r)
  writeFileSync(out, glb)
  const tri = r.json.accessors.filter((a, i) => r.json.meshes.some(m => m.primitives.some(p => p.indices === i))).reduce((n, a) => n + a.count / 3, 0)
  console.log(`✓ ${basename(out)}: ${r.parts.length} parts, ${r.json.nodes.length} nodes, ${Math.round(tri).toLocaleString()} triangles, ${(r.json.images || []).length} images, ${r.json.asset.extras.axzRig.parts.reduce((n, p) => n + p.animations.length, 0)} animations, ${(glb.length / 1048576).toFixed(2)} MB`)
  console.log(`  parts: ${r.parts.join(', ')}`)
}
