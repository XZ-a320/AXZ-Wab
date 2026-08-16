/* ==========================================================================
   AXZ sim — terrain, airports, runways.

   ONE height function. `elevation(x, z)` is called by the mesh builder and by
   the landing gear in fdm.js, and if those two ever disagree the aeroplane
   sinks into a hill that is drawn somewhere else. Everything that needs to
   know where the ground is asks this, and nothing caches it.

   The geography is the one the site already names: the routes section lists
   圣克鲁斯山脉(中段) and 蒙特雷湾沿岸 as the landmarks on KSFO-KSNS, so there is
   a bay north-east of KSFO, a ridge running down the west side of the route,
   and water again near Salinas. It is not a survey — it is a relief map that
   agrees with the sentence already printed on the home page.
   ========================================================================== */

import { clamp, DEG } from './math.js'

/* --- Airports -------------------------------------------------------------
   KSFO sits at the origin. KSNS is placed on the true bearing between the two
   airports' real coordinates, at the distance THIS SITE publishes (110 km) —
   the same decision the 2D network map makes, and for the same reason: the
   drawing must not contradict the prose beside it. */
export const AIRPORTS = {
  KSFO: {
    icao: 'KSFO', name: 'San Francisco', elev: 4,
    x: 0, z: 0,
    rwy: { id: '28R', hdg: 284, len: 3618, width: 61 },
  },
  KSNS: {
    icao: 'KSNS', name: 'Salinas', elev: 26,
    x: Math.sin(147.3 * DEG) * 110000, z: -Math.cos(147.3 * DEG) * 110000,
    rwy: { id: '31', hdg: 310, len: 1829, width: 46 },
  },
  /* The China pair. The site publishes two routes and only one of them was
     flyable, which made half the airline decorative. Same construction: the
     bearing is computed from the two airports' real coordinates, the leg
     length is the 280 km the routes section prints, and both fields are placed
     far enough from KSFO that neither landscape has to know about the other. */
  ZSPD: {
    icao: 'ZSPD', name: 'Shanghai Pudong', elev: 4,
    x: 620000, z: 210000,
    rwy: { id: '35L', hdg: 350, len: 4000, width: 60 },
  },
  ZSNJ: {
    icao: 'ZSNJ', name: 'Nanjing Lukou', elev: 15,
    x: 620000 + Math.sin(283.4 * DEG) * 280000,
    z: 210000 - Math.cos(283.4 * DEG) * 280000,
    rwy: { id: '06', hdg: 60, len: 3600, width: 45 },
  },
}

/** Every airport, in the order the route list uses. */
export const AP_LIST = ['KSFO', 'KSNS', 'ZSPD', 'ZSNJ']

/* The four flights the site publishes, as flyable legs. */
export const LEGS = {
  AXZ001: { from: 'KSFO', to: 'KSNS', cruise: 1676 },
  AXZ002: { from: 'KSNS', to: 'KSFO', cruise: 1676 },
  AXZ003: { from: 'ZSPD', to: 'ZSNJ', cruise: 9500 },
  AXZ004: { from: 'ZSNJ', to: 'ZSPD', cruise: 9500 },
}

/** Unit vector along a compass heading. Heading 000 is -Z; east is +X. */
export const hdgVec = deg => ({ x: Math.sin(deg * DEG), y: 0, z: -Math.cos(deg * DEG) })

/* --- Noise ---------------------------------------------------------------
   Value noise with a hashed integer lattice. Deterministic and seedless: the
   same coordinates give the same hill on every machine and every reload, which
   matters because the runway has to stay where the approach chart says.     */
function hash2(ix, iz) {
  let h = ix * 374761393 + iz * 668265263
  h = (h ^ (h >> 13)) * 1274126177
  return ((h ^ (h >> 16)) >>> 0) / 4294967295
}
const smooth = t => t * t * (3 - 2 * t)

function valueNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = smooth(x - ix), fz = smooth(z - iz)
  const a = hash2(ix, iz), b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1)
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz
}

function fbm(x, z, oct = 4) {
  let sum = 0, amp = 1, freq = 1, norm = 0
  for (let i = 0; i < oct; i++) {
    sum += valueNoise(x * freq, z * freq) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.07      // not exactly 2, so octaves do not line up into a grid
  }
  return sum / norm
}

/* --- Water ----------------------------------------------------------------
   Two bodies, both named on the home page. Each is a smooth distance field so
   the shoreline is soft rather than a circle.                               */
const BAY = { x: 11000, z: -9000, r: 15000 }        // San Francisco Bay, NE of KSFO
const MONTEREY = { x: 34000, z: 104000, r: 21000 }  // Monterey Bay, SW of Salinas
// The Yangtze delta half: the landmarks the routes section lists for ZSPD-ZSNJ
// are 长江三角洲, 太湖 and 镇江, so there is an estuary east of Pudong and a
// lake between the two fields.
const EASTSEA = { x: 700000, z: 200000, r: 90000 }  // the sea, east of Pudong
const TAIHU = { x: 470000, z: 150000, r: 32000 }    // Lake Tai, on the route

function waterField(x, z) {
  let w = 0
  for (const b of [BAY, MONTEREY, EASTSEA, TAIHU]) {
    const d = Math.hypot(x - b.x, z - b.z)
    // Wobble the radius so the coast is not a compass circle.
    const wob = (fbm(x * 0.00004, z * 0.00004, 2) - 0.5) * b.r * 0.5
    w = Math.max(w, clamp(1 - (d - wob) / b.r, 0, 1))
  }
  return w
}

/* --- The ridge ------------------------------------------------------------
   Santa Cruz mountains: a band running parallel to the route, on its west
   side. Distance is measured to the LINE, so the range is a ridge rather than
   a lump.                                                                    */
const RIDGE_A = { x: -9000, z: 12000 }
const RIDGE_B = { x: 30000, z: 86000 }

function ridgeField(x, z) {
  const dx = RIDGE_B.x - RIDGE_A.x, dz = RIDGE_B.z - RIDGE_A.z
  const len2 = dx * dx + dz * dz
  const t = clamp(((x - RIDGE_A.x) * dx + (z - RIDGE_A.z) * dz) / len2, 0, 1)
  const px = RIDGE_A.x + dx * t, pz = RIDGE_A.z + dz * t
  // Signed side: the ridge sits west of the route, so only one side gets it.
  const side = (x - px) * dz - (z - pz) * dx
  const d = Math.hypot(x - px, z - pz)
  const across = clamp(1 - d / 15000, 0, 1)
  const along = Math.sin(t * Math.PI)          // tapers off at both ends
  return across * across * along * (side < 0 ? 1 : 0.35)
}

/* --- Airport flattening ---------------------------------------------------
   An airport is a plateau. Inside `flat` the ground is exactly the field
   elevation, then it blends into the natural terrain over `blend` — without
   this the runway would be draped over noise and the aeroplane would take off
   from a hillside. */
function airportMask(x, z, ap, flat, blend) {
  const d = Math.hypot(x - ap.x, z - ap.z)
  if (d <= flat) return 1
  if (d >= flat + blend) return 0
  return smooth(1 - (d - flat) / blend)
}

/** Ground elevation in metres above sea level. The authority for the whole sim. */
export function elevation(x, z) {
  const water = waterField(x, z)
  const ridge = ridgeField(x, z)

  /* Land sits WELL above sea level. Centring the rolling term on zero put
     roughly half the landscape under the sea-level water plane, so the view
     from the runway was an endless flat sheet with a few buildings on it. The
     base is offset instead, and only the two named bays go below zero. */
  const rolling = fbm(x * 0.000045, z * 0.000045, 4)          // 0..1
  const detail = (fbm(x * 0.00035, z * 0.00035, 3) - 0.5) * 55

  /* The Yangtze delta is a delta: famously, almost completely flat. Damping
     the relief toward the China pair is not a shortcut, it is the landmark the
     site names, and a Shanghai approach over Californian foothills would be
     the drawing disagreeing with the prose again. */
  const delta = clamp((x - 330000) / 120000, 0, 1)
  const relief = 1 - 0.88 * delta

  let h = 22 + rolling * 300 * relief + ridge * 900 * (1 - delta) + detail * (1 - water) * relief
  // Sea bed: pull down hard inside a water body so the coast reads as a shore.
  h = h * (1 - water) - water * 24
  if (h < -24) h = -24

  for (const key of AP_LIST) {
    const ap = AIRPORTS[key]
    const m = airportMask(x, z, ap, ap.rwy.len * 0.62, 1700)
    if (m > 0) h = h * (1 - m) + ap.elev * m
  }
  return h
}

export const WATER_LEVEL = 0
export const isWater = (x, z) => elevation(x, z) < WATER_LEVEL - 0.5

/* --- Palette --------------------------------------------------------------
   Shaded-relief bands rather than a texture. Elevation picks the band; the
   flat-shading in gl.js supplies the relief.                                */
const BANDS = [
  { h: -30, c: [0.06, 0.13, 0.20] },   // deep water
  { h: -2, c: [0.10, 0.22, 0.31] },    // shallows
  { h: 1, c: [0.55, 0.53, 0.44] },     // sand / shore
  { h: 40, c: [0.36, 0.40, 0.28] },    // lowland
  { h: 180, c: [0.31, 0.35, 0.24] },   // foothills
  { h: 420, c: [0.38, 0.36, 0.27] },   // slopes
  { h: 700, c: [0.46, 0.43, 0.36] },   // high ground
  { h: 1000, c: [0.62, 0.60, 0.56] },  // bare rock
]

function bandColor(h) {
  if (h <= BANDS[0].h) return BANDS[0].c
  for (let i = 1; i < BANDS.length; i++) {
    if (h <= BANDS[i].h) {
      const a = BANDS[i - 1], b = BANDS[i]
      const t = (h - a.h) / (b.h - a.h)
      return [a.c[0] + (b.c[0] - a.c[0]) * t, a.c[1] + (b.c[1] - a.c[1]) * t, a.c[2] + (b.c[2] - a.c[2]) * t]
    }
  }
  return BANDS[BANDS.length - 1].c
}

/**
 * A square of terrain as loose triangles.
 * `size` metres across, `res` cells per side, centred on (cx, cz).
 */
export function terrainPatch(cx, cz, size, res) {
  const pos = [], normal = [], color = []
  const step = size / res
  const x0 = cx - size / 2, z0 = cz - size / 2

  // One row of heights is reused as the next row's top edge; sampling each
  // corner once instead of four times per quad is the difference between this
  // taking 8 ms and 30 ms on a rebuild.
  let rowA = new Float32Array(res + 1)
  let rowB = new Float32Array(res + 1)
  for (let i = 0; i <= res; i++) rowA[i] = elevation(x0 + i * step, z0)

  const push = (x, y, z, nx, ny, nz, c) => {
    pos.push(x, y, z); normal.push(nx, ny, nz); color.push(c[0], c[1], c[2])
  }

  for (let j = 0; j < res; j++) {
    const z1 = z0 + j * step, z2 = z1 + step
    for (let i = 0; i <= res; i++) rowB[i] = elevation(x0 + i * step, z2)
    for (let i = 0; i < res; i++) {
      const xa = x0 + i * step, xb = xa + step
      const hAA = rowA[i], hBA = rowA[i + 1], hAB = rowB[i], hBB = rowB[i + 1]
      /* Two triangles, each with its own face normal — that is the facet look.
         Wound counter-clockwise SEEN FROM ABOVE. The obvious ordering
         (A, B, C going +x then +z) produces a downward normal and a clockwise
         face, and every triangle of the landscape was quietly back-face culled;
         what looked like ground in early builds was the sea-level plane
         showing through the hole where the terrain should have been. */
      tri(xa, hAA, z1, xb, hBB, z2, xb, hBA, z1)
      tri(xa, hAA, z1, xa, hAB, z2, xb, hBB, z2)
    }
    const t = rowA; rowA = rowB; rowB = t
  }

  /* Water is BAKED IN, not a separate plane. A single sea-level quad spanning
     the whole world sat within a few hundred metres of terrain that was
     kilometres away, and at that depth range the buffer could not separate
     them: the sea won in patches and the landscape rendered as a flat sheet.
     Clamping each vertex to sea level and colouring it by its TRUE depth gives
     a real coastline out of the same triangles, and nothing to z-fight with. */
  function tri(ax, ay, az, bx, by, bz, cx2, cy, cz2) {
    const c = bandColor((ay + by + cy) / 3)
    const ya = Math.max(ay, 0), yb = Math.max(by, 0), yc = Math.max(cy, 0)
    const ux = bx - ax, uy = yb - ya, uz = bz - az
    const vx = cx2 - ax, vy = yc - ya, vz = cz2 - az
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l; ny /= l; nz /= l
    push(ax, ya, az, nx, ny, nz, c)
    push(bx, yb, bz, nx, ny, nz, c)
    push(cx2, yc, cz2, nx, ny, nz, c)
  }

  return { pos, normal, color }
}

/** Hairline grid over the near terrain — the ledger rule, laid on the ground. */
export function terrainGrid(cx, cz, size, res, col) {
  const pos = [], color = []
  const step = size / res
  const x0 = cx - size / 2, z0 = cz - size / 2
  const lift = 1.2      // just clear of the surface, or z-fighting eats it
  const seg = (ax, az, bx, bz) => {
    pos.push(ax, elevation(ax, az) + lift, az, bx, elevation(bx, bz) + lift, bz)
    color.push(col[0], col[1], col[2], col[0], col[1], col[2])
  }
  for (let i = 0; i <= res; i++) {
    const x = x0 + i * step, z = z0 + i * step
    for (let j = 0; j < res; j++) {
      seg(x, z0 + j * step, x, z0 + (j + 1) * step)
      seg(x0 + j * step, z, x0 + (j + 1) * step, z)
    }
  }
  return { pos, color }
}

/* --- Runway ---------------------------------------------------------------
   Built in the runway's own frame then rotated into place, which keeps the
   marking maths readable: +u runs down the centreline toward the far end,
   +v is to the right of it.                                                 */
export function runwayMesh(ap) {
  const pos = [], normal = [], color = []
  const R = ap.rwy
  const dir = hdgVec(R.hdg)
  const rgt = { x: -dir.z, y: 0, z: dir.x }
  const y = ap.elev + 0.06
  const half = R.width / 2
  const asphalt = [0.13, 0.13, 0.14]
  const paint = [0.88, 0.87, 0.82]

  // Threshold sits at -len/2 so the airport's coordinate IS the midpoint.
  const at = (u, v, yy = y) => ({
    x: ap.x + dir.x * u + rgt.x * v,
    y: yy,
    z: ap.z + dir.z * u + rgt.z * v,
  })
  const quad = (a, b, c, d, col) => {
    for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
      for (const pt of [p, q, r]) { pos.push(pt.x, pt.y, pt.z); normal.push(0, 1, 0); color.push(col[0], col[1], col[2]) }
    }
  }

  const u0 = -R.len / 2, u1 = R.len / 2
  quad(at(u0, -half), at(u1, -half), at(u1, half), at(u0, half), asphalt)

  // Paint sits a hair above the asphalt for the same z-fighting reason.
  const py = y + 0.03
  const stripe = (ua, ub, va, vb, col = paint) =>
    quad(at(ua, va, py), at(ub, va, py), at(ub, vb, py), at(ua, vb, py), col)

  // Centreline: 30 m stripe, 20 m gap, stopping short of both thresholds.
  for (let u = u0 + 90; u < u1 - 90; u += 50) stripe(u, Math.min(u + 30, u1 - 90), -0.45, 0.45)

  // Threshold bars at both ends: eight stripes across, the piano keys.
  for (const [base, sign] of [[u0, 1], [u1, -1]]) {
    for (let k = 0; k < 8; k++) {
      const v = -half + 3 + k * (R.width - 6) / 8
      stripe(base + sign * 6, base + sign * 36, v, v + (R.width - 6) / 8 - 1.6)
    }
    // Aiming-point blocks, 300 m in.
    stripe(base + sign * 300, base + sign * 345, -9, -4)
    stripe(base + sign * 300, base + sign * 345, 4, 9)
  }

  // Shoulders, so the strip reads as a made surface rather than a floating slab.
  const shoulder = [0.20, 0.21, 0.18]
  quad(at(u0, -half - 26), at(u1, -half - 26), at(u1, -half), at(u0, -half), shoulder)
  quad(at(u0, half), at(u1, half), at(u1, half + 26), at(u0, half + 26), shoulder)

  return { pos, normal, color }
}

/* --- PAPI -----------------------------------------------------------------
   Four lights beside the touchdown zone, each white above its own angle and
   red below it, spaced so the set reads: four white = high, two and two = on
   slope, four red = low. It is the instrument that makes a visual approach an
   instrument task, and it is the single most useful thing that can be added to
   a simulator's runway. The angles are the real ones for a 3-degree slope.

   Returned as data rather than geometry, because the colours depend on where
   the aeroplane is and have to be evaluated every frame.                    */
export const PAPI_ANGLES = [2.5, 2.833, 3.167, 3.5]

export function papiUnits(ap) {
  const R = ap.rwy
  const dir = hdgVec(R.hdg)
  const rgt = { x: -dir.z, y: 0, z: dir.x }
  // Abeam the aiming point, on the left of the runway, as ICAO places them.
  const u = -R.len / 2 + 300
  const out = []
  for (let i = 0; i < 4; i++) {
    const v = -R.width / 2 - 16 - i * 9
    out.push({
      x: ap.x + dir.x * u + rgt.x * v,
      y: ap.elev + 1.1,
      z: ap.z + dir.z * u + rgt.z * v,
      angle: PAPI_ANGLES[i],
    })
  }
  return { units: out, dir, threshold: { x: ap.x + dir.x * (-R.len / 2), z: ap.z + dir.z * (-R.len / 2) }, elev: ap.elev }
}

/**
 * Which PAPI lights are white for an aeroplane at `p`.
 * Only meaningful within the beam: roughly on the approach side, and inside
 * about ten degrees either side of the centreline.
 */
export function papiState(papi, p) {
  const dx = p.x - papi.threshold.x, dz = p.z - papi.threshold.z
  const along = -(dx * papi.dir.x + dz * papi.dir.z)     // positive = before the threshold
  if (along < 60 || along > 12000) return null
  const across = Math.abs(dx * -papi.dir.z + dz * papi.dir.x)
  if (across > along * 0.30 + 120) return null
  const ang = Math.atan2(Math.max(p.y - papi.elev, 0), along) * 180 / Math.PI
  return papi.units.map(u => ang >= u.angle)
}

/** Runway edge and threshold lights, drawn as lines. */
export function runwayLights(ap) {
  const pos = [], color = []
  const R = ap.rwy
  const dir = hdgVec(R.hdg)
  const rgt = { x: -dir.z, y: 0, z: dir.x }
  const half = R.width / 2
  const white = [1, 0.96, 0.85], green = [0.2, 1, 0.45], red = [1, 0.28, 0.24]
  const at = (u, v, yy) => ({ x: ap.x + dir.x * u + rgt.x * v, y: yy, z: ap.z + dir.z * u + rgt.z * v })
  const lamp = (u, v, col, h = 0.9) => {
    const a = at(u, v, ap.elev + 0.05), b = at(u, v, ap.elev + h)
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
    color.push(col[0], col[1], col[2], col[0], col[1], col[2])
  }
  const u0 = -R.len / 2, u1 = R.len / 2
  for (let u = u0; u <= u1; u += 60) { lamp(u, -half - 1.5, white); lamp(u, half + 1.5, white) }
  for (let v = -half; v <= half; v += 6) { lamp(u0, v, green, 0.6); lamp(u1, v, red, 0.6) }
  // Approach lights: a lead-in bar out from the landing threshold.
  for (let u = u0 - 90; u > u0 - 900; u -= 90) { lamp(u, 0, white, 1.4); lamp(u, -6, white, 1.1); lamp(u, 6, white, 1.1) }
  return { pos, color }
}

/* --- Vegetation -----------------------------------------------------------
   Trees are billboards on a hashed lattice, generated around the camera each
   time it moves a cell. Nothing is stored: the same coordinates always give
   the same tree, so a forest can be arbitrarily large and cost nothing but the
   sprites currently on screen.

   They matter more than they look: at low level over featureless terrain there
   is no sense of height or speed at all, and a scattering of 12 m objects
   supplies both.                                                            */
export function trees(camX, camZ, range, out) {
  out.length = 0
  const S = 260                                  // lattice pitch, metres
  const i0 = Math.floor((camX - range) / S), i1 = Math.floor((camX + range) / S)
  const j0 = Math.floor((camZ - range) / S), j1 = Math.floor((camZ + range) / S)
  const r2 = range * range
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const keep = hash2(i * 3 + 7, j * 5 + 11)
      if (keep > 0.55) continue
      const x = (i + hash2(i, j)) * S
      const z = (j + hash2(j, i)) * S
      const dx = x - camX, dz = z - camZ
      if (dx * dx + dz * dz > r2) continue
      const g = elevation(x, z)
      if (g < 4 || g > 900) continue             // no trees in the sea or on bare rock
      // Keep the approach corridors and the runways clear.
      let blocked = false
      for (const key of AP_LIST) {
        const ap = AIRPORTS[key]
        if (Math.hypot(x - ap.x, z - ap.z) < ap.rwy.len * 0.75) { blocked = true; break }
      }
      if (blocked) continue
      const h = 9 + hash2(i * 13, j * 17) * 14
      const v = (hash2(i * 19, j * 23) * 4) | 0   // which of the four on the sheet
      out.push({
        x, y: g + h * 0.5, z, size: h * 0.62,
        r: 1, g: 1, b: 1, a: 1,
        u0: (v % 2) * 0.5, v0: (v >> 1) * 0.5,
        u1: (v % 2) * 0.5 + 0.5, v1: (v >> 1) * 0.5 + 0.5,
      })
    }
  }
  return out
}

/* --- Scenery --------------------------------------------------------------
   Blocks, not buildings. They exist to give height reference and parallax on
   approach; a city that tried to look like a city would be a texture budget
   this renderer does not have and a look this site would not want.          */
export function scenery(ap, count = 90, spread = 4200) {
  const pos = [], normal = [], color = []
  const box = (cx, cy, cz, w, h, d, col) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y0 = cy, y1 = cy + h
    const V = (x, y, z) => ({ x, y, z })
    const faces = [
      [V(x0, y1, z0), V(x1, y1, z0), V(x1, y1, z1), V(x0, y1, z1), 1.0],   // roof
      [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1), 0.78],
      [V(x1, y0, z0), V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), 0.62],
      [V(x1, y0, z1), V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), 0.70],
      [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0), 0.55],
    ]
    for (const [a, b, c, d2, k] of faces) {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z
      const vx = d2.x - a.x, vy = d2.y - a.y, vz = d2.z - a.z
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l; ny /= l; nz /= l
      const cc = [col[0] * k, col[1] * k, col[2] * k]
      for (const [p, q, r] of [[a, b, c], [a, c, d2]]) {
        for (const pt of [p, q, r]) { pos.push(pt.x, pt.y, pt.z); normal.push(nx, ny, nz); color.push(cc[0], cc[1], cc[2]) }
      }
    }
  }

  const R = ap.rwy
  const dir = hdgVec(R.hdg)
  for (let i = 0; i < count; i++) {
    // Hashed, not random: the skyline is the same on every reload.
    const a = hash2(i * 7 + 11, i * 13 + 5) * Math.PI * 2
    const r = (0.25 + hash2(i * 3 + 1, i * 17) * 0.75) * spread
    const x = ap.x + Math.cos(a) * r, z = ap.z + Math.sin(a) * r
    // Never build on the runway or its approach corridor.
    const along = (x - ap.x) * dir.x + (z - ap.z) * dir.z
    const across = Math.abs((x - ap.x) * -dir.z + (z - ap.z) * dir.x)
    if (Math.abs(along) < R.len / 2 + 700 && across < 260) continue
    const g = elevation(x, z)
    if (g < 1) continue
    const h = 12 + hash2(i * 5, i * 23) * (r < spread * 0.45 ? 78 : 26)
    const w = 16 + hash2(i * 31, i * 3) * 26
    const d = 16 + hash2(i * 11, i * 41) * 26
    const tone = 0.30 + hash2(i * 19, i * 7) * 0.16
    box(x, g, z, w, h, d, [tone, tone * 0.99, tone * 0.94])
  }
  return { pos, normal, color }
}
