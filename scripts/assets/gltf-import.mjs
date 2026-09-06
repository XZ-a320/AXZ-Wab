#!/usr/bin/env node
/* ==========================================================================
   A Sketchfab glTF archive → one GLB in FlightGear's frame at published size.

   Sketchfab exports are arbitrary in scale, axes and pose. The published
   length fixes the scale; the shape fixes the axes: height is the smallest
   extent, the longest-against-span ratio picks length from span, the fin
   (the wider slice) marks the tail. Before any of that, flat backdrop
   sheets and named props are dropped and a plan yaw is removed, because a
   model posed at 56° with a sky quad behind it measures as nothing real.
   Names, extras and materials pass through untouched; the compressor runs
   afterwards as for every other model.

     node scripts/assets/gltf-import.mjs <scene.gltf> <out.glb> --len=<m> --span=<m> [--exclude=a,b]
     node scripts/assets/gltf-import.mjs --id=<manifest row>   (run inside axz-assets; reads row.import)
   ========================================================================== */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune } from '@gltf-transform/functions'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { neutralise } from './neutralise-livery.mjs'

const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o }
const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]

/** World-space bounds per mesh node, plus a sampled point cloud of the whole scene. */
export function measure(doc, { perNode = false } = {}) {
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
  const pts = [], nodes = []
  const walk = (node, parent) => {
    const m = mul(parent, node.getMatrix())
    const mesh = node.getMesh()
    if (mesh) {
      const nmn = [Infinity, Infinity, Infinity], nmx = [-Infinity, -Infinity, -Infinity]
      for (const prim of mesh.listPrimitives()) {
        const a = prim.getAttribute('POSITION'); if (!a) continue
        const step = perNode ? 1 : Math.max(1, Math.floor(a.getCount() / 4000))
        for (let i = 0; i < a.getCount(); i += step) {
          const p = xf(m, a.getElement(i, []))
          if (!perNode || i % 8 === 0) pts.push(p)
          for (let k = 0; k < 3; k++) { nmn[k] = Math.min(nmn[k], p[k]); nmx[k] = Math.max(nmx[k], p[k]); mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]) }
        }
      }
      nodes.push({ node, mn: nmn, mx: nmx, ext: nmx.map((v, i) => v - nmn[i]) })
    }
    for (const c of node.listChildren()) walk(c, m)
  }
  for (const n of scene.listChildren()) walk(n, ident())
  return { mn, mx, ext: mx.map((v, i) => v - mn[i]), pts, nodes }
}

/** Drop named props and backdrop sheets: a mesh that is flat (thinnest extent under
    0.5% of its widest) and at least 80% of the scene's widest extent is scenery,
    not airframe. Returns the names dropped. */
export function dropScenery(doc, { exclude = [] } = {}) {
  const meas = measure(doc, { perNode: true })
  const sceneMax = Math.max(...meas.ext)
  const dropped = []
  for (const { node, ext } of meas.nodes) {
    const name = node.getName()
    const flat = Math.min(...ext) < 0.005 * Math.max(...ext) && Math.max(...ext) >= 0.8 * sceneMax
    if (exclude.includes(name) || flat) { dropped.push(`${name}${flat ? ' (backdrop)' : ''}`); node.setMesh(null); node.dispose() }
  }
  return dropped
}

/** Plan yaw from a two-axis principal-component fit in the plane orthogonal to the
    height axis, reduced to (−45°, 45°]. Symmetric airframes have their length and
    span axes as principal directions exactly. */
export function planYaw(meas, H) {
  const [u, v] = [0, 1, 2].filter(a => a !== H)
  const c = [0, 0, 0]; for (const p of meas.pts) for (let k = 0; k < 3; k++) c[k] += p[k] / meas.pts.length
  let suu = 0, svv = 0, suv = 0
  for (const p of meas.pts) { const a = p[u] - c[u], b = p[v] - c[v]; suu += a * a; svv += b * b; suv += a * b }
  let th = 0.5 * Math.atan2(2 * suv, suu - svv)
  while (th > Math.PI / 4) th -= Math.PI / 2
  while (th <= -Math.PI / 4) th += Math.PI / 2
  return { u, v, theta: th }
}

/** Column-major matrix rotating the (u,v) plane by −theta: out_u = c·u + s·v, out_v = −s·u + c·v. */
function deYaw(u, v, H, theta) {
  const c = Math.cos(theta), s = Math.sin(theta), m = new Array(16).fill(0)
  m[u * 4 + u] = c; m[v * 4 + u] = s; m[u * 4 + v] = -s; m[v * 4 + v] = c; m[H * 4 + H] = 1; m[15] = 1
  return m
}

/** Decide which source axis is length and which is span, and which way is aft.
    Height is the smallest extent (Z-up exporters exist). Of the other two, the pair
    assignment whose extent ratio best matches the published length/span is
    taken (a B-2 is wider than it is long). Aft is the end whose slice
    spreads further across the span: tailplanes, fins, or a flying wing's
    trailing edge, against a nose or an apex. */
export function orient(meas, { len, span }) {
  const { ext, pts, mn, mx } = meas
  const H = [0, 1, 2].sort((a, b) => ext[a] - ext[b])[0]
  const others = [0, 1, 2].filter(a => a !== H)
  /* Length against span: an airframe mirrors across its length axis, so the
     two end slices along the span axis are the same wingtip twice, while the
     two along the length axis are a nose and a tail. The axis whose end
     slices differ most is the length; the published ratio only breaks a tie
     (a model with no wings, or with end slices that happen to match). */
  const spreadAlong = (s, a) => { let lo = Infinity, hi = -Infinity; for (const p of s) { lo = Math.min(lo, p[a]); hi = Math.max(hi, p[a]) } return hi - lo }
  const ends = (A, B) => { const q = ext[A] / 6; const head = pts.filter(p => p[A] < mn[A] + q), tail = pts.filter(p => p[A] > mx[A] - q); return { head, tail, asym: Math.abs(head.length - tail.length) / Math.max(head.length, tail.length, 1) + Math.abs(spreadAlong(head, B) - spreadAlong(tail, B)) / Math.max(spreadAlong(head, B), spreadAlong(tail, B), 1e-9) } }
  const cands = [[others[0], others[1]], [others[1], others[0]]].map(([L, S]) => ({ L, S, ...ends(L, S), ratioErr: Math.abs(Math.log((ext[L] / ext[S]) / (len / span))) }))
  const bySym = [...cands].sort((a, b) => b.asym - a.asym)
  const pick = bySym[0].asym - bySym[1].asym > 0.05 ? bySym[0] : [...cands].sort((a, b) => a.ratioErr - b.ratioErr)[0]
  const { L, S, head: headSlice, tail: tailSlice } = pick
  const spreadS = s => spreadAlong(s, S)
  const tailAtMax = spreadS(tailSlice) >= spreadS(headSlice)
  const sx = tailAtMax ? 1 : -1
  /* Up is the side the fin is on: the tail slice reaches further from the
     airframe's own level on the fin's side. A flying wing has no fin, so
     when the tail slice is even the whole cloud decides by its hump. */
  const tail = tailAtMax ? tailSlice : headSlice
  /* The airframe's own level is the median height, which the fuselage and
     wing dominate; the box's mid-height would sit halfway up the fin and
     make a fin above and a fin below look alike. */
  const hs = pts.map(p => p[H]).sort((a, b) => a - b)
  const midH = hs[hs.length >> 1]
  const exc = s => { let up = 0, dn = 0; for (const p of s) { up = Math.max(up, p[H] - midH); dn = Math.max(dn, midH - p[H]) } return { up, dn, ratio: up / (dn || 1e-9) } }
  const tailExc = exc(tail)
  const hasFin = tailExc.up + tailExc.dn > 0.15 * ext[H]      // a flat tail slice is outer wing, not a fin
  const finRatio = hasFin ? tailExc.ratio : 1
  const sz = finRatio > 1.25 ? 1 : finRatio < 0.8 ? -1 : (exc(pts).ratio >= 1 ? 1 : -1)
  const row = (axis, sign) => { const r = [0, 0, 0]; r[axis] = sign; return r }
  let X = row(L, sx), Z = row(H, sz), Y = row(S, 1)
  const det = X[0] * (Y[1] * Z[2] - Y[2] * Z[1]) - X[1] * (Y[0] * Z[2] - Y[2] * Z[0]) + X[2] * (Y[0] * Z[1] - Y[1] * Z[0])
  if (det < 0) Y = row(S, -1)
  return { L, S, H, sx, sz, finRatio: +finRatio.toFixed(2), asym: cands.map(c => +c.asym.toFixed(2)), rows: [X, Y, Z], lengthExt: ext[L], spanExt: ext[S], heightExt: ext[H], ratioErr: pick.ratioErr }
}

/** Livery neutralisation on the model itself, recorded on the manifest row as
    `import.neutralise`: `materials` recolours saturated textureless base colours
    to `fill` (a Wizz Air pink fuselage becomes white paint), `textures` paints
    saturated marks out of every base-colour texture with the same rule the PNG
    tool uses (`dark` paints dark unsaturated pixels too, for skins whose
    windows are geometry), `opaque` names blended materials that are skin, not glass. */
export async function neutraliseModel(doc, { materials = false, textures = false, sat = 0.28, dark = 0, fill = [1, 1, 1], opaque = [] } = {}) {
  const root = doc.getRoot(), log = []
  if (materials) for (const m of root.listMaterials()) {
    if (m.getBaseColorTexture()) continue
    const [r, g, b, a] = m.getBaseColorFactor(); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const s = mx ? (mx - mn) / mx : 0
    if (s > 0.35 && mx > 0.3 && a >= 0.99) { m.setBaseColorFactor([fill[0], fill[1], fill[2], a]); log.push(`material ${m.getName()} (${[r, g, b].map(v => v.toFixed(2)).join(',')}) → paint`) }
  }
  if (textures) for (const t of root.listTextures()) {
    if (!root.listMaterials().some(m => m.getBaseColorTexture() === t)) continue
    const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const res = neutralise({ width: info.width, height: info.height, rgba: data, hadAlpha: true }, { sat })
    /* `dark`: titles and outlines are dark and unsaturated, which the paint
       rule spares on purpose (window lines, panel lines). A skin whose
       windows are geometry can afford to lose its dark pixels too; a metal
       or engine texture, mostly dark, keeps them. */
    const bright = (() => { let n = 0, b = 0; for (let i = 0; i < data.length; i += 4 * 61) { n++; if (Math.max(data[i], data[i + 1], data[i + 2]) > 150) b++ } return b / n })()
    if (dark > 0 && bright > 0.5) { const o = res.img.rgba, f = res.fill; for (let i = 0; i < o.length; i += 4) { const mx = Math.max(o[i], o[i + 1], o[i + 2]); if (mx < dark) { const k = Math.min(1, (dark - mx) / 40); o[i] += (f[0] - o[i]) * k; o[i + 1] += (f[1] - o[i + 1]) * k; o[i + 2] += (f[2] - o[i + 2]) * k; res.changed++ } } }
    const share = res.changed / (info.width * info.height)
    if (share < 0.0005) continue
    const png = await sharp(res.img.rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
    t.setImage(png).setMimeType('image/png')
    log.push(`texture ${t.getName() || info.width + 'x' + info.height}: ${(100 * share).toFixed(1)}% painted`)
  }
  for (const m of root.listMaterials()) if (opaque.includes(m.getName())) { const c = m.getBaseColorFactor(); m.setBaseColorFactor([c[0], c[1], c[2], 1]).setAlphaMode('OPAQUE'); log.push(`material ${m.getName()} → opaque`) }
  return log
}

export async function importGltf(src, out, { len, span = null, exclude = [], neutralise: neut = null }) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  const doc = await io.read(src)
  const dropped = dropScenery(doc, { exclude })
  const painted = neut ? await neutraliseModel(doc, neut) : []
  await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: false }))
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]

  // 1. Pose: take any plan yaw out on an inner node, so the axis choice below sees an aligned airframe.
  let meas = measure(doc)
  const H0 = [0, 1, 2].sort((a, b) => meas.ext[a] - meas.ext[b])[0]
  const yaw = planYaw(meas, H0)
  const yawDeg = +(yaw.theta * 180 / Math.PI).toFixed(1)
  const inner = doc.createNode('sketchfab:pose')
  if (Math.abs(yawDeg) > 1.5) inner.setMatrix(deYaw(yaw.u, yaw.v, H0, yaw.theta))
  for (const c of scene.listChildren()) { scene.removeChild(c); inner.addChild(c) }

  // 2. Axes and scale on the root; the model's own nodes are untouched.
  scene.addChild(inner); meas = measure(doc); scene.removeChild(inner)
  const o = orient(meas, { len, span: span || len * 0.9 })
  const scale = len / o.lengthExt
  const R = o.rows
  const M = [R[0][0] * scale, R[1][0] * scale, R[2][0] * scale, 0, R[0][1] * scale, R[1][1] * scale, R[2][1] * scale, 0, R[0][2] * scale, R[1][2] * scale, R[2][2] * scale, 0, 0, 0, 0, 1]
  const root = doc.createNode('part:sketchfab').setMatrix(M).addChild(inner)
  scene.addChild(root)
  root.setExtras({ part: 'sketchfab', frame: 'FlightGear: x aft, y starboard, z up', scale, yawDeg, finRatio: o.finRatio, dropped, painted, sourceAxes: { length: o.L, span: o.S, height: o.H } })

  // 3. Recentre: the tail-most point at +len/2 keeps the nose ahead of the origin, like FlightGear's models.
  const after = measure(doc)
  root.setTranslation([-(after.mn[0] + after.mx[0]) / 2, -(after.mn[1] + after.mx[1]) / 2, -after.mn[2] - (after.mx[2] - after.mn[2]) * 0.25])
  const finalM = measure(doc)
  mkdirSync(dirname(out), { recursive: true })
  const glb = await io.writeBinary(doc)
  writeFileSync(out, glb)
  const names = doc.getRoot().listNodes().map(n => n.getName()).filter(Boolean)
  const tris = doc.getRoot().listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices() ? p.getIndices().getCount() / 3 : p.getAttribute('POSITION').getCount() / 3), 0), 0)
  const uv = doc.getRoot().listMeshes().every(m => m.listPrimitives().every(p => !!p.getAttribute('TEXCOORD_0')))
  return { bytes: glb.length, scale, yawDeg, finRatio: o.finRatio, asym: o.asym, axes: [o.L, o.S, o.H], dropped, painted, ext: finalM.ext.map(v => +v.toFixed(2)), nodes: names.length, triangles: Math.round(tris), textures: doc.getRoot().listTextures().length, uv, wheelNames: names.filter(n => /tyre|tire|wheel|rim|gear/i.test(n)).slice(0, 12), spanCheck: span ? +(finalM.ext[1] / span).toFixed(3) : null, heightCheck: +(finalM.ext[2]).toFixed(2) }
}

/** Find a manifest row by id in ./manifests/*.json (the axz-assets repo root). */
export function manifestRow(id, repo = process.cwd()) {
  const dir = join(repo, 'manifests')
  if (!existsSync(dir)) throw new Error(`no manifests/ under ${repo}; run inside axz-assets`)
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const m = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    const row = (m.rows || m.assets || []).find(r => r.id === id)
    if (row) return { row, file: join(dir, f) }
  }
  throw new Error(`no manifest row ${id}`)
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const opt = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : undefined }
  let src, out, len, span, exclude = [], neutralise = null
  if (opt('id')) {
    const { row } = manifestRow(opt('id'))
    if (!row.import) { console.error(`${row.id}: no import block (len, span, exclude?) on the manifest row`); process.exit(2) }
    src = join('raw', dirname(row.fetch.expect), 'source', 'scene.gltf'); out = join('derived', row.file.replace(/\.glb$/, '.raw.glb'))
    ;({ len, span, exclude = [], neutralise = null } = row.import)
  } else {
    ;[src, out] = args; len = +opt('len'); span = +opt('span'); exclude = (opt('exclude') || '').split(',').filter(Boolean)
  }
  if (!src || !out || !len || !span) { console.error('usage: node scripts/assets/gltf-import.mjs <scene.gltf> <out.glb> --len=<m> --span=<m> [--exclude=a,b]   |   --id=<row>'); process.exit(2) }
  const r = await importGltf(src, out, { len, span, exclude, neutralise })
  console.log(`✓ ${out.split('/').pop()}: ${r.triangles.toLocaleString()} tris, ${r.nodes} nodes, ${r.textures} textures, uv ${r.uv}, extent ${r.ext.join(' × ')} m (span/published ${r.spanCheck}, yaw ${r.yawDeg}°, fin ${r.finRatio}, axes LSH ${r.axes.join('')} asym ${r.asym.join('/')}), ${(r.bytes / 1048576).toFixed(1)} MB`)
  if (r.dropped.length) console.log(`  dropped: ${r.dropped.join(', ')}`)
  if (r.painted.length) console.log(`  painted: ${r.painted.join('; ')}`)
  if (r.wheelNames.length) console.log(`  wheel-ish names: ${r.wheelNames.join(', ')}`)
}
