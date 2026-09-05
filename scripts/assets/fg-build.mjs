#!/usr/bin/env node
/* ==========================================================================
   One FlightGear package → one aircraft GLB with its rig inside.

     node scripts/assets/fg-build.mjs <id> <root.xml> <packageRoot> <outDir> [--exclude=a.xml,Dir]

   Reads the rig from the model XML tree, converts every .ac the rig names
   (textures found from the package's Models/ root), assembles the parts in
   FlightGear's frame, and writes <outDir>/<id>.glb and <id>.rig.json.
   ========================================================================== */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { buildRig } from './fg-rig.mjs'
import { convert, packGlb } from './ac2gltf.mjs'
import { assemble } from './fg-assemble.mjs'

/** Several roots (Concorde keeps its exterior and flight deck in separate XMLs) merge into one rig. */
export function buildPackage(id, rootXml, packageRoot, outDir, { exclude = [], textureOverride = null, log = () => {} } = {}) {
  const roots = String(rootXml).split(',').map(r => r.trim()).filter(Boolean)
  const rigs = roots.map(r => buildRig(id, r, packageRoot))
  const rig = rigs[0]
  for (const extra of rigs.slice(1)) for (const p of extra.parts) if (!rig.parts.some(q => q.xml === p.xml && q.ac === p.ac)) rig.parts.push(p)
  rig.root = roots.map(r => r.split('/').pop()).join(' + ')
  const glbDir = join(outDir, 'parts')
  const converted = [], warnings = []
  for (const p of rig.parts) {
    if (!p.ac) continue
    if (exclude.some(x => (p.xml || '') === x || (p.ac || '') === x || (p.dir || '').split('/').includes(x))) continue
    const acPath = join(packageRoot, p.dir, p.ac)
    if (!existsSync(acPath)) { warnings.push(`${p.ac}: not in package`); continue }
    const out = join(glbDir, p.dir, p.glb)
    mkdirSync(dirname(out), { recursive: true })
    const r = convert(acPath, out, { textureRoot: join(packageRoot, 'Models'), textureOverride })
    converted.push({ part: p.xml || p.ac, triangles: r.triangles, objects: r.objects })
    for (const w of r.warnings) warnings.push(`${p.ac}: ${w}`)
    log(`  ${p.ac}: ${r.objects} objects, ${r.triangles.toLocaleString()} triangles`)
  }
  const asm = assemble(rig, glbDir, { exclude })
  for (const d of asm.dropped || []) warnings.push(`dropped oversized part ${d}`)
  const glb = packGlb(asm)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, `${id}.glb`), glb)
  writeFileSync(join(outDir, `${id}.rig.json`), JSON.stringify(rig, null, 2) + '\n')
  const triangles = converted.reduce((n, c) => n + c.triangles, 0)
  return { id, parts: asm.parts, converted: converted.length, triangles, animations: asm.json.asset.extras.axzRig.parts.reduce((n, p) => n + p.animations.length, 0), images: (asm.json.images || []).length, bytes: glb.length, warnings }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const [id, rootXml, packageRoot, outDir] = args
  if (!outDir) { console.error('usage: node scripts/assets/fg-build.mjs <id> <root.xml> <packageRoot> <outDir> [--exclude=a.xml,Dir] [--textures=<override dir>]'); process.exit(2) }
  const ex = process.argv.find(a => a.startsWith('--exclude='))
  const ov = process.argv.find(a => a.startsWith('--textures='))
  const r = buildPackage(id, rootXml, packageRoot, outDir, { exclude: ex ? ex.slice(10).split(',') : [], textureOverride: ov ? ov.slice(11) : null, log: console.log })
  console.log(`✓ ${r.id}.glb: ${r.parts.length} parts, ${r.triangles.toLocaleString()} triangles, ${r.images} images, ${r.animations} animations, ${(r.bytes / 1048576).toFixed(2)} MB`)
  for (const w of [...new Set(r.warnings)]) console.log(`  ! ${w}`)
}
