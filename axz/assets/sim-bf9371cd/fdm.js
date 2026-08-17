/* ==========================================================================
   AXZ sim — flight dynamics.

   A real coefficient-based model, not a "point the nose and move" arcade
   cheat. Lift and drag come from angle of attack through a CL curve that
   actually breaks at the stall, thrust spools, the gear is a spring-damper
   with tyre friction, and the moments carry static stability and rate damping
   so the aeroplane has a trim speed and a phugoid.

   The numbers are 737-800 figures, and they were checked rather than guessed:
   at 65 t the clean stall lands near 145 kt, flaps 30 near 110 kt, and level
   flight at 250 kt needs about a fifth of the available thrust. Those three
   sanity checks are what the constants were tuned against.

   Sign conventions live in math.js. Aerodynamic moments below are written in
   the usual convention — positive pitch = nose up, positive yaw = nose right,
   positive roll = right wing down — and converted to body torques in exactly
   one place, at the bottom of `aeroMoments`.
   ========================================================================== */

import {
  clamp, DEG, approach, qrot, qinv, qmul, qnorm, qFromAxisAngle, qFromEuler,
  vadd, vsub, vscale, vdot, vcross, vlen, vnorm,
} from './math.js'
import { elevation, obstacleAt, onPavement } from './world.js'

const G = 9.80665
/** Lever position where the burner lights, on the types that have one. */
const AB_GATE = 0.92

/** ISA density. Thrust and every dynamic pressure in here run through it. */
export function airDensity(altM) {
  if (altM < 11000) {
    const T = 288.15 - 0.0065 * altM
    return 1.225 * Math.pow(T / 288.15, 4.2559)
  }
  return 0.3639 * Math.exp(-(altM - 11000) / 6341.6)
}

/* --- Flap schedules -------------------------------------------------------
   Detent -> extra lift, extra drag, the stall angle it buys, and the speed it
   may be extended at. The build hands the whole set of tables down from
   `scripts/airframe.mjs`, so the page's roster arithmetic and this model read
   the same numbers. The default below is the airliner schedule, kept here so
   the engine still runs if the attribute is ever missing. */
const DEFAULT_FLAPS = {
  airliner: [
    { deg: 0, dCL: 0.00, dCD: 0.0000, dStall: 0.0, vfe: 9999 },
    { deg: 5, dCL: 0.28, dCD: 0.0055, dStall: 0.7, vfe: 250 },
    { deg: 15, dCL: 0.62, dCD: 0.0170, dStall: 1.2, vfe: 210 },
    { deg: 30, dCL: 1.05, dCD: 0.0480, dStall: 1.6, vfe: 175 },
    { deg: 40, dCL: 1.28, dCD: 0.0850, dStall: 1.4, vfe: 162 },
  ],
}
let FLAP_SETS = DEFAULT_FLAPS

/** Install the schedules the page shipped. Called once, before any Aircraft. */
export function setFlapSets(sets) {
  if (sets && sets.airliner) FLAP_SETS = sets
}
export const flapsFor = spec => FLAP_SETS[spec && spec.flapSet] || FLAP_SETS.airliner
/** How many detents THIS type has. Concorde has one; an airliner has five. */
export const flapSteps = spec => flapsFor(spec).length

/**
 * Wave drag, as a fraction of the wing area.
 *
 * It is a BUMP, not a step. Drag climbs steeply from the drag-divergence Mach
 * number, peaks a little past Mach 1 where the shock system is worst, and then
 * FALLS AWAY as the shocks sweep back and settle — which is the whole reason
 * a supersonic aeroplane is possible at all. The previous version saturated at
 * its maximum and stayed there, so past Mach 1 the aeroplane was pushing a
 * wall that never let go: Concorde topped out at Mach 0.70 and the F-16 at
 * 1.38, against published figures of 2.04 and 2.05.
 *
 * The supersonic decay follows the slender-body result that wave drag falls
 * with sqrt(M² - 1), normalised so the curve is continuous at the peak.
 */
export function waveDrag(cfg, mach) {
  const mdd = cfg.mdd
  if (mach <= mdd) return 0
  const PEAK = 1.10
  if (mach < PEAK) {
    const x = (mach - mdd) / (PEAK - mdd)
    return cfg.waveDrag * x * x * (3 - 2 * x)          // smooth rise to the peak
  }
  const ref = Math.sqrt(PEAK * PEAK - 1)
  return cfg.waveDrag * Math.max(0.16, ref / Math.sqrt(Math.max(mach * mach - 1, ref * ref)))
}

/** The speed of sound at an altitude, ISA. Mach matters once a type can reach it. */
export function speedOfSound(altM) {
  const T = altM < 11000 ? 288.15 - 0.0065 * altM : 216.65
  return Math.sqrt(1.4 * 287.053 * T)
}

/**
 * Lift-curve slope at a Mach number, from the incompressible value.
 *
 * Three regimes, and all three are things you can feel. Below the drag rise
 * the wing gets MORE sensitive as it goes faster — Prandtl-Glauert, the
 * 1/sqrt(1-M²) that also explains why the transonic is where the trouble
 * starts. Through the transonic the shocks form and the slope collapses.
 * Supersonically it settles at the thin-aerofoil result, 4/sqrt(M²-1), except
 * that a low-aspect-ratio wing cannot exceed its own slender-body limit of
 * pi·AR/2. At its own cruise that leaves Concorde at 2.28 against a subsonic
 * 2.92, a fifth down, while the F-16 at Mach 2 is at 2.23 against 3.95, which
 * is nearly half. The delta was shaped to hold its lift across the barrier and
 * it does; the fighter was not and does not. That difference is most of why
 * the two feel so unlike each other at speed, and it falls out of the aspect
 * ratio rather than being typed in.
 */
export function liftSlopeAt(a0, AR, mach) {
  const sup = Math.min(4 / Math.sqrt(Math.max(mach * mach - 1, 0.04)), Math.PI * AR / 2)
  if (mach <= 0.75) return a0 / Math.sqrt(1 - mach * mach)
  const peak = a0 / Math.sqrt(1 - 0.75 * 0.75)
  if (mach >= 1.25) return sup
  // Smoothstep from the transonic peak down to the supersonic value.
  const t = (mach - 0.75) / 0.5
  const k = t * t * (3 - 2 * t)
  return peak + (sup - peak) * k
}

/** Everything the model needs about a type, derived from the fleet table. */
export function makeConfig(spec) {
  /* Everything used to be derived from LENGTH with 737 constants, which was
     fine while every type in the table was a 737. It is not fine for a 250 t
     747 with four engines or a 1.05 t single, so mass, wing area and thrust
     are now the type's own published figures and only the inertias are
     estimated from geometry.

     The test of whether this is a flight model or a lookup table is whether
     the same equations fly the Cessna and the 747 without special cases. They
     do. What arrives per type is not a special case but a coefficient: the
     lift-curve slope, which the build derives from the published span and wing
     area through lifting-line theory, the parasite drag, the span efficiency
     and the angle the wing lets go at. Those four numbers are the difference
     between a slender delta, a fighter and an airliner, and they are all the
     difference there is. */
  const b = spec.span
  const S = spec.wingArea || (b * b) / 10.3
  const AR = (b * b) / S
  const c = S / b
  const mass = spec.mass || 1650 * spec.len
  /* PER ENGINE, times the number of them. The table used to mix the two
     conventions — a total for the airliners and a per-engine figure for the
     types added later — and the model applied whatever it found once along the
     nose. Concorde therefore flew on one Olympus instead of four and could not
     reach Mach 0.71; the Gulfstream flew on one engine of two. */
  const nEng = spec.engines || 1
  const dry = (spec.thrust || 121400) * nEng
  /* Gear stiffness is sized from the STANCE, not from a constant. At a fixed
     `mass * 13` the static squat came out at 25 cm for everything, which is
     seven per cent of a 737's leg and a quarter of a Cessna's — and a quarter
     of the leg is how the light single ended up with its propeller under the
     runway. Sizing the spring so the squat is a fixed fraction of the leg
     keeps a big aeroplane feeling like one and stops a small one sitting on
     its belly. The damping then follows at the same ratio the 737 was tuned
     with, which is 0.40 of critical. */
  const stance = spec.restHeight || 3.4
  const squat = clamp(stance * 0.062, 0.03, 0.30)
  const gearK = (mass * G / 3) / squat
  const engine = spec.engine || (spec.prop ? 'piston' : 'turbofan')
  // Spool rates, per second, toward the lever. Up is slower than down on every
  // gas turbine; a piston has effectively neither.
  const SPOOL = {
    turbofan: [0.55, 0.9],
    'turbofan-small': [0.85, 1.2],
    'turbofan-ab': [1.5, 1.9],
    'turbojet-reheat': [1.1, 1.5],
    piston: [4.0, 4.5],
  }
  const [spoolUp, spoolDown] = SPOOL[engine] || SPOOL.turbofan

  /* Manoeuvring speed, which is where a type's published roll rate is quoted
     and the speed above which full control deflection is limited rather than
     available. It is not invented: VA is the clean stall speed times the root
     of the certification limit load factor, and that load factor is a real
     published number per category — 2.5 for transport, 3.8 for a normal
     category single, 9 for a fighter. It is the whole reason an F-16 gets its
     324 degrees a second at 396 knots and an airliner never does. */
  const cl0 = spec.cl0 != null ? spec.cl0 : 0.15
  const clA = spec.clAlpha || 5.2
  const stallA = (spec.stallDeg != null ? spec.stallDeg : (spec.prop ? 16.5 : 15.5)) * DEG
  const clMaxClean = Math.max(cl0 + clA * stallA, 0.4)
  const vsClean = Math.sqrt((2 * mass * G) / (1.225 * S * clMaxClean))
  const vRoll = vsClean * Math.sqrt(spec.nLimit || 2.5)
  const rollRate = spec.rollRate || 30

  return {
    name: spec.name, S, b, c, mass, AR,
    maxThrust: dry,
    /* Reheat is a second published figure, not a multiplier. The Olympus 593
       gives 139.4 kN dry and 169.2 kN lit; the F110 gives 76.3 and 131. */
    abThrust: (spec.thrustAB || 0) * nEng,
    nEng,
    /* Transonic. `mdd` is where the drag rise starts, `waveDrag` is how big the
       peak is, and `machInlet` is where the intake stops being able to feed the
       engine — which on a fixed normal-shock intake like the F-16's is the real
       reason the aeroplane has a top speed at all. */
    mdd: spec.mdd || 0.78,
    waveDrag: spec.waveDrag != null ? spec.waveDrag : 0.075,
    machInlet: spec.machInlet || 1.0,
    engine, spoolUp, spoolDown,
    lapse: spec.lapse != null ? spec.lapse : 1,
    // A fighter's gear is up in five seconds; an airliner's takes ten.
    gearRate: spec.len < 20 ? 0.5 : spec.len > 55 ? 0.20 : 0.28,
    prop: !!spec.prop,
    // Radii of gyration as fractions of the airframe, which is the standard
    // way to estimate these when you do not have the real inertia tensor.
    Ix: mass * Math.pow(spec.len * 0.21, 2),
    Iy: mass * Math.pow(((spec.len + b) / 2) * 0.25, 2),
    Iz: mass * Math.pow(b * 0.17, 2),
    gearK,
    gearC: 2 * 0.402 * Math.sqrt(gearK * mass),
    vne: spec.vne || 340,
    mmo: spec.mmo || 0.86,
    ceiling: spec.ceiling || (spec.prop ? 4100 : 12000),
    cl0: spec.cl0 != null ? spec.cl0 : 0.15,
    cd0: spec.cd0 != null ? spec.cd0 : 0.021,
    oswald: spec.oswald || 0.80,
    clAlpha: spec.clAlpha || 5.2,
    /* How far the aerodynamic centre travels aft through the transonic, as a
       fraction of the mean chord. This is Mach tuck: the wing's centre of lift
       moves back, the nose drops, and the faster it goes the harder it tucks.
       It is why Concorde pumped twenty tonnes of fuel aft on the way through
       the barrier, and it is the single most characteristic thing about flying
       a transport near its limit. */
    acShift: spec.acShift != null ? spec.acShift : 0.16,
    stallAlpha: (spec.stallDeg != null ? spec.stallDeg : (spec.prop ? 16.5 : 15.5)) * DEG,
    /* A short wing rolls faster than a long one for the same aileron, and a
       fighter's roll rate is most of what makes it feel like a fighter. Scaled
       against the 737's span so the airliners keep exactly what they had. */
    /* Roll authority, sized from the type's PUBLISHED maximum roll rate.
       It used to scale inversely with span, which is dimensionally wrong and
       gave exactly the complaint it deserved: Concorde's span is shorter than
       a 737's, so the formula handed a 111-tonne delta more roll authority
       than a narrowbody and it rolled like a fighter. What sets roll rate is
       the balance between aileron power and roll damping, and solving that
       balance backwards from the real rate is one line:

           p_steady = (Cl_da / -Cl_p) * (2V / b)

       so Cl_da is whatever makes p_steady come out at the published figure at
       the manoeuvring speed. A 737 rolls at 35 degrees a second, Concorde at
       15, an F-16 at 324, and now they do. */
    rollPower: (rollRate * DEG) * 0.48 * b / (2 * vRoll),
    vRoll,
  }
}

/* --- Wind -----------------------------------------------------------------
   A mean wind that shears with height plus band-limited turbulence. This is
   the single change that makes an approach feel flown rather than watched: the
   aeroplane has to be crabbed into a crosswind, a headwind changes the ground
   speed without touching the airspeed, and gusts move the aiming point.

   Turbulence is a sum of sines at incommensurate rates rather than filtered
   noise. It is cheap, it never repeats within a session, and unlike random
   per-frame jitter it is frame-rate independent, which matters when the same
   model runs at 120 and 240 Hz.                                            */
export class Wind {
  constructor() {
    /* Still air by default. Eight knots from 250 with gusts is a fair day and
       it was on for everybody the moment they pressed Start, which means the
       first thing anyone ever flew here was a crosswind landing they had not
       asked for. The wind controls are on the page; this is where they begin. */
    this.dirDeg = 250          // direction the wind comes FROM
    this.speedKt = 0
    this.gust = 0              // 0..1, how lively
    this.t = 0
    this.cur = { x: 0, y: 0, z: 0 }
  }

  set(dirDeg, speedKt, gust = 0.35) {
    this.dirDeg = dirDeg; this.speedKt = speedKt; this.gust = clamp(gust, 0, 1)
  }

  /** Wind vector at a height, in m/s, blowing TOWARD +x/+z. */
  sample(altAgl, dt) {
    this.t += dt
    // Surface friction: the boundary layer slows and backs the wind near the
    // ground, which is why a crosswind changes as you descend into the flare.
    const shear = clamp(0.42 + 0.58 * Math.log10(Math.max(altAgl, 2) / 2 + 1) / Math.log10(51), 0.42, 1)
    const base = this.speedKt * 0.514444 * shear
    const from = this.dirDeg * DEG
    // "From 250" means blowing toward 070.
    let vx = -Math.sin(from) * base
    let vz = Math.cos(from) * base

    const g = this.gust * base * 0.42
    const t = this.t
    vx += g * (Math.sin(t * 0.83) * 0.6 + Math.sin(t * 2.17 + 1.3) * 0.3 + Math.sin(t * 5.31 + 2.6) * 0.15)
    vz += g * (Math.cos(t * 0.71 + 0.4) * 0.6 + Math.cos(t * 1.93 + 2.1) * 0.3 + Math.cos(t * 4.77) * 0.15)
    const vy = g * 0.45 * (Math.sin(t * 1.37 + 0.9) * 0.7 + Math.sin(t * 3.11 + 1.7) * 0.3)

    this.cur.x = vx; this.cur.y = vy; this.cur.z = vz
    return this.cur
  }
}

export class Aircraft {
  constructor(spec, contacts, restHeight) {
    this.spec = spec
    // The stance has to be known before the gear spring is sized, so it goes
    // in rather than being read back off the finished object.
    this.cfg = makeConfig({ ...spec, restHeight })
    this.flaps = flapsFor(spec)
    this.contacts = contacts
    this.restHeight = restHeight
    this.reheat = 0               // 0..1, how far into the burner the lever is

    this.pos = { x: 0, y: 0, z: 0 }
    this.vel = { x: 0, y: 0, z: 0 }
    this.q = { x: 0, y: 0, z: 0, w: 1 }
    this.omega = { x: 0, y: 0, z: 0 }

    this.ctl = { elevator: 0, aileron: 0, rudder: 0 }
    this.trim = 0
    this.throttle = 0
    this.thrustLag = 0            // spooled engine state, 0..1
    this.flap = 0
    this.gearDown = true
    this.gearPos = 1              // animates 0..1
    this.spoilers = 0
    this.brakes = 0
    this.parkingBrake = false
    this.assist = true

    // Readouts the HUD and the mission logic use.
    this.alpha = 0; this.beta = 0; this.tas = 0; this.ias = 0; this.mach = 0
    this.agl = 0; this.onGround = true; this.gLoad = 1
    this.stalling = false; this.overspeed = false
    this.wind = { x: 0, y: 0, z: 0 }
    this.touchdownBurst = 0
    this.touchdownFpm = 0; this.wasAirborne = false; this.justLanded = null
    this.crashed = false
  }

  /** Static gear compression: what the legs are already squashed by at rest. */
  get staticSquat() { return (this.cfg.mass * G / 3) / this.cfg.gearK }

  /**
   * Solve the attitude, trim and thrust that hold `speedMs` on a flight path of
   * `gamma` radians. Dropping an aeroplane in at a level attitude and letting it
   * sort itself out is honest and unusable: it is not in equilibrium, so it
   * sinks, accelerates, balloons and phugoids its way down while the reader is
   * still working out which key is the throttle. Airborne starts come through
   * here instead, already trimmed.
   */
  trimFor(speedMs, gamma = 0) {
    const cfg = this.cfg
    const flap = this.flaps[this.flap]
    const rho = airDensity(Math.max(this.pos.y, 0))
    const qbar = 0.5 * rho * speedMs * speedMs
    const W = cfg.mass * G
    const CLreq = (W * Math.cos(gamma)) / (qbar * cfg.S)
    // The type's own lift-curve slope, or a delta trims itself to an alpha a
    // swept wing would need and arrives on the slope nose-down.
    const alpha = (CLreq - cfg.cl0 - flap.dCL) / cfg.clAlpha
    const trim = clamp((1.25 * alpha - 0.045) / 0.88, -0.6, 0.6)
    const kInd = 1 / (Math.PI * cfg.oswald * cfg.AR)
    const CD = cfg.cd0 + flap.dCD + this.gearPos * 0.019 + kInd * CLreq * CLreq
    const D = qbar * cfg.S * CD
    // Trim on DRY power. Nothing cruises in reheat, and a lever position solved
    // against the wet figure would have put the burner in every cruise start.
    const gate = this.hasReheat ? AB_GATE : 1
    const dry = this.thrustAvailable(rho, speedMs, gate)
    const throttle = clamp(gate * (D + W * Math.sin(gamma)) / Math.max(dry, 1), 0, gate)
    return { alpha, pitch: alpha + gamma, trim, throttle }
  }

  /**
   * Thrust at this density and speed for a given lever position, in newtons.
   *
   * Four engines behave in three ways and the difference is not cosmetic. A
   * high-bypass fan is roughly constant with speed and falls with density. A
   * reheated turbojet gains with speed, because the intake is compressing the
   * air for it — which is exactly why Concorde could cruise supersonically on
   * dry power after using the burner only to get through the transonic. A
   * propeller converts roughly constant POWER, so its thrust is largest
   * standing still and falls away as the aeroplane accelerates.
   */
  thrustAvailable(rho, V, lever) {
    const cfg = this.cfg
    const dens = Math.min(1, rho / 1.225 + (cfg.prop ? 0.0 : 0.12))
    if (cfg.prop) {
      const vRef = Math.max(V, 12)
      return clamp(lever, 0, 1) * cfg.maxThrust * dens * clamp(24 / vRef, 0.22, 1)
    }
    const L = clamp(lever, 0, 1)
    let T
    if (!this.hasReheat) {
      T = L * cfg.maxThrust
    } else if (L <= AB_GATE) {
      // The dry range occupies the lever up to the detent, so full military
      // power is the published dry figure and not some fraction of it.
      T = (L / AB_GATE) * cfg.maxThrust
    } else {
      T = cfg.maxThrust + (cfg.abThrust - cfg.maxThrust) * ((L - AB_GATE) / (1 - AB_GATE))
    }
    // Ram rise. An intake compressing Mach 2 air is doing work the compressor
    // would otherwise have to, which is why a turbojet gains thrust with speed
    // where a big fan does not.
    const mach = V / speedOfSound(Math.max(this.pos.y, 0))
    /* A high-bypass fan works the other way round: most of its thrust comes
       from accelerating a large mass of air by a little, so as the aeroplane
       speeds up the air is already arriving fast and the fan adds less to it.
       A CFM56 makes about 121 kN standing still and about 24 at cruise, and
       only half of that fall is density. Without this the take-off roll came
       out at 717 m against a real 65-tonne 737's 1,300, and every airliner
       cruised past its own Mmo. */
    const ram = cfg.engine === 'turbojet-reheat' ? 1 + 0.62 * clamp(mach, 0, 2.1)
      : cfg.engine === 'turbofan-ab' ? 1 + 0.30 * clamp(mach, 0, 1.8)
        /* How hard a fan lapses with speed is set by its BYPASS RATIO. A
           CFM56 at 5.5 is throwing a large mass of air backwards slowly, so
           once the aeroplane is moving fast the air is already arriving at
           nearly that speed and the fan adds little. A military core at 0.9 —
           the F118 in a B-2, the TF33 in a B-52 — is throwing a small mass
           very fast and barely notices. At the airliner's lapse a B-2 could
           not hold its own cruise: it needed 90 kN and had 63. */
        : clamp(1 - 0.90 * cfg.lapse * mach + 0.42 * cfg.lapse * mach * mach, 0.28, 1)
    /* Intake pressure recovery, which is what actually sets a top speed. An
       F-16's intake is a fixed normal-shock duct and stops feeding the engine
       somewhere past Mach 1.8 — that, not thrust, is why the published figure
       is 2.05. Concorde's intake ramps move, which is why it could hold
       recovery past Mach 2 and cruise there on dry power. Without this term an
       aeroplane with reheat simply accelerates until the wave drag catches it,
       which is nowhere near the right number. */
    const over = Math.max(0, mach - cfg.machInlet)
    const recovery = clamp(1 - 2.6 * over * over, 0.12, 1)
    return T * dens * ram * recovery
  }

  /** Does this type have a burner at all? */
  get hasReheat() { return this.cfg.abThrust > this.cfg.maxThrust }
  /** How far into the burner the engines are, 0..1. Zero on a type without one. */
  get abFrac() {
    if (!this.hasReheat) return 0
    return clamp((this.thrustLag - AB_GATE) / (1 - AB_GATE), 0, 1)
  }

  /** Put the aeroplane somewhere at a given speed, heading and flight path. */
  place(x, y, z, headingDeg, speedMs, { onGround = false, gamma = 0, trimmed = false, wind = null } = {}) {
    // Sitting at exactly the uncompressed gear height means zero penetration,
    // which reads as "no contact", which makes the very next frame look like a
    // touchdown and logged a phantom greaser every time a session started.
    if (onGround) y -= this.staticSquat
    this.pos = { x, y, z }
    const h = headingDeg * DEG

    let pitch = 0
    if (trimmed && !onGround) {
      const t = this.trimFor(speedMs, gamma)
      pitch = t.pitch
      this.trim = t.trim
      this.throttle = t.throttle
      this.thrustLag = t.throttle
    } else {
      this.trim = 0
      this.thrustLag = onGround ? 0.03 : 0.35
    }
    this.q = qFromEuler(h, pitch, 0)
    /* Velocity follows the FLIGHT PATH, not the nose: on a glideslope the two
       differ by exactly the angle of attack, and starting them aligned would
       put the wing at zero alpha and drop the aeroplane out of the sky.

       And speedMs is an AIRSPEED, so the wind is added on top to get the
       ground velocity. Setting the ground velocity to Vref instead meant that
       in an eight-knot wind the aeroplane's actual airspeed was several knots
       off the speed it had just been trimmed for. On the 737 that was a wobble;
       on the 250-tonne 747, whose response to being out of trim is slow enough
       to build, it wound up into a departure and a crash every time. */
    const air = {
      x: Math.sin(h) * Math.cos(gamma) * speedMs,
      y: Math.sin(gamma) * speedMs,
      z: -Math.cos(h) * Math.cos(gamma) * speedMs,
    }
    this.vel = wind ? { x: air.x + wind.x, y: air.y + wind.y, z: air.z + wind.z } : air
    if (wind) { this.wind.x = wind.x; this.wind.y = wind.y; this.wind.z = wind.z }
    this.omega = { x: 0, y: 0, z: 0 }
    this.onGround = onGround
    this.wasAirborne = !onGround
    this.crashed = false
    this.justLanded = null
  }

  get altitudeM() { return this.pos.y }

  /* --- Aerodynamics ------------------------------------------------------ */
  liftCoef(alpha, dCL, stallAlpha) {
    // The compressible slope at the Mach number the aeroplane is actually at.
    const cl0 = this.cfg.cl0, a = this.clAlphaNow || this.cfg.clAlpha
    const linear = cl0 + dCL + a * alpha
    const mag = Math.abs(alpha)
    if (mag <= stallAlpha) return linear
    // Past the break the wing does not simply stop lifting: it sheds toward a
    // flat-plate value. Without this the aeroplane falls like a brick instead
    // of mushing, and the stall stops being recoverable.
    const peak = cl0 + dCL + a * stallAlpha
    const fade = Math.exp(-(mag - stallAlpha) * 8)
    const plate = 1.05 * Math.sin(2 * alpha)
    return Math.sign(alpha) * peak * fade + plate * (1 - fade)
  }

  step(dt) {
    const cfg = this.cfg
    const flap = this.flaps[this.flap]

    /* Gear travel, and thrust spool. A jet does not answer the lever at once,
       and on short final that lag is most of the difficulty — but how long it
       takes is a property of the engine, not of jets in general. A 2.8 m fan
       has an enormous rotating inertia and takes the famous eight seconds from
       idle to go-around thrust; a fighter's low-bypass core is spinning small
       parts and answers in about two; a piston answers as fast as the throttle
       plate moves. */
    this.gearPos = approach(this.gearPos, this.gearDown ? 1 : 0, cfg.gearRate, dt)
    const demand = clamp(this.throttle, 0, 1)
    this.thrustLag = approach(this.thrustLag, demand,
      demand > this.thrustLag ? cfg.spoolUp : cfg.spoolDown, dt)

    const rho = airDensity(Math.max(this.pos.y, -100))
    /* Everything aerodynamic runs on the RELATIVE wind, not the ground track.
       Subtracting the air mass here is what gives the model a headwind that
       changes ground speed without touching indicated airspeed, and a
       crosswind you have to crab into. Position still integrates on this.vel,
       which is why the aeroplane drifts downwind if you do not. */
    const air = vsub(this.vel, this.wind)
    const vb = qinv(this.q, air)                 // airspeed in body axes
    const V = vlen(air)
    const u = -vb.z                              // forward component

    this.alpha = V > 1 ? Math.atan2(-vb.y, Math.max(u, 0.1)) : 0
    this.beta = V > 1 ? Math.asin(clamp(vb.x / V, -1, 1)) : 0
    this.tas = V
    this.ias = V * Math.sqrt(rho / 1.225)

    const ground = elevation(this.pos.x, this.pos.z)
    // agl is the CG height, which is what ground effect wants. The radio
    // altimeter reads from the WHEELS and must show zero on the runway, so the
    // two are kept apart rather than one pretending to be the other.
    this.agl = this.pos.y - ground
    this.radioAlt = Math.max(0, this.agl - this.restHeight + this.staticSquat)

    const qbar = 0.5 * rho * V * V
    const stallAlpha = cfg.stallAlpha + flap.dStall * DEG

    /* Mach first, because compressibility now reaches the lift itself and not
       just the drag. Crossing the barrier is a real event in here: the slope
       collapses, the aerodynamic centre runs aft and tucks the nose, and the
       controls go heavy, all from this one number. */
    const mach = V / speedOfSound(Math.max(this.pos.y, 0))
    const machPrev = this.mach || 0
    this.mach = mach
    this.clAlphaNow = liftSlopeAt(cfg.clAlpha, cfg.AR, mach)
    /* The frame the aeroplane goes through Mach 1, in either direction, so the
       boom and the shock cloud have something to fire on. With hysteresis:
       accelerating through the transonic the Mach number hunts either side of
       1.00 for a second or two as the drag rise bites, and a bare comparison
       fired the boom twice going out and twice coming back. */
    if (!this.supersonic && mach >= 1.02) { this.supersonic = true; this.wentSupersonic = true }
    else if (this.supersonic && mach < 0.98) { this.supersonic = false; this.wentSubsonic = true }

    // Ground effect: within a span of the surface the induced drag falls away
    // and the wing floats. This is why a greaser is hard.
    const hb = clamp(this.agl / cfg.b, 0, 1.2)
    const ge = 1 - 0.38 * Math.exp(-3.2 * hb)

    let CL = this.liftCoef(this.alpha, flap.dCL, stallAlpha) + this.spoilers * -0.55
    /* A wreck is not an aeroplane. Once the airframe is broken it keeps only
       the lift of a tumbling object, which is nearly none, so it falls instead
       of gliding serenely on to its destination. */
    if (this.crashed) CL *= 0.12
    this.CL = CL                        // the tuck term needs it
    const CD0 = cfg.cd0 + flap.dCD + this.gearPos * 0.019 + this.spoilers * 0.055
    const kInd = 1 / (Math.PI * cfg.oswald * cfg.AR)
    const CD = CD0 + waveDrag(cfg, mach) + kInd * CL * CL * ge
    const CY = -0.90 * this.beta

    this.stalling = Math.abs(this.alpha) > stallAlpha && V > 12
    this.overspeed = this.ias * 1.943844 > cfg.vne || mach > cfg.mmo ||
      (this.flap > 0 && this.ias * 1.943844 > flap.vfe)

    const L = qbar * cfg.S * CL
    const D = qbar * cfg.S * CD
    const Yf = qbar * cfg.S * CY

    // Wind axes, built in the body frame: drag opposes the relative wind, lift
    // is perpendicular to it in the plane of symmetry.
    let Fb = { x: 0, y: 0, z: 0 }
    if (V > 0.5) {
      const vhat = vnorm(vb)
      const side = vnorm(vcross(vhat, { x: 0, y: 1, z: 0 }))
      const liftDir = vnorm(vcross(side, vhat))
      Fb = vadd(Fb, vscale(vhat, -D))
      Fb = vadd(Fb, vscale(liftDir, L))
      Fb = vadd(Fb, vscale(side, Yf))
    }

    // Thrust along the nose. `thrustAvailable` owns the three engine
    // behaviours; here it is only asked for the number at the spooled lever.
    const thrust = this.crashed ? 0 : this.thrustAvailable(rho, V, this.thrustLag)
    Fb = vadd(Fb, { x: 0, y: 0, z: -thrust })

    // Keep the non-gravitational force separately: a G meter reads SPECIFIC
    // force, which is why it shows 1 in level flight and 0 in free fall.
    // Including weight here made it read 0 whenever the aeroplane was trimmed.
    const Faero = qrot(this.q, Fb)
    let F = vadd(Faero, { x: 0, y: -cfg.mass * G, z: 0 })

    let M = this.aeroMoments(qbar, V, flap, dt)
    // Tumble: no control, and the damping that a pilot's hands supplied is gone.
    if (this.crashed) {
      M = { x: M.x * 0.15 + qbar * 12, y: M.y * 0.15 - qbar * 7, z: M.z * 0.15 + qbar * 9 }
    }

    // Ground reactions come last so they can see the aerodynamic state.
    const gr = this.groundForces(dt)
    F = vadd(F, gr.force)
    M = vadd(M, gr.moment)

    // Load factor, along the body's own up axis, from the aerodynamic and
    // ground forces only.
    const bodyUp = qrot(this.q, { x: 0, y: 1, z: 0 })
    this.gLoad = (vdot(vadd(Faero, gr.force), bodyUp) / cfg.mass) / G

    // --- Integrate (semi-implicit Euler; stable at the 240 Hz this runs at).
    const acc = vscale(F, 1 / cfg.mass)
    this.vel = vadd(this.vel, vscale(acc, dt))
    this.pos = vadd(this.pos, vscale(this.vel, dt))

    const alphaDot = {
      x: (M.x - (cfg.Iz - cfg.Iy) * this.omega.y * this.omega.z) / cfg.Ix,
      y: (M.y - (cfg.Ix - cfg.Iz) * this.omega.z * this.omega.x) / cfg.Iy,
      z: (M.z - (cfg.Iy - cfg.Ix) * this.omega.x * this.omega.y) / cfg.Iz,
    }
    this.omega = vadd(this.omega, vscale(alphaDot, dt))

    const w = this.omega
    const spin = Math.hypot(w.x, w.y, w.z)
    if (spin > 1e-7) {
      const dq = qFromAxisAngle(w, spin * dt)
      this.q = qnorm(qmul(this.q, dq))
    }

    /* --- Impact ------------------------------------------------------------
       Two ways to hit something that is not a runway, and until now neither of
       them did anything: the aeroplane was quietly lifted back out of the
       hillside it had flown into, and the city was scenery you passed through.

       A building is checked against the SAME box list that draws the skyline,
       with the span as the radius, because a wingtip is what actually catches
       a tower. Terrain is a crash when the aeroplane arrives on it away from
       pavement with real speed — which is CFIT, and is what flying into the
       Santa Cruz mountains at 250 knots should be. */
    this.impact = null
    if (!this.crashed) {
      const top = obstacleAt(this.pos.x, this.pos.z, this.cfg.b * 0.42)
      if (top != null && this.pos.y - this.restHeight * 0.35 < top && this.tas > 18) {
        this.impact = 'obstacle'
      } else if (this.pos.y - ground < this.restHeight * 0.55 && this.tas > 40 &&
                 !onPavement(this.pos.x, this.pos.z, 60)) {
        this.impact = 'terrain'
      }
    }

    // Never let the aeroplane end up under the terrain, whatever the forces did.
    const floor = ground + 0.3
    if (this.pos.y < floor) {
      this.pos.y = floor
      if (this.vel.y < 0) this.vel.y = 0
    }
  }

  aeroMoments(qbar, V, flap, dtHint = 1 / 240) {
    const cfg = this.cfg
    const Vs = Math.max(V, 25)          // rate terms blow up at taxi speed
    const qS = qbar * cfg.S

    // Body rates, expressed the way the coefficients expect them.
    const pRate = -this.omega.z        // roll right, positive
    const qRate = this.omega.x         // pitch up, positive
    const rRate = -this.omega.y        // yaw right, positive

    const elev = clamp(this.ctl.elevator + this.trim, -1, 1)

    // Elevator authority is set by what a rotation actually costs: the mains
    // sit 0.045 L aft of the CG, so lifting the nose at Vr needs a little over
    // a million newton-metres. 1.45 cleared that by so much that the aeroplane
    // rotated at fifteen degrees a second; 0.88 rotates at about four, which is
    // what the real one does.
    /* Control effectiveness follows the lift-curve slope, so a surface loses
       authority through the transonic exactly as the wing does. Everything
       supersonic in here is that one ratio. */
    const slope = this.clAlphaNow || cfg.clAlpha
    const auth = clamp(slope / cfg.clAlpha, 0.45, 1.35)

    let Cm = 0.045 - 1.25 * this.alpha + 0.88 * elev * auth - 30 * (qRate * cfg.c / (2 * Vs))

    /* MACH TUCK. The aerodynamic centre moves aft through the transonic, so
       the lift it already has starts pitching the nose down, and it does it
       harder the faster you go. The nose-down moment is the shift times the
       lift coefficient — straight out of the definition of the aerodynamic
       centre, not a curve fitted to feel right. */
    const mach = this.mach || 0
    if (mach > cfg.mdd) {
      const tuck = clamp((mach - cfg.mdd) / (1.10 - cfg.mdd), 0, 1)
      Cm -= cfg.acShift * tuck * (this.CL || 0)
    }

    /* Roll. Full authority up to the manoeuvring speed and a constant rate
       above it, which is what an aeroplane actually does: the surfaces are
       rate-limited and the airframe is load-limited, so going faster past VA
       does not buy a faster roll. */
    const rollAuth = cfg.rollPower * Math.min(1, cfg.vRoll / Math.max(V, 20)) * auth
    let Cl = rollAuth * this.ctl.aileron - 0.105 * this.beta - 0.48 * (pRate * cfg.b / (2 * Vs))
    let Cn = 0.128 * this.beta + 0.085 * this.ctl.rudder - 0.16 * (rRate * cfg.b / (2 * Vs))
      - 0.022 * this.ctl.aileron        // adverse yaw

    // A stalled wing stops damping roll and starts dropping one wing — the
    // reason a stall becomes a spin if it is not corrected.
    if (this.stalling) {
      const over = Math.abs(this.alpha) - cfg.stallAlpha - flap.dStall * DEG
      const sev = clamp(over / (12 * DEG), 0, 1)
      Cl *= 1 - 0.7 * sev
      Cm -= 0.22 * sev                                    // nose drops
      Cl += 0.045 * sev * Math.sign(Math.sin(this.pos.x * 0.05 + 1))   // a wing goes first
    }

    let Mpitch = qS * cfg.c * Cm
    let Mroll = qS * cfg.b * Cl
    let Myaw = qS * cfg.b * Cn

    /* Assist. Not autopilot — it adds the damping a real yoke gets from having
       a pilot's hands on it, and coordinates the rudder. Without it a keyboard
       (which has no analogue axis and no self-centring) makes this aeroplane
       genuinely unpleasant to fly. It is a toggle, and it is off in the numbers
       the flight model reports. */
    // Pitch damping applies on the ground too. A pilot's hands are on the yoke
    // during the take-off roll as much as in the air, and without it a rotation
    // begun with a keyboard has nothing to arrest it.
    /* Pitch damping. This is the single most important number for whether the
       thing is flyable: it turns "elevator commands a pitch ACCELERATION" into
       "elevator commands a pitch RATE", which is what a heavy aeroplane with a
       pilot on the yoke actually behaves like, and what every fly-by-wire
       transport implements deliberately.

       At 0.85 a one-and-a-half second flare pitched the nose up fourteen
       degrees and ballooned the aeroplane to eighty feet. At 3.2 the same input
       gives about four degrees a second, so a flare is a flare. */
    if (this.assist) {
      Mpitch -= this.omega.x * cfg.Ix * (this.onGround ? 1.4 : 3.2)
      /* Roll damping on the ground. An aeroplane sitting on three legs is
         enormously damped in roll by the legs themselves, and without a term
         for it any disturbance on the runway rings rather than settling. */
      if (this.onGround) Mroll -= (-this.omega.z) * cfg.Iz * 2.4
    }
    if (this.assist && !this.onGround) {
      Mroll -= (-this.omega.z) * cfg.Iz * 1.25
      Myaw -= (-this.omega.y) * cfg.Iy * 0.9
      /* Coordination. This used to drive the sideslip itself to zero, which is
         wrong and was the bug that made every jet approach in a crosswind end
         in a departure: in a crosswind, steady sideslip is the CORRECT state —
         it is what crabbing is — so a term that keeps trying to remove it just
         keeps yawing the aeroplane, and on a heavy with a long yaw time
         constant that winds up until the nose leaves the flight path entirely.

         What a pilot's feet actually do is damp the sideslip RATE and take out
         the yaw the ailerons caused, so that is what this does now. The steady
         crab is left alone, which is also why the crosswind landing the tips
         talk about is now a thing you have to fly rather than something the
         assist quietly undoes. */
      const betaRate = (this.beta - (this.betaPrev || 0)) / Math.max(dtHint, 1e-4)
      this.betaPrev = this.beta
      Myaw += -clamp(betaRate, -1.5, 1.5) * cfg.Iy * 0.35
      // Cancel the adverse yaw the ailerons just made, which is the other half
      // of what coordinated feet are for.
      Myaw += this.ctl.aileron * qS * cfg.b * 0.022
      // Gentle roll levelling when the stick is centred, like a trimmed aeroplane.
      if (Math.abs(this.ctl.aileron) < 0.06) {
        const right = qrot(this.q, { x: 1, y: 0, z: 0 })
        Mroll -= right.y * cfg.Iz * 0.55
      }
    }

    // The one conversion into body torques. +Y is nose-LEFT and +Z lifts the
    // RIGHT wing, so yaw and roll are negated here and nowhere else.
    return { x: Mpitch, y: -Myaw, z: -Mroll }
  }

  /* --- Gear ---------------------------------------------------------------
     Three spring-damper legs with tyre friction. Forces are applied at the
     contact points, so the moment they generate is what makes the aeroplane
     pitch onto its nosewheel and weathervane in a crosswind, rather than
     something scripted.                                                     */
  groundForces(dt) {
    const cfg = this.cfg
    let force = { x: 0, y: 0, z: 0 }
    let moment = { x: 0, y: 0, z: 0 }
    let anyContact = false
    let wheelContact = false        // a tailstrike is not a landing
    let hardest = 0
    this.tailStrike = false

    const retract = this.gearPos            // no legs, no reaction
    for (const c of this.contacts) {
      const rBody = { x: c.x, y: c.y, z: c.z }
      const rWorld = qrot(this.q, rBody)
      const p = vadd(this.pos, rWorld)
      const g = elevation(p.x, p.z)
      // The skid is part of the airframe: it does not retract, so it touches at
      // its own height whatever the gear lever says.
      const contactY = c.tail ? g : g + (1 - retract) * this.restHeight * 0.72
      const pen = contactY - p.y
      if (pen <= 0) continue

      anyContact = true
      if (!c.tail) wheelContact = true
      const vPoint = vadd(this.vel, vcross(this.rotWorld(), rWorld))
      const compressRate = -vPoint.y

      let N = cfg.gearK * pen + cfg.gearC * compressRate
      if (N < 0) N = 0
      // A leg cannot pull the aeroplane down, and it cannot take unlimited load.
      N = Math.min(N, cfg.mass * G * 6)
      hardest = Math.max(hardest, -Math.min(compressRate, 0))

      let Fc = { x: 0, y: N, z: 0 }

      // Tyre friction, resolved in the wheel's own frame.
      const up = { x: 0, y: 1, z: 0 }
      let fwd = qrot(this.q, { x: 0, y: 0, z: -1 })
      fwd = vnorm({ x: fwd.x, y: 0, z: fwd.z })
      if (c.nose) {
        // Nosewheel steering, authority fading out as the rudder takes over.
        const steer = -this.ctl.rudder * 32 * DEG * clamp(1 - this.tas / 60, 0, 1)
        const cs = Math.cos(steer), sn = Math.sin(steer)
        fwd = { x: fwd.x * cs + fwd.z * sn, y: 0, z: -fwd.x * sn + fwd.z * cs }
      }
      const side = vcross(up, fwd)

      const vF = vdot(vPoint, fwd), vS = vdot(vPoint, side)
      // A skid scrapes; it does not roll. That drag is the cost of a tailstrike.
      const muRoll = c.tail ? 0.62 : 0.02 + this.brakes * 0.55 + (this.parkingBrake ? 0.9 : 0)
      /* Side grip. At 0.85 with a viscous term stiff enough to saturate it at
         a metre a second of slip, every wheel developed 0.85 g sideways the
         instant the aeroplane was not pointing exactly where it was going —
         and 0.85 g through a contact patch three metres below the centre of
         gravity is a rolling moment that tips the aeroplane over. A tyre on
         dry concrete corners at about 0.55, and a taxiing aeroplane is nowhere
         near even that. */
      const muSide = c.tail ? 0.62 : 0.55
      if (c.tail) this.tailStrike = true

      // Viscous first, then clamped to the friction circle — a pure Coulomb
      // model chatters at a stop, a pure viscous one never stops at all.
      let fF = clamp(-vF * cfg.mass * 0.9, -muRoll * N, muRoll * N)
      let fS = clamp(-vS * cfg.mass * 0.9, -muSide * N, muSide * N)
      if (retract < 0.5) { fF *= 3; fS *= 1.5 }   // a belly does not roll

      Fc = vadd(Fc, vadd(vscale(fwd, fF), vscale(side, fS)))

      force = vadd(force, Fc)
      // Torque about the CG, then back into body axes to join the aero moments.
      const tWorld = vcross(rWorld, Fc)
      moment = vadd(moment, qinv(this.q, tWorld))
    }

    // Touchdown detection: the frame the WHEELS first take load after a flight.
    if (wheelContact && this.wasAirborne) {
      this.touchdownFpm = Math.max(0, -this.vel.y) * 196.850393701
      this.touchdownBurst = this.touchdownFpm
      this.justLanded = {
        fpm: this.touchdownFpm,
        gLoad: 1 + hardest * 0.35,
        speedKt: this.tas * 1.943844,
      }
      this.wasAirborne = false
    }
    if (!anyContact) {
      this.wasAirborne = true
    }
    this.onGround = anyContact
    return { force, moment }
  }

  rotWorld() { return qrot(this.q, this.omega) }

  /* --- Cockpit switches --------------------------------------------------- */
  setFlap(i) { this.flap = clamp(i | 0, 0, this.flaps.length - 1) }
  flapUp() { this.setFlap(this.flap - 1) }
  flapDown() { this.setFlap(this.flap + 1) }
  get flapDeg() { return this.flaps[this.flap].deg }
  /** What the detent is MARKED, which is not always a number of degrees. */
  get flapLabel() {
    const f = this.flaps[this.flap]
    return f.label != null ? f.label : String(f.deg)
  }
  get flapVfe() { return this.flaps[this.flap].vfe }
  toggleGear() { if (!this.onGround || this.gearPos < 1) this.gearDown = !this.gearDown; else this.gearDown = !this.gearDown }
  /**
   * Reference approach speed for the CURRENT configuration, in m/s.
   * 1.3 times the stall, which is where the airline number comes from, and it
   * is per-type because the scenarios used to hand every aeroplane the 737's
   * 140 kt — including a Cessna whose Vref is 48.
   */
  vrefMs() { return (this.stallSpeedKt() * 1.3) / 1.943844 }

  /** Published service ceiling. A normally-aspirated single does not go to FL310. */
  ceilingM() { return this.cfg.ceiling }

  /** Stall speed right now, in knots — what the HUD's low-speed cue is drawn from. */
  stallSpeedKt() {
    const cfg = this.cfg
    const flap = this.flaps[this.flap]
    const CLmax = cfg.cl0 + flap.dCL + cfg.clAlpha * (cfg.stallAlpha + flap.dStall * DEG)
    const v = Math.sqrt((2 * cfg.mass * G) / (1.225 * cfg.S * Math.max(CLmax, 0.3)))
    return v * 1.943844
  }
}
