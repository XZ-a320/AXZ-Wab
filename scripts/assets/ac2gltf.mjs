#!/usr/bin/env node
/* ==========================================================================
   AC3D (.ac) → glTF 2.0 binary, with the object names kept.

   FlightGear's aircraft are AC3D files: a flat MATERIAL list, then a tree of
   OBJECTs (world / group / poly) with loc/rot, vertices, and surfaces that
   reference vertices with UVs. The names matter more than anything else —
   FlightGear's animation XML rotates and translates objects BY NAME, and a
   rig that keeps the names can read that XML instead of guessing hinges.

   No dependencies. Textures are embedded as PNG/JPG image bufferViews;
   formats glTF cannot carry (dds, rgb) are noted and left untextured.
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'

/* --- Parse ------------------------------------------------------------- */
export function parseAc(text) {
  const lines = text.split(/\r?\n/)
  let i = 0
  const next = () => lines[i++]
  const peek = () => lines[i]
  const head = next()
  if (!/^AC3D/.test(head || '')) throw new Error('not an AC3D file')
  const materials = []
  const tok = s => { const out = []; const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g; let m; while ((m = re.exec(s))) out.push(m[1] != null ? m[1] : m[2]); return out }
  const num = s => parseFloat(s)
  while (i < lines.length && /^MATERIAL\b/.test(peek() || '')) {
    const t = tok(next())
    const at = k => { const j = t.indexOf(k); return j < 0 ? null : t.slice(j + 1, j + 4).map(num) }
    const sh = t.indexOf('shi'), tr = t.indexOf('trans')
    materials.push({ name: t[1], rgb: at('rgb') || [1, 1, 1], amb: at('amb'), emis: at('emis') || [0, 0, 0], spec: at('spec') || [0, 0, 0], shi: sh < 0 ? 0 : num(t[sh + 1]), trans: tr < 0 ? 0 : num(t[tr + 1]) })
  }
  function object() {
    const t = tok(next())
    if (t[0] !== 'OBJECT') throw new Error(`expected OBJECT at line ${i}, got "${t[0]}"`)
    const o = { type: t[1], name: '', texture: null, texrep: [1, 1], texoff: [0, 0], loc: [0, 0, 0], rot: null, crease: 45, verts: [], surfs: [], kids: [] }
    for (;;) {
      const line = next()
      if (line == null) return o
      const s = tok(line)
      const k = s[0]
      if (k === 'name') o.name = s[1] || ''
      else if (k === 'texture') o.texture = s[1] || null
      else if (k === 'texrep') o.texrep = [num(s[1]), num(s[2])]
      else if (k === 'texoff') o.texoff = [num(s[1]), num(s[2])]
      else if (k === 'crease') o.crease = num(s[1])
      else if (k === 'loc') o.loc = [num(s[1]), num(s[2]), num(s[3])]
      else if (k === 'rot') o.rot = s.slice(1, 10).map(num)
      else if (k === 'numvert') { const n = parseInt(s[1]); for (let v = 0; v < n; v++) { const p = tok(next()); o.verts.push([num(p[0]), num(p[1]), num(p[2])]) } }
      else if (k === 'numsurf') {
        const n = parseInt(s[1])
        for (let f = 0; f < n; f++) {
          const st = tok(next()); const flags = parseInt(st[1], 16)
          const surf = { flags, mat: 0, refs: [] }
          for (;;) {
            const q = tok(peek() || '')
            if (q[0] === 'mat') { surf.mat = parseInt(q[1]); next() }
            else if (q[0] === 'refs') { next(); const r = parseInt(q[1]); for (let j = 0; j < r; j++) { const rr = tok(next()); surf.refs.push([parseInt(rr[0]), num(rr[1]), num(rr[2])]) }; break }
            else break
          }
          o.surfs.push(surf)
        }
      }
      else if (k === 'kids') { const n = parseInt(s[1]); for (let c = 0; c < n; c++) o.kids.push(object()); return o }
      // url, data, subdiv, folded, locked, hidden: ignored
      else if (k === 'data') { const n = parseInt(s[1]); let got = 0; while (got < n && i < lines.length) got += next().length + 1 }
    }
  }
  const root = object()
  return { materials, root }
}

/* --- Geometry ----------------------------------------------------------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l] }

/** One AC3D poly object → primitives grouped by (material, texture, two-sided). */
export function buildMesh(o, materials) {
  const groups = new Map()
  const smoothNormals = new Map()   // vertex index → accumulated normal for smooth surfaces
  for (const s of o.surfs) {
    const type = s.flags & 0xf
    if (type !== 0 || s.refs.length < 3) continue         // lines are not drawn
    const smooth = !!(s.flags & 0x10)
    const p0 = o.verts[s.refs[0][0]], p1 = o.verts[s.refs[1][0]], p2 = o.verts[s.refs[2][0]]
    const fn = norm(cross(sub(p1, p0), sub(p2, p0)))
    if (smooth) for (const [vi] of s.refs) { const a = smoothNormals.get(vi) || [0, 0, 0]; smoothNormals.set(vi, [a[0] + fn[0], a[1] + fn[1], a[2] + fn[2]]) }
  }
  for (const s of o.surfs) {
    const type = s.flags & 0xf
    if (type !== 0 || s.refs.length < 3) continue
    const smooth = !!(s.flags & 0x10), twoSided = !!(s.flags & 0x20)
    const key = `${s.mat}|${o.texture || ''}|${twoSided ? 2 : 1}`
    if (!groups.has(key)) groups.set(key, { mat: s.mat, texture: o.texture, twoSided, pos: [], nor: [], uv: [], idx: [] })
    const g = groups.get(key)
    const p0 = o.verts[s.refs[0][0]], p1 = o.verts[s.refs[1][0]], p2 = o.verts[s.refs[2][0]]
    const fn = norm(cross(sub(p1, p0), sub(p2, p0)))
    const base = g.pos.length / 3
    for (const [vi, u, v] of s.refs) {
      const p = o.verts[vi]; g.pos.push(p[0], p[1], p[2])
      const n = smooth ? norm(smoothNormals.get(vi)) : fn; g.nor.push(n[0], n[1], n[2])
      g.uv.push(u * o.texrep[0] + o.texoff[0], 1 - (v * o.texrep[1] + o.texoff[1]))
    }
    for (let k = 1; k + 1 < s.refs.length; k++) g.idx.push(base, base + k, base + k + 1)   // fan
  }
  return [...groups.values()].filter(g => g.idx.length)
}

function quatFromRot(r) {
  // AC3D rot is a 3×3 matrix, row-major; glTF wants a unit quaternion (x, y, z, w).
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = r
  const tr = m00 + m11 + m22
  let q
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s] }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s] }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s] }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s] }
  const l = Math.hypot(...q) || 1
  return q.map(v => +(v / l).toFixed(7))
}

/* --- glTF assembly -------------------------------------------------------- */
export function toGltf(ac, { textureDir = null, textureRoot = null, generator = 'axz ac2gltf' } = {}) {
  const bin = []; let binLen = 0
  const bufferViews = [], accessors = [], images = [], textures = [], materials = [], meshes = [], nodes = []
  const imageIndex = new Map(), materialIndex = new Map()
  const warnings = []
  const pushView = (buf, target) => { while (binLen % 4) { bin.push(Buffer.alloc(1)); binLen++ } bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: buf.length, ...(target ? { target } : {}) }); bin.push(buf); binLen += buf.length; return bufferViews.length - 1 }
  const pushAccessor = (arr, type, componentType, target, withBounds) => {
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
    const a = { bufferView: pushView(buf, target), componentType, count: arr.length / { SCALAR: 1, VEC2: 2, VEC3: 3 }[type], type }
    if (withBounds) { const n = 3; const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; for (let k = 0; k < arr.length; k += n) for (let c = 0; c < n; c++) { min[c] = Math.min(min[c], arr[k + c]); max[c] = Math.max(max[c], arr[k + c]) } a.min = min; a.max = max }
    accessors.push(a); return accessors.length - 1
  }
  /* FlightGear keeps textures beside the .ac, or at the package's Models/
     root while the .ac sits in a subfolder, or under Textures/. Look in the
     .ac's folder, then each ancestor up to `textureRoot`, then Textures/. */
  const dirsFor = () => {
    const out = []
    if (textureDir) { let d = textureDir; for (let k = 0; k < 6; k++) { out.push(d, join(d, 'Textures')); if (!textureRoot || d === textureRoot) break; const up = dirname(d); if (up === d) break; d = up } }
    return out
  }
  const imageFor = tex => {
    if (!tex) return null
    if (imageIndex.has(tex)) return imageIndex.get(tex)
    const ext = tex.toLowerCase().split('.').pop()
    const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : null
    const path = mime ? dirsFor().map(d => join(d, tex)).find(existsSync) : null
    if (!mime || !path) { warnings.push(`texture ${tex}: ${!mime ? 'format not embeddable' : 'file not found'}`); imageIndex.set(tex, null); return null }
    images.push({ mimeType: mime, bufferView: pushView(readFileSync(path)), name: basename(tex) })
    textures.push({ source: images.length - 1, sampler: 0 })
    imageIndex.set(tex, textures.length - 1); return textures.length - 1
  }
  const materialFor = (matIdx, tex, twoSided) => {
    const key = `${matIdx}|${tex || ''}|${twoSided}`
    if (materialIndex.has(key)) return materialIndex.get(key)
    const m = ac.materials[matIdx] || ac.materials[0] || { rgb: [1, 1, 1], emis: [0, 0, 0], shi: 0, trans: 0, name: 'default' }
    const t = imageFor(tex)
    const mat = {
      name: `${m.name || 'mat'}${tex ? '·' + basename(tex) : ''}`,
      pbrMetallicRoughness: { baseColorFactor: [...(t ? [1, 1, 1] : m.rgb), 1 - (m.trans || 0)], metallicFactor: 0, roughnessFactor: +(1 - Math.min(1, (m.shi || 0) / 128)).toFixed(3), ...(t != null ? { baseColorTexture: { index: t } } : {}) },
      emissiveFactor: m.emis.map(v => Math.min(1, v)),
      ...(twoSided ? { doubleSided: true } : {}),
      ...(m.trans > 0 ? { alphaMode: 'BLEND' } : {}),
    }
    materials.push(mat); materialIndex.set(key, materials.length - 1); return materials.length - 1
  }
  const stats = { objects: 0, triangles: 0, vertices: 0 }
  function node(o) {
    const n = { name: o.name || o.type }
    if (o.loc.some(v => v !== 0)) n.translation = o.loc
    if (o.rot) { const q = quatFromRot(o.rot); if (Math.abs(q[3] - 1) > 1e-6) n.rotation = q }
    if (o.type === 'poly' && o.verts.length) {
      const prims = buildMesh(o, ac.materials)
      if (prims.length) {
        const primitives = prims.map(g => {
          const pos = new Float32Array(g.pos), nor = new Float32Array(g.nor), uv = new Float32Array(g.uv)
          const big = g.pos.length / 3 > 65535
          const idx = big ? new Uint32Array(g.idx) : new Uint16Array(g.idx)
          stats.triangles += g.idx.length / 3; stats.vertices += g.pos.length / 3
          return { attributes: { POSITION: pushAccessor(pos, 'VEC3', 5126, 34962, true), NORMAL: pushAccessor(nor, 'VEC3', 5126, 34962), TEXCOORD_0: pushAccessor(uv, 'VEC2', 5126, 34962) }, indices: pushAccessor(idx, 'SCALAR', big ? 5125 : 5123, 34963), material: materialFor(g.mat, g.texture, g.twoSided) }
        })
        meshes.push({ name: n.name, primitives }); n.mesh = meshes.length - 1; stats.objects++
      }
    }
    const kids = o.kids.map(node)
    if (kids.length) n.children = kids
    nodes.push(n); return nodes.length - 1
  }
  const rootIdx = node(ac.root)
  const json = {
    asset: { version: '2.0', generator }, scene: 0, scenes: [{ nodes: [rootIdx] }], nodes, meshes, materials,
    ...(textures.length ? { textures, images, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] } : {}),
    accessors, bufferViews, buffers: [{ byteLength: 0 }],
  }
  const binBuf = Buffer.concat(bin)
  json.buffers[0].byteLength = binBuf.length
  return { json, bin: binBuf, stats, warnings }
}

export function packGlb({ json, bin }) {
  let js = Buffer.from(JSON.stringify(json)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')])
  let bb = bin; while (bb.length % 4) bb = Buffer.concat([bb, Buffer.alloc(1)])
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bb.length, 8)
  const c0 = Buffer.alloc(8); c0.writeUInt32LE(js.length, 0); c0.writeUInt32LE(0x4e4f534a, 4)
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(bb.length, 0); c1.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([head, c0, js, c1, bb])
}

export function convert(acPath, outPath, opts = {}) {
  const ac = parseAc(readFileSync(acPath, 'utf8'))
  const g = toGltf(ac, { textureDir: dirname(acPath), textureRoot: opts.textureRoot || null, ...opts })
  const glb = packGlb(g)
  writeFileSync(outPath, glb)
  return { bytes: glb.length, ...g.stats, warnings: g.warnings, materials: g.json.materials.length, textures: (g.json.textures || []).length }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const rootArg = process.argv.find(a => a.startsWith('--texture-root='))
  const [inp, out] = args
  if (!inp) { console.error('usage: node scripts/assets/ac2gltf.mjs <model.ac> [out.glb] [--texture-root=<dir>]'); process.exit(2) }
  const o = out || inp.replace(/\.ac$/i, '.glb')
  const r = convert(inp, o, rootArg ? { textureRoot: rootArg.slice(15) } : {})
  console.log(`✓ ${basename(inp)} → ${basename(o)}: ${r.objects} objects, ${r.triangles.toLocaleString()} triangles, ${r.materials} materials, ${r.textures} textures, ${(r.bytes / 1048576).toFixed(2)} MB`)
  for (const w of r.warnings) console.log(`  ! ${w}`)
}
