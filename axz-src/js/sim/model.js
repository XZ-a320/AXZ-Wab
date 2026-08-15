/* ==========================================================================
   AXZ sim — the aeroplane, built from the fleet's own dimensions table.

   `scripts/airframe.mjs` already draws the four types in plan view on the home
   page from published length / span / fuselage diameter / height. The build
   hands that same table to this file, so the thing you fly is dimensioned from
   the same four numbers as the drawing in sector 02. The A321 is longer here
   because it is longer there.

   Body frame (see math.js): +X right wing, +Y up, +Z aft. The nose is -Z.
   The origin is the centre of gravity, not the nose, because that is what the
   flight model wants to rotate about.
   ========================================================================== */

import { makeBuilder, makeLineBuilder, shade } from './gl.js'

const CYAN = [0.00, 0.635, 0.91]     // #00A2E8, the wordmark's own cyan
const BONE = [0.93, 0.92, 0.88]
const INK = [0.10, 0.11, 0.13]
const GREY = [0.42, 0.44, 0.46]
const GLASS = [0.16, 0.22, 0.28]
const MC_GREEN = [0.36, 0.62, 0.28]  // B-1717 only, the Minecraft collaboration

export function liveryFor(reg) {
  if (reg === 'B-1717') return { accent: MC_GREEN, belly: [0.28, 0.34, 0.24] }
  if (reg === 'B-0001F') return { accent: [0.75, 0.36, 0.16], belly: [0.30, 0.31, 0.33] }
  return { accent: CYAN, belly: [0.28, 0.30, 0.33] }
}

/**
 * Build the aircraft mesh.
 * `spec` is a row of the fleet table: { len, span, dia, h, engines, cargo }.
 */
export function aircraftMesh(spec, livery) {
  const B = makeBuilder()
  const L = spec.len, S = spec.span, r = spec.dia / 2
  const noseZ = -L * 0.45, tailZ = L * 0.55
  const accent = livery.accent

  /* --- Fuselage ----------------------------------------------------------
     An eight-sided tube. Eight is enough to read as round under flat shading
     and few enough that the facets are part of the look. Each station has a
     radius scale and a vertical offset, so the tail can rise into the fin. */
  const SIDES = 8
  const ring = (z, rad, yOff = 0, squash = 1) => {
    const out = []
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2 + Math.PI / SIDES
      out.push({ x: Math.sin(a) * rad, y: Math.cos(a) * rad * squash + yOff, z })
    }
    return out
  }

  // t along the body, radius fraction, vertical rise of the centreline.
  const STATIONS = [
    [0.000, 0.02, 0.00], [0.030, 0.42, -0.06], [0.075, 0.72, -0.06],
    [0.130, 0.94, -0.03], [0.190, 1.00, 0.00], [0.640, 1.00, 0.00],
    [0.760, 0.92, 0.06], [0.865, 0.70, 0.16], [0.945, 0.42, 0.26],
    [1.000, 0.10, 0.32],
  ]
  const rings = STATIONS.map(([t, k, rise]) =>
    ring(noseZ + (tailZ - noseZ) * t, Math.max(r * k, 0.05), r * rise, 1.02))

  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s], b = rings[s + 1]
    // The cheatline: upper half bone, lower half the belly tone, with a band
    // of accent where they meet — the same two-tone split the wordmark uses.
    for (let i = 0; i < SIDES; i++) {
      const j = (i + 1) % SIDES
      const up = Math.cos((i / SIDES) * Math.PI * 2 + Math.PI / SIDES)
      const col = up > 0.35 ? BONE : up < -0.55 ? livery.belly : (up > -0.1 ? shade(accent, 1.0) : BONE)
      B.quad(a[i], a[j], b[j], b[i], col)
    }
  }
  // Cap the nose and the tail cone so the tube is closed.
  const n0 = rings[0], nLast = rings[rings.length - 1]
  for (let i = 1; i < SIDES - 1; i++) {
    B.tri(n0[0], n0[i + 1], n0[i], BONE)
    B.tri(nLast[0], nLast[i], nLast[i + 1], livery.belly)
  }

  // Flight deck windows: a dark wedge on the shoulder, both sides.
  const wz = noseZ + L * 0.055, wz2 = noseZ + L * 0.125
  for (const sgn of [-1, 1]) {
    B.quad2(
      { x: sgn * r * 0.55, y: r * 0.52, z: wz },
      { x: sgn * r * 0.80, y: r * 0.44, z: wz2 },
      { x: sgn * r * 0.80, y: r * 0.10, z: wz2 },
      { x: sgn * r * 0.55, y: r * 0.20, z: wz },
      GLASS)
  }

  /* --- Wing ---------------------------------------------------------------
     Swept trapezoid with dihedral, given thickness so it is a solid from every
     angle. Root chord and sweep are proportions of length, which is what makes
     the A321's wing sit correctly further aft on its longer body. */
  const halfSpan = S / 2
  const rootLE = -L * 0.055, rootTE = L * 0.145
  const sweep = L * 0.20, tipChord = L * 0.055
  const dihedral = 0.105                     // ~6 degrees
  const thickRoot = r * 0.30, thickTip = r * 0.09

  const wingSurface = (sgn) => {
    const yr = -r * 0.28
    const rLE = { x: sgn * r * 0.85, y: yr, z: rootLE }
    const rTE = { x: sgn * r * 0.85, y: yr, z: rootTE }
    const tipY = yr + halfSpan * dihedral
    const tLE = { x: sgn * halfSpan, y: tipY, z: rootLE + sweep }
    const tTE = { x: sgn * halfSpan, y: tipY, z: rootLE + sweep + tipChord }
    const up = t => ({ x: t.x, y: t.y + (t === rLE || t === rTE ? thickRoot : thickTip), z: t.z })
    const uLE = up(rLE), uTE = up(rTE)
    const utLE = { x: tLE.x, y: tLE.y + thickTip, z: tLE.z }
    const utTE = { x: tTE.x, y: tTE.y + thickTip, z: tTE.z }
    const top = shade(GREY, 1.05), bot = shade(GREY, 0.7)
    if (sgn > 0) {
      B.quad(uLE, utLE, utTE, uTE, top)
      B.quad(rLE, rTE, tTE, tLE, bot)
      B.quad(rLE, tLE, utLE, uLE, shade(GREY, 0.95))     // leading edge
      B.quad(rTE, uTE, utTE, tTE, shade(GREY, 0.85))     // trailing edge
      B.quad(tLE, tTE, utTE, utLE, accent)               // tip, in the accent
    } else {
      B.quad(uTE, utTE, utLE, uLE, top)
      B.quad(tLE, tTE, rTE, rLE, bot)
      B.quad(uLE, utLE, tLE, rLE, shade(GREY, 0.95))
      B.quad(tTE, utTE, uTE, rTE, shade(GREY, 0.85))
      B.quad(utLE, utTE, tTE, tLE, accent)
    }
    // Winglet, canted up from the tip.
    const wl = { x: sgn * halfSpan * 0.99, y: tipY + thickTip, z: rootLE + sweep + tipChord * 0.15 }
    const wlT = { x: sgn * halfSpan * 1.02, y: tipY + L * 0.055, z: rootLE + sweep + tipChord * 0.35 }
    B.quad2(wl, { x: wl.x, y: wl.y, z: wl.z + tipChord * 0.75 }, { x: wlT.x, y: wlT.y, z: wlT.z + tipChord * 0.42 }, wlT, accent)
    return { tipY, rLE, tLE }
  }
  const wingL = wingSurface(-1), wingR = wingSurface(1)

  /* --- Engines ------------------------------------------------------------ */
  const nacelle = (sgn) => {
    const px = sgn * halfSpan * 0.34
    const py = -r * 0.28 + Math.abs(px) * dihedral - r * 0.52
    const pz = rootLE + sweep * 0.22 - L * 0.06
    const nr = r * 0.52, nl = L * 0.115
    const cyl = (z, rad) => {
      const o = []
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8
        o.push({ x: px + Math.sin(a) * rad, y: py + Math.cos(a) * rad, z })
      }
      return o
    }
    const a = cyl(pz, nr * 0.92), b = cyl(pz + nl * 0.25, nr), c = cyl(pz + nl, nr * 0.80)
    for (const [p, q, col] of [[a, b, shade(GREY, 1.0)], [b, c, shade(GREY, 0.88)]]) {
      for (let i = 0; i < 8; i++) B.quad(p[i], p[(i + 1) % 8], q[(i + 1) % 8], q[i], col)
    }
    // Intake face and the fan behind it.
    for (let i = 1; i < 7; i++) B.tri(a[0], a[i], a[i + 1], INK)
    for (let i = 1; i < 7; i++) B.tri(c[0], c[i + 1], c[i], shade(INK, 1.6))
    // Pylon up to the wing.
    B.quad2(
      { x: px, y: py + nr * 0.6, z: pz + nl * 0.25 },
      { x: px, y: py + nr * 0.6, z: pz + nl * 0.9 },
      { x: px, y: py + nr * 2.0, z: pz + nl * 0.95 },
      { x: px, y: py + nr * 2.0, z: pz + nl * 0.35 },
      shade(GREY, 0.8))
  }
  for (let e = 0; e < (spec.engines || 2); e++) nacelle(e % 2 === 0 ? -1 : 1)

  /* --- Tail --------------------------------------------------------------- */
  const tz = tailZ - L * 0.20
  const finH = spec.h * 0.62
  const finBase = r * 0.30
  // Vertical fin, swept, carrying the accent and a bone AXZ band.
  B.quad2(
    { x: 0, y: finBase, z: tz },
    { x: 0, y: finBase, z: tz + L * 0.155 },
    { x: 0, y: finBase + finH, z: tz + L * 0.175 },
    { x: 0, y: finBase + finH, z: tz + L * 0.105 },
    accent)
  B.quad2(
    { x: 0, y: finBase + finH * 0.34, z: tz + L * 0.055 },
    { x: 0, y: finBase + finH * 0.34, z: tz + L * 0.150 },
    { x: 0, y: finBase + finH * 0.60, z: tz + L * 0.158 },
    { x: 0, y: finBase + finH * 0.60, z: tz + L * 0.080 },
    BONE)

  // Horizontal stabiliser, same construction as the wing but smaller.
  const hs = S * 0.36, hRoot = L * 0.085, hSweep = L * 0.075, hTip = L * 0.035
  for (const sgn of [-1, 1]) {
    const y0 = r * 0.16
    const a = { x: 0, y: y0, z: tz + L * 0.03 }
    const b = { x: 0, y: y0, z: tz + L * 0.03 + hRoot }
    const c = { x: sgn * hs, y: y0 + hs * 0.06, z: tz + L * 0.03 + hSweep + hTip }
    const d = { x: sgn * hs, y: y0 + hs * 0.06, z: tz + L * 0.03 + hSweep }
    B.quad2(a, b, c, d, sgn > 0 ? shade(GREY, 1.02) : shade(GREY, 0.98))
  }

  return B.build()
}

/**
 * Landing gear, as its own mesh so it can simply not be drawn when retracted.
 * Returns the mesh plus the three contact points the flight model needs, in
 * body coordinates — one source for what you see and what you land on.
 */
export function gearMesh(spec) {
  const B = makeBuilder()
  const L = spec.len, r = spec.dia / 2
  const noseZ = -L * 0.45
  const strutCol = [0.55, 0.56, 0.58], tyre = [0.09, 0.09, 0.10]

  // A 737-800's fuselage centreline sits a bit over 3 m up, so the leg has to
  // put the wheel about 1.9 m below the belly, not the 2.9 m an eyeballed
  // 1.55 radii gave — which parked the aeroplane a storey above its own runway.
  const legLen = r * 1.02
  const yTop = -r * 0.92
  const yBot = yTop - legLen

  /* Main gear position is not cosmetic: it is the pivot the aeroplane rotates
     about, and its distance aft of the CG sets how much elevator a rotation
     costs. At 0.075 L the mains sat about 3 m too far back, the reaction they
     fed into the pitch axis nearly cancelled full elevator, and the aeroplane
     would accelerate down the whole runway without lifting the nose. A real
     737-800 carries roughly a tenth of its weight on the nose gear, which is
     what these two stations give. */
  const contacts = [
    { x: 0, y: yBot, z: noseZ + L * 0.135, nose: true },
    { x: -r * 0.98, y: yBot, z: L * 0.045, nose: false },
    { x: r * 0.98, y: yBot, z: L * 0.045, nose: false },
    /* The tail skid. Not landing gear — it never retracts, and it is what
       stops a rotation instead of the flight model politely declining to keep
       pitching. With the mains at 0.045 L this point touches at about eleven
       degrees, which is where a 737-800 strikes its tail. Without it, full
       back stick rotated the aeroplane to seventy-five degrees on the runway
       and it flew away like a party balloon. */
    { x: 0, y: -r * 0.16, z: L * 0.495, tail: true },
  ]

  for (const c of contacts) {
    const w = c.nose ? r * 0.10 : r * 0.13
    // Strut
    B.quad2({ x: c.x - w, y: yTop, z: c.z - w }, { x: c.x + w, y: yTop, z: c.z - w },
      { x: c.x + w, y: c.y, z: c.z - w }, { x: c.x - w, y: c.y, z: c.z - w }, strutCol)
    B.quad2({ x: c.x - w, y: yTop, z: c.z + w }, { x: c.x + w, y: yTop, z: c.z + w },
      { x: c.x + w, y: c.y, z: c.z + w }, { x: c.x - w, y: c.y, z: c.z + w }, strutCol)
    // Wheels: a hexagonal disc each side of the strut.
    const wr = c.nose ? r * 0.20 : r * 0.26
    for (const side of c.nose ? [-1, 1] : [-1.9, 1.9]) {
      const wx = c.x + side * w * 1.7
      const prev = []
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * Math.PI * 2
        prev.push({ x: wx, y: c.y + wr + Math.sin(a) * wr, z: c.z + Math.cos(a) * wr })
      }
      for (let i = 0; i < 8; i++) {
        B.tri({ x: wx, y: c.y + wr, z: c.z }, prev[i], prev[i + 1], tyre)
        B.tri({ x: wx + w * 0.6, y: c.y + wr, z: c.z }, prev[i + 1], prev[i], tyre)
      }
    }
  }
  return { mesh: B.build(), contacts, legLen, restHeight: -yBot }
}

/** Wing and fuselage outlines — the plan-view drawing, carried into 3D. */
export function aircraftLines(spec, col) {
  const LB = makeLineBuilder()
  const L = spec.len, S = spec.span, r = spec.dia / 2
  const halfSpan = S / 2
  const rootLE = -L * 0.055, sweep = L * 0.20, tipChord = L * 0.055
  const yr = -r * 0.28 + r * 0.30
  for (const sgn of [-1, 1]) {
    const tipY = yr + halfSpan * 0.105
    LB.seg({ x: sgn * r * 0.85, y: yr, z: rootLE }, { x: sgn * halfSpan, y: tipY, z: rootLE + sweep }, col)
    LB.seg({ x: sgn * halfSpan, y: tipY, z: rootLE + sweep },
      { x: sgn * halfSpan, y: tipY, z: rootLE + sweep + tipChord }, col)
  }
  return LB.build()
}
