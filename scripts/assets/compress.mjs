#!/usr/bin/env node
/* ==========================================================================
   Make a published GLB small without changing what it is.

   Geometry: weld, then Draco (KHR_draco_mesh_compression). Textures: WebP
   (EXT_texture_webp) capped at 2048 px. Nothing that would merge, flatten,
   simplify or instance: the rig addresses nodes by name and the names,
   the hierarchy and the extras must come out exactly as they went in.
   Three.js reads both extensions with the Draco decoder from our origin.

     node scripts/assets/compress.mjs in.glb [out.glb] [--max=2048] [--quality=82]
   ========================================================================== */
import { readFileSync, writeFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune, weld, draco, textureCompress } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import sharp from 'sharp'

let io = null
async function getIO() {
  if (io) return io
  io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  })
  return io
}

/** Compress a GLB buffer; returns { glb, before, after, textures, nodes }. */
export async function compressGlb(buf, { max = 2048, quality = 82 } = {}) {
  const io = await getIO()
  const doc = await io.readBinary(new Uint8Array(buf))
  const namesBefore = doc.getRoot().listNodes().map(n => n.getName())
  const extrasBefore = JSON.stringify(doc.getRoot().getAsset().extras || null)
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true, keepLeaves: true }),
    weld(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [max, max], quality }),
    draco({ method: 'edgebreaker', quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  )
  const namesAfter = doc.getRoot().listNodes().map(n => n.getName())
  if (namesAfter.length !== namesBefore.length || namesAfter.some((n, i) => n !== namesBefore[i])) throw new Error('compression changed the node list; refusing')
  if (JSON.stringify(doc.getRoot().getAsset().extras || null) !== extrasBefore) throw new Error('compression changed asset.extras; refusing')
  const glb = Buffer.from(await io.writeBinary(doc))
  return { glb, before: buf.length, after: glb.length, textures: doc.getRoot().listTextures().length, nodes: namesAfter.length }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const [inp, out] = args
  if (!inp) { console.error('usage: node scripts/assets/compress.mjs in.glb [out.glb] [--max=2048] [--quality=82]'); process.exit(2) }
  const opt = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? +a.split('=')[1] : undefined }
  const r = await compressGlb(readFileSync(inp), { max: opt('max'), quality: opt('quality') })
  writeFileSync(out || inp, r.glb)
  console.log(`✓ ${inp.split('/').pop()}: ${(r.before / 1048576).toFixed(2)} MB → ${(r.after / 1048576).toFixed(2)} MB (${Math.round(100 * r.after / r.before)}%), ${r.textures} textures, ${r.nodes} nodes kept`)
}
