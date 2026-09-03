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

/* ==========================================================================
   Simulator types.

   IMPORTANT, and the reason this is a separate table from TYPES above:
   AIR XIAO ZE OPERATES FOUR AIRCRAFT. That is what the site says and it is
   not this file's business to change it. Everything below with `axz: false`
   is a type the SIMULATOR can fly, not an aeroplane the airline owns, and the
   simulator page says so in as many words. The fleet page keeps reading TYPES
   and is untouched.

   The 747-400 earns its place: the site's own top story is a photograph of
   B-2472, an Air China 747-400 at Hongqiao. The Cessna is here because a
   1.1-tonne single is the hardest possible test of a flight model tuned on a
   65-tonne twinjet, and if the same equations fly both then they are equations
   rather than a lookup table. Concorde, the Gulfstream and the F-16 are here
   for the same reason from the other end: a slender delta that lands at
   twenty-four degrees of alpha, a business jet with its engines on the tail,
   and a fighter with more thrust than weight are three shapes the equations
   had never been asked to fly.

   Every figure is the manufacturer's published one. Mass is a typical
   operating weight, not MTOW, because that is what you actually fly at.

   THRUST IS PER ENGINE. It has to be said in capitals because it was not, and
   the ambiguity cost the two newest aeroplanes most of their engines: the
   airliners carried a total and the new types carried a per-engine figure, the
   flight model applied whatever it found once along the nose, and Concorde
   flew a transatlantic aeroplane on a quarter of its thrust while the
   Gulfstream flew on half. The column in the roster says "×4" and now means
   it.

   What is NOT written down here is anything that can be derived. The
   lift-curve slope comes out of the wingspan and the wing area through
   lifting-line theory, so a 1.83 aspect-ratio delta gets a slope of 2.9 per
   radian and a 10.3 airliner wing gets 5.2, from one formula and no per-type
   fudge. That is the difference between eleven aeroplanes and eleven lookup
   tables.
   ========================================================================== */

/* --- Flap schedules -------------------------------------------------------
   Extra lift, extra drag, the stall angle the device buys, and the speed it
   may be extended at. Four families, because the devices really are different
   hardware: an airliner's slats and triple-slotted Fowlers are not a business
   jet's single-slotted flap, a fighter's manoeuvre flaps are not either, and
   Concorde had neither. Referenced by key so eleven types cost four tables. */
export const FLAP_SETS = {
  /* Slats plus Fowler flaps. The 737/747/787 numbers this was tuned on, and a
     Boeing quadrant is marked in DEGREES, so the detent is its own label. */
  airliner: [
    { deg: 0, label: 'UP', dCL: 0.00, dCD: 0.0000, dStall: 0.0, vfe: 9999 },
    { deg: 5, label: '5', dCL: 0.28, dCD: 0.0055, dStall: 0.7, vfe: 250 },
    { deg: 15, label: '15', dCL: 0.62, dCD: 0.0170, dStall: 1.2, vfe: 210 },
    { deg: 30, label: '30', dCL: 1.05, dCD: 0.0480, dStall: 1.6, vfe: 175 },
    { deg: 40, label: '40', dCL: 1.28, dCD: 0.0850, dStall: 1.4, vfe: 162 },
  ],
  /* The same devices, but an Airbus lever is not marked in degrees. It has
     five positions called UP, 1, 2, 3 and FULL, each of which commands its own
     slat and flap pair, and printing "15" on an A320 is printing a number that
     appears nowhere in that flight deck. Same aerodynamics, right names. */
  airbus: [
    { deg: 0, label: 'UP', dCL: 0.00, dCD: 0.0000, dStall: 0.0, vfe: 9999 },
    { deg: 10, label: '1', dCL: 0.28, dCD: 0.0055, dStall: 0.7, vfe: 230 },
    { deg: 15, label: '2', dCL: 0.62, dCD: 0.0170, dStall: 1.2, vfe: 200 },
    { deg: 20, label: '3', dCL: 1.05, dCD: 0.0480, dStall: 1.6, vfe: 185 },
    { deg: 35, label: 'FULL', dCL: 1.28, dCD: 0.0850, dStall: 1.4, vfe: 177 },
  ],
  // Single-slotted flap, no leading-edge device over most of the span, which
  // is why a business jet lands fast for how light it is.
  bizjet: [
    { deg: 0, label: 'UP', dCL: 0.00, dCD: 0.0000, dStall: 0.0, vfe: 9999 },
    { deg: 10, label: '10', dCL: 0.20, dCD: 0.0060, dStall: 0.4, vfe: 250 },
    { deg: 20, label: '20', dCL: 0.38, dCD: 0.0190, dStall: 0.7, vfe: 210 },
    { deg: 39, label: '39', dCL: 0.55, dCD: 0.0520, dStall: 0.9, vfe: 180 },
  ],
  // Leading-edge and trailing-edge manoeuvre flaps. Modest lift, and they are
  // there to move the stall angle rather than to make a big low-speed wing.
  fighter: [
    { deg: 0, label: 'UP', dCL: 0.00, dCD: 0.0000, dStall: 0.0, vfe: 9999 },
    { deg: 20, label: 'MAN', dCL: 0.30, dCD: 0.0230, dStall: 1.5, vfe: 300 },
  ],
  // Plain flaps on a strut-braced wing that already has plenty of area.
  light: [
    { deg: 0, label: 'UP', dCL: 0.00, dCD: 0.0000, dStall: 0.0, vfe: 9999 },
    { deg: 10, label: '10', dCL: 0.42, dCD: 0.0090, dStall: 0.8, vfe: 110 },
    { deg: 20, label: '20', dCL: 0.78, dCD: 0.0260, dStall: 1.3, vfe: 95 },
    { deg: 30, label: '30', dCL: 1.05, dCD: 0.0560, dStall: 1.6, vfe: 85 },
  ],
  /* Concorde had no flaps and no slats. The wing makes its landing lift out of
     alpha and the vortices over its leading edge, which is why it comes down
     the slope at fourteen degrees nose-up with the nose drooped so the crew
     can see. One detent, and the flap key does nothing. */
  none: [
    { deg: 0, label: 'NONE', dCL: 0.00, dCD: 0.0000, dStall: 0.0, vfe: 9999 },
  ],
}

/** The detent an approach is flown at. Clamped per type to what it has. */
export const LANDING_DETENT = 3

/**
 * Lift-curve slope per radian, from lifting-line theory on the published
 * span and wing area. A finite wing loses slope to its own downwash, and how
 * much it loses is exactly the aspect ratio — which is why this is derived
 * rather than typed in eleven times.
 */
export function liftSlope(span, wingArea) {
  const AR = (span * span) / wingArea
  return (2 * Math.PI) / (1 + (2 * Math.PI) / (Math.PI * 0.95 * AR))
}

export const SIM_TYPES = {
  'b-737x': {
    name: 'Boeing 737-800', axz: true, reg: 'B-737X',
    len: 39.47, span: 35.79, dia: 3.76, h: 12.55, engines: 2,
    mass: 65000, wingArea: 124.6, thrust: 121400, vne: 340, mmo: 0.82,
    mdd: 0.78, waveDrag: 0.082, machInlet: 1.0,
    shape: 'jet', flapSet: 'airliner', engine: 'turbofan',
    // Flight-deck alert voice. A Boeing says AIRSPEED LOW.
    warnPack: 'boeing',
    cl0: 0.15, cd0: 0.021, oswald: 0.80, stallDeg: 15.5,
    ceiling: 12500, tailStrikeDeg: 11, rollRate: 35, nLimit: 2.5, acShift: 0.16, track: 5.72,
  },
  'b-321x': {
    name: 'Airbus A321', axz: true, reg: 'B-321X',
    len: 44.51, span: 35.80, dia: 3.95, h: 11.76, engines: 2,
    mass: 71000, wingArea: 122.6, thrust: 143100, vne: 350, mmo: 0.82,
    mdd: 0.78, waveDrag: 0.095, machInlet: 1.0,
    shape: 'jet', flapSet: 'airbus', engine: 'turbofan',
    // Flight-deck alert voice. An Airbus gives the cricket and STALL.
    warnPack: 'airbus',
    cl0: 0.15, cd0: 0.021, oswald: 0.80, stallDeg: 15.5,
    // The stretch is what makes an A321 strike its tail earlier than an A320.
    ceiling: 11900, tailStrikeDeg: 9.7, rollRate: 25, nLimit: 2.5, acShift: 0.16, track: 7.59,
  },
  'b-1717': {
    name: 'Boeing 737-800', axz: true, reg: 'B-1717',
    len: 39.47, span: 35.79, dia: 3.76, h: 12.55, engines: 2,
    mass: 65000, wingArea: 124.6, thrust: 121400, vne: 340, mmo: 0.82,
    mdd: 0.78, waveDrag: 0.082, machInlet: 1.0,
    shape: 'jet', flapSet: 'airliner', engine: 'turbofan',
    // Flight-deck alert voice. A Boeing says AIRSPEED LOW.
    warnPack: 'boeing',
    cl0: 0.15, cd0: 0.021, oswald: 0.80, stallDeg: 15.5,
    ceiling: 12500, tailStrikeDeg: 11, rollRate: 35, nLimit: 2.5, acShift: 0.16, track: 5.72,
  },
  'b-0001f': {
    name: 'Boeing 737-800BCF', axz: true, reg: 'B-0001F', cargo: true,
    len: 39.47, span: 35.79, dia: 3.76, h: 12.55, engines: 2,
    // A freighter is heavier for the same airframe, and it lands faster for it.
    mass: 71000, wingArea: 124.6, thrust: 121400, vne: 340, mmo: 0.82,
    mdd: 0.78, waveDrag: 0.082, machInlet: 1.0,
    shape: 'jet', flapSet: 'airliner', engine: 'turbofan',
    // Flight-deck alert voice. A Boeing says AIRSPEED LOW.
    warnPack: 'boeing',
    cl0: 0.15, cd0: 0.021, oswald: 0.80, stallDeg: 15.5,
    ceiling: 12500, tailStrikeDeg: 11, rollRate: 35, nLimit: 2.5, acShift: 0.16, track: 5.72,
  },

  /* --- Not AXZ aircraft. Simulator types only. --------------------------- */
  'a320': {
    name: 'Airbus A320', axz: false, reg: 'SIM-320',
    len: 37.57, span: 35.80, dia: 3.95, h: 11.76, engines: 2,
    mass: 62000, wingArea: 122.6, thrust: 120000, vne: 350, mmo: 0.82,
    mdd: 0.78, waveDrag: 0.095, machInlet: 1.0,
    shape: 'jet', flapSet: 'airbus', engine: 'turbofan',
    // Flight-deck alert voice. An Airbus gives the cricket and STALL.
    warnPack: 'airbus',
    cl0: 0.15, cd0: 0.021, oswald: 0.80, stallDeg: 15.5,
    ceiling: 11900, tailStrikeDeg: 13.5, rollRate: 25, nLimit: 2.5, acShift: 0.16, track: 7.59,
  },
  'b744': {
    name: 'Boeing 747-400', axz: false, reg: 'SIM-744',
    len: 70.66, span: 64.44, dia: 6.50, h: 19.41, engines: 4,
    mass: 250000, wingArea: 541.2, thrust: 252400, vne: 365, mmo: 0.92,
    mdd: 0.86, waveDrag: 0.060, machInlet: 1.0,
    shape: 'jet', flapSet: 'airliner', engine: 'turbofan',
    // Flight-deck alert voice. A Boeing says AIRSPEED LOW.
    warnPack: 'boeing',
    cl0: 0.15, cd0: 0.021, oswald: 0.80, stallDeg: 15.5,
    ceiling: 13700, tailStrikeDeg: 12, rollRate: 20, nLimit: 2.5, acShift: 0.17, track: 11.0,
    // The hump. Everything about how this aeroplane reads at a glance.
    upperDeck: true,
  },
  'b789': {
    name: 'Boeing 787-9', axz: false, reg: 'SIM-789',
    len: 62.81, span: 60.12, dia: 5.77, h: 17.02, engines: 2,
    mass: 180000, wingArea: 377, thrust: 320000, vne: 360, mmo: 0.90,
    mdd: 0.86, waveDrag: 0.062, machInlet: 1.0,
    shape: 'jet', flapSet: 'airliner', engine: 'turbofan',
    // Flight-deck alert voice. A Boeing says AIRSPEED LOW.
    warnPack: 'boeing',
    cl0: 0.15, cd0: 0.021, oswald: 0.80, stallDeg: 15.5,
    ceiling: 13100, tailStrikeDeg: 9.5, rollRate: 20, nLimit: 2.5, acShift: 0.16, track: 9.79,
    // Raked tips rather than a winglet, and a famously flexible wing.
    rakedTips: true, dihedral: 0.135,
  },
  'c172': {
    name: 'Cessna 172S', axz: false, reg: 'SIM-172',
    len: 8.28, span: 11.00, dia: 1.25, h: 2.72, engines: 1,
    mass: 1050, wingArea: 16.2, thrust: 3400, vne: 163, mmo: 0.30,
    mdd: 0.55, waveDrag: 0.100, machInlet: 1.0,
    prop: true, shape: 'light', flapSet: 'light', engine: 'piston',
    cl0: 0.15, cd0: 0.037, oswald: 0.75, stallDeg: 16.5,
    ceiling: 4100, tailStrikeDeg: 16, rollRate: 60, nLimit: 3.8, acShift: 0.02, track: 2.51,
    // High wing on a strut, fixed gear, and a propeller disc.
    highWing: true, fixedGear: true, strut: true,
  },
  /* Concorde. The reheated Olympus 593 Mk 610 gives 139.4 kN dry and 169.2 kN
     lit, and the aeroplane needs the reheat twice on every crossing: once to
     get off the ground and once to push through Mach 1. Mass is the published
     maximum landing weight, because in this simulator you are almost always
     about to land. */
  'conc': {
    name: 'Aerospatiale/BAC Concorde', axz: false, reg: 'SIM-102',
    len: 61.66, span: 25.60, dia: 2.88, h: 12.20, engines: 4,
    mass: 111130, wingArea: 358.25, thrust: 139400, thrustAB: 169200,
    vne: 530, mmo: 2.04, mdd: 0.93, waveDrag: 0.024, machInlet: 1.74,
    shape: 'delta', flapSet: 'none', engine: 'turbojet-reheat',
    // Flight-deck alert voice. An Airbus gives the cricket and STALL.
    warnPack: 'airbus',
    // A slender delta makes its lift out of leading-edge vortices, so it keeps
    // gaining CL long past the angle a swept wing would have let go at.
    cl0: 0.05, cd0: 0.0145, oswald: 0.62, stallDeg: 24,
    ceiling: 18300, tailStrikeDeg: 13, rollRate: 15, nLimit: 2.5, acShift: 0.09, track: 7.72, dihedral: 0.0,
  },
  /* The corporate aeroplane. Engines on the aft fuselage and a T-tail, which
     is the whole silhouette, and a wing with no leading-edge device — which is
     why something that weighs half an A320 lands only ten knots slower. */
  'g650': {
    name: 'Gulfstream G650ER', axz: false, reg: 'SIM-650',
    len: 30.41, span: 30.36, dia: 2.90, h: 7.82, engines: 2,
    mass: 33566, wingArea: 119.2, thrust: 75200, vne: 340, mmo: 0.925,
    mdd: 0.88, waveDrag: 0.058, machInlet: 1.0,
    shape: 'bizjet', flapSet: 'bizjet', engine: 'turbofan-small',
    // Flight-deck alert voice. A Boeing says AIRSPEED LOW.
    warnPack: 'boeing',
    cl0: 0.12, cd0: 0.0175, oswald: 0.82, stallDeg: 13.5,
    ceiling: 15545, tailStrikeDeg: 12, rollRate: 35, nLimit: 2.5, acShift: 0.15, track: 3.63, dihedral: 0.055,
  },
  /* The fighter. One F110-GE-129: 76.3 kN dry, 131 kN in reheat, against
     12 tonnes — which is more thrust than weight, and the reason this is the
     only aeroplane in the list that can climb vertically. */
  'f16': {
    name: 'Lockheed Martin F-16C', axz: false, reg: 'SIM-F16',
    len: 15.06, span: 9.96, dia: 1.60, h: 4.88, engines: 1,
    mass: 12000, wingArea: 27.87, thrust: 76300, thrustAB: 131000,
    vne: 695, mmo: 2.05, mdd: 0.92, waveDrag: 0.032, machInlet: 1.65,
    shape: 'fighter', flapSet: 'fighter', engine: 'turbofan-ab',
    cl0: 0.05, cd0: 0.0195, oswald: 0.72, stallDeg: 21,
    ceiling: 15240, tailStrikeDeg: 15, rollRate: 324, nLimit: 9.0, acShift: 0.11, track: 2.36, dihedral: 0.0,
    // No airline paint on a fighter, and no cabin windows to draw.
    lowVis: true,
  },
  /* --- Fifth generation ---------------------------------------------------
     What makes these different from the F-16 is not that they are newer. The
     Raptor has thrust vectoring and supercruises, which means it holds Mach
     1.8 on DRY power — the only aeroplane in the roster that does not need
     reheat to stay supersonic. The F-35 has one very large engine and a wing
     sized for carrying rather than turning, so it accelerates hard and is
     slower than either of them flat out. */
  'f22': {
    name: 'Lockheed Martin F-22A', axz: false, reg: 'SIM-F22',
    len: 18.92, span: 13.56, dia: 2.10, h: 5.08, engines: 2,
    mass: 29410, wingArea: 78.04, thrust: 116000, thrustAB: 156000,
    vne: 750, mmo: 2.25, mdd: 0.94, waveDrag: 0.026, machInlet: 1.95,
    shape: 'fighter', flapSet: 'fighter', engine: 'turbofan-ab',
    cl0: 0.05, cd0: 0.0172, oswald: 0.76, stallDeg: 26,
    ceiling: 19812, tailStrikeDeg: 15, rollRate: 100, nLimit: 9.0, acShift: 0.10,
    track: 3.05, dihedral: 0.0, twinFin: true, chined: true, lowVis: true,
    armed: 'aim120', hardpoints: 8,
  },
  'f35': {
    name: 'Lockheed Martin F-35A', axz: false, reg: 'SIM-F35',
    len: 15.67, span: 10.70, dia: 2.00, h: 4.33, engines: 1,
    mass: 22470, wingArea: 42.70, thrust: 125000, thrustAB: 191000,
    vne: 700, mmo: 1.60, mdd: 0.93, waveDrag: 0.038, machInlet: 1.32,
    shape: 'fighter', flapSet: 'fighter', engine: 'turbofan-ab',
    cl0: 0.05, cd0: 0.0201, oswald: 0.74, stallDeg: 24,
    ceiling: 15000, tailStrikeDeg: 14, rollRate: 200, nLimit: 9.0, acShift: 0.11,
    track: 2.60, dihedral: 0.0, twinFin: true, chined: true, lowVis: true,
    armed: 'aim120', hardpoints: 6,
  },

  /* --- Bombers ------------------------------------------------------------
     A flying wing has no fin at all, which is why it needs a computer to fly
     straight and why it rolls like a barn door; and a B-52 has eight engines
     in four pods and a wing so flexible its tips move four metres. Neither is
     a big fighter. */
  'b2': {
    name: 'Northrop Grumman B-2A', axz: false, reg: 'SIM-B2A',
    len: 21.03, span: 52.43, dia: 3.40, h: 5.18, engines: 4,
    mass: 152600, wingArea: 478, thrust: 77000, vne: 400, mmo: 0.95,
    mdd: 0.88, waveDrag: 0.058, machInlet: 1.0, lapse: 0.55,
    shape: 'wing', flapSet: 'fighter', engine: 'turbofan',
    cl0: 0.06, cd0: 0.0112, oswald: 0.88, stallDeg: 18,
    ceiling: 15200, tailStrikeDeg: 12, rollRate: 20, nLimit: 2.0, acShift: 0.13,
    track: 12.19, dihedral: 0.0, lowVis: true,
    armed: 'jdam', hardpoints: 16,
  },
  'b52': {
    name: 'Boeing B-52H', axz: false, reg: 'SIM-B52',
    len: 48.50, span: 56.39, dia: 3.66, h: 12.40, engines: 8,
    mass: 120000, wingArea: 370, thrust: 76000, vne: 390, mmo: 0.86,
    mdd: 0.80, waveDrag: 0.084, machInlet: 1.0, lapse: 0.62,
    shape: 'jet', flapSet: 'airliner', engine: 'turbofan',
    warnPack: 'boeing',
    cl0: 0.14, cd0: 0.0225, oswald: 0.78, stallDeg: 15.5,
    ceiling: 15000, tailStrikeDeg: 11, rollRate: 15, nLimit: 2.0, acShift: 0.17,
    track: 8.00, dihedral: -0.02, lowVis: true,
    armed: 'jdam', hardpoints: 20,
  },
}

/** The four the airline actually operates, in the order the site lists them. */
export const AXZ_ORDER = ['b-737x', 'b-321x', 'b-1717', 'b-0001f']
/** Everything else the simulator offers. */
export const SIM_ONLY = ['a320', 'b744', 'b789', 'c172', 'conc', 'g650', 'f16', 'f22', 'f35', 'b2', 'b52']

/**
 * Stall and reference speeds in knots, for the type at its landing setting.
 * The page's roster table and the flight model must never be able to disagree
 * about these, so both go through this one function.
 */
export function speedsFor(t) {
  const G = 9.80665
  const flaps = FLAP_SETS[t.flapSet] || FLAP_SETS.airliner
  // The detent the approach scenario actually selects, not the last one on the
  // quadrant: an airliner lands at flap 30 and keeps 40 for a short field, so
  // quoting 40 here would print a speed nobody in this simulator ever flies.
  const land = flaps[Math.min(LANDING_DETENT, flaps.length - 1)]
  const a = liftSlope(t.span, t.wingArea)
  const CLmax = t.cl0 + land.dCL + a * ((t.stallDeg + land.dStall) * Math.PI / 180)
  const vs = Math.sqrt((2 * t.mass * G) / (1.225 * t.wingArea * CLmax))
  return { clAlpha: a, CLmax, vsKt: vs * 1.943844, vrefKt: vs * 1.3 * 1.943844 }
}

/* --- Hangar ------------------------------------------------------------------
   The 3D hangar shows the airline's own four at true scale next to three
   guests: the helicopter the hangar was built around, and the two aeroplanes
   that most people can name from a silhouette. Dimensions are the published
   ones; for the aeroplanes they are the SAME rows as SIM_TYPES, so the hangar,
   the fleet table and the simulator cannot disagree. */
export const ROTORCRAFT = {
  h145: {
    name: 'Airbus H145', kind: 'h145', axz: false, reg: '',
    // Length rotors turning, main rotor diameter, height to the top of the fin.
    len: 13.64, span: 11.00, dia: 2.00, h: 3.95, engines: 2,
    mass: 3800, engineNote: '2 × Safran Arriel 2E',
  },
}
export const HANGAR_ORDER = ['h145', 'b-737x', 'b-321x', 'b-1717', 'b-0001f', 'b744', 'conc']
/* Per-type drawing flags the hangar needs and the flight model does not. */
export const HANGAR_FLAGS = {
  'b-737x':  { winglet: 'blended', livery: 'axz', dorsal: true, engineNote: '2 × CFM56-7B' },
  'b-321x':  { winglet: 'sharklet', livery: 'axz', dorsal: false, engineNote: '2 × IAE V2500', sweepDeg: 25, stabSpan: 0.35 },
  'b-1717':  { winglet: 'blended', livery: 'minecraft', dorsal: true, engineNote: '2 × CFM56-7B' },
  'b-0001f': { winglet: 'blended', livery: 'plain', dorsal: true, cargo: true, engineNote: '2 × CFM56-7B' },
  'b744':    { winglet: 'canted', livery: 'heavy', dorsal: true, upperDeck: true, engineNote: '4 × CF6-80C2', sweepDeg: 37, upperDeg: 20, stabSpan: 0.35, nacelle: 2.7, dihedralDeg: 7, clear: 2.2 },
  'conc':    { kind: 'concorde', livery: 'plain', engineNote: '4 × Olympus 593' },
  // Simulator-only types the hangar page does not list, but the simulator draws.
  'a320':    { winglet: 'sharklet', livery: 'heavy', dorsal: false, stabSpan: 0.35 },
  'b789':    { winglet: 'raked', livery: 'heavy', dorsal: true, dihedralDeg: 7, nacelle: 3.0, stabSpan: 0.36 },
  'b52':     { highWing: true, gearLayout: 'bicycle', dihedralDeg: -2, winglet: 'none', nacelle: 1.4, clear: 1.9, dorsal: false, finSweepDeg: 30 },
}
