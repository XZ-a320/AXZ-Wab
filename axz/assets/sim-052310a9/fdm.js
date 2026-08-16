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
import { elevation } from './world.js'

const G = 9.80665

/** ISA density. Thrust and every dynamic pressure in here run through it. */
export function airDensity(altM) {
  if (altM < 11000) {
    const T = 288.15 - 0.0065 * altM
    return 1.225 * Math.pow(T / 288.15, 4.2559)
  }
  return 0.3639 * Math.exp(-(altM - 11000) / 6341.6)
}

/** Flap schedule: detent -> extra lift, extra drag, and the stall angle it buys. */
const FLAPS = [
  { deg: 0, dCL: 0.00, dCD: 0.0000, dStall: 0.0, vfe: 9999 },
  { deg: 5, dCL: 0.28, dCD: 0.0055, dStall: 0.7, vfe: 250 },
  { deg: 15, dCL: 0.62, dCD: 0.0170, dStall: 1.2, vfe: 210 },
  { deg: 30, dCL: 1.05, dCD: 0.0480, dStall: 1.6, vfe: 175 },
  { deg: 40, dCL: 1.28, dCD: 0.0850, dStall: 1.4, vfe: 162 },
]
export const FLAP_STEPS = FLAPS.length

/** Everything the model needs about a type, derived from the fleet table. */
export function makeConfig(spec) {
  /* Everything used to be derived from LENGTH with 737 constants, which was
     fine while every type in the table was a 737. It is not fine for a 250 t
     747 with four engines or a 1.05 t single, so mass, wing area and thrust
     are now the type's own published figures and only the inertias are
     estimated from geometry.

     The test of whether this is a flight model or a lookup table is whether
     the same equations fly the Cessna and the 747 without special cases.
     They do; the only branch below is prop versus jet, and that is a real
     difference in how thrust behaves, not a fudge. */
  const b = spec.span
  const S = spec.wingArea || (b * b) / 10.3
  const AR = (b * b) / S
  const c = S / b
  const mass = spec.mass || 1650 * spec.len
  return {
    name: spec.name, S, b, c, mass, AR,
    maxThrust: spec.thrust || 242000 * (spec.len / 39.47),
    prop: !!spec.prop,
    // Radii of gyration as fractions of the airframe, which is the standard
    // way to estimate these when you do not have the real inertia tensor.
    Ix: mass * Math.pow(spec.len * 0.21, 2),
    Iy: mass * Math.pow(((spec.len + b) / 2) * 0.25, 2),
    Iz: mass * Math.pow(b * 0.17, 2),
    gearK: mass * 13,
    gearC: mass * 2.9,
    vne: spec.vne || 340,
    // A light aeroplane's wing stalls a shade later than a swept jet's.
    stallAlpha: (spec.prop ? 16.5 : 15.5) * DEG,
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
    this.dirDeg = 250          // direction the wind comes FROM
    this.speedKt = 8
    this.gust = 0.35           // 0..1, how lively
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
    this.cfg = makeConfig(spec)
    this.contacts = contacts
    this.restHeight = restHeight

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
    this.alpha = 0; this.beta = 0; this.tas = 0; this.ias = 0
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
    const flap = FLAPS[this.flap]
    const rho = airDensity(Math.max(this.pos.y, 0))
    const qbar = 0.5 * rho * speedMs * speedMs
    const W = this.cfg.mass * G
    const CLreq = (W * Math.cos(gamma)) / (qbar * this.cfg.S)
    const alpha = (CLreq - 0.15 - flap.dCL) / 5.2
    const trim = clamp((1.25 * alpha - 0.045) / 0.88, -0.6, 0.6)
    const kInd = 1 / (Math.PI * 0.80 * this.cfg.AR)
    const CD = 0.021 + flap.dCD + this.gearPos * 0.019 + kInd * CLreq * CLreq
    const D = qbar * this.cfg.S * CD
    const throttle = clamp((D + W * Math.sin(gamma)) /
      (this.cfg.maxThrust * Math.min(1, rho / 1.225 + 0.12)), 0, 1)
    return { alpha, pitch: alpha + gamma, trim, throttle }
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
    const linear = 0.15 + dCL + 5.2 * alpha
    const mag = Math.abs(alpha)
    if (mag <= stallAlpha) return linear
    // Past the break the wing does not simply stop lifting: it sheds toward a
    // flat-plate value. Without this the aeroplane falls like a brick instead
    // of mushing, and the stall stops being recoverable.
    const peak = 0.15 + dCL + 5.2 * stallAlpha
    const fade = Math.exp(-(mag - stallAlpha) * 8)
    const plate = 1.05 * Math.sin(2 * alpha)
    return Math.sign(alpha) * peak * fade + plate * (1 - fade)
  }

  step(dt) {
    const cfg = this.cfg
    const flap = FLAPS[this.flap]

    // Gear travel, and thrust spool. A jet does not answer the lever at once,
    // and on short final that lag is most of the difficulty.
    this.gearPos = approach(this.gearPos, this.gearDown ? 1 : 0, 0.28, dt)
    const demand = clamp(this.throttle, 0, 1)
    this.thrustLag = approach(this.thrustLag, demand, demand > this.thrustLag ? 0.55 : 0.9, dt)

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

    // Ground effect: within a span of the surface the induced drag falls away
    // and the wing floats. This is why a greaser is hard.
    const hb = clamp(this.agl / cfg.b, 0, 1.2)
    const ge = 1 - 0.38 * Math.exp(-3.2 * hb)

    let CL = this.liftCoef(this.alpha, flap.dCL, stallAlpha) + this.spoilers * -0.55
    /* A wreck is not an aeroplane. Once the airframe is broken it keeps only
       the lift of a tumbling object, which is nearly none, so it falls instead
       of gliding serenely on to its destination. */
    if (this.crashed) CL *= 0.12
    const CD0 = 0.021 + flap.dCD + this.gearPos * 0.019 + this.spoilers * 0.055
    const kInd = 1 / (Math.PI * 0.80 * cfg.AR)
    const CD = CD0 + kInd * CL * CL * ge
    const CY = -0.90 * this.beta

    this.stalling = Math.abs(this.alpha) > stallAlpha && V > 12
    this.overspeed = this.ias * 1.943844 > cfg.vne || (this.flap > 0 && this.ias * 1.943844 > flap.vfe)

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

    // Thrust along the nose, falling off with density like a real engine.
    /* Thrust. A jet's is roughly constant with speed and falls with density.
       A propeller converts roughly constant POWER, so its thrust falls off as
       speed rises and is largest standing still — which is why a light single
       accelerates hard off the mark and then stops gaining. */
    let thrust = 0
    if (!this.crashed) {
      const dens = Math.min(1, rho / 1.225 + (cfg.prop ? 0.0 : 0.12))
      if (cfg.prop) {
        const vRef = Math.max(V, 12)
        thrust = this.thrustLag * cfg.maxThrust * dens * clamp(24 / vRef, 0.22, 1)
      } else {
        thrust = this.thrustLag * cfg.maxThrust * dens
      }
    }
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

    // Never let the aeroplane end up under the terrain, whatever the forces did.
    const floor = elevation(this.pos.x, this.pos.z) + 0.3
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
    let Cm = 0.045 - 1.25 * this.alpha + 0.88 * elev - 30 * (qRate * cfg.c / (2 * Vs))
    let Cl = 0.115 * this.ctl.aileron - 0.105 * this.beta - 0.48 * (pRate * cfg.b / (2 * Vs))
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
      const muSide = c.tail ? 0.62 : 0.85
      if (c.tail) this.tailStrike = true

      // Viscous first, then clamped to the friction circle — a pure Coulomb
      // model chatters at a stop, a pure viscous one never stops at all.
      let fF = clamp(-vF * cfg.mass * 0.9, -muRoll * N, muRoll * N)
      let fS = clamp(-vS * cfg.mass * 2.2, -muSide * N, muSide * N)
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
  setFlap(i) { this.flap = clamp(i | 0, 0, FLAPS.length - 1) }
  flapUp() { this.setFlap(this.flap - 1) }
  flapDown() { this.setFlap(this.flap + 1) }
  get flapDeg() { return FLAPS[this.flap].deg }
  get flapVfe() { return FLAPS[this.flap].vfe }
  toggleGear() { if (!this.onGround || this.gearPos < 1) this.gearDown = !this.gearDown; else this.gearDown = !this.gearDown }
  /**
   * Reference approach speed for the CURRENT configuration, in m/s.
   * 1.3 times the stall, which is where the airline number comes from, and it
   * is per-type because the scenarios used to hand every aeroplane the 737's
   * 140 kt — including a Cessna whose Vref is 48.
   */
  vrefMs() { return (this.stallSpeedKt() * 1.3) / 1.943844 }

  /** Practical ceiling. A normally-aspirated single does not go to FL310. */
  ceilingM() { return this.cfg.prop ? 4100 : 12000 }

  /** Stall speed right now, in knots — what the HUD's low-speed cue is drawn from. */
  stallSpeedKt() {
    const flap = FLAPS[this.flap]
    const CLmax = 0.15 + flap.dCL + 5.2 * (this.cfg.stallAlpha + flap.dStall * DEG)
    const v = Math.sqrt((2 * this.cfg.mass * G) / (1.225 * this.cfg.S * Math.max(CLmax, 0.3)))
    return v * 1.943844
  }
}
