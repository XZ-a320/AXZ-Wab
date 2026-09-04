#!/usr/bin/env node
/* ==========================================================================
   FlightGear model XML → a rig description.

   A FlightGear aircraft is a tree of model XML files: each names one .ac
   file, places child XMLs with <offsets>, and lists <animation>s that
   rotate, translate or spin objects BY NAME, driven by a property such as
   gear/gear[0]/position-norm, with an axis and a centre in the model's own
   frame (x aft, y starboard, z up, metres). That is a rig contract, written
   by the people who built the model. This reads it out; nothing is guessed.

   No dependencies: FlightGear's PropertyList XML is plain nested tags.
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'

/* --- A minimal XML reader (tags, attributes, text, comments) -------------- */
export function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], text: '' }
  const stack = [root]
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g
  let m
  while ((m = re.exec(text))) {
    if (m[0].startsWith('<!--') || m[0].startsWith('<?') || m[0].startsWith('<!DOCTYPE')) continue
    if (m[1] != null) { stack[stack.length - 1].text += m[1]; continue }
    if (m[2]) { if (stack.length > 1) stack.pop(); continue }
    if (m[3]) {
      const attrs = {}
      for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2]
      const node = { name: m[3], attrs, children: [], text: '' }
      stack[stack.length - 1].children.push(node)
      if (!m[5]) stack.push(node)
      continue
    }
    if (m[6] != null) stack[stack.length - 1].text += m[6]
  }
  return root
}
const kids = (n, name) => n.children.filter(c => c.name === name)
const kid = (n, name) => kids(n, name)[0]
const txt = (n, name, dflt = null) => { const k = kid(n, name); return k ? k.text.trim() : dflt }
const num = (n, name, dflt = null) => { const t = txt(n, name); return t == null || t === '' ? dflt : parseFloat(t) }

function readAxis(anim) {
  const ax = kid(anim, 'axis')
  if (!ax) return null
  if (kid(ax, 'x1-m')) {
    // Two-point axis: from (x1,y1,z1) to (x2,y2,z2); the centre is the first point.
    const p1 = [num(ax, 'x1-m', 0), num(ax, 'y1-m', 0), num(ax, 'z1-m', 0)], p2 = [num(ax, 'x2-m', 0), num(ax, 'y2-m', 0), num(ax, 'z2-m', 0)]
    const d = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]]; const l = Math.hypot(...d) || 1
    return { axis: d.map(v => v / l), center: p1 }
  }
  return { axis: [num(ax, 'x', 0), num(ax, 'y', 0), num(ax, 'z', 0)] }
}
function readCenter(anim) { const c = kid(anim, 'center'); return c ? [num(c, 'x-m', 0), num(c, 'y-m', 0), num(c, 'z-m', 0)] : null }
function readTable(anim) {
  const t = kid(anim, 'interpolation')
  if (!t) return null
  return kids(t, 'entry').map(e => [num(e, 'ind', 0), num(e, 'dep', 0)])
}

export function readAnimation(a) {
  const type = txt(a, 'type', '')
  const objects = kids(a, 'object-name').map(o => o.text.trim()).filter(Boolean)
  const out = { type, objects, property: txt(a, 'property') }
  if (type === 'rotate' || type === 'spin') {
    const ax = readAxis(a) || {}
    Object.assign(out, { axis: ax.axis || null, center: readCenter(a) || ax.center || null, factor: num(a, 'factor', 1), offsetDeg: num(a, 'offset-deg', 0), min: num(a, 'min-deg'), max: num(a, 'max-deg'), table: readTable(a) })
  } else if (type === 'translate') {
    const ax = readAxis(a) || {}
    Object.assign(out, { axis: ax.axis || null, factor: num(a, 'factor', 1), offsetM: num(a, 'offset-m', 0), min: num(a, 'min-m'), max: num(a, 'max-m'), table: readTable(a) })
  } else if (type === 'select' || type === 'noshadow' || type === 'material' || type === 'textranslate' || type === 'texrotate' || type === 'pick' || type === 'scale' || type === 'range' || type === 'alpha-test' || type === 'blend' || type === 'billboard' || type === 'flash' || type === 'dist-scale' || type === 'shader' || type === 'light' || type === 'timed' || type === 'knob' || type === 'slider' || type === 'touch' || type === 'locked-track') {
    out.condition = !!kid(a, 'condition')
  }
  return out
}

/** Resolve a FlightGear include path. "Aircraft/<name>/Models/x.xml" is
    relative to the package root; anything else is relative to the XML. */
export function resolveInclude(p, { xmlDir, packageRoot }) {
  const m = /^Aircraft\/[^/]+\/(.*)$/.exec(p)
  if (m) return join(packageRoot, m[1])
  return resolve(xmlDir, p)
}

export function readModelXml(xmlPath, { packageRoot, seen = new Set(), depth = 0 } = {}) {
  const abs = resolve(xmlPath)
  if (seen.has(abs) || depth > 8 || !existsSync(abs)) return []
  seen.add(abs)
  const doc = parseXml(readFileSync(abs, 'utf8'))
  const pl = kid(doc, 'PropertyList') || doc
  const part = { xml: basename(abs), dir: dirname(abs), ac: txt(pl, 'path'), animations: [], other: {}, includes: [] }
  for (const a of kids(pl, 'animation')) {
    const an = readAnimation(a)
    if (['rotate', 'translate', 'spin', 'select'].includes(an.type) && an.objects.length) part.animations.push(an)
    else part.other[an.type || '?'] = (part.other[an.type || '?'] || 0) + 1
  }
  const parts = [part]
  for (const m of kids(pl, 'model')) {
    const p = txt(m, 'path')
    if (!p) continue
    const off = kid(m, 'offsets')
    const inc = { path: p, name: txt(m, 'name'), offset: off ? { x: num(off, 'x-m', 0), y: num(off, 'y-m', 0), z: num(off, 'z-m', 0), pitch: num(off, 'pitch-deg', 0), roll: num(off, 'roll-deg', 0), heading: num(off, 'heading-deg', 0) } : null }
    part.includes.push(inc)
    const target = resolveInclude(p, { xmlDir: dirname(abs), packageRoot })
    if (/\.xml$/i.test(p)) for (const sub of readModelXml(target, { packageRoot, seen, depth: depth + 1 })) { sub.placedBy = part.xml; sub.offset = sub.offset || inc.offset; parts.push(sub) }
    else if (/\.ac$/i.test(p)) parts.push({ xml: null, dir: dirname(target), ac: basename(target), animations: [], other: {}, includes: [], placedBy: part.xml, offset: inc.offset })
  }
  return parts
}

export function buildRig(id, rootXml, packageRoot) {
  const parts = readModelXml(rootXml, { packageRoot })
  const withAc = parts.filter(p => p.ac)
  const anims = parts.reduce((n, p) => n + p.animations.length, 0)
  const props = new Set(); for (const p of parts) for (const a of p.animations) if (a.property) props.add(a.property)
  return {
    id, root: basename(rootXml), frame: 'FlightGear model frame: x aft, y starboard, z up, metres',
    parts: parts.map(p => ({ xml: p.xml, ac: p.ac, glb: p.ac ? p.ac.replace(/\.ac$/i, '.glb') : null, dir: p.dir.replace(packageRoot, '').replace(/^\//, ''), placedBy: p.placedBy || null, offset: p.offset || null, animations: p.animations, other: p.other })),
    summary: { parts: parts.length, withGeometry: withAc.length, animations: anims, properties: [...props].sort() },
  }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [id, rootXml, packageRoot, out] = process.argv.slice(2)
  if (!id || !rootXml || !packageRoot) { console.error('usage: node scripts/assets/fg-rig.mjs <id> <root.xml> <packageRoot> [out.json]'); process.exit(2) }
  const rig = buildRig(id, rootXml, packageRoot)
  if (out) { const { writeFileSync, mkdirSync } = await import('node:fs'); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(rig, null, 2) + '\n') }
  const s = rig.summary
  console.log(`${id}: ${s.parts} parts (${s.withGeometry} with geometry), ${s.animations} rotate/translate/spin/select animations, ${s.properties.length} properties`)
  const wanted = s.properties.filter(p => /gear|flap|slat|spoiler|aileron|elevator|rudder|speedbrake|reverser|rpm|n1|door|nose|visor|throttle|yoke|stick/i.test(p))
  console.log(`  ${wanted.slice(0, 40).join('\n  ')}`)
}
