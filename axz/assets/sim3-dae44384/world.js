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
/* Each field now has the runways it really has, not one of them. The FIRST in
   the list is the one the site publishes and the one the landing score is
   measured on; the rest are the real parallel and crossing strips, placed by
   their published length, width and offset from the field centre. That is
   what makes an approach a choice rather than a corridor — a crosswind that
   is impossible on 28R is a gift on 01L, and the two are 90 degrees apart at
   the same airport.

   `offset` is metres to the right of the field centre, measured across the
   runway's own heading; `along` is metres up its own centreline. */
export const AIRPORTS = {
  KSFO: {
    icao: 'KSFO', name: 'San Francisco', elev: 4,
    x: 0, z: 0,
    rwys: [
      { id: '28R', hdg: 284, len: 3618, width: 61, offset: 0, along: 0 },
      // The parallel. KSFO's 28s are 228 m apart, which is why they can be
      // used together and why the pair is the airport's whole capacity story.
      { id: '28L', hdg: 284, len: 3618, width: 61, offset: 228, along: 0 },
      // And the crossing pair, 7,500 ft, which is the crosswind runway.
      { id: '01L', hdg: 14, len: 2286, width: 61, offset: -160, along: -300 },
      { id: '01R', hdg: 14, len: 2286, width: 61, offset: 60, along: -300 },
    ],
  },
  KSNS: {
    icao: 'KSNS', name: 'Salinas', elev: 26,
    x: Math.sin(147.3 * DEG) * 110000, z: -Math.cos(147.3 * DEG) * 110000,
    rwys: [
      { id: '31', hdg: 310, len: 1829, width: 46, offset: 0, along: 0 },
      // Salinas' other strip, 4,825 ft, crossing the first.
      { id: '26', hdg: 264, len: 1471, width: 46, offset: 0, along: 240 },
    ],
  },
  /* The China pair. The site publishes two routes and only one of them was
     flyable, which made half the airline decorative. Same construction: the
     bearing is computed from the two airports' real coordinates, the leg
     length is the 280 km the routes section prints, and both fields are placed
     far enough from KSFO that neither landscape has to know about the other. */
  ZSPD: {
    icao: 'ZSPD', name: 'Shanghai Pudong', elev: 4,
    x: 620000, z: 210000,
    rwys: [
      { id: '35L', hdg: 350, len: 4000, width: 60, offset: 0, along: 0 },
      // Pudong runs four parallels. Two more of them, at their real spacing.
      { id: '35R', hdg: 350, len: 3800, width: 60, offset: 440, along: -120 },
      { id: '34L', hdg: 344, len: 3800, width: 60, offset: -1600, along: 200 },
    ],
  },
  ZSNJ: {
    icao: 'ZSNJ', name: 'Nanjing Lukou', elev: 15,
    x: 620000 + Math.sin(283.4 * DEG) * 280000,
    z: 210000 - Math.cos(283.4 * DEG) * 280000,
    rwys: [
      { id: '06', hdg: 60, len: 3600, width: 45, offset: 0, along: 0 },
      // Lukou's second runway, which opened in 2020.
      { id: '07', hdg: 66, len: 3600, width: 45, offset: 1100, along: -200 },
    ],
  },
}


/** Where a runway's centre sits in world coordinates. */
export function rwyCentre(ap, r) {
  const d = hdgVec(r.hdg)
  const rgt = { x: -d.z, z: d.x }
  return {
    x: ap.x + d.x * r.along + rgt.x * r.offset,
    z: ap.z + d.z * r.along + rgt.z * r.offset,
  }
}

/* --- The neighbours -------------------------------------------------------
   The four fields above are the ones the site publishes and the only ones the
   airline flies to. These are the airports that are really there, placed on
   their true bearing and distance from the published field nearest them, with
   the runways they really have.

   They are here because a landscape with two airports in it is a corridor. A
   diversion needs somewhere to divert TO, a short field is a different problem
   from a long one, and 5,000 ft of runway at Half Moon Bay with the sea at one
   end is a landing challenge that KSFO's 11,870 ft cannot pose.               */
const NEAR = [
  // California, from KSFO.
  ['KOAK', 'Oakland', 'KSFO', 49.9, 17727, 3, [
    ['12', 122, 3048, 46, 0, 0], ['28R', 284, 1895, 46, -700, 300]]],
  ['KSJC', 'San Jose', 'KSFO', 126.0, 48566, 19, [
    ['12L', 122, 3353, 46, -110, 0], ['12R', 122, 3353, 46, 110, 0]]],
  ['KHAF', 'Half Moon Bay', 'KSFO', 223.3, 16128, 20, [
    ['12', 122, 1525, 46, 0, 0]]],
  ['KMRY', 'Monterey', 'KSNS', 232.0, 27500, 78, [
    ['10R', 100, 2164, 46, 0, 0], ['10L', 100, 1036, 30, 300, -200]]],
  // The Yangtze delta, from ZSPD.
  ['ZSSS', 'Shanghai Hongqiao', 'ZSPD', 277.7, 45068, 3, [
    ['18L', 184, 3400, 60, -180, 0], ['18R', 184, 3300, 60, 180, -150]]],
  ['ZSWX', 'Wuxi Shuofang', 'ZSPD', 285.0, 128000, 5, [
    ['03', 30, 3200, 45, 0, 0]]],
]
for (const [icao, name, from, brg, dist, elev, rwys] of NEAR) {
  const base = AIRPORTS[from]
  AIRPORTS[icao] = {
    icao, name, elev,
    x: base.x + Math.sin(brg * DEG) * dist,
    z: base.z - Math.cos(brg * DEG) * dist,
    rwys: rwys.map(([id, hdg, len, width, offset, along]) =>
      ({ id, hdg, len, width, offset, along })),
  }
}

/* Every airport keeps a single `rwy` pointing at its published strip. The
   scenarios, the PAPI, the landing score and the navigation all mean THAT
   runway when they say "the runway", and none of them had to learn about the
   others. */
for (const key of Object.keys(AIRPORTS)) {
  const ap = AIRPORTS[key]
  ap.rwy = ap.rwys[0]
  // How far the made surface reaches, for the terrain flattening below.
  ap.spread = Math.max(...ap.rwys.map(r =>
    Math.hypot(r.len / 2 + Math.abs(r.along), Math.abs(r.offset))))
}

/** Every airport, in the order the route list uses, then the neighbours. */
export const AP_LIST = ['KSFO', 'KSNS', 'ZSPD', 'ZSNJ', ...NEAR.map(n => n[0])]
/** The four the airline serves. Scenarios and scoring only ever mean these. */
export const AP_PUBLISHED = ['KSFO', 'KSNS', 'ZSPD', 'ZSNJ']

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
/* San Francisco Bay lies BETWEEN San Francisco and Oakland, and both airports
   are built on its shore — SFO on the west side, OAK on the east, facing each
   other across the water. Placed off to the north-east it reached neither, so
   the ground rose to 47 m two and a half kilometres off the end of runway 28
   and the 01 thresholds, which in life sit at the water's edge, were in the
   middle of a hillside. Centred between the two fields it does what it does in
   life: the 28s depart over it and the 01s land toward it.

   Water can be laid right up to a field without flooding it, because the
   airport plateau is applied AFTER the water in `elevation` and overrides it. */
const BAY = { x: 6800, z: -5700, r: 12400 }         // San Francisco Bay
const MONTEREY = { x: 34000, z: 104000, r: 21000 }  // Monterey Bay, SW of Salinas
// The Yangtze delta half: the landmarks the routes section lists for ZSPD-ZSNJ
// are 长江三角洲, 太湖 and 镇江, so there is an estuary east of Pudong and a
// lake between the two fields.
const EASTSEA = { x: 700000, z: 200000, r: 90000 }  // the sea, east of Pudong
const TAIHU = { x: 470000, z: 150000, r: 32000 }    // Lake Tai, on the route
/* The Pacific. Its absence was conspicuous: the whole Californian half of this
   world is a peninsula, Half Moon Bay is ON the coast, and there was no coast.
   A very large circle centred far to the west is a straight shoreline by the
   time it reaches the route, which is what it should look like. */
const PACIFIC = { x: -210000, z: 70000, r: 205000 }
/* The South Bay. San Francisco Bay does not stop at the airport — it runs
   south past it toward San Jose, and that southern arm is what the 01
   thresholds face. Without it the crossing pair landed toward a hillside. */
const SOUTHBAY = { x: 3000, z: 8000, r: 12000 }
// San Pablo Bay, north of the one already here, so the bay system reads.
const SANPABLO = { x: 22000, z: -46000, r: 13000 }
// The Yangtze estuary itself, which is what ZSPD sits beside.
const YANGTZE = { x: 596000, z: 96000, r: 46000 }

function waterField(x, z) {
  let w = 0
  for (const b of [BAY, SOUTHBAY, MONTEREY, EASTSEA, TAIHU, PACIFIC, SANPABLO, YANGTZE]) {
    const d = Math.hypot(x - b.x, z - b.z)
    // Wobble the radius so the coast is not a compass circle.
    const wob = (fbm(x * 0.00004, z * 0.00004, 2) - 0.5) * b.r * 0.5
    /* A BASIN with a shoreline, not a cone. Falling linearly from one at the
       centre to zero at the rim meant a body of water was only fully wet at
       its exact middle: the bay reached 0.42 where San Francisco's runway 28
       departs over it, which after blending with the land left 36 m of hill
       where there should have been open water. Full depth out to the shore
       ramp, and the ramp is where the coast is. */
    w = Math.max(w, clamp((b.r - d + wob) / (b.r * 0.22), 0, 1))
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
    // The plateau has to cover every strip on the field, not just the one the
    // site publishes, or the crossing runway is draped over a hillside.
    const m = airportMask(x, z, ap, ap.spread * 1.10, 1700)
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
  // Read as linear light by the 2.0 renderer, so the sea keeps a colour at a
  // distance rather than going to black under the fog.
  { h: -30, c: [0.15, 0.30, 0.44] },   // deep water
  { h: -2, c: [0.20, 0.36, 0.48] },    // shallows
  { h: 1, c: [0.55, 0.53, 0.44] },     // sand / shore
  { h: 40, c: [0.36, 0.40, 0.28] },    // lowland
  { h: 180, c: [0.31, 0.35, 0.24] },   // foothills
  { h: 420, c: [0.38, 0.36, 0.27] },   // slopes
  { h: 700, c: [0.46, 0.43, 0.36] },   // high ground
  { h: 1000, c: [0.62, 0.60, 0.56] },  // bare rock
]

export function bandColor(h) {
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

/**
 * A square of terrain with a square HOLE in it, for the coarser rings of a
 * clip-map: the fine ring draws inside the hole, so the coarse mesh never
 * floats over an airport plateau it cannot resolve. Returns typed arrays
 * plus the true (un-clamped) height per vertex, for the water shader.
 */
export function terrainRing(cx, cz, size, res, hole) {
  const pos = [], normal = [], color = [], depth = []
  const step = size / res
  const x0 = cx - size / 2, z0 = cz - size / 2
  let rowA = new Float32Array(res + 1), rowB = new Float32Array(res + 1)
  for (let i = 0; i <= res; i++) rowA[i] = elevation(x0 + i * step, z0)
  const inHole = (x, z) => hole && Math.abs(x - hole.cx) < hole.size / 2 && Math.abs(z - hole.cz) < hole.size / 2
  const push = (x, y, z, nx, ny, nz, c, d) => { pos.push(x, y, z); normal.push(nx, ny, nz); color.push(c[0], c[1], c[2]); depth.push(d) }
  const tri = (ax, ay, az, bx, by, bz, cx2, cy, cz2) => {
    const c = bandColor((ay + by + cy) / 3)
    const ya = Math.max(ay, 0), yb = Math.max(by, 0), yc = Math.max(cy, 0)
    const ux = bx - ax, uy = yb - ya, uz = bz - az
    const vx = cx2 - ax, vy = yc - ya, vz = cz2 - az
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l; ny /= l; nz /= l
    push(ax, ya, az, nx, ny, nz, c, ay); push(bx, yb, bz, nx, ny, nz, c, by); push(cx2, yc, cz2, nx, ny, nz, c, cy)
  }
  for (let j = 0; j < res; j++) {
    const z1 = z0 + j * step, z2 = z1 + step
    for (let i = 0; i <= res; i++) rowB[i] = elevation(x0 + i * step, z2)
    for (let i = 0; i < res; i++) {
      const xa = x0 + i * step, xb = xa + step
      if (inHole(xa + step / 2, z1 + step / 2)) continue
      const hAA = rowA[i], hBA = rowA[i + 1], hAB = rowB[i], hBB = rowB[i + 1]
      tri(xa, hAA, z1, xb, hBB, z2, xb, hBA, z1)
      tri(xa, hAA, z1, xa, hAB, z2, xb, hBB, z2)
    }
    const t = rowA; rowA = rowB; rowB = t
  }
  return {
    pos: new Float32Array(pos), normal: new Float32Array(normal),
    color: new Float32Array(color), depth: new Float32Array(depth),
  }
}

/** Runway and approach lights as POINTS: position, colour, and whether it is a
    unidirectional approach light (drawn brighter from the approach side). */
export function lightPoints(ap) {
  const pos = [], color = [], kind = []
  const put = (p, col, k = 0) => { pos.push(p.x, p.y, p.z); color.push(col[0], col[1], col[2]); kind.push(k) }
  const white = [1, 0.96, 0.85], green = [0.2, 1, 0.45], red = [1, 0.28, 0.24], blue = [0.35, 0.55, 1], amber = [1, 0.75, 0.25]
  for (const R of ap.rwys) {
    const dir = hdgVec(R.hdg), rgt = { x: -dir.z, y: 0, z: dir.x }
    const half = R.width / 2, c = rwyCentre(ap, R)
    const at = (u, v, h = 0.4) => ({ x: c.x + dir.x * u + rgt.x * v, y: ap.elev + h, z: c.z + dir.z * u + rgt.z * v })
    const u0 = -R.len / 2, u1 = R.len / 2
    for (let u = u0; u <= u1; u += 60) { put(at(u, -half - 1.5), white); put(at(u, half + 1.5), white) }
    for (let v = -half; v <= half; v += 6) { put(at(u0, v, 0.3), green); put(at(u1, v, 0.3), red) }
    // Centreline lights, white then alternating then red at the far end.
    for (let u = u0 + 30; u < u1; u += 30) {
      const left = u1 - u
      put(at(u, 0, 0.1), left < 300 ? red : left < 900 && Math.round(u / 30) % 2 ? red : white)
    }
    // Approach lighting: a centreline bar every 30 m out to 900 m, with
    // crossbars, and sequenced strobes in the last 600 m.
    for (let u = u0 - 30; u > u0 - 900; u -= 30) {
      put(at(u, 0, 1.4), white, 1)
      if (u > u0 - 300) { put(at(u, -4.5, 1.2), white, 1); put(at(u, 4.5, 1.2), white, 1) }
      if (Math.round((u0 - u) / 30) % 5 === 0) for (let v = -12; v <= 12; v += 3) if (Math.abs(v) > 1) put(at(u, v, 1.2), white, 1)
      if (u < u0 - 300) put(at(u, 0, 1.6), white, 2)     // strobe
    }
    // Taxiway edge lights, blue, along the parallel taxiway.
    const tv = half + 92
    for (let u = u0 + 60; u <= u1 - 60; u += 60) { put(at(u, tv - 23, 0.3), blue); put(at(u, tv + 23, 0.3), blue) }
    // Amber at the holding points.
    for (let k = 0; k <= 4; k++) { const u = u0 + 90 + (R.len - 180) * (k / 4); put(at(u, half + 40, 0.3), amber); put(at(u, half + 44, 0.3), amber) }
  }
  return { pos: new Float32Array(pos), color: new Float32Array(color), kind: new Float32Array(kind) }
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
/**
 * The strip, or its markings, depending on `marks`.
 *
 * Two meshes rather than one because they are two decals on the same plane and
 * each has to win a different depth fight: the asphalt against the terrain, and
 * the paint against the asphalt. Both are drawn with a polygon offset, which
 * scales with distance the way a fixed few centimetres of lift does not — a
 * runway seen from six miles out is the whole reason there is a runway.
 */
export function runwayMesh(ap, marks = false) {
  const pos = [], normal = [], color = []
  for (const R of ap.rwys) buildStrip(ap, R, marks, pos, normal, color)
  return { pos, normal, color }
}

function buildStrip(ap, R, marks, pos, normal, color) {
  const dir = hdgVec(R.hdg)
  const rgt = { x: -dir.z, y: 0, z: dir.x }
  const y = ap.elev + 0.06
  const half = R.width / 2
  const asphalt = [0.13, 0.13, 0.14]
  const paint = [0.88, 0.87, 0.82]
  const taxiway = [0.19, 0.19, 0.20]
  const c = rwyCentre(ap, R)

  // Threshold sits at -len/2 so the runway's own centre IS the midpoint.
  const at = (u, v, yy = y) => ({
    x: c.x + dir.x * u + rgt.x * v,
    y: yy,
    z: c.z + dir.z * u + rgt.z * v,
  })
  /* Wound counter-clockwise SEEN FROM ABOVE, which is the reverse of the order
     the corners are written in. This is the same trap the terrain builder
     documents, and the runway fell into it: every triangle of the strip, its
     centreline, its piano keys, its aiming points and its shoulders was
     back-facing, so `cullFace(BACK)` threw all four runways away and the
     aeroplane appeared to be parked in a field at every airport on the map. */
  const quad = (a, b, c, d, col) => {
    for (const [p, q, r] of [[a, c, b], [a, d, c]]) {
      for (const pt of [p, q, r]) { pos.push(pt.x, pt.y, pt.z); normal.push(0, 1, 0); color.push(col[0], col[1], col[2]) }
    }
  }

  const u0 = -R.len / 2, u1 = R.len / 2

  if (!marks || marks === 'apron') {
    // 'apron': shoulders and taxiways only; the strip itself is a textured surface now (runway.js).
    if (marks !== 'apron') quad(at(u0, -half), at(u1, -half), at(u1, half), at(u0, half), asphalt)
    // Shoulders, so the strip reads as a made surface rather than a floating slab.
    const shoulder = [0.20, 0.21, 0.18]
    quad(at(u0, -half - 26), at(u1, -half - 26), at(u1, -half), at(u0, -half), shoulder)
    quad(at(u0, half), at(u1, half), at(u1, half + 26), at(u0, half + 26), shoulder)

    /* A parallel taxiway, and the connectors on to it. An airport with a
       runway and nothing else reads as a strip in a field; the taxiway is the
       single cheapest thing that makes it read as an airport, and it is where
       you actually are after you land. */
    const tw = 23, tv = half + 92
    quad(at(u0 + 60, tv - tw), at(u1 - 60, tv - tw), at(u1 - 60, tv + tw), at(u0 + 60, tv + tw), taxiway)
    for (let k = 0; k <= 4; k++) {
      const u = u0 + 90 + (R.len - 180) * (k / 4)
      quad(at(u - 22, half), at(u + 22, half), at(u + 22, tv - tw), at(u - 22, tv - tw), taxiway)
    }
    return
  }

  // Paint sits a hair above the asphalt and is drawn at a deeper offset again.
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
}

/**
 * Is this point on a made surface — any runway or its shoulders?
 * Flying into a field is a crash; arriving on concrete is a landing, and the
 * difference has to be answerable from a coordinate.
 */
export function onPavement(x, z, margin = 0) {
  for (const key of AP_LIST) {
    const ap = AIRPORTS[key]
    if (Math.hypot(x - ap.x, z - ap.z) > ap.spread + 400) continue
    for (const R of ap.rwys) {
      const d = hdgVec(R.hdg)
      const c = rwyCentre(ap, R)
      const dx = x - c.x, dz = z - c.z
      const along = dx * d.x + dz * d.z
      const across = dx * -d.z + dz * d.x
      if (Math.abs(along) <= R.len / 2 + margin &&
          Math.abs(across) <= R.width / 2 + 26 + margin) return true
    }
  }
  return false
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
  for (const R of ap.rwys) lightStrip(ap, R, pos, color)
  return { pos, color }
}

function lightStrip(ap, R, pos, color) {
  const dir = hdgVec(R.hdg)
  const rgt = { x: -dir.z, y: 0, z: dir.x }
  const half = R.width / 2
  const white = [1, 0.96, 0.85], green = [0.2, 1, 0.45], red = [1, 0.28, 0.24]
  const c = rwyCentre(ap, R)
  const at = (u, v, yy) => ({ x: c.x + dir.x * u + rgt.x * v, y: yy, z: c.z + dir.z * u + rgt.z * v })
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
/**
 * The city, as a list of boxes.
 *
 * Generated from the same hash as the geometry and cached, because it is now
 * two things at once: what you see, and what you hit. A skyline that is only
 * a picture is a skyline you fly through, and an aeroplane that flies through
 * a tower block at 300 knots is not a simulator.
 *
 * Downtown is a real cluster rather than a uniform scatter: heights follow the
 * distance from the field, so there is a core worth threading and a suburb
 * worth being low over.
 */
/**
 * Where the town is.
 *
 * Chosen rather than hashed: of twelve candidate bearings round the field, the
 * one whose centre sits on the HIGHEST GROUND wins, with anything under water
 * rejected outright. Hashing it was stable and cheap and put San Francisco's
 * downtown in the middle of the bay the moment the bay was drawn where it
 * really is — the field ended up with a skyline of zero buildings. Deciding it
 * from the terrain means a town cannot be built in the sea however the
 * coastline is redrawn later.
 *
 * Deterministic, and memoised, because it is asked for every frame.
 */
const townCache = new Map()
function townCentre(ap, spread) {
  const hit = townCache.get(ap.icao)
  if (hit) return hit
  const r = spread * 0.52
  let best = null, bestH = -1e9
  for (let i = 0; i < 12; i++) {
    // Never straight off either end of the main runway: that is the approach.
    const brg = (ap.rwy.hdg + 40 + i * 30) * DEG
    const p = { x: ap.x + Math.cos(brg) * r, z: ap.z + Math.sin(brg) * r }
    const g = elevation(p.x, p.z)
    if (g < 2) continue
    if (g > bestH) { bestH = g; best = p }
  }
  // Every candidate under water: no town, which is a legitimate answer.
  const out = best || { x: ap.x, z: ap.z, dry: false }
  townCache.set(ap.icao, out)
  return out
}

const boxCache = new Map()
export function cityBoxes(ap, count = 90, spread = 4200) {
  const key = `${ap.icao}:${count}:${spread}`
  if (boxCache.has(key)) return boxCache.get(key)
  const out = []
  /* Downtown is a PLACE, offset from the field on its own bearing, the way a
     city is near an airport rather than around it. Scattering height by
     distance from the runway instead gave a uniform carpet of low blocks with
     nothing worth flying round: the tallest thing anywhere was 37 m. */
  const town = townCentre(ap, spread)
  for (let i = 0; i < count; i++) {
    // Hashed, not random: the skyline is the same on every reload.
    const a = hash2(i * 7 + 11, i * 13 + 5) * Math.PI * 2
    const rr = (0.10 + Math.pow(hash2(i * 3 + 1, i * 17), 0.7) * 0.92) * spread
    const x = town.x + Math.cos(a) * rr, z = town.z + Math.sin(a) * rr
    // Never build on a runway, on its shoulders, or under anybody's approach.
    if (onPavement(x, z, 260)) continue
    if (inApproachPath(x, z)) continue
    const g = elevation(x, z)
    if (g < 1) continue
    /* Height falls off from the centre of TOWN. A cluster of towers with low
       blocks around it is a city; the same buildings spread evenly are a
       carpet. The core is worth threading and the suburbs are worth being low
       over, and both of those are now decisions the pilot can make. */
    const core = clamp(1 - rr / (spread * 0.34), 0, 1)
    const tall = Math.pow(hash2(i * 5, i * 23), 1.5)
    const h = 12 + tall * (22 + core * core * 260)
    const w = 16 + hash2(i * 31, i * 3) * (16 + core * 26)
    const d = 16 + hash2(i * 11, i * 41) * (16 + core * 26)
    const tone = 0.28 + hash2(i * 19, i * 7) * 0.18
    out.push({ x, y: g, z, w, h, d, tone })
  }

  /* And a handful of real towers in the middle of it. Left to the hash the
     tallest thing at any field came out at 61 m, which is a business park:
     there was nothing in the landscape that a pilot had to go round. These
     are deterministic, they are the only buildings tall enough to matter, and
     they are what makes the low pass through town a decision. */
  const TOWERS = [[0, 0, 232], [180, 120, 196], [-150, 90, 174], [60, -190, 158], [-90, -140, 142]]
  for (const [ox, oz, hh] of TOWERS) {
    const x = town.x + ox, z = town.z + oz
    if (onPavement(x, z, 260) || inApproachPath(x, z)) continue
    const g = elevation(x, z)
    if (g < 1) continue
    // Scaled to the size of the town, so Half Moon Bay does not get a skyline.
    const s = clamp(spread / 6200, 0.30, 1)
    out.push({ x, y: g, z, w: 34 * s + 14, h: hh * s, d: 34 * s + 14, tone: 0.33 })
  }
  boxCache.set(key, out)
  return out
}

/**
 * Is this point under somebody's final approach?
 *
 * A protected wedge out from each runway end, widening with distance, which is
 * what a real obstacle-limitation surface is for. Without it the denser city
 * put tower blocks under the six-mile final at KSFO, and an approach flown
 * hands-off — which is to say the approach scenario, on every start — ended in
 * a building.
 */
export function inApproachPath(x, z) {
  for (const key of AP_LIST) {
    const ap = AIRPORTS[key]
    if (Math.hypot(x - ap.x, z - ap.z) > 15000) continue
    for (const R of ap.rwys) {
      const d = hdgVec(R.hdg)
      const c = rwyCentre(ap, R)
      const dx = x - c.x, dz = z - c.z
      const along = dx * d.x + dz * d.z
      const across = Math.abs(dx * -d.z + dz * d.x)
      // Both ends: an aeroplane can arrive from either direction.
      const out = Math.abs(along) - R.len / 2
      if (out < 0) continue
      if (out < 13000 && across < 260 + out * 0.10) return true
    }
  }
  return false
}

/**
 * The tallest thing standing at a point, in metres above sea level, or null.
 * Queried by the flight model, so it walks only the boxes that could contain
 * the point rather than the whole skyline.
 */
export function obstacleAt(x, z, pad = 0) {
  for (const key of AP_LIST) {
    const ap = AIRPORTS[key]
    const c = CITY[key]
    if (!c) continue
    if (Math.hypot(x - ap.x, z - ap.z) > c[1] + 400) continue
    for (const b of cityBoxes(ap, c[0], c[1])) {
      if (Math.abs(x - b.x) <= b.w / 2 + pad && Math.abs(z - b.z) <= b.d / 2 + pad) {
        return b.y + b.h
      }
    }
  }
  return null
}

/* How many blocks each field gets, and how far they spread. Raised from a
   scatter of ninety to a city, now that they are solid. */
export const CITY = {
  KSFO: [340, 6200], KSNS: [130, 3000], ZSPD: [380, 7000], ZSNJ: [190, 4200],
  // The neighbours get towns too, or they sit in empty fields.
  KOAK: [260, 5200], KSJC: [300, 5600], KHAF: [70, 2200],
  KMRY: [140, 3200], ZSSS: [340, 6000], ZSWX: [180, 4000],
}

export function scenery(ap, count = 90, spread = 4200) {
  const pos = [], normal = [], color = []
  const box = (cx, cy, cz, w, h, d, col) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y0 = cy, y1 = cy + h
    const V = (x, y, z) => ({ x, y, z })
    const faces = [
      // The roof, wound the same way round as the four walls. Written the
      // other way it was back-facing AND its computed normal pointed at the
      // ground, so every roof in every skyline was culled — and the ones that
      // survived at a grazing angle were shaded as though lit from below.
      [V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0), V(x0, y1, z0), 1.0],   // roof
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

  /* Drawn from the SAME list the collision test walks. Two generators would
     be two skylines, and the one you hit would not be the one you can see. */
  for (const b of cityBoxes(ap, count, spread)) {
    box(b.x, b.y, b.z, b.w, b.h, b.d, [b.tone, b.tone * 0.99, b.tone * 0.94])
  }
  return { pos, normal, color }
}
