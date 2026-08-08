/* ==========================================================================
   Plan-view airframe generator.

   Draws each type from its REAL published dimensions, in one shared coordinate
   space, so the four aircraft on the fleet page are at true relative scale to
   each other. The A321 really is longer than the 737-800; the drawing should
   not have to be taken on faith.

   These are type dimensions (Boeing/Airbus published figures), not claims about
   AXZ's operation. Nothing here asserts anything the site did not already say —
   the site already names all four types.
   ========================================================================== */

// length / wingspan / fuselage diameter / overall height, metres.
export const TYPES = {
  'b-737x':  { name: 'Boeing 737-800',     len: 39.47, span: 35.79, dia: 3.76, h: 12.55, engines: 2, cargo: false },
  'b-321x':  { name: 'Airbus A321',        len: 44.51, span: 35.80, dia: 3.95, h: 11.76, engines: 2, cargo: false },
  'b-1717':  { name: 'Boeing 737-800',     len: 39.47, span: 35.79, dia: 3.76, h: 12.55, engines: 2, cargo: false },
  'b-0001f': { name: 'Boeing 737-800BCF',  len: 39.47, span: 35.79, dia: 3.76, h: 12.55, engines: 2, cargo: true },
}

const n = v => Math.round(v * 100) / 100

/**
 * Plan view, nose at x=0, centreline at y=0, one unit = one metre.
 * Returns { paths, len, span, viewBox } for embedding in a shared-scale row.
 */
export function airframe(spec) {
  const { len: L, span: S, dia: D } = spec
  const r = D / 2                    // fuselage half-width
  const h = S / 2                    // half-span

  // Fuselage: rounded nose, constant section, tail cone tapering to the fin.
  const noseEnd = L * 0.115
  const tailStart = L * 0.72
  const fuse = [
    `M 0 0`,
    `C ${n(L * 0.02)} ${n(-r * 0.62)} ${n(L * 0.06)} ${n(-r)} ${n(noseEnd)} ${n(-r)}`,
    `L ${n(tailStart)} ${n(-r)}`,
    `C ${n(L * 0.86)} ${n(-r * 0.92)} ${n(L * 0.95)} ${n(-r * 0.42)} ${n(L)} ${n(-r * 0.10)}`,
    `L ${n(L)} ${n(r * 0.10)}`,
    `C ${n(L * 0.95)} ${n(r * 0.42)} ${n(L * 0.86)} ${n(r * 0.92)} ${n(tailStart)} ${n(r)}`,
    `L ${n(noseEnd)} ${n(r)}`,
    `C ${n(L * 0.06)} ${n(r)} ${n(L * 0.02)} ${n(r * 0.62)} 0 0`,
    'Z',
  ].join(' ')

  // Wing: swept leading edge from the root, straight trailing edge, raked tip.
  const wRootLE = L * 0.395
  const wRootTE = L * 0.585
  const wTipLE = L * 0.60
  const wTipTE = L * 0.655
  const wing = side => [
    `M ${n(wRootLE)} ${n(side * r * 0.86)}`,
    `L ${n(wTipLE)} ${n(side * h)}`,
    `L ${n(wTipTE)} ${n(side * h)}`,
    `L ${n(wRootTE)} ${n(side * r * 0.86)}`,
    'Z',
  ].join(' ')

  // Horizontal stabiliser, ~40% of wingspan on a narrowbody.
  const sh = h * 0.40
  const sRootLE = L * 0.885
  const sRootTE = L * 0.975
  const sTipLE = L * 0.945
  const sTipTE = L * 0.99
  const stab = side => [
    `M ${n(sRootLE)} ${n(side * r * 0.45)}`,
    `L ${n(sTipLE)} ${n(side * sh)}`,
    `L ${n(sTipTE)} ${n(side * sh)}`,
    `L ${n(sRootTE)} ${n(side * r * 0.45)}`,
    'Z',
  ].join(' ')

  // Engine nacelles. A nacelle hangs UNDER the wing and projects forward of the
  // leading edge — so it has to straddle the LE at its own spanwise station,
  // not sit at a fixed x. Find where the swept LE actually is at that station.
  const eFrac = 0.34                       // spanwise position, fraction of half-span
  const ey = h * eFrac
  const leAtEngine = wRootLE + (wTipLE - wRootLE) * eFrac
  const eLen = L * 0.115
  const eR = D * 0.27
  const nacelle = side => {
    const x0 = leAtEngine - eLen * 0.62    // ~62% of the nacelle ahead of the LE
    const y = side * ey
    const rr = eR * 0.34                   // slightly rounded intake/exhaust
    return [
      `M ${n(x0 + rr)} ${n(y - eR)}`,
      `L ${n(x0 + eLen - rr)} ${n(y - eR)}`,
      `Q ${n(x0 + eLen)} ${n(y - eR)} ${n(x0 + eLen)} ${n(y - eR + rr)}`,
      `L ${n(x0 + eLen)} ${n(y + eR - rr)}`,
      `Q ${n(x0 + eLen)} ${n(y + eR)} ${n(x0 + eLen - rr)} ${n(y + eR)}`,
      `L ${n(x0 + rr)} ${n(y + eR)}`,
      `Q ${n(x0)} ${n(y + eR)} ${n(x0)} ${n(y + eR - rr)}`,
      `L ${n(x0)} ${n(y - eR + rr)}`,
      `Q ${n(x0)} ${n(y - eR)} ${n(x0 + rr)} ${n(y - eR)}`,
      'Z',
    ].join(' ')
  }

  // Fin. Seen from directly above, a vertical tail shows only its THICKNESS —
  // well under a metre, far narrower than the tail cone it stands on. Drawn as
  // a filled wedge it pokes outside the fuselage silhouette and leaves slivers,
  // so it is a stroked centreline spine instead. Render with fill="none".
  const fin = `M ${n(L * 0.775)} 0 L ${n(L * 0.99)} 0`

  // Cargo mark: the main-deck freight door, which is what a BCF conversion
  // actually adds. Drawn only on the freighter.
  const door = spec.cargo
    ? `M ${n(L * 0.20)} ${n(-r)} L ${n(L * 0.20)} ${n(-r * 0.34)} L ${n(L * 0.36)} ${n(-r * 0.34)} L ${n(L * 0.36)} ${n(-r)}`
    : null

  const pad = 1.2
  return {
    ...spec,
    viewBox: `${-pad} ${n(-h - pad)} ${n(L + pad * 2)} ${n(S + pad * 2)}`,
    paths: {
      fuse,
      wings: [wing(-1), wing(1)],
      stabs: [stab(-1), stab(1)],
      nacelles: [nacelle(-1), nacelle(1)],
      fin,
      door,
    },
  }
}

/** Longest type in the set — everything is scaled against it. */
export function scaleBase(keys) {
  return Math.max(...keys.map(k => TYPES[k].len))
}

/**
 * Side elevation, nose at x=0, fuselage centreline at y=0, up is negative.
 * Same metre-per-unit scale as airframe(), so a plan view and a side view of
 * the same type line up exactly when placed one above the other.
 */
export function sideview(spec) {
  const { len: L, dia: D } = spec
  const r = D / 2
  const H = spec.h || D * 3.3          // overall height, ground to fin tip
  const gear = r + (H - r) * 0.16      // approximate belly-to-ground clearance

  // Fuselage: nose, constant section, upswept tail cone.
  const noseEnd = L * 0.115
  const tailStart = L * 0.70
  const fuse = [
    `M 0 ${n(-r * 0.10)}`,
    `C ${n(L * 0.02)} ${n(-r * 0.72)} ${n(L * 0.06)} ${n(-r)} ${n(noseEnd)} ${n(-r)}`,
    `L ${n(tailStart)} ${n(-r)}`,
    `C ${n(L * 0.86)} ${n(-r * 1.02)} ${n(L * 0.95)} ${n(-r * 1.10)} ${n(L)} ${n(-r * 1.15)}`,
    `L ${n(L)} ${n(-r * 0.55)}`,
    `C ${n(L * 0.92)} ${n(r * 0.30)} ${n(L * 0.82)} ${n(r * 0.86)} ${n(L * 0.62)} ${n(r)}`,
    `L ${n(noseEnd)} ${n(r)}`,
    `C ${n(L * 0.06)} ${n(r)} ${n(L * 0.02)} ${n(r * 0.72)} 0 ${n(-r * 0.10)}`,
    'Z',
  ].join(' ')

  // Fin: swept leading edge, the tallest thing on the aircraft.
  const finTop = -(H - gear)
  const fin = [
    `M ${n(L * 0.70)} ${n(-r * 0.95)}`,
    `L ${n(L * 0.925)} ${n(finTop)}`,
    `L ${n(L * 1.0)} ${n(finTop)}`,
    `L ${n(L * 0.995)} ${n(-r * 1.12)}`,
    'Z',
  ].join(' ')

  // Tailplane, seen edge-on as a shallow wedge off the tail cone.
  const stab = [
    `M ${n(L * 0.90)} ${n(-r * 0.72)}`,
    `L ${n(L * 1.03)} ${n(-r * 1.30)}`,
    `L ${n(L * 1.05)} ${n(-r * 1.16)}`,
    `L ${n(L * 0.94)} ${n(-r * 0.55)}`,
    'Z',
  ].join(' ')

  // Wing edge-on, and the nacelle slung under it.
  const wing = [
    `M ${n(L * 0.40)} ${n(r * 0.42)}`,
    `L ${n(L * 0.66)} ${n(r * 0.10)}`,
    `L ${n(L * 0.62)} ${n(r * 0.02)}`,
    `L ${n(L * 0.395)} ${n(r * 0.30)}`,
    'Z',
  ].join(' ')
  const eR = D * 0.27
  const ex = L * 0.365
  const ey = r + eR * 0.42   // keeps real clearance under the nacelle
  const nacelle = [
    `M ${n(ex)} ${n(ey - eR)}`,
    `L ${n(ex + L * 0.115)} ${n(ey - eR * 0.86)}`,
    `L ${n(ex + L * 0.115)} ${n(ey + eR * 0.86)}`,
    `L ${n(ex)} ${n(ey + eR)}`,
    'Z',
  ].join(' ')

  // Window line and door, the details that make it read as an airliner.
  const win = `M ${n(L * 0.16)} ${n(-r * 0.34)} L ${n(L * 0.80)} ${n(-r * 0.34)}`
  const door = spec.cargo
    ? `M ${n(L * 0.20)} ${n(-r * 0.92)} L ${n(L * 0.20)} ${n(-r * 0.10)} L ${n(L * 0.36)} ${n(-r * 0.10)} L ${n(L * 0.36)} ${n(-r * 0.92)}`
    : null

  // Gear: a plain stance line rather than drawn bogies at this size.
  const ground = `M 0 ${n(gear)} L ${n(L)} ${n(gear)}`
  const legs = [
    `M ${n(L * 0.165)} ${n(r * 0.98)} L ${n(L * 0.165)} ${n(gear)}`,
    `M ${n(L * 0.47)} ${n(r * 0.92)} L ${n(L * 0.47)} ${n(gear)}`,
  ]

  const pad = 1.2
  const top = finTop - pad
  return {
    ...spec,
    viewBox: `${-pad} ${n(top)} ${n(L + pad * 2)} ${n(gear - top + pad)}`,
    paths: { fuse, fin, stab, wing, nacelle, win, door, ground, legs },
  }
}
