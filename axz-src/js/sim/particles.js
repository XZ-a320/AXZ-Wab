/* ==========================================================================
   AXZ sim — particles and weather.

   Every emitter here fires off something the aeroplane is ACTUALLY doing, so
   the effects double as instrumentation: tyre smoke means the wheels just took
   weight, wingtip vapour means the wing is working hard, a contrail means you
   are high and cold enough for one. Nothing is decorative.

   One pooled array, one draw call per texture. Particles are recycled rather
   than allocated, because a landing that spawns forty puffs a second must not
   hand the garbage collector forty objects a second at the exact moment the
   frame budget matters most.
   ========================================================================== */

import { clamp } from './math.js'

const MAX = 900

export class Particles {
  constructor() {
    this.p = new Array(MAX)
    for (let i = 0; i < MAX; i++) {
      this.p[i] = { alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, grow: 0, r: 1, g: 1, b: 1, a: 1, fade: 1, drag: 0.5, kind: 0 }
    }
    this.next = 0
    this.count = 0
  }

  spawn(o) {
    // Oldest-slot reuse. A full pool drops the newest request rather than
    // scanning for a victim; at 900 live particles nobody can tell.
    let tries = 0
    while (tries < MAX) {
      const q = this.p[this.next]
      this.next = (this.next + 1) % MAX
      tries++
      if (q.alive) continue
      q.alive = true
      q.x = o.x; q.y = o.y; q.z = o.z
      q.vx = o.vx || 0; q.vy = o.vy || 0; q.vz = o.vz || 0
      q.life = 0; q.max = o.max || 1
      q.size = o.size || 1; q.grow = o.grow || 0
      q.r = o.r === undefined ? 1 : o.r
      q.g = o.g === undefined ? 1 : o.g
      q.b = o.b === undefined ? 1 : o.b
      q.a = o.a === undefined ? 1 : o.a
      q.fade = o.fade === undefined ? 1 : o.fade
      q.drag = o.drag === undefined ? 0.6 : o.drag
      q.kind = o.kind || 0
      return q
    }
    return null
  }

  step(dt, wind) {
    let n = 0
    for (let i = 0; i < MAX; i++) {
      const q = this.p[i]
      if (!q.alive) continue
      q.life += dt
      if (q.life >= q.max) { q.alive = false; continue }
      // Exponential drag, then drift with the wind: smoke that ignores the
      // wind while the aeroplane is crabbing looks painted on.
      const k = Math.exp(-q.drag * dt)
      q.vx *= k; q.vy *= k; q.vz *= k
      if (wind) { q.vx += (wind.x - q.vx) * (1 - k) * 0.6; q.vz += (wind.z - q.vz) * (1 - k) * 0.6 }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt
      q.size += q.grow * dt
      n++
    }
    this.count = n
  }

  /** Collect into the renderer's sprite format, split by texture kind. */
  collect(out) {
    for (const k in out) out[k].length = 0
    for (let i = 0; i < MAX; i++) {
      const q = this.p[i]
      if (!q.alive) continue
      const t = q.life / q.max
      const a = q.a * Math.pow(1 - t, q.fade)
      if (a <= 0.004) continue
      const bucket = out[q.kind]
      if (!bucket) continue
      bucket.push({ x: q.x, y: q.y, z: q.z, size: q.size, r: q.r, g: q.g, b: q.b, a })
    }
  }
}

export const KIND = { PUFF: 0, DOT: 1 }

/* --- Emitters -------------------------------------------------------------
   Each takes the aircraft state and decides, from the physics, whether there
   is anything to emit. The rules are the interesting part; the spawning is
   bookkeeping.                                                              */
export class Effects {
  constructor(parts) {
    this.parts = parts
    this.tSmoke = 0
    this.tExhaust = 0
    this.tContrail = 0
    this.tVortex = 0
    this.tSpray = 0
    this.tShock = 0
    this.tDiamond = 0
  }

  update(ac, dt, wind, helpers) {
    const P = this.parts
    const { bodyPoint } = helpers
    const spd = ac.tas

    /* Tyre smoke. Fires on the touchdown frame, scaled by how hard the arrival
       was — the same vertical speed the landing is graded on, so the puff you
       see is the score you are about to read. */
    if (ac.touchdownBurst) {
      const n = clamp(Math.round(ac.touchdownBurst / 40), 3, 26)
      for (const c of ac.contacts) {
        if (c.nose || c.tail) continue
        const w = bodyPoint(c)
        for (let i = 0; i < n; i++) {
          P.spawn({
            x: w.x, y: w.y + 0.4, z: w.z,
            vx: (Math.random() - 0.5) * 9 + ac.vel.x * 0.12,
            vy: 1.6 + Math.random() * 3.4,
            vz: (Math.random() - 0.5) * 9 + ac.vel.z * 0.12,
            max: 1.6 + Math.random() * 1.8, size: 1.4, grow: 4.2,
            r: 0.80, g: 0.78, b: 0.74, a: 0.55, fade: 1.5, drag: 1.5, kind: KIND.PUFF,
          })
        }
      }
      ac.touchdownBurst = 0
    }

    /* Rolling tyre dust: only on the ground, only while actually moving, and
       harder under braking. */
    if (ac.onGround && spd > 6) {
      this.tSmoke += dt
      const every = 0.06
      while (this.tSmoke > every) {
        this.tSmoke -= every
        const c = ac.contacts[1 + ((Math.random() * 2) | 0)]
        const w = bodyPoint(c)
        const heavy = ac.brakes > 0.4 ? 2.2 : 1
        P.spawn({
          x: w.x, y: w.y + 0.3, z: w.z,
          vx: (Math.random() - 0.5) * 3, vy: 0.5 + Math.random() * 1.4, vz: (Math.random() - 0.5) * 3,
          max: 0.8 + Math.random() * 0.9, size: 0.9, grow: 2.6 * heavy,
          r: 0.72, g: 0.70, b: 0.64, a: clamp(0.10 + spd / 300, 0, 0.34) * heavy, fade: 1.6, drag: 1.8, kind: KIND.PUFF,
        })
      }
    }

    /* Exhaust. Visible when the engines are working and the air is dense —
       a jet at idle at altitude does not trail anything you can see. */
    const thr = ac.thrustLag
    if (thr > 0.35 && ac.pos.y < 4200) {
      this.tExhaust += dt
      const every = 0.05
      while (this.tExhaust > every) {
        this.tExhaust -= every
        for (const side of [-1, 1]) {
          const e = bodyPoint({ x: side * ac.spec.span * 0.17, y: -ac.spec.dia * 0.62, z: -ac.spec.len * 0.02 })
          P.spawn({
            x: e.x, y: e.y, z: e.z,
            vx: -ac.vel.x * 0.05 + (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 1.2,
            vz: -ac.vel.z * 0.05 + (Math.random() - 0.5) * 2,
            max: 0.5 + Math.random() * 0.5, size: 1.1, grow: 5.5,
            r: 0.55, g: 0.55, b: 0.57, a: 0.05 + (thr - 0.35) * 0.14, fade: 1.8, drag: 2.4, kind: KIND.PUFF,
          })
        }
      }
    }

    /* Contrails. Above the tropopause-ish, where it is cold enough. Long-lived
       and slow-growing, so they actually persist behind the aeroplane. */
    if (ac.pos.y > 7200 && spd > 90) {
      this.tContrail += dt
      const every = 0.08
      while (this.tContrail > every) {
        this.tContrail -= every
        for (const side of [-1, 1]) {
          const e = bodyPoint({ x: side * ac.spec.span * 0.17, y: -ac.spec.dia * 0.55, z: ac.spec.len * 0.02 })
          P.spawn({
            x: e.x, y: e.y, z: e.z,
            vx: 0, vy: 0, vz: 0,
            max: 22, size: 5, grow: 3.2,
            r: 1, g: 1, b: 1, a: 0.42, fade: 0.7, drag: 0.05, kind: KIND.PUFF,
          })
        }
      }
    }

    /* Wingtip vapour. The one effect that is genuinely a physics readout: it
       appears when the wing is near its lift limit, which is exactly when a
       real one condenses its own vortex cores. */
    const heavyWing = ac.gLoad > 1.35 || (ac.alpha > 0.16 && spd > 55)
    if (heavyWing && ac.pos.y > 3 && !ac.onGround) {
      this.tVortex += dt
      const every = 0.045
      while (this.tVortex > every) {
        this.tVortex -= every
        const strength = clamp((ac.gLoad - 1.15) * 0.7 + (ac.alpha - 0.13) * 3.2, 0, 1)
        if (strength <= 0.02) break
        for (const side of [-1, 1]) {
          const w = bodyPoint({ x: side * ac.spec.span * 0.49, y: 0, z: ac.spec.len * 0.14 })
          P.spawn({
            x: w.x, y: w.y, z: w.z,
            vx: 0, vy: -0.6, vz: 0,
            max: 1.5 + strength * 1.6, size: 1.0, grow: 3.0,
            r: 1, g: 1, b: 1, a: 0.30 * strength, fade: 1.4, drag: 0.6, kind: KIND.PUFF,
          })
        }
      }
    }

    /* --- The barrier -----------------------------------------------------
       Two effects, and both are things a camera has actually caught.

       THE SHOCK COLLAR. Between about Mach 0.94 and 1.06 the pressure drop
       behind the shock cools the air past its dew point and a cone of cloud
       stands on the aeroplane. It is a condensation effect, not a speed
       effect, so it wants moist air: it is drawn strongest low down and fades
       out with altitude, which is why the famous photographs are all of
       aeroplanes at sea level and none of them are of anything at 50,000 ft.
       It appears going up THROUGH the barrier and again coming back down. */
    const mach = ac.mach || 0
    if (mach > 0.94 && mach < 1.08 && !ac.onGround) {
      const near = clamp(1 - Math.abs(mach - 1.005) / 0.062, 0, 1)
      const moist = clamp(1 - ac.pos.y / 9000, 0.08, 1)
      const strength = near * moist
      this.tShock += dt
      const every = 0.008
      while (this.tShock > every && strength > 0.04) {
        this.tShock -= every
        // A ring standing off the aft fuselage, which is where the cone sits.
        /* Sized against the AIRFRAME, not against the fuselage. A real cone is
           as wide as the aeroplane is long and stands off the rear third of
           it; at a couple of metres across it was technically present and
           invisible from any distance you would actually watch from. */
        const a = Math.random() * Math.PI * 2
        const rad = ac.spec.dia * (1.1 + Math.random() * 1.5)
        const p = bodyPoint({
          x: Math.cos(a) * rad,
          y: Math.sin(a) * rad,
          z: ac.spec.len * (0.10 + Math.random() * 0.30),
        })
        /* Carried at the aeroplane's own velocity, and short-lived. The cone
           STANDS on the airframe; it does not stream off it. Spawned at rest
           in world space, a Mach 1 aeroplane leaves its own condensation a
           hundred metres behind within a third of a second and what you see is
           a contrail. Given the aircraft's velocity and a heavy drag, each
           puff holds station for a moment and then slides aft, which is what
           the trailing edge of a real cone does. */
        P.spawn({
          x: p.x, y: p.y, z: p.z,
          vx: ac.vel.x, vy: ac.vel.y, vz: ac.vel.z,
          max: 0.18 + strength * 0.12, size: ac.spec.len * 0.10, grow: 12.0,
          r: 1, g: 1, b: 1, a: 0.55 * strength, fade: 3.0, drag: 2.2, kind: KIND.PUFF,
        })
      }
    }

    /* SHOCK DIAMONDS. A reheated engine running supersonic exhausts into air
       it cannot expand to, so the plume alternately over- and under-expands
       and stands up a row of bright nodes. They are fixed in the plume, not
       carried away by it, which is what makes them read as diamonds rather
       than as sparks. */
    if (mach > 1 && (ac.abFrac || 0) > 0.05 && !ac.onGround) {
      this.tDiamond += dt
      const every = 0.03
      while (this.tDiamond > every) {
        this.tDiamond -= every
        const n = ac.spec.engines >= 4 ? 4 : ac.spec.engines
        for (let e = 0; e < n; e++) {
          const side = n === 1 ? 0 : (e % 2 ? 1 : -1)
          const lane = n >= 4 ? (e < 2 ? 0.30 : 0.52) : 0.34
          for (let k = 0; k < 4; k++) {
            const p = bodyPoint({
              x: side * ac.spec.span * lane,
              y: n === 1 ? 0 : -ac.spec.dia * 0.35,
              z: ac.spec.len * (0.50 + k * 0.055),
            })
            const bright = (1 - k * 0.19) * ac.abFrac
            // Fixed IN the plume, so they ride with the aeroplane.
            P.spawn({
              x: p.x, y: p.y, z: p.z,
              vx: ac.vel.x, vy: ac.vel.y, vz: ac.vel.z,
              max: 0.07, size: ac.spec.dia * (0.16 - k * 0.02), grow: 1.4,
              r: 2.4 * bright, g: 1.5 * bright, b: 2.2 * bright,
              a: 0.9, fade: 2.6, drag: 1.2, kind: KIND.DOT,
            })
          }
        }
      }
    }
  }
}

/* --- Clouds ---------------------------------------------------------------
   A deck of cumulus, each one a clutch of billboards around a centre. They are
   placed on a hashed lattice rather than a list, so the deck extends as far as
   the aeroplane ever flies without storing anything, and the same cloud is in
   the same place on every reload.

   Sorted back to front every frame: soft alpha sprites drawn out of order put
   their own transparent edges over the ones behind.                         */
export class Clouds {
  constructor({ base = 1500, thickness = 500, spacing = 5200, puffs = 9, radius = 240 } = {}) {
    this.base = base
    this.thickness = thickness
    this.spacing = spacing
    this.puffs = puffs
    this.radius = radius
    this.cover = 0.5
  }

  static hash(ix, iz, salt) {
    let h = ix * 374761393 + iz * 668265263 + salt * 2246822519
    h = (h ^ (h >> 13)) * 1274126177
    return ((h ^ (h >> 16)) >>> 0) / 4294967295
  }

  /** Build the visible sprite list around a camera position. */
  collect(camX, camZ, range, out) {
    out.length = 0
    if (this.cover <= 0.01) return out
    const S = this.spacing
    const i0 = Math.floor((camX - range) / S), i1 = Math.floor((camX + range) / S)
    const j0 = Math.floor((camZ - range) / S), j1 = Math.floor((camZ + range) / S)
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        if (Clouds.hash(i, j, 11) > this.cover) continue
        const cx = (i + Clouds.hash(i, j, 3)) * S
        const cz = (j + Clouds.hash(i, j, 5)) * S
        const dx = cx - camX, dz = cz - camZ
        if (dx * dx + dz * dz > range * range) continue
        const cy = this.base + Clouds.hash(i, j, 7) * this.thickness
        const scale = 0.7 + Clouds.hash(i, j, 13) * 0.9
        for (let k = 0; k < this.puffs; k++) {
          const a = Clouds.hash(i * 31 + k, j, 17) * Math.PI * 2
          const rr = Clouds.hash(i, j * 31 + k, 19)
          const px = cx + Math.cos(a) * rr * this.radius * scale * 1.5
          const pz = cz + Math.sin(a) * rr * this.radius * scale * 1.5
          const py = cy + (Clouds.hash(i + k, j - k, 23) - 0.45) * this.radius * 0.55 * scale
          out.push({
            x: px, y: py, z: pz,
            size: this.radius * scale * (0.55 + Clouds.hash(i - k, j + k, 29) * 0.7),
            r: 1, g: 1, b: 1, a: 0.85,
            d: (px - camX) * (px - camX) + (py) * 0 + (pz - camZ) * (pz - camZ),
          })
        }
      }
    }
    out.sort((a, b) => b.d - a.d)
    return out
  }
}

/* --- Crash ----------------------------------------------------------------
   A crash is not a state flag with a red caption. It is: the airframe stops
   flying, the wreck slides and stops, and the site of it burns.

   The explosion is four overlapping systems, because one system of orange
   sprites reads as confetti. A fireball that expands fast and cools from white
   through orange to black; a smoke column that outlives it and keeps rising;
   debris that is thrown ballistically and bounces once; and a single expanding
   shock ring on the ground. The bright core is well above 1.0 so the bloom
   pass in post.js has something to catch, which is what makes it look hot
   rather than painted.                                                      */
export function explode(P, x, y, z, energy = 1, vel = { x: 0, y: 0, z: 0 }) {
  const E = clamp(energy, 0.35, 2.4)

  // Fireball: hot, fast, short-lived.
  for (let i = 0; i < Math.round(46 * E); i++) {
    const a = Math.random() * Math.PI * 2
    const el = Math.random() * 1.15
    const sp = (7 + Math.random() * 26) * E
    P.spawn({
      x, y: y + 1.5, z,
      vx: Math.cos(a) * Math.cos(el) * sp + vel.x * 0.25,
      vy: Math.sin(el) * sp * 0.85 + 3,
      vz: Math.sin(a) * Math.cos(el) * sp + vel.z * 0.25,
      max: 0.55 + Math.random() * 0.9,
      size: 1.8 + Math.random() * 3.4 * E, grow: 8.5 * E,
      // Over-bright on purpose: this is what the bloom threshold picks up.
      r: 1.95, g: 0.92, b: 0.26, a: 1, fade: 1.9, drag: 2.1, kind: KIND.PUFF,
    })
  }
  // Cooler outer flame, a beat behind the core.
  for (let i = 0; i < Math.round(34 * E); i++) {
    const a = Math.random() * Math.PI * 2
    const sp = (4 + Math.random() * 15) * E
    P.spawn({
      x, y: y + 2, z,
      vx: Math.cos(a) * sp, vy: 2 + Math.random() * 9, vz: Math.sin(a) * sp,
      max: 1.1 + Math.random() * 1.3,
      size: 2.6 + Math.random() * 5 * E, grow: 7.5 * E,
      r: 1.25, g: 0.36, b: 0.09, a: 0.9, fade: 1.6, drag: 1.5, kind: KIND.PUFF,
    })
  }
  // Smoke column: slow, dark, and it outlasts everything else.
  for (let i = 0; i < Math.round(40 * E); i++) {
    const a = Math.random() * Math.PI * 2
    const sp = (1.5 + Math.random() * 7) * E
    P.spawn({
      x, y: y + 2, z,
      vx: Math.cos(a) * sp, vy: 3 + Math.random() * 11, vz: Math.sin(a) * sp,
      max: 7 + Math.random() * 9,
      size: 3.4 + Math.random() * 6 * E, grow: 5.5,
      r: 0.14, g: 0.13, b: 0.12, a: 0.85, fade: 1.1, drag: 0.55, kind: KIND.PUFF,
    })
  }
  // Debris: ballistic, hot, and small.
  for (let i = 0; i < Math.round(30 * E); i++) {
    const a = Math.random() * Math.PI * 2
    const sp = (14 + Math.random() * 46) * E
    const el = 0.3 + Math.random() * 1.0
    P.spawn({
      x, y: y + 2, z,
      vx: Math.cos(a) * Math.cos(el) * sp + vel.x * 0.5,
      vy: Math.sin(el) * sp,
      vz: Math.sin(a) * Math.cos(el) * sp + vel.z * 0.5,
      max: 1.6 + Math.random() * 2.4,
      size: 0.9 + Math.random() * 1.6, grow: 0,
      r: 2.2, g: 0.9, b: 0.25, a: 1, fade: 2.2, drag: 0.16, kind: KIND.DOT,
    })
  }
  // One ground shock ring.
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2
    const sp = 26 * E
    P.spawn({
      x, y: y + 0.8, z,
      vx: Math.cos(a) * sp, vy: 0.6, vz: Math.sin(a) * sp,
      max: 1.4, size: 2, grow: 8,
      r: 0.85, g: 0.75, b: 0.60, a: 0.5, fade: 1.6, drag: 2.6, kind: KIND.PUFF,
    })
  }
}

/** A burning wreck: a slow trickle of fire and a smoke column that persists. */
export function burn(P, x, y, z, dt, acc) {
  acc.t = (acc.t || 0) + dt
  const every = 0.07
  let fired = false
  while (acc.t > every) {
    acc.t -= every
    fired = true
    P.spawn({
      x: x + (Math.random() - 0.5) * 6, y: y + 1, z: z + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 2.4, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 2.4,
      max: 0.7 + Math.random() * 0.7, size: 2.2, grow: 5,
      r: 2.2, g: 0.85, b: 0.22, a: 0.9, fade: 1.7, drag: 1.4, kind: KIND.PUFF,
    })
    P.spawn({
      x: x + (Math.random() - 0.5) * 8, y: y + 3, z: z + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 2, vy: 5 + Math.random() * 6, vz: (Math.random() - 0.5) * 2,
      max: 6 + Math.random() * 6, size: 5, grow: 7,
      r: 0.13, g: 0.12, b: 0.11, a: 0.7, fade: 1.2, drag: 0.5, kind: KIND.PUFF,
    })
  }
  return fired
}
