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
  // The three types the simulator added carry their own paint. An airline
  // cheatline on a fighter would be the drawing telling a lie about what the
  // aeroplane is, and the whole roster is built around that distinction.
  if (reg === 'SIM-102') return { accent: [0.10, 0.20, 0.52], belly: [0.30, 0.33, 0.38] }
  if (reg === 'SIM-650') return { accent: [0.62, 0.52, 0.24], belly: [0.22, 0.24, 0.27] }
  if (reg === 'SIM-F16') return { accent: [0.40, 0.44, 0.48], belly: [0.52, 0.55, 0.58], skin: [0.44, 0.48, 0.52] }
  // The two stealth fighters wear a darker, flatter grey than a fourth-
  // generation air-superiority scheme, and the bombers darker again.
  if (reg === 'SIM-F22') return { accent: [0.30, 0.33, 0.37], belly: [0.38, 0.41, 0.45], skin: [0.34, 0.37, 0.41] }
  if (reg === 'SIM-F35') return { accent: [0.33, 0.35, 0.38], belly: [0.42, 0.45, 0.48], skin: [0.38, 0.40, 0.43] }
  if (reg === 'SIM-B2A') return { accent: [0.16, 0.17, 0.19], belly: [0.13, 0.14, 0.16], skin: [0.21, 0.22, 0.25] }
  if (reg === 'SIM-B52') return { accent: [0.24, 0.26, 0.24], belly: [0.30, 0.31, 0.30], skin: [0.31, 0.33, 0.31] }
  return { accent: CYAN, belly: [0.28, 0.30, 0.33] }
}

/* WINDING. Every closed surface in this file — fuselage tubes, nacelle
   barrels, the exhaust cone, the light single's boxy body — is built as rings
   of vertices from nose to tail, and each quad must be wound COUNTER-CLOCKWISE
   SEEN FROM OUTSIDE or `cullFace(BACK)` throws away the skin you can see and
   keeps the one you cannot. Written the natural way round, `a[i], a[j], b[j],
   b[i]` across a forward ring and an aft ring, the normal comes out pointing
   into the tube: every aeroplane in the roster was inside-out, and looking at
   one from outside you saw straight through the near side of the fuselage to
   the inside of the far side. The rule is to step ALONG the body first —
   `a[i], b[i], b[j], a[j]` — and the caps follow from it.                    */

/* --- Stance ---------------------------------------------------------------
   How high the centre of gravity sits above the ground with the aeroplane
   standing on its own gear. This used to be a multiple of the fuselage radius
   — `r * 1.94` — which is a number with no source, and on the light single it
   put the CG 0.96 m up while the mesh's own propeller disc reached 0.84 m
   below it. Subtract the static squat and the aeroplane was drawn with its
   propeller and most of its fuselage under the runway, which is exactly what
   it looked like.

   The published overall HEIGHT is a real figure for every type in the table,
   and the mesh knows where it draws the top of the fin. The stance is the
   difference. That makes the drawn aeroplane exactly as tall as the number the
   manufacturer publishes, and it cannot be buried by construction — a
   type whose fin is drawn taller gets longer legs, automatically, including
   any type added later.                                                     */
export function finTipY(spec) {
  if (spec.shape === 'light') return spec.dia * 0.21 + spec.h * 0.50
  // A flying wing has no fin at all, so its highest point is its own spine.
  if (spec.shape === 'wing') return spec.dia * 0.62
  if (spec.shape === 'fighter') return spec.dia * 0.30 + spec.h * 0.52
  if (spec.shape === 'bizjet') return spec.dia * 0.32 + spec.h * 0.62
  if (spec.shape === 'delta') return spec.dia * 0.30 + spec.h * 0.66
  return spec.dia * 0.15 + spec.h * 0.70
}

/** CG height above the ground at rest, metres. */
export function stanceHeight(spec) {
  return Math.max(spec.h - finTipY(spec), spec.dia * 0.55)
}

/**
 * Build the aircraft mesh.
 * `spec` is a row of the fleet table: { len, span, dia, h, engines, cargo }.
 * Returns the geometry plus the extreme heights of what it drew, so the caller
 * can put the wheels under the lowest thing on the aeroplane rather than under
 * an assumption about where that is.
 */
export function aircraftMesh(spec, livery) {
  const shape = spec.shape || (spec.prop ? 'light' : 'jet')
  // A high-wing single is not a small airliner. Straight untapered wing on top
  // of the cabin, a strut holding it there, a propeller on the nose and no
  // nacelles at all: sharing the swept-wing builder and scaling it down would
  // have produced a very small 737, which is not what a Cessna looks like. The
  // same argument, three more times, for the delta, the T-tail and the fighter.
  if (shape === 'light') return extents(lightMesh(spec, livery))
  if (shape === 'delta') return extents(deltaMesh(spec, livery))
  if (shape === 'bizjet') return extents(bizjetMesh(spec, livery))
  if (shape === 'fighter') return extents(fighterMesh(spec, livery))
  if (shape === 'wing') return extents(wingMesh(spec, livery))
  return extents(jetMesh(spec, livery))
}

/** Tag a built mesh with the highest and lowest point it actually contains. */
function extents(geo) {
  let minY = Infinity, maxY = -Infinity
  for (let i = 1; i < geo.pos.length; i += 3) {
    const y = geo.pos[i]
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  geo.minY = minY === Infinity ? 0 : minY
  geo.maxY = maxY === -Infinity ? 0 : maxY
  return geo
}

function jetMesh(spec, livery) {
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
      B.quad(a[i], b[i], b[j], a[j], col)
    }
  }
  // Cap the nose and the tail cone so the tube is closed.
  const n0 = rings[0], nLast = rings[rings.length - 1]
  for (let i = 1; i < SIDES - 1; i++) {
    B.tri(n0[0], n0[i], n0[i + 1], BONE)
    B.tri(nLast[0], nLast[i + 1], nLast[i], livery.belly)
  }

  /* Upper deck. A stretched fairing along the top of the forward fuselage,
     faired in at the back. On a 747 this is the whole silhouette. */
  if (spec.upperDeck) {
    const d0 = noseZ + L * 0.06, d1 = noseZ + L * 0.30, d2 = noseZ + L * 0.40
    const yTop = r * 1.32, ySide = r * 0.62
    const w = r * 0.78
    for (const sgn of [-1, 1]) {
      B.quad(
        { x: sgn * w, y: ySide, z: d0 }, { x: sgn * w, y: ySide, z: d2 },
        { x: sgn * w * 0.92, y: yTop, z: d1 }, { x: sgn * w * 0.92, y: yTop, z: d0 + L * 0.02 },
        sgn > 0 ? BONE : shade(BONE, 0.94))
    }
    B.quad({ x: -w * 0.92, y: yTop, z: d0 + L * 0.02 }, { x: w * 0.92, y: yTop, z: d0 + L * 0.02 },
      { x: w * 0.92, y: yTop, z: d1 }, { x: -w * 0.92, y: yTop, z: d1 }, BONE)
    // The fair-in aft, which is the long sloping shoulder.
    B.quad({ x: -w * 0.92, y: yTop, z: d1 }, { x: w * 0.92, y: yTop, z: d1 },
      { x: w, y: ySide, z: d2 }, { x: -w, y: ySide, z: d2 }, shade(BONE, 0.97))
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
  const dihedral = spec.dihedral || 0.105    // ~6 degrees unless the type says otherwise
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
    /* Tip treatment. A 787 has no winglet: it has a long raked extension that
       sweeps back and barely rises, and that silhouette is most of how you
       tell one from an A320 at distance. Everything else gets the canted
       winglet. */
    if (spec.rakedTips) {
      const rk = { x: sgn * halfSpan * 1.10, y: tipY + halfSpan * 0.035, z: rootLE + sweep + tipChord * 1.5 }
      B.quad2(
        { x: sgn * halfSpan, y: tipY + thickTip, z: rootLE + sweep },
        { x: sgn * halfSpan, y: tipY + thickTip, z: rootLE + sweep + tipChord },
        { x: rk.x, y: rk.y, z: rk.z + tipChord * 0.30 }, rk, accent)
    } else {
      const wl = { x: sgn * halfSpan * 0.99, y: tipY + thickTip, z: rootLE + sweep + tipChord * 0.15 }
      const wlT = { x: sgn * halfSpan * 1.02, y: tipY + L * 0.055, z: rootLE + sweep + tipChord * 0.35 }
      B.quad2(wl, { x: wl.x, y: wl.y, z: wl.z + tipChord * 0.75 }, { x: wlT.x, y: wlT.y, z: wlT.z + tipChord * 0.42 }, wlT, accent)
    }
    return { tipY, rLE, tLE }
  }
  const wingL = wingSurface(-1), wingR = wingSurface(1)

  /* --- Engines ------------------------------------------------------------ */
  /* Span fraction per engine. A four-holer's inboard and outboard nacelles are
     at genuinely different stations, and putting all four at one fraction was
     the difference between a 747 and a 737 with two extra lumps.

     The nacelle hangs at a fixed CLEARANCE above the ground rather than at a
     fixed offset below the wing. A podded engine on a low-wing airliner sits
     about half a metre off the concrete whatever the aeroplane is, and pinning
     it there is also what guarantees the lowest thing on the aeroplane is
     never the thing that goes underground. */
  const stance = stanceHeight(spec)
  const nacelle = (sgn, frac) => {
    const px = sgn * halfSpan * frac
    const nr = r * 0.52, nl = L * 0.115
    const py = -stance + Math.max(0.45, nr * 0.45) + nr
    const pz = rootLE + sweep * 0.22 - L * 0.06
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
      for (let i = 0; i < 8; i++) B.quad(p[i], q[i], q[(i + 1) % 8], p[(i + 1) % 8], col)
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
  /* Station per engine. A four-holer's inboard and outboard nacelles are at
     genuinely different places, and a B-52 carries EIGHT in four twin pods —
     two pods a side, each holding a pair. Putting all eight at one fraction,
     or four, would have lost the aeroplane. */
  const nEng = spec.engines || 2
  if (nEng >= 8) {
    // Four pods, each drawn as a close-coupled pair.
    for (const sgn of [-1, 1]) {
      for (const f of [0.24, 0.44]) { nacelle(sgn, f - 0.028); nacelle(sgn, f + 0.028) }
    }
  } else if (nEng >= 4) {
    for (const sgn of [-1, 1]) { nacelle(sgn, 0.28); nacelle(sgn, 0.52) }
  } else if (nEng === 2) {
    nacelle(-1, 0.34); nacelle(1, 0.34)
  }

  /* --- Tail ---------------------------------------------------------------
     The fin height is what sets the stance, because the stance is the
     published overall height minus wherever this draws the fin tip. At 0.62 h
     the drawn 737 came out 12.0 m tall against a published 12.55, and the
     half-metre of missing fin came off the legs instead. */
  const tz = tailZ - L * 0.20
  const finBase = r * 0.30
  const finH = spec.h * 0.70
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
export function gearMesh(spec, stance) {
  const B = makeBuilder()
  const L = spec.len, r = spec.dia / 2
  const noseZ = -L * 0.45
  const strutCol = [0.55, 0.56, 0.58], tyre = [0.09, 0.09, 0.10]

  /* The wheels go where the ground is, which is `stance` below the centre of
     gravity, and the leg is however long that turns out to be. The previous
     version worked the other way round — a leg of `r * 1.02` and whatever
     stance that implied — and on a Cessna it implied a stance shorter than the
     aeroplane's own propeller. */
  const yBot = -stance
  // The leg emerges from inside the body, never from a point below it, or the
  // strut hangs in mid-air with daylight between it and the fuselage.
  const yTop = Math.max(-r * 0.92, yBot * 0.55)

  /* Main gear position is not cosmetic: it is the pivot the aeroplane rotates
     about, and its distance aft of the CG sets how much elevator a rotation
     costs. At 0.075 L the mains sat about 3 m too far back, the reaction they
     fed into the pitch axis nearly cancelled full elevator, and the aeroplane
     would accelerate down the whole runway without lifting the nose. A real
     737-800 carries roughly a tenth of its weight on the nose gear, which is
     what these two stations give. A fighter's wheelbase is a much larger
     fraction of a much shorter aeroplane. */
  const wide = spec.shape === 'fighter'
  const mainZ = L * (wide ? 0.075 : 0.045)
  const noseFwd = noseZ + L * (wide ? 0.30 : 0.135)
  /* HALF the published main-gear track. This was a multiple of the fuselage
     radius, which came out at about half the real figure on every type: a
     737's mains are 5.72 m apart and it was standing on 3.7. The ratio of
     half-track to centre-of-gravity height IS the roll-over threshold, so at
     that width the aeroplanes tipped over from a small steering input on the
     ground and a crosswind landing was unflyable. */
  const track = (spec.track || spec.dia * 1.5) / 2

  /* The tail skid. Not landing gear — it never retracts, and it is what stops
     a rotation instead of the flight model politely declining to keep pitching.
     Without it, full back stick rotated the aeroplane to seventy-five degrees
     on the runway and it flew away like a party balloon.

     Its height is SOLVED from the published tail-strike angle rather than
     eyeballed as a fraction of the fuselage: an A321 strikes at 9.7 degrees
     and a 737-800 at 11, and that difference is the whole reason a stretch is
     harder to rotate. */
  const skidZ = L * (spec.shape === 'light' ? 0.545 : 0.495)
  const strikeRad = (spec.tailStrikeDeg || 11) * Math.PI / 180
  const skidY = yBot + (skidZ - mainZ) * Math.tan(strikeRad)

  const contacts = [
    { x: 0, y: yBot, z: noseFwd, nose: true },
    { x: -track, y: yBot, z: mainZ, nose: false },
    { x: track, y: yBot, z: mainZ, nose: false },
    { x: 0, y: skidY, z: skidZ, tail: true },
  ]

  for (const c of contacts) {
    // The skid is a bumper under the tail cone, not a leg with wheels on it.
    // Drawing it through the wheel branch put a pair of tyres halfway up the
    // rear fuselage of every aeroplane in the roster.
    if (c.tail) {
      const w = r * 0.10, l = L * 0.02
      B.quad2({ x: -w, y: c.y, z: c.z - l }, { x: w, y: c.y, z: c.z - l },
        { x: w, y: c.y + r * 0.14, z: c.z + l }, { x: -w, y: c.y + r * 0.14, z: c.z + l }, strutCol)
      continue
    }
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
  return { mesh: B.build(), contacts, legLen: -yBot + yTop, restHeight: -yBot }
}

/* --- Decals ---------------------------------------------------------------
   The airline signing its own aeroplane. Each is a flat quad standing a few
   centimetres proud of the skin it sits on, carrying a texture generated in
   tex.js. Both sides get one, mirrored, so the mark reads correctly from
   either beam.

   A quad rather than a UV map over the fuselage: the tube is eight-sided and
   faceted on purpose, and wrapping type around those facets would kink every
   letter. Standing the lettering just off the surface is what a real decal is
   anyway.                                                                   */
function decalQuad(a, b, c, d) {
  const pos = [], normal = [], uv = []
  const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z
  const vx = d.x - a.x, vy = d.y - a.y, vz = d.z - a.z
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
  const l = Math.hypot(nx, ny, nz) || 1
  nx /= l; ny /= l; nz /= l
  const UV = [[0, 0], [1, 0], [1, 1], [0, 1]]
  for (const [p, q, r] of [[0, 1, 2], [0, 2, 3]]) {
    for (const i of [p, q, r]) {
      const pt = [a, b, c, d][i]
      pos.push(pt.x, pt.y, pt.z)
      normal.push(nx, ny, nz)
      uv.push(UV[i][0], UV[i][1])
    }
  }
  return { pos, normal, uv }
}

const mergeGeo = list => ({
  pos: [].concat(...list.map(g => g.pos)),
  normal: [].concat(...list.map(g => g.normal)),
  uv: [].concat(...list.map(g => g.uv)),
})

/**
 * Decal geometry for a type, grouped by which texture each set needs.
 * Returns [{ tex, geo }] for the caller to turn into meshes.
 */
export function decalQuads(spec, reg) {
  const L = spec.len, r = spec.dia / 2
  const noseZ = -L * 0.45, tailZ = L * 0.55
  const out = []
  /* A fighter carries no airline wordmark, no cabin windows and no fin logo.
     Painting AIR XIAO ZE down the side of an F-16 would be the drawing
     contradicting the sentence next to it, which is the one thing this whole
     roster is arranged to avoid. */
  if (spec.lowVis) return out
  const light = spec.shape === 'light' || spec.shape === 'fighter'

  // Wordmark, forward fuselage, both sides. Slightly proud of the skin.
  const off = r * 1.02
  const wz0 = noseZ + L * 0.16, wz1 = noseZ + L * 0.40
  const wy0 = -r * 0.10, wy1 = r * 0.34
  const fuse = []
  fuse.push(decalQuad(
    { x: -off, y: wy1, z: wz0 }, { x: -off, y: wy1, z: wz1 },
    { x: -off, y: wy0, z: wz1 }, { x: -off, y: wy0, z: wz0 }))
  fuse.push(decalQuad(
    { x: off, y: wy1, z: wz1 }, { x: off, y: wy1, z: wz0 },
    { x: off, y: wy0, z: wz0 }, { x: off, y: wy0, z: wz1 }))
  out.push({ tex: 'fuse', geo: mergeGeo(fuse) })

  // Cabin windows, a strip down each side, below the cheatline. A four-seat
  // single has two windows, not a cabin, so it does not get the strip.
  if (!light) {
    const gz0 = noseZ + L * 0.15, gz1 = tailZ - L * 0.30
    const gy0 = r * 0.10, gy1 = r * 0.40
    const win = []
    win.push(decalQuad(
      { x: -off, y: gy1, z: gz0 }, { x: -off, y: gy1, z: gz1 },
      { x: -off, y: gy0, z: gz1 }, { x: -off, y: gy0, z: gz0 }))
    win.push(decalQuad(
      { x: off, y: gy1, z: gz1 }, { x: off, y: gy1, z: gz0 },
      { x: off, y: gy0, z: gz0 }, { x: off, y: gy0, z: gz1 }))
    out.push({ tex: 'win', geo: mergeGeo(win) })
  }

  /* Fin mark. The fin is a flat plate at x=0, so the decal straddles it. On the
     delta and the T-tail the fin is in a different place and a different size,
     so the band is measured off `finTipY` — the same number the legs are cut
     from — rather than off the airliner's own fin constants. */
  const tip = finTipY(spec)
  const tz = spec.shape === 'delta' ? tailZ - L * 0.30
    : spec.shape === 'bizjet' ? tailZ - L * 0.22 : tailZ - L * 0.20
  const finBase = r * 0.30
  const fy0 = finBase + (tip - finBase) * 0.30, fy1 = finBase + (tip - finBase) * 0.86
  const fz0 = tz + L * 0.055, fz1 = tz + L * 0.155
  const fin = []
  fin.push(decalQuad(
    { x: -0.06, y: fy1, z: fz0 }, { x: -0.06, y: fy1, z: fz1 },
    { x: -0.06, y: fy0, z: fz1 }, { x: -0.06, y: fy0, z: fz0 }))
  fin.push(decalQuad(
    { x: 0.06, y: fy1, z: fz1 }, { x: 0.06, y: fy1, z: fz0 },
    { x: 0.06, y: fy0, z: fz0 }, { x: 0.06, y: fy0, z: fz1 }))
  out.push({ tex: 'fin', geo: mergeGeo(fin) })

  /* B-1717 only: the collaboration paint. The site says this aeroplane
     "swore it would never lose its paint", so it is the one airframe that
     carries a second livery band, in blocks. */
  if (reg === 'B-1717') {
    const bz0 = noseZ + L * 0.42, bz1 = tailZ - L * 0.26
    const by0 = -r * 0.52, by1 = -r * 0.06
    const blk = []
    blk.push(decalQuad(
      { x: -off, y: by1, z: bz0 }, { x: -off, y: by1, z: bz1 },
      { x: -off, y: by0, z: bz1 }, { x: -off, y: by0, z: bz0 }))
    blk.push(decalQuad(
      { x: off, y: by1, z: bz1 }, { x: off, y: by1, z: bz0 },
      { x: off, y: by0, z: bz0 }, { x: off, y: by0, z: bz1 }))
    out.push({ tex: 'block', geo: mergeGeo(blk) })
  }

  return out
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


/* --- Light single ---------------------------------------------------------
   Built to the same conventions as the jet (origin at the CG, nose at -Z) so
   the flight model, the decals and the gear all keep working unchanged. What
   differs is the shape, because the shape is the point: the wing is above the
   cabin, it does not sweep, it is held up by a strut, and the thrust comes
   from a disc on the front rather than pods underneath.                     */
function lightMesh(spec, livery) {
  const B = makeBuilder()
  const L = spec.len, S = spec.span, r = spec.dia / 2
  const noseZ = -L * 0.42, tailZ = L * 0.58
  const accent = livery.accent
  const skin = BONE, trim = accent

  // Cabin: a boxy six-sided body, tapering into a slim tail boom.
  const box = (z0, z1, w0, h0, w1, h1, yo0, yo1, col) => {
    const A = [
      { x: -w0, y: yo0 - h0, z: z0 }, { x: w0, y: yo0 - h0, z: z0 },
      { x: w0, y: yo0 + h0, z: z0 }, { x: -w0, y: yo0 + h0, z: z0 },
    ]
    const Bv = [
      { x: -w1, y: yo1 - h1, z: z1 }, { x: w1, y: yo1 - h1, z: z1 },
      { x: w1, y: yo1 + h1, z: z1 }, { x: -w1, y: yo1 + h1, z: z1 },
    ]
    B.quad(A[3], Bv[3], Bv[2], A[2], col)                       // roof
    B.quad(Bv[0], A[0], A[1], Bv[1], shade(col, 0.72))          // floor
    B.quad(A[1], Bv[1], Bv[2], A[2], shade(col, 0.92))          // right
    B.quad(Bv[0], A[0], A[3], Bv[3], shade(col, 0.86))          // left
    return Bv
  }
  const w = r * 0.92, h = r * 1.05
  box(noseZ, noseZ + L * 0.16, w * 0.52, h * 0.55, w, h, 0, 0, skin)      // cowl
  box(noseZ + L * 0.16, L * 0.10, w, h, w, h, 0, 0, skin)                 // cabin
  box(L * 0.10, tailZ - L * 0.06, w, h, w * 0.30, h * 0.34, 0, r * 0.30, skin)  // boom

  // Windscreen and side glass, as one dark wrap over the cabin shoulder.
  for (const sgn of [-1, 1]) {
    B.quad2(
      { x: sgn * w * 1.01, y: h * 0.18, z: noseZ + L * 0.17 },
      { x: sgn * w * 1.01, y: h * 0.18, z: L * 0.02 },
      { x: sgn * w * 1.01, y: h * 0.86, z: L * 0.02 },
      { x: sgn * w * 1.01, y: h * 0.86, z: noseZ + L * 0.20 },
      GLASS)
  }
  B.quad2(
    { x: -w * 0.92, y: h * 0.92, z: noseZ + L * 0.19 }, { x: w * 0.92, y: h * 0.92, z: noseZ + L * 0.19 },
    { x: w * 0.72, y: h * 0.30, z: noseZ + L * 0.10 }, { x: -w * 0.72, y: h * 0.30, z: noseZ + L * 0.10 },
    GLASS)

  /* Wing: straight, untapered, ON TOP, with a couple of degrees of dihedral.
     No sweep at all — sweep is for going fast and this does not. */
  const halfSpan = S / 2
  const yTop = h * 1.02
  const cRoot = L * 0.20, thick = r * 0.16
  const wz0 = noseZ + L * 0.30, wz1 = wz0 + cRoot
  for (const sgn of [-1, 1]) {
    const tipY = yTop + halfSpan * 0.030
    const a = { x: 0, y: yTop, z: wz0 }, b = { x: 0, y: yTop, z: wz1 }
    const c = { x: sgn * halfSpan, y: tipY, z: wz1 - cRoot * 0.06 }
    const d = { x: sgn * halfSpan, y: tipY, z: wz0 + cRoot * 0.06 }
    const up = p => ({ x: p.x, y: p.y + thick, z: p.z })
    const top = shade(skin, 1.0), bot = shade(skin, 0.66)
    if (sgn > 0) {
      B.quad(up(a), up(d), up(c), up(b), top)
      B.quad(a, b, c, d, bot)
      B.quad(a, d, up(d), up(a), shade(skin, 0.9))
      B.quad(b, up(b), up(c), c, shade(skin, 0.8))
      B.quad(d, c, up(c), up(d), trim)
    } else {
      B.quad(up(b), up(c), up(d), up(a), top)
      B.quad(d, c, b, a, bot)
      B.quad(up(a), up(d), d, a, shade(skin, 0.9))
      B.quad(c, up(c), up(b), b, shade(skin, 0.8))
      B.quad(up(d), up(c), c, d, trim)
    }
    // Lift strut, cabin floor out to mid-span. The give-away of the type.
    if (spec.strut) {
      const s0 = { x: sgn * w * 0.9, y: -h * 0.72, z: L * 0.02 }
      const s1 = { x: sgn * halfSpan * 0.52, y: yTop - thick * 0.2, z: wz0 + cRoot * 0.55 }
      const t = r * 0.055
      B.quad2({ x: s0.x, y: s0.y, z: s0.z - t }, { x: s1.x, y: s1.y, z: s1.z - t },
        { x: s1.x, y: s1.y, z: s1.z + t }, { x: s0.x, y: s0.y, z: s0.z + t }, shade(GREY, 1.0))
    }
  }

  /* Propeller. A hub, two blades, and a translucent-looking disc so it reads
     as turning rather than as a stopped stick. */
  const px = 0, py = 0, pz = noseZ - L * 0.012
  const pr = r * 1.35
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2
    B.tri({ x: px, y: py, z: pz },
      { x: px + Math.cos(a0) * pr, y: py + Math.sin(a0) * pr, z: pz },
      { x: px + Math.cos(a1) * pr, y: py + Math.sin(a1) * pr, z: pz },
      [0.20, 0.21, 0.23])
  }
  for (const a of [0, Math.PI / 2]) {
    const bw = r * 0.10
    B.quad2(
      { x: px + Math.cos(a) * pr, y: py + Math.sin(a) * pr, z: pz - bw },
      { x: px - Math.cos(a) * pr, y: py - Math.sin(a) * pr, z: pz - bw },
      { x: px - Math.cos(a) * pr, y: py - Math.sin(a) * pr, z: pz + bw },
      { x: px + Math.cos(a) * pr, y: py + Math.sin(a) * pr, z: pz + bw },
      INK)
  }
  B.quad2({ x: -r * 0.16, y: -r * 0.16, z: pz - r * 0.1 }, { x: r * 0.16, y: -r * 0.16, z: pz - r * 0.1 },
    { x: r * 0.16, y: r * 0.16, z: pz - r * 0.1 }, { x: -r * 0.16, y: r * 0.16, z: pz - r * 0.1 }, trim)

  // Tail: straight fin and a straight stabiliser, both unswept. The fin tip is
  // where `finTipY` says it is, because that is the number the legs are cut to.
  const tz = tailZ - L * 0.16
  const finTop = finTipY(spec)
  B.quad2({ x: 0, y: r * 0.42, z: tz }, { x: 0, y: r * 0.42, z: tz + L * 0.15 },
    { x: 0, y: finTop, z: tz + L * 0.15 }, { x: 0, y: finTop, z: tz + L * 0.06 }, trim)
  const hs = S * 0.34
  for (const sgn of [-1, 1]) {
    const y0 = r * 0.40
    B.quad2({ x: 0, y: y0, z: tz + L * 0.02 }, { x: 0, y: y0, z: tz + L * 0.12 },
      { x: sgn * hs, y: y0 + hs * 0.02, z: tz + L * 0.11 }, { x: sgn * hs, y: y0 + hs * 0.02, z: tz + L * 0.03 },
      shade(skin, 0.98))
  }
  return B.build()
}

/* --- Slender delta --------------------------------------------------------
   Concorde. Everything that is hard about this shape is the same thing: it is
   sixty-two metres long on a twenty-five metre span, so nothing here scales
   from an airliner. The wing is an ogee — the leading edge is a curve, not a
   straight sweep — and it runs from a quarter of the way down the fuselage all
   the way to the tail, which is why there is no horizontal tail to put
   anywhere. Four engines live in two rectangular boxes under the wing rather
   than in round pods on pylons.                                             */
function deltaMesh(spec, livery) {
  const B = makeBuilder()
  const L = spec.len, S = spec.span, r = spec.dia / 2
  const noseZ = -L * 0.46, tailZ = L * 0.54
  const accent = livery.accent
  const halfSpan = S / 2
  const skin = BONE

  /* Fuselage. A long thin tube with a very long, very fine nose — the needle
     is a third of the aeroplane. The last section droops, which is the one
     silhouette everyone recognises. */
  const SIDES = 8
  const ring = (z, rad, yOff = 0) => {
    const out = []
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2 + Math.PI / SIDES
      out.push({ x: Math.sin(a) * rad, y: Math.cos(a) * rad + yOff, z })
    }
    return out
  }
  const STATIONS = [
    [0.000, 0.03, -0.30], [0.055, 0.20, -0.20], [0.120, 0.42, -0.10],
    [0.190, 0.68, -0.02], [0.280, 0.92, 0.00], [0.360, 1.00, 0.00],
    [0.720, 1.00, 0.02], [0.840, 0.86, 0.10], [0.930, 0.58, 0.20],
    [1.000, 0.14, 0.28],
  ]
  const rings = STATIONS.map(([t, k, rise]) =>
    ring(noseZ + (tailZ - noseZ) * t, Math.max(r * k, 0.05), r * rise))
  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s], b = rings[s + 1]
    for (let i = 0; i < SIDES; i++) {
      const j = (i + 1) % SIDES
      const up = Math.cos((i / SIDES) * Math.PI * 2 + Math.PI / SIDES)
      // A cheatline this narrow is most of the paint scheme on a Concorde.
      const col = up > 0.30 ? skin : up < -0.55 ? livery.belly
        : (up > -0.05 ? accent : skin)
      B.quad(a[i], b[i], b[j], a[j], col)
    }
  }
  const n0 = rings[0], nL = rings[rings.length - 1]
  for (let i = 1; i < SIDES - 1; i++) {
    B.tri(n0[0], n0[i], n0[i + 1], skin)
    B.tri(nL[0], nL[i + 1], nL[i], livery.belly)
  }

  // The visor and the flight-deck glass, right at the top of the needle.
  for (const sgn of [-1, 1]) {
    B.quad2(
      { x: sgn * r * 0.42, y: r * 0.60, z: noseZ + L * 0.170 },
      { x: sgn * r * 0.66, y: r * 0.52, z: noseZ + L * 0.235 },
      { x: sgn * r * 0.66, y: r * 0.18, z: noseZ + L * 0.235 },
      { x: sgn * r * 0.42, y: r * 0.28, z: noseZ + L * 0.170 },
      GLASS)
  }

  /* The wing. Five spanwise stations trace the ogee: a very sharply swept
     inner strake, then the curve relaxing outboard. Each station carries its
     own leading and trailing edge, so the planform is the curve rather than a
     triangle pretending to be one. */
  const wz0 = noseZ + L * 0.245                 // where the strake starts
  const OGEE = [
    // fraction of half-span, leading-edge z, trailing-edge z, droop
    [0.00, 0.000, 0.985, 0.00],
    [0.28, 0.235, 0.985, 0.00],
    [0.55, 0.430, 0.965, -0.02],
    [0.80, 0.615, 0.930, -0.06],
    [1.00, 0.790, 0.880, -0.14],
  ]
  const yWing = -r * 0.62
  const at = (sgn, i) => {
    const [f, le, te, dr] = OGEE[i]
    const x = sgn * halfSpan * f
    const y = yWing + halfSpan * dr
    return {
      le: { x, y, z: wz0 + (tailZ - wz0) * le },
      te: { x, y, z: wz0 + (tailZ - wz0) * te },
    }
  }
  const thick = r * 0.34
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < OGEE.length - 1; i++) {
      const a = at(sgn, i), b = at(sgn, i + 1)
      const up = p => ({ x: p.x, y: p.y + thick * (1 - Math.abs(p.x) / halfSpan * 0.75), z: p.z })
      const top = shade(skin, 1.0), bot = shade(skin, 0.66)
      if (sgn > 0) {
        B.quad(up(a.le), up(b.le), up(b.te), up(a.te), top)
        B.quad(a.le, a.te, b.te, b.le, bot)
        B.quad(a.le, b.le, up(b.le), up(a.le), shade(skin, 0.9))
      } else {
        B.quad(up(a.te), up(b.te), up(b.le), up(a.le), top)
        B.quad(b.le, b.te, a.te, a.le, bot)
        B.quad(up(a.le), up(b.le), b.le, a.le, shade(skin, 0.9))
      }
      // Trailing edge, carrying the elevons.
      if (i === OGEE.length - 2) {
        const t = at(sgn, OGEE.length - 1)
        B.quad2(t.le, t.te, { x: t.te.x, y: t.te.y + thick * 0.25, z: t.te.z },
          { x: t.le.x, y: t.le.y + thick * 0.25, z: t.le.z }, accent)
      }
    }
  }

  /* Engines. Two rectangular boxes, each holding a pair, slung under the wing
     inboard. A Concorde nacelle is a square-section duct with a rectangular
     intake, and drawing it as two round pods would lose the aeroplane. */
  const stance = stanceHeight(spec)
  const boxW = r * 0.86, boxH = r * 0.60
  const bz0 = wz0 + (tailZ - wz0) * 0.50, bz1 = tailZ - L * 0.02
  for (const sgn of [-1, 1]) {
    const cx = sgn * halfSpan * 0.36
    const cy = -stance + Math.max(0.40, boxH * 0.55) + boxH
    const V = (x, y, z) => ({ x, y, z })
    const x0 = cx - boxW, x1 = cx + boxW, y0 = cy - boxH, y1 = cy + boxH
    B.quad(V(x0, y0, bz0), V(x1, y0, bz0), V(x1, y0, bz1), V(x0, y0, bz1), shade(GREY, 0.72))
    B.quad(V(x0, y1, bz1), V(x1, y1, bz1), V(x1, y1, bz0), V(x0, y1, bz0), shade(GREY, 1.0))
    B.quad(V(x1, y0, bz0), V(x1, y1, bz0), V(x1, y1, bz1), V(x1, y0, bz1), shade(GREY, 0.86))
    B.quad(V(x0, y0, bz1), V(x0, y1, bz1), V(x0, y1, bz0), V(x0, y0, bz0), shade(GREY, 0.78))
    // Two rectangular intakes at the front, two nozzles at the back.
    for (const s2 of [-1, 1]) {
      const ix = cx + s2 * boxW * 0.5, iw = boxW * 0.42
      B.quad(V(ix - iw, y0 + 0.1, bz0), V(ix + iw, y0 + 0.1, bz0),
        V(ix + iw, y1 - 0.1, bz0), V(ix - iw, y1 - 0.1, bz0), INK)
      B.quad(V(ix - iw, y1 - 0.1, bz1), V(ix + iw, y1 - 0.1, bz1),
        V(ix + iw, y0 + 0.1, bz1), V(ix - iw, y0 + 0.1, bz1), shade(INK, 1.5))
    }
  }

  // Fin: tall, sharply swept, no tailplane anywhere on the aeroplane.
  const tz = tailZ - L * 0.30
  const tip = finTipY(spec)
  B.quad2(
    { x: 0, y: r * 0.30, z: tz },
    { x: 0, y: r * 0.30, z: tz + L * 0.235 },
    { x: 0, y: tip, z: tz + L * 0.250 },
    { x: 0, y: tip, z: tz + L * 0.150 },
    accent)
  B.quad2(
    { x: 0, y: r * 0.30 + (tip - r * 0.30) * 0.30, z: tz + L * 0.075 },
    { x: 0, y: r * 0.30 + (tip - r * 0.30) * 0.30, z: tz + L * 0.225 },
    { x: 0, y: r * 0.30 + (tip - r * 0.30) * 0.60, z: tz + L * 0.238 },
    { x: 0, y: r * 0.30 + (tip - r * 0.30) * 0.60, z: tz + L * 0.120 },
    skin)
  return B.build()
}

/* --- Business jet ---------------------------------------------------------
   A T-tail with the engines on the back of the fuselage. Both of those exist
   for the same reason: put the engines where a passenger is not, and the wing
   is then free of pylons and the tail has to climb above the jet efflux to
   find clean air. It is a completely different silhouette from an airliner
   and it is drawn as one.                                                   */
function bizjetMesh(spec, livery) {
  const B = makeBuilder()
  const L = spec.len, S = spec.span, r = spec.dia / 2
  const noseZ = -L * 0.44, tailZ = L * 0.56
  const accent = livery.accent
  const halfSpan = S / 2
  const skin = BONE

  const SIDES = 8
  const ring = (z, rad, yOff = 0) => {
    const out = []
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2 + Math.PI / SIDES
      out.push({ x: Math.sin(a) * rad, y: Math.cos(a) * rad + yOff, z })
    }
    return out
  }
  const STATIONS = [
    [0.000, 0.03, -0.06], [0.040, 0.44, -0.04], [0.100, 0.78, -0.01],
    [0.170, 0.98, 0.00], [0.620, 1.00, 0.00], [0.760, 0.94, 0.06],
    [0.880, 0.72, 0.16], [0.960, 0.44, 0.26], [1.000, 0.12, 0.32],
  ]
  const rings = STATIONS.map(([t, k, rise]) =>
    ring(noseZ + (tailZ - noseZ) * t, Math.max(r * k, 0.04), r * rise))
  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s], b = rings[s + 1]
    for (let i = 0; i < SIDES; i++) {
      const j = (i + 1) % SIDES
      const up = Math.cos((i / SIDES) * Math.PI * 2 + Math.PI / SIDES)
      const col = up > 0.30 ? skin : up < -0.50 ? livery.belly
        : (up > 0.02 ? shade(accent, 1.0) : skin)
      B.quad(a[i], b[i], b[j], a[j], col)
    }
  }
  const n0 = rings[0], nL = rings[rings.length - 1]
  for (let i = 1; i < SIDES - 1; i++) {
    B.tri(n0[0], n0[i], n0[i + 1], skin)
    B.tri(nL[0], nL[i + 1], nL[i], livery.belly)
  }
  for (const sgn of [-1, 1]) {
    B.quad2(
      { x: sgn * r * 0.56, y: r * 0.52, z: noseZ + L * 0.055 },
      { x: sgn * r * 0.82, y: r * 0.44, z: noseZ + L * 0.135 },
      { x: sgn * r * 0.82, y: r * 0.08, z: noseZ + L * 0.135 },
      { x: sgn * r * 0.56, y: r * 0.18, z: noseZ + L * 0.055 },
      GLASS)
  }

  // Wing: swept, low, well forward of the engines, with a tall blended winglet.
  const rootLE = -L * 0.020, rootTE = L * 0.190
  const sweep = L * 0.235, tipChord = L * 0.062
  const dihedral = spec.dihedral || 0.055
  const thickRoot = r * 0.30, thickTip = r * 0.08
  for (const sgn of [-1, 1]) {
    const yr = -r * 0.66
    const rLE = { x: sgn * r * 0.80, y: yr, z: rootLE }
    const rTE = { x: sgn * r * 0.80, y: yr, z: rootTE }
    const tipY = yr + halfSpan * dihedral
    const tLE = { x: sgn * halfSpan, y: tipY, z: rootLE + sweep }
    const tTE = { x: sgn * halfSpan, y: tipY, z: rootLE + sweep + tipChord }
    const uLE = { x: rLE.x, y: yr + thickRoot, z: rLE.z }
    const uTE = { x: rTE.x, y: yr + thickRoot, z: rTE.z }
    const utLE = { x: tLE.x, y: tipY + thickTip, z: tLE.z }
    const utTE = { x: tTE.x, y: tipY + thickTip, z: tTE.z }
    const top = shade(GREY, 1.05), bot = shade(GREY, 0.7)
    if (sgn > 0) {
      B.quad(uLE, utLE, utTE, uTE, top)
      B.quad(rLE, rTE, tTE, tLE, bot)
      B.quad(rLE, tLE, utLE, uLE, shade(GREY, 0.95))
      B.quad(rTE, uTE, utTE, tTE, shade(GREY, 0.85))
    } else {
      B.quad(uTE, utTE, utLE, uLE, top)
      B.quad(tLE, tTE, rTE, rLE, bot)
      B.quad(uLE, utLE, tLE, rLE, shade(GREY, 0.95))
      B.quad(tTE, utTE, uTE, rTE, shade(GREY, 0.85))
    }
    // The winglet, which on this type is nearly as tall as the fuselage is deep.
    const wl = { x: sgn * halfSpan * 0.99, y: tipY + thickTip, z: rootLE + sweep + tipChord * 0.10 }
    const wlT = { x: sgn * halfSpan * 1.02, y: tipY + L * 0.070, z: rootLE + sweep + tipChord * 0.55 }
    B.quad2(wl, { x: wl.x, y: wl.y, z: wl.z + tipChord * 0.86 },
      { x: wlT.x, y: wlT.y, z: wlT.z + tipChord * 0.44 }, wlT, accent)
  }

  /* Engines: round pods on short stub pylons off the sides of the rear
     fuselage, above the wing and well aft of the cabin. */
  const nr = r * 0.46, nl = L * 0.155
  const ez = tailZ - L * 0.36
  for (const sgn of [-1, 1]) {
    const px = sgn * (r * 1.42), py = r * 0.22
    const cyl = (z, rad) => {
      const o = []
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8
        o.push({ x: px + Math.sin(a) * rad, y: py + Math.cos(a) * rad, z })
      }
      return o
    }
    const a = cyl(ez, nr * 0.90), b = cyl(ez + nl * 0.22, nr), c = cyl(ez + nl, nr * 0.78)
    for (const [p, q, col] of [[a, b, shade(GREY, 1.0)], [b, c, shade(GREY, 0.88)]]) {
      for (let i = 0; i < 8; i++) B.quad(p[i], q[i], q[(i + 1) % 8], p[(i + 1) % 8], col)
    }
    for (let i = 1; i < 7; i++) B.tri(a[0], a[i], a[i + 1], INK)
    for (let i = 1; i < 7; i++) B.tri(c[0], c[i + 1], c[i], shade(INK, 1.6))
    // Stub pylon inboard to the fuselage.
    B.quad2(
      { x: px, y: py - nr * 0.3, z: ez + nl * 0.20 },
      { x: px, y: py - nr * 0.3, z: ez + nl * 0.80 },
      { x: sgn * r * 0.30, y: py - nr * 0.1, z: ez + nl * 0.78 },
      { x: sgn * r * 0.30, y: py - nr * 0.1, z: ez + nl * 0.24 },
      shade(GREY, 0.8))
  }

  /* T-tail. The fin carries the tailplane at its very top, which is the line
     that tells this apart from everything else in the roster at any distance. */
  const tz = tailZ - L * 0.22
  const tip = finTipY(spec)
  const base = r * 0.32
  B.quad2(
    { x: 0, y: base, z: tz },
    { x: 0, y: base, z: tz + L * 0.165 },
    { x: 0, y: tip, z: tz + L * 0.185 },
    { x: 0, y: tip, z: tz + L * 0.110 },
    accent)
  const hs = S * 0.34, hRoot = L * 0.075, hSweep = L * 0.045
  for (const sgn of [-1, 1]) {
    const y0 = tip - r * 0.06
    B.quad2(
      { x: 0, y: y0, z: tz + L * 0.112 },
      { x: 0, y: y0, z: tz + L * 0.112 + hRoot },
      { x: sgn * hs, y: y0 + hs * 0.05, z: tz + L * 0.112 + hSweep + L * 0.030 },
      { x: sgn * hs, y: y0 + hs * 0.05, z: tz + L * 0.112 + hSweep },
      sgn > 0 ? shade(GREY, 1.02) : shade(GREY, 0.98))
  }
  return B.build()
}

/* --- Fighter --------------------------------------------------------------
   An F-16 is not a small airliner either. The body and the wing are blended
   rather than joined, the intake is a single duct under the nose, the canopy
   is a bubble sitting proud of the spine with nothing in front of it, and the
   whole tail is one fin plus two all-moving slabs and a pair of ventral fins.
   The exhaust is one nozzle on the centreline.                              */
function fighterMesh(spec, livery) {
  const B = makeBuilder()
  const L = spec.len, S = spec.span, r = spec.dia / 2
  const noseZ = -L * 0.50, tailZ = L * 0.50
  const halfSpan = S / 2
  const skin = livery.skin || [0.44, 0.48, 0.52]
  const dark = shade(skin, 0.74)
  const accent = livery.accent

  // Body: a six-sided section, widest over the wing, tapering both ways.
  const SIDES = 6
  const ring = (z, w, hgt, yOff = 0) => {
    const out = []
    for (let i = 0; i < SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2 + Math.PI / SIDES
      out.push({ x: Math.sin(a) * w, y: Math.cos(a) * hgt + yOff, z })
    }
    return out
  }
  const STATIONS = [
    // t, width scale, height scale, centreline rise
    [0.000, 0.05, 0.05, 0.10], [0.060, 0.34, 0.32, 0.08], [0.150, 0.62, 0.56, 0.04],
    [0.280, 0.86, 0.80, 0.00], [0.420, 1.00, 0.92, 0.00], [0.640, 1.00, 0.92, 0.00],
    [0.820, 0.92, 0.86, 0.00], [0.940, 0.80, 0.80, 0.00], [1.000, 0.72, 0.74, 0.00],
  ]
  const rings = STATIONS.map(([t, kw, kh, rise]) =>
    ring(noseZ + (tailZ - noseZ) * t, Math.max(r * kw, 0.04), Math.max(r * kh, 0.04), r * rise))
  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s], b = rings[s + 1]
    for (let i = 0; i < SIDES; i++) {
      const j = (i + 1) % SIDES
      const up = Math.cos((i / SIDES) * Math.PI * 2 + Math.PI / SIDES)
      // Two-tone tactical grey: darker on top, lighter underneath, no stripe.
      B.quad(a[i], b[i], b[j], a[j], up > 0.2 ? dark : up < -0.4 ? shade(skin, 1.12) : skin)
    }
  }
  const n0 = rings[0]
  for (let i = 1; i < SIDES - 1; i++) B.tri(n0[0], n0[i], n0[i + 1], shade(dark, 0.8))
  // Exhaust nozzle: a short dark cone, open at the back.
  const nL2 = rings[rings.length - 1]
  const nozz = ring(tailZ + L * 0.035, r * 0.56, r * 0.56)
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES
    B.quad(nL2[i], nozz[i], nozz[j], nL2[j], shade(GREY, 0.5))
  }
  for (let i = 1; i < SIDES - 1; i++) B.tri(nozz[0], nozz[i], nozz[i + 1], [0.05, 0.05, 0.06])

  // Chin intake: a rectangular duct under the forward fuselage.
  const iz0 = noseZ + L * 0.175, iz1 = noseZ + L * 0.36
  const iw = r * 0.72, iy0 = -r * 1.34, iy1 = -r * 0.62
  const V = (x, y, z) => ({ x, y, z })
  B.quad(V(-iw, iy0, iz0), V(iw, iy0, iz0), V(iw, iy0, iz1), V(-iw, iy0, iz1), shade(skin, 1.08))
  B.quad(V(iw, iy0, iz0), V(iw, iy1, iz0), V(iw, iy1, iz1), V(iw, iy0, iz1), skin)
  B.quad(V(-iw, iy1, iz0), V(-iw, iy0, iz0), V(-iw, iy0, iz1), V(-iw, iy1, iz1), shade(skin, 0.92))
  B.quad(V(-iw, iy1, iz0), V(iw, iy1, iz0), V(iw, iy0, iz0), V(-iw, iy0, iz0), INK)

  // Bubble canopy: a faceted dome on the spine, with a clear view forward.
  const cz0 = noseZ + L * 0.185, cz1 = noseZ + L * 0.395
  const cw = r * 0.52, ch = r * 0.92
  B.quad2(V(-cw, r * 0.52, cz0), V(cw, r * 0.52, cz0), V(cw * 0.8, ch, cz0 + L * 0.045), V(-cw * 0.8, ch, cz0 + L * 0.045), GLASS)
  B.quad2(V(-cw * 0.8, ch, cz0 + L * 0.045), V(cw * 0.8, ch, cz0 + L * 0.045), V(cw * 0.8, ch, cz1 - L * 0.045), V(-cw * 0.8, ch, cz1 - L * 0.045), GLASS)
  for (const sgn of [-1, 1]) {
    B.quad2(
      V(sgn * cw, r * 0.52, cz0), V(sgn * cw * 0.8, ch, cz0 + L * 0.045),
      V(sgn * cw * 0.8, ch, cz1 - L * 0.045), V(sgn * cw, r * 0.52, cz1), GLASS)
  }
  B.quad2(V(-cw * 0.8, ch, cz1 - L * 0.045), V(cw * 0.8, ch, cz1 - L * 0.045),
    V(cw * 0.7, r * 0.62, cz1), V(-cw * 0.7, r * 0.62, cz1), dark)

  /* Wing: a cropped delta with a leading-edge root extension running forward
     along the body. The strake is why this aeroplane keeps flying at angles
     that would have let go of a plain delta. */
  const wLE = -L * 0.030, wTE = L * 0.300
  const wSweep = L * 0.185, tipC = L * 0.075
  const yW = -r * 0.16
  const thick = r * 0.16
  for (const sgn of [-1, 1]) {
    const rLE = { x: sgn * r * 0.90, y: yW, z: wLE }
    const rTE = { x: sgn * r * 0.90, y: yW, z: wTE }
    const tLE = { x: sgn * halfSpan, y: yW, z: wLE + wSweep }
    const tTE = { x: sgn * halfSpan, y: yW, z: wLE + wSweep + tipC }
    const up = p => ({ x: p.x, y: p.y + thick, z: p.z })
    if (sgn > 0) {
      B.quad(up(rLE), up(tLE), up(tTE), up(rTE), shade(dark, 1.06))
      B.quad(rLE, rTE, tTE, tLE, shade(skin, 1.06))
      B.quad(rLE, tLE, up(tLE), up(rLE), skin)
      B.quad(rTE, up(rTE), up(tTE), tTE, shade(skin, 0.9))
    } else {
      B.quad(up(rTE), up(tTE), up(tLE), up(rLE), shade(dark, 1.06))
      B.quad(tLE, tTE, rTE, rLE, shade(skin, 1.06))
      B.quad(up(rLE), up(tLE), tLE, rLE, skin)
      B.quad(tTE, up(tTE), up(rTE), rTE, shade(skin, 0.9))
    }
    // Leading-edge root extension, running forward to under the canopy.
    B.quad2(
      { x: sgn * r * 0.86, y: yW + thick * 0.5, z: wLE },
      { x: sgn * r * 0.30, y: yW + thick * 0.5, z: noseZ + L * 0.30 },
      { x: sgn * r * 0.24, y: yW + thick * 0.5, z: noseZ + L * 0.30 },
      { x: sgn * r * 0.80, y: yW + thick * 0.5, z: wLE + L * 0.02 },
      shade(dark, 1.02))
    // Ventral fin under the tail, canted outboard.
    B.quad2(
      { x: sgn * r * 0.48, y: -r * 0.78, z: tailZ - L * 0.145 },
      { x: sgn * r * 0.48, y: -r * 0.78, z: tailZ - L * 0.015 },
      { x: sgn * r * 0.94, y: -r * 1.42, z: tailZ - L * 0.020 },
      { x: sgn * r * 0.86, y: -r * 1.42, z: tailZ - L * 0.105 },
      shade(skin, 0.96))
    // All-moving stabilator.
    const sh = S * 0.30, sz = tailZ - L * 0.150
    B.quad2(
      { x: sgn * r * 0.72, y: -r * 0.05, z: sz },
      { x: sgn * r * 0.72, y: -r * 0.05, z: sz + L * 0.125 },
      { x: sgn * sh, y: -r * 0.05, z: sz + L * 0.135 },
      { x: sgn * sh, y: -r * 0.05, z: sz + L * 0.072 },
      sgn > 0 ? shade(dark, 1.04) : shade(dark, 0.98))
  }

  /* Fins. One upright on a fourth-generation fighter; TWO, canted outward, on
     both of the fifth-generation ones — and the cant is not styling. A vertical
     surface returns a radar signal straight back to whatever painted it, and
     tilting it throws that return somewhere else. It is the single feature
     that reads "stealth" at a glance, which is why an F-22 and an F-35 look
     more like each other than either looks like an F-16. */
  const tip = finTipY(spec)
  const fz = tailZ - L * 0.325
  const finPanel = (xBase, cant, height) => {
    const y0 = r * 0.48
    const dx = (height - y0) * Math.tan(cant)
    B.quad2(
      { x: xBase, y: y0, z: fz },
      { x: xBase, y: y0, z: fz + L * 0.325 },
      { x: xBase + dx, y: height, z: fz + L * 0.330 },
      { x: xBase + dx, y: height, z: fz + L * 0.185 },
      shade(skin, 1.02))
  }
  if (spec.twinFin) {
    for (const sgn of [-1, 1]) finPanel(sgn * r * 0.62, sgn * 0.48, tip)
  } else {
    finPanel(0, 0, tip)
    B.quad2(
      { x: 0, y: r * 0.48 + (tip - r * 0.48) * 0.55, z: fz + L * 0.120 },
      { x: 0, y: r * 0.48 + (tip - r * 0.48) * 0.55, z: fz + L * 0.300 },
      { x: 0, y: r * 0.48 + (tip - r * 0.48) * 0.86, z: fz + L * 0.305 },
      { x: 0, y: r * 0.48 + (tip - r * 0.48) * 0.86, z: fz + L * 0.225 },
      accent)
  }

  /* Chines. A hard edge running from the radome back along the forebody, which
     is what the two stealth fighters have instead of a round nose: it holds
     the vortex at high alpha and it reflects sideways rather than forward. */
  if (spec.chined) {
    for (const sgn of [-1, 1]) {
      B.quad2(
        { x: 0, y: r * 0.10, z: noseZ },
        { x: sgn * r * 0.90, y: r * 0.02, z: noseZ + L * 0.30 },
        { x: sgn * r * 0.86, y: -r * 0.10, z: noseZ + L * 0.42 },
        { x: 0, y: -r * 0.02, z: noseZ + L * 0.02 },
        shade(dark, 1.04))
    }
  }
  return B.build()
}

/* --- Flying wing ----------------------------------------------------------
   A B-2 has no fuselage and no tail. The whole aeroplane is one cranked
   double-W planform with the crew and the engines buried in the thickest part
   of it, and it holds its heading with split drag rudders at the tips rather
   than with a fin. Built from the same ring-and-quad primitives as everything
   else, but there is nothing here to reuse from the airliner: an aeroplane
   with no fin cannot go through a builder whose stance is measured from the
   top of one.                                                               */
function wingMesh(spec, livery) {
  const B = makeBuilder()
  const L = spec.len, S = spec.span, r = spec.dia / 2
  const half = S / 2
  const skin = livery.skin || [0.26, 0.28, 0.31]
  const dark = shade(skin, 0.80)
  const noseZ = -L * 0.46, tailZ = L * 0.54

  /* The planform, as spanwise stations. Each is a leading and trailing edge
     and a thickness, and the sawtooth trailing edge is the shape everyone
     recognises: four W points across the back. */
  const ST = [
    // fraction of half-span, LE z, TE z, thickness fraction
    [0.00, 0.00, 1.00, 1.00],
    [0.16, 0.16, 0.78, 0.72],
    [0.34, 0.34, 0.95, 0.44],
    [0.52, 0.52, 0.70, 0.28],
    [0.72, 0.70, 0.88, 0.16],
    [1.00, 0.96, 1.00, 0.05],
  ]
  const at = (sgn, i) => {
    const [f, le, te, th] = ST[i]
    const x = sgn * half * f
    return {
      le: { x, y: 0, z: noseZ + (tailZ - noseZ) * le },
      te: { x, y: 0, z: noseZ + (tailZ - noseZ) * te },
      t: r * th,
    }
  }
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < ST.length - 1; i++) {
      const a = at(sgn, i), b = at(sgn, i + 1)
      const up = (p, t) => ({ x: p.x, y: p.y + t, z: p.z })
      const dn = (p, t) => ({ x: p.x, y: p.y - t * 0.34, z: p.z })
      if (sgn > 0) {
        B.quad(up(a.le, a.t), up(b.le, b.t), up(b.te, b.t), up(a.te, a.t), shade(skin, 1.04))
        B.quad(dn(a.le, a.t), dn(a.te, a.t), dn(b.te, b.t), dn(b.le, b.t), dark)
        B.quad(dn(a.le, a.t), dn(b.le, b.t), up(b.le, b.t), up(a.le, a.t), shade(skin, 0.94))
        B.quad(dn(a.te, a.t), up(a.te, a.t), up(b.te, b.t), dn(b.te, b.t), shade(dark, 0.92))
      } else {
        B.quad(up(a.te, a.t), up(b.te, b.t), up(b.le, b.t), up(a.le, a.t), shade(skin, 1.04))
        B.quad(dn(b.le, b.t), dn(b.te, b.t), dn(a.te, a.t), dn(a.le, a.t), dark)
        B.quad(up(a.le, a.t), up(b.le, b.t), dn(b.le, b.t), dn(a.le, a.t), shade(skin, 0.94))
        B.quad(dn(b.te, b.t), up(b.te, b.t), up(a.te, a.t), dn(a.te, a.t), shade(dark, 0.92))
      }
    }
  }

  // The cockpit blister, low and faired into the centre section.
  const cz = noseZ + L * 0.20
  for (const sgn of [-1, 1]) {
    B.quad2(
      { x: sgn * r * 0.30, y: r * 0.98, z: cz },
      { x: sgn * r * 0.46, y: r * 1.22, z: cz + L * 0.12 },
      { x: sgn * r * 0.46, y: r * 0.96, z: cz + L * 0.26 },
      { x: sgn * r * 0.30, y: r * 0.92, z: cz + L * 0.02 },
      GLASS)
  }

  /* Intakes on TOP of the wing, which is the other giveaway: nothing on a
     stealth bomber may look down at a radar, including its compressor faces. */
  for (const sgn of [-1, 1]) {
    const ix = sgn * half * 0.20, iw = half * 0.075
    const iz = noseZ + L * 0.42
    B.quad(
      { x: ix - iw, y: r * 0.98, z: iz }, { x: ix + iw, y: r * 0.98, z: iz },
      { x: ix + iw, y: r * 1.16, z: iz + L * 0.10 }, { x: ix - iw, y: r * 1.16, z: iz + L * 0.10 },
      shade(dark, 0.7))
    B.quad(
      { x: ix - iw, y: r * 0.98, z: iz }, { x: ix - iw, y: r * 1.16, z: iz + L * 0.10 },
      { x: ix + iw, y: r * 1.16, z: iz + L * 0.10 }, { x: ix + iw, y: r * 0.98, z: iz },
      INK)
  }
  return B.build()
}

/* --- Shock cone -----------------------------------------------------------
   The Prandtl-Glauert condensation cloud, as real geometry rather than a
   cloud of billboards.

   Why geometry. The effect is a SHELL: a thin surface of vapour standing off
   the airframe, bright where you look along it and clear where you look
   through it. Built out of sprites it can only ever be a smear that streams
   away, because a sprite has no surface to look along and no way to stay put
   on an aeroplane doing three hundred metres a second. Built as a shell, the
   grazing-angle term in the ghost shader does the whole job for free.

   The shape is the Mach cone, and its half-angle is not a guess: mu = asin(1/M)
   is the angle of the shock a body makes at Mach M, which is 90 degrees at
   Mach 1 and closes as it goes faster. That is why the cloud is a flat disc
   standing on the aeroplane as it passes through the barrier and a long narrow
   cone once it is past — and why the photographs that everyone knows, all
   taken at just about Mach 1, show a disc.

   Returned as a unit shape running from the origin down +Z, one metre long
   and one metre in radius, so the caller scales it per frame from the Mach
   number without rebuilding anything.                                       */
export function shockConeMesh(segments = 40, rings = 7) {
  const B = makeBuilder()
  const white = [1, 1, 1]
  const ringAt = t => {
    // A slightly convex profile rather than a straight cone: the real shell
    // bells out at its base where the pressure recovers.
    const rad = Math.pow(t, 0.72)
    const out = []
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2
      out.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad, z: t })
    }
    return out
  }
  let prev = ringAt(0.001)
  for (let r = 1; r <= rings; r++) {
    const cur = ringAt(r / rings)
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments
      B.quad(prev[i], cur[i], cur[j], prev[j], white)
    }
    prev = cur
  }
  return B.build()
}
