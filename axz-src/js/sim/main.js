/* ==========================================================================
   AXZ sim — scene, cameras, loop, mission.

   The loop runs the flight model on a FIXED 240 Hz step with an accumulator,
   and renders whenever the browser asks. Physics tied to the frame rate would
   mean a 144 Hz monitor flies a different aeroplane from a 60 Hz one, and the
   gear spring in particular would go unstable on a slow frame.
   ========================================================================== */

import {
  clamp, approach, DEG, RAD, M_TO_FT, MS_TO_KT, MS_TO_FPM,
  qrot, qmul, qnorm, qFromAxisAngle, qToEuler, qFromEuler,
  vadd, vsub, vscale, vlen, vnorm, v3,
  m4perspective, m4view, m4model, m4identity,
} from './math.js'
import { Renderer, Mesh } from './gl.js'
import {
  AIRPORTS, elevation, terrainPatch, terrainGrid, runwayMesh, runwayLights,
  scenery, hdgVec,
} from './world.js'
import { aircraftMesh, gearMesh, liveryFor } from './model.js'
import { Aircraft, FLAP_STEPS } from './fdm.js'
import { Input } from './input.js'
import { HUD, navInfo } from './hud.js'

const NEAR_SIZE = 11000, NEAR_RES = 96      // ~115 m cells under the aeroplane
const FAR_SIZE = 300000, FAR_RES = 150      // 2 km cells, out to the horizon
const SNAP = NEAR_SIZE / 8                  // rebuild the near mesh this often
const CAMERAS = ['cockpit', 'chase', 'external', 'tower']

export class Sim {
  constructor(opts) {
    this.opts = opts
    this.L = opts.labels
    this.container = opts.container
    this.fleet = opts.fleet
    this.bands = opts.bands || []
    this.onEvent = opts.onEvent || (() => {})

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'sim-canvas'
    // The canvas is a picture of the state; the HUD text beside it is the
    // accessible copy, so this is hidden rather than given a name that would
    // go stale the moment the aeroplane moved.
    this.canvas.setAttribute('aria-hidden', 'true')
    this.container.appendChild(this.canvas)

    this.renderer = new Renderer(this.canvas)
    this.gl = this.renderer.gl

    this.hudRoot = document.createElement('div')
    this.hudRoot.className = 'sim-hud'
    this.container.appendChild(this.hudRoot)
    this.hud = new HUD(this.hudRoot, this.L)

    this.input = new Input(this.canvas)
    this.cameraMode = 0
    this.orbit = { yaw: 0.6, pitch: 0.22, dist: 90 }
    this.timeScale = 1
    this.paused = false
    this.running = false
    this.acc = 0
    this.lastT = 0
    this.camPos = v3(); this.camQ = qnorm({ x: 0, y: 0, z: 0, w: 1 })
    this.stats = { fps: 60, frames: 0, t: 0 }

    this.buildStaticWorld()
    this.setAircraft(opts.aircraftId || this.fleet._order[0])
    this.setScenario(opts.scenario || 'takeoff')

    this.onResize = () => this.resize()
    window.addEventListener('resize', this.onResize)
    this.resize()
  }

  /* --- Scene ------------------------------------------------------------- */
  buildStaticWorld() {
    const gl = this.gl
    this.far = new Mesh(gl, terrainPatch(20000, 40000, FAR_SIZE, FAR_RES))
    this.near = new Mesh(gl, terrainPatch(0, 0, NEAR_SIZE, NEAR_RES))
    this.nearCentre = { x: 0, z: 0 }
    this.grid = new Mesh(gl, toLine(terrainGrid(0, 0, NEAR_SIZE, 24, [0.55, 0.54, 0.50])), gl.LINES)


    this.runways = []
    this.lights = []
    this.props = []
    for (const key of ['KSFO', 'KSNS']) {
      const ap = AIRPORTS[key]
      this.runways.push(new Mesh(gl, runwayMesh(ap)))
      this.lights.push(new Mesh(gl, toLine(runwayLights(ap)), gl.LINES))
      this.props.push(new Mesh(gl, scenery(ap, key === 'KSFO' ? 110 : 55, key === 'KSFO' ? 5200 : 2600)))
    }
    this.identity = m4identity()
  }

  setAircraft(id) {
    const spec = this.fleet[id]
    if (!spec) return
    this.aircraftId = id
    const livery = liveryFor(spec.reg)
    const g = gearMesh(spec)
    if (this.acMesh) this.acMesh.dispose()
    if (this.gearMesh) this.gearMesh.dispose()
    this.acMesh = new Mesh(this.gl, aircraftMesh(spec, livery))
    this.gearMesh = new Mesh(this.gl, g.mesh)
    const keep = this.ac ? { pos: this.ac.pos, vel: this.ac.vel, q: this.ac.q } : null
    this.ac = new Aircraft(spec, g.contacts, g.restHeight)
    if (keep) { this.ac.pos = keep.pos; this.ac.vel = keep.vel; this.ac.q = keep.q }
    this.ac.assist = this.opts.assist !== false
  }

  /* --- Scenarios ----------------------------------------------------------
     Where a session starts. "Approach" exists because the interesting ninety
     seconds of a flight are the last ninety, and making someone fly 110 km to
     reach them is not respect for their time. */
  setScenario(kind) {
    this.scenario = kind
    const ac = this.ac
    const ksfo = AIRPORTS.KSFO, ksns = AIRPORTS.KSNS
    this.dest = ksns
    this.mission = { active: false, phase: 'free', best: null }

    const onRwy = (ap, backFrac) => {
      const d = hdgVec(ap.rwy.hdg)
      const u = -ap.rwy.len / 2 + ap.rwy.len * backFrac
      return { x: ap.x + d.x * u, z: ap.z + d.z * u }
    }

    if (kind === 'runway' || kind === 'takeoff') {
      const p = onRwy(ksfo, 0.06)
      ac.place(p.x, ksfo.elev + ac.restHeight, p.z, ksfo.rwy.hdg, 0, { onGround: true })
      ac.throttle = 0; ac.setFlap(kind === 'takeoff' ? 2 : 0)
      ac.gearDown = true; ac.gearPos = 1
      ac.parkingBrake = kind === 'runway'
      this.input.throttle = 0
      this.mission = { active: true, phase: 'takeoff', best: null }
      this.dest = ksns
    } else if (kind === 'approach') {
      /* Six miles out on the extended centreline. Ten was the honest number
         and it is four and a half minutes of holding a trimmed aeroplane
         steady before anything happens; six still starts you on a real final,
         at the height a three-degree slope actually puts you at that range.
         Landing flap, not approach flap: at flaps 15 the wing needed eleven
         degrees of alpha to hold Vref and the aeroplane flew down final with
         its nose in the air. */
      const d = hdgVec(ksns.rwy.hdg)
      const back = 11112
      const x = ksns.x - d.x * (back + ksns.rwy.len / 2)
      const z = ksns.z - d.z * (back + ksns.rwy.len / 2)
      ac.setFlap(3); ac.gearDown = true; ac.gearPos = 1
      ac.place(x, ksns.elev + 582, z, ksns.rwy.hdg, 72, { gamma: -3 * DEG, trimmed: true })
      this.input.throttle = ac.throttle
      this.mission = { active: true, phase: 'final', best: null }
      this.dest = ksns
    } else {
      // Cruise, halfway down the route at the level the site publishes.
      const t = 0.45
      const x = ksfo.x + (ksns.x - ksfo.x) * t, z = ksfo.z + (ksns.z - ksfo.z) * t
      const brg = Math.atan2(ksns.x - ksfo.x, -(ksns.z - ksfo.z)) * RAD
      ac.setFlap(0); ac.gearDown = false; ac.gearPos = 0
      // 1,676 m is the cruise level the site publishes for KSFO-KSNS.
      ac.place(x, 1676, z, brg, 128, { trimmed: true })
      this.input.throttle = ac.throttle
      this.mission = { active: true, phase: 'cruise', best: null }
      this.dest = ksns
    }
    // NB: no `ac.trim = 0` here. The airborne scenarios are trimmed by
    // Aircraft.place, and zeroing it afterwards handed the aeroplane a
    // nose-down pitching moment it then flew all the way into the ground.
    this.refreshNear(true)
    this.onEvent({ type: 'scenario', kind, phase: this.mission.phase })
  }

  refreshNear(force = false) {
    const ac = this.ac
    const cx = Math.round(ac.pos.x / SNAP) * SNAP
    const cz = Math.round(ac.pos.z / SNAP) * SNAP
    if (!force && cx === this.nearCentre.x && cz === this.nearCentre.z) return
    this.nearCentre = { x: cx, z: cz }
    this.near.upload(terrainPatch(cx, cz, NEAR_SIZE, NEAR_RES))
    this.grid.upload(toLine(terrainGrid(cx, cz, NEAR_SIZE, 24, [0.55, 0.54, 0.50])))
  }

  /* --- Loop --------------------------------------------------------------- */
  start() {
    if (this.running) return
    this.running = true
    this.input.enabled = true
    this.lastT = performance.now()
    const frame = t => {
      if (!this.running) return
      this.raf = requestAnimationFrame(frame)
      // Clamp the wall-clock delta: a tab that was hidden for a minute must not
      // hand the integrator sixty seconds to catch up in one go.
      const dt = Math.min((t - this.lastT) / 1000, 0.25)
      this.lastT = t
      this.tick(dt)
    }
    this.raf = requestAnimationFrame(frame)
  }

  stop() {
    this.running = false
    this.input.enabled = false
    if (this.raf) cancelAnimationFrame(this.raf)
  }

  destroy() {
    this.stop()
    this.input.destroy()
    window.removeEventListener('resize', this.onResize)
  }

  tick(dtReal) {
    this.input.poll(dtReal)
    this.handleActions()

    if (!this.paused) {
      const ac = this.ac
      ac.ctl.elevator = -this.input.axes.pitch   // pulling back is nose up
      ac.ctl.aileron = this.input.axes.roll
      ac.ctl.rudder = this.input.axes.yaw
      ac.throttle = this.input.throttle
      ac.brakes = this.input.brakes

      // Time compression drops back to real time near the ground. Nobody wants
      // to flare at eight times speed, and it is also where the integrator can
      // least afford to be starved of steps.
      if (this.timeScale > 1 && ac.radioAlt < 450 && !ac.onGround) this.setTimeScale(1)

      // A coarser step under compression: at 8x the loop needs eight times the
      // steps, and 240 Hz precision is for a landing, not for cruise.
      const step = this.timeScale > 2 ? 1 / 120 : 1 / 240
      this.acc += dtReal * this.timeScale
      // Cap the catch-up so a stalled main thread cannot spiral. The budget has
      // to cover a slow frame AT the compression in use, or discarded time
      // shows up as the aeroplane teleporting.
      let budget = 40 + Math.ceil(this.timeScale * 30)
      while (this.acc >= step && budget-- > 0) {
        ac.step(step)
        this.acc -= step
      }
      if (budget <= 0) this.acc = 0

      this.refreshNear()
      this.checkEvents(dtReal)
    }

    this.updateCamera(dtReal)
    this.render()

    const euler = qToEuler(this.ac.q)
    this.hud.update(this.ac, { euler }, dtReal)

    this.stats.frames++
    this.stats.t += dtReal
    if (this.stats.t >= 0.5) {
      this.stats.fps = this.stats.frames / this.stats.t
      this.stats.frames = 0; this.stats.t = 0
    }
    this.input.endFrame()
  }

  handleActions() {
    const I = this.input, ac = this.ac
    if (I.hit('KeyG')) ac.toggleGear()
    if (I.hit('KeyF')) ac.flapDown()
    if (I.hit('KeyV')) ac.flapUp()
    if (I.hit('KeyX')) ac.spoilers = ac.spoilers > 0.5 ? 0 : 1
    if (I.hit('KeyP')) ac.parkingBrake = !ac.parkingBrake
    if (I.hit('KeyN')) { ac.assist = !ac.assist; this.onEvent({ type: 'assist', on: ac.assist }) }
    if (I.hit('Comma')) ac.trim = clamp(ac.trim + 0.02, -0.5, 0.5)
    if (I.hit('Period')) ac.trim = clamp(ac.trim - 0.02, -0.5, 0.5)
    if (I.hit('KeyC')) this.cameraMode = (this.cameraMode + 1) % CAMERAS.length
    if (I.hit('BracketRight')) this.setTimeScale(this.timeScale * 2)
    if (I.hit('BracketLeft')) this.setTimeScale(this.timeScale / 2)
    if (I.hit('KeyR')) this.setScenario(this.scenario)
    if (I.hit('Escape')) this.setPaused(!this.paused)
  }

  setTimeScale(v) {
    this.timeScale = clamp(v, 1, 8)
    this.onEvent({ type: 'timescale', value: this.timeScale })
  }

  setPaused(p) {
    this.paused = p
    this.onEvent({ type: 'paused', paused: p })
  }

  /* --- Mission ------------------------------------------------------------
     Phases are read off the aeroplane's own state rather than scripted, so
     doing something unexpected does not desync the mission from reality. */
  checkEvents(dt) {
    const ac = this.ac, m = this.mission
    if (!m.active) return

    if (ac.justLanded) {
      const info = ac.justLanded
      ac.justLanded = null
      const nav = navInfo(ac, this.dest)
      const onDest = nav.distM < this.dest.rwy.len * 0.75
      const band = this.bandFor(info.fpm)
      const result = {
        type: 'landing', fpm: Math.round(info.fpm), speedKt: Math.round(info.speedKt),
        band, atDestination: onDest, airport: onDest ? this.dest.icao : null,
        centreline: onDest ? this.centrelineOffset() : null,
      }
      if (!m.best || info.fpm < m.best.fpm) m.best = result
      this.onEvent(result)
      if (onDest) m.phase = 'landed'
    }

    if (m.phase === 'takeoff' && !ac.onGround && ac.agl > 15) {
      m.phase = 'climb'
      this.onEvent({ type: 'phase', phase: 'climb' })
    }
    if (m.phase === 'climb' && ac.pos.y > 1500) {
      m.phase = 'cruise'
      this.onEvent({ type: 'phase', phase: 'cruise' })
    }
    const nav = navInfo(ac, this.dest)
    if ((m.phase === 'cruise') && nav.distNm < 15) {
      m.phase = 'final'
      this.onEvent({ type: 'phase', phase: 'final' })
    }

    // Structural failure: a genuinely violent arrival is not a landing. Latched
    // until the aeroplane is flying again, or it fires on every frame it stays
    // tipped over and buries the log under one event.
    if (ac.onGround && !ac.crashLatch && Math.abs(qToEuler(ac.q).bank) > 40 * DEG && ac.tas > 30) {
      ac.crashed = true
      ac.crashLatch = true
      this.onEvent({ type: 'crash', reason: 'bank' })
    }
    if (!ac.onGround) { ac.crashLatch = false; ac.crashed = false }
  }

  bandFor(fpm) {
    // The same four bands as the landing scorer on the dispatch page, in the
    // same order, so one aeroplane cannot be graded two different ways.
    const i = fpm <= 60 ? 0 : fpm <= 200 ? 1 : fpm <= 400 ? 2 : 3
    return this.bands[i] || null
  }

  /** How far off the runway centreline the wheels are, in metres. */
  centrelineOffset() {
    const ap = this.dest, d = hdgVec(ap.rwy.hdg)
    const rx = -d.z, rz = d.x
    return (this.ac.pos.x - ap.x) * rx + (this.ac.pos.z - ap.z) * rz
  }

  /* --- Camera ------------------------------------------------------------- */
  updateCamera(dt) {
    const ac = this.ac
    const mode = CAMERAS[this.cameraMode]
    const spec = ac.spec

    if (mode === 'cockpit') {
      // Eye point: forward and up from the CG, roughly where the seat is.
      const eye = qrot(ac.q, { x: 0, y: spec.dia * 0.28, z: -spec.len * 0.33 })
      this.camPos = vadd(ac.pos, eye)
      this.camQ = ac.q
      this.fov = 62 * DEG
    } else if (mode === 'chase') {
      // Follow the flight path, not the nose: a chase camera welded to the
      // aeroplane's heading swings wildly in a sideslip and hides the attitude.
      const back = spec.len * 1.5, up = spec.len * 0.42
      const fwd = qrot(ac.q, { x: 0, y: 0, z: -1 })
      const want = vadd(ac.pos, vadd(vscale(fwd, -back), { x: 0, y: up, z: 0 }))
      const k = 1 - Math.exp(-6 * dt)
      this.camPos = vadd(this.camPos, vscale(vsub(want, this.camPos), k))
      this.camQ = this.lookAt(this.camPos, vadd(ac.pos, { x: 0, y: spec.dia * 0.3, z: 0 }))
      this.fov = 58 * DEG
    } else if (mode === 'external') {
      this.orbit.yaw += dt * 0.16
      const d = this.orbit.dist * (spec.len / 39.47)
      const p = {
        x: ac.pos.x + Math.sin(this.orbit.yaw) * d * Math.cos(this.orbit.pitch),
        y: ac.pos.y + Math.sin(this.orbit.pitch) * d,
        z: ac.pos.z + Math.cos(this.orbit.yaw) * d * Math.cos(this.orbit.pitch),
      }
      this.camPos = p
      this.camQ = this.lookAt(p, ac.pos)
      this.fov = 52 * DEG
    } else {
      // Tower: a fixed point beside the nearest airport, tracking the aircraft.
      let best = AIRPORTS.KSFO, bd = Infinity
      for (const k of ['KSFO', 'KSNS']) {
        const a = AIRPORTS[k], d = Math.hypot(a.x - ac.pos.x, a.z - ac.pos.z)
        if (d < bd) { bd = d; best = a }
      }
      const p = { x: best.x + 320, y: best.elev + 45, z: best.z + 260 }
      this.camPos = p
      this.camQ = this.lookAt(p, ac.pos)
      // Zoom in as it gets further away, the way a tower camera would.
      this.fov = clamp(52 * DEG * (900 / Math.max(bd, 900)), 6 * DEG, 52 * DEG)
    }
  }

  lookAt(from, to) {
    const f = vnorm(vsub(to, from))
    // Camera looks down -Z, so the basis is built from the reversed direction.
    const zAxis = vscale(f, -1)
    let up = { x: 0, y: 1, z: 0 }
    if (Math.abs(zAxis.y) > 0.999) up = { x: 0, y: 0, z: -1 }
    const xAxis = vnorm({
      x: up.y * zAxis.z - up.z * zAxis.y,
      y: up.z * zAxis.x - up.x * zAxis.z,
      z: up.x * zAxis.y - up.y * zAxis.x,
    })
    const yAxis = {
      x: zAxis.y * xAxis.z - zAxis.z * xAxis.y,
      y: zAxis.z * xAxis.x - zAxis.x * xAxis.z,
      z: zAxis.x * xAxis.y - zAxis.y * xAxis.x,
    }
    // Rotation matrix -> quaternion, branching on the largest diagonal term
    // because the cheap formula loses precision when the trace is small.
    const m00 = xAxis.x, m01 = yAxis.x, m02 = zAxis.x
    const m10 = xAxis.y, m11 = yAxis.y, m12 = zAxis.y
    const m20 = xAxis.z, m21 = yAxis.z, m22 = zAxis.z
    const tr = m00 + m11 + m22
    let q
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2
      q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s }
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2
      q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s }
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2
      q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s }
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2
      q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s }
    }
    return qnorm(q)
  }

  /* --- Render ------------------------------------------------------------- */
  resize() {
    const r = this.container.getBoundingClientRect()
    this.renderer.resize(r.width, Math.max(r.height, 240))
  }

  render() {
    const R = this.renderer, ac = this.ac
    const alt = ac.pos.y
    // Sky darkens and haze thins with height — cheap, and it sells altitude
    // better than any amount of extra geometry would.
    const hi = clamp(alt / 9000, 0, 1)
    const sky = [
      0.55 - 0.42 * hi, 0.68 - 0.44 * hi, 0.82 - 0.37 * hi,
    ]
    // Haze, not soup. At 900 m / 26 km the terrain was washed to sky colour
    // within a mile of the aeroplane and the whole world looked like an empty
    // blue plane; the point of building a landscape is being able to see it.
    const fogNear = 4200 + alt * 3
    const fogFar = 70000 + alt * 16

    R.begin(sky)
    const proj = m4perspective(this.fov || 60 * DEG, R.aspect, 3, 240000)
    const view = m4view(this.camPos, this.camQ)
    const env = {
      light: vnorm({ x: 0.42, y: 0.78, z: 0.32 }),
      ambient: 0.52,
      fog: sky, fogNear, fogFar,
    }

    R.use('solid', proj, view, env)
    R.draw(this.far, this.identity)
    R.draw(this.near, this.identity)
    for (const m of this.runways) R.draw(m, this.identity)
    for (const m of this.props) R.draw(m, this.identity)

    // The aeroplane is not drawn in cockpit view — you are sitting in it.
    if (CAMERAS[this.cameraMode] !== 'cockpit') {
      const model = m4model(ac.pos, ac.q, 1)
      R.draw(this.acMesh, model)
      if (ac.gearPos > 0.02) R.draw(this.gearMesh, model)
    }

    R.use('line', proj, view, env)
    R.draw(this.grid, this.identity)
    for (const m of this.lights) R.draw(m, this.identity)
  }

  /** A snapshot for the panel beside the canvas. */
  readout() {
    const ac = this.ac
    const e = qToEuler(ac.q)
    const nav = navInfo(ac, this.dest)
    return {
      ias: ac.ias * MS_TO_KT,
      alt: ac.pos.y * M_TO_FT,
      agl: (ac.radioAlt != null ? ac.radioAlt : ac.agl) * M_TO_FT,
      vs: ac.vel.y * MS_TO_FPM,
      hdg: (e.heading * RAD + 360) % 360,
      pitch: e.pitch * RAD,
      bank: e.bank * RAD,
      alpha: ac.alpha * RAD,
      throttle: ac.throttle,
      flap: ac.flapDeg,
      gear: ac.gearPos > 0.98,
      dist: nav.distNm,
      brg: nav.bearing,
      dest: this.dest.icao,
      phase: this.mission.phase,
      fps: this.stats.fps,
      timeScale: this.timeScale,
      assist: ac.assist,
      pad: this.input.usingPad ? this.input.padName : '',
      camera: CAMERAS[this.cameraMode],
    }
  }
}

/** Line builders emit pos+color only; the shared Mesh wants a normal array. */
function toLine(d) {
  return { pos: d.pos, color: d.color, normal: new Array(d.pos.length).fill(0) }
}

export { CAMERAS }
