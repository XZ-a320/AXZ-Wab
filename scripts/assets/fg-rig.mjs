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
import { join, dirname, basename, resolve, relative } from 'node:path'

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

/** FlightGear <condition> → a small tree the runtime can evaluate.
    Leaves are properties or values; nodes are not/and/or and comparisons. */
export function readCondition(node) {
  if (!node) return null
  const cmp = { equals: 'eq', 'not-equals': 'ne', 'less-than': 'lt', 'less-than-equals': 'le', 'greater-than': 'gt', 'greater-than-equals': 'ge' }
  /* <property alias="/params/x"/> names the property by attribute. */
  const pname = c => (c.text.trim() || (c.attrs && c.attrs.alias) || '').replace(/^\//, '')
  const operands = n => n.children.filter(c => c.name === 'property' || c.name === 'value').map(c => c.name === 'property' ? { property: pname(c) } : { value: isNaN(parseFloat(c.text)) ? c.text.trim() : parseFloat(c.text) })
  const terms = []
  for (const c of node.children) {
    if (c.name === 'property') terms.push({ op: 'property', name: pname(c) })
    else if (c.name === 'not') { const inner = readCondition(c); if (inner) terms.push({ op: 'not', a: inner }) }
    else if (c.name === 'and' || c.name === 'or') { const inner = readCondition(c); if (inner) terms.push(inner.op === c.name ? inner : { op: c.name, list: [inner] }) }
    else if (cmp[c.name]) { const [l, r] = operands(c); if (l && r) terms.push({ op: cmp[c.name], left: l, right: r }) }
  }
  if (!terms.length) return null
  if (terms.length === 1) return terms[0]
  return { op: node.name === 'or' ? 'or' : 'and', list: terms }
}

export function readAnimation(a) {
  const type = txt(a, 'type', '')
  const objects = kids(a, 'object-name').map(o => o.text.trim()).filter(Boolean)
  const out = { type, objects, property: txt(a, 'property') }
  const cond = readCondition(kid(a, 'condition'))
  if (cond) out.condition = cond
  if (type === 'rotate' || type === 'spin') {
    const ax = readAxis(a) || {}
    Object.assign(out, { axis: ax.axis || null, center: readCenter(a) || ax.center || null, factor: num(a, 'factor', 1), offsetDeg: num(a, 'offset-deg', 0), min: num(a, 'min-deg'), max: num(a, 'max-deg'), table: readTable(a) })
  } else if (type === 'translate') {
    const ax = readAxis(a) || {}
    Object.assign(out, { axis: ax.axis || null, factor: num(a, 'factor', 1), offsetM: num(a, 'offset-m', 0), min: num(a, 'min-m'), max: num(a, 'max-m'), table: readTable(a) })
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

export function mergePropertyLists(base, local) {
  const merged = { name: 'PropertyList', attrs: {}, children: [], text: '' }
  const key = c => `${c.name}#${c.attrs && c.attrs.n != null ? c.attrs.n : ''}`
  const byKey = new Map()
  for (const c of base.children) { const k = key(c); if (c.attrs && c.attrs.n != null) byKey.set(k, { ...c, children: [...c.children] }); merged.children.push(byKey.get(k) || c) }
  for (const c of local.children) {
    const k = key(c)
    if (c.attrs && c.attrs.n != null && byKey.has(k)) {
      const target = byKey.get(k)
      for (const cc of c.children) { const j = target.children.findIndex(t => t.name === cc.name); if (j >= 0) target.children[j] = cc; else target.children.push(cc) }
      if (c.text.trim()) target.text = c.text
    } else merged.children.push(c)
  }
  return merged
}

const readOffsets = off => off ? { x: num(off, 'x-m', 0), y: num(off, 'y-m', 0), z: num(off, 'z-m', 0), pitch: num(off, 'pitch-deg', 0), roll: num(off, 'roll-deg', 0), heading: num(off, 'heading-deg', 0) } : null
/** Offsets compose down the include chain: translations add, the deepest
    rotation wins (FlightGear's own parts are placed on unrotated parents). */
export function composeOffsets(base, own) {
  if (!base) return own || null
  if (!own) return base
  return { x: base.x + own.x, y: base.y + own.y, z: base.z + own.z, pitch: own.pitch || base.pitch, roll: own.roll || base.roll, heading: own.heading || base.heading }
}

export function readModelXml(xmlPath, { packageRoot, seen = new Set(), depth = 0, base = null } = {}) {
  const abs = resolve(xmlPath)
  if (seen.has(abs) || depth > 8 || !existsSync(abs)) return []
  seen.add(abs)
  const doc = parseXml(readFileSync(abs, 'utf8'))
  let pl = kid(doc, 'PropertyList') || doc
  /* <PropertyList include="other.xml"> merges the other file underneath this
     one: same-named children with the same n="…" index are one element,
     the local file's fields winning. That is how 738.xml adds offsets to
     the models 737-model-common.xml declares. */
  if (pl.attrs && pl.attrs.include) {
    const incPath = resolve(dirname(abs), pl.attrs.include)
    if (existsSync(incPath)) {
      const base = kid(parseXml(readFileSync(incPath, 'utf8')), 'PropertyList')
      if (base) pl = mergePropertyLists(base, pl)
    }
  }
  /* A model XML may shift its own .ac with a root-level <offsets>. */
  const own = composeOffsets(base, readOffsets(kid(pl, 'offsets')))
  const part = { xml: basename(abs), dir: dirname(abs), ac: txt(pl, 'path'), offset: own, animations: [], other: {}, includes: [] }
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
    /* A <model> may carry a <condition>: FlightGear loads the submodel only
       while it holds (a drag chute, a fuel truck, a bomb on a pylon). */
    const inc = { path: p, name: txt(m, 'name'), condition: readCondition(kid(m, 'condition')), offset: readOffsets(off) }
    part.includes.push(inc)
    const target = resolveInclude(p, { xmlDir: dirname(abs), packageRoot })
    const placed = composeOffsets(own, inc.offset)
    if (/\.xml$/i.test(p)) for (const sub of readModelXml(target, { packageRoot, seen, depth: depth + 1, base: placed })) { if (!sub.placedBy) { sub.placedBy = part.xml; if (!sub.name) sub.name = inc.name; if (inc.condition && !sub.condition) sub.condition = inc.condition }; parts.push(sub) }
    else if (/\.ac$/i.test(p)) parts.push({ xml: null, dir: dirname(target), ac: basename(target), name: inc.name, condition: inc.condition, animations: [], other: {}, includes: [], placedBy: part.xml, offset: placed })
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
    parts: parts.map(p => ({ xml: p.xml, ac: p.ac, glb: p.ac ? p.ac.replace(/\.ac$/i, '.glb') : null, dir: relative(resolve(packageRoot), p.dir), name: p.name || null, condition: p.condition || null, placedBy: p.placedBy || null, offset: p.offset || null, animations: p.animations, other: p.other })),
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
