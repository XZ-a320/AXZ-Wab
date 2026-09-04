/* ==========================================================================
   AXZ sim 3.0 — scene, cameras, loop, mission.

   The 1.0 orchestrator with the renderer replaced and the game grown. The
   loop still runs the flight model on a FIXED 240 Hz step with an accumulator
   and renders whenever the browser asks, for the reason 1.0 gave: physics
   tied to the frame rate means a 144 Hz monitor flies a different aeroplane
   from a 60 Hz one, and the gear spring goes unstable on a slow frame.

   New here: six cameras, an altitude and heading hold, landing lights,
   reversers, a weather that can rain on the runway, fuel that runs down, a
   landing scorecard, and the stall buffet you feel through the camera.
   ========================================================================== */

import {
  clamp, DEG, RAD, M_TO_FT, MS_TO_KT, MS_TO_FPM,
  qrot, qnorm, qToEuler, vadd, vsub, vscale, vnorm, v3,
} from './math.js'
import { AIRPORTS, AP_LIST, LEGS, elevation, hdgVec, papiUnits, papiState, rwyCentre } from './world.js'
import { Aircraft, Wind, setFlapSets } from './fdm.js'
import { Particles, Effects, Clouds, KIND, explode, burn } from './particles.js'
import { Sound } from './sound.js'
import { Input, Gyro } from './input.js'
import { HUD, navInfo } from './hud.js'
import { Scene3D } from './scene.js'
import { AircraftView } from './aircraft.js'
import { RiggedAircraft } from './rigged.js'

const CAMERAS = ['cockpit', 'chase', 'external', 'tower', 'wing', 'flyby']

export class Sim {
  constructor(opts) {
    this.opts = opts
    this.L = opts.labels
    this.container = opts.container
    this.fleet = opts.fleet
    this.bands = opts.bands || []
    this.onEvent = opts.onEvent || (() => {})
    this.THREE = opts.THREE
    this.hangar = opts.hangar
    /* 3.0: sourced models, loaded by boot.js through the asset hub and kept
       here by fleet id. A type without one flies the hangar's model. */
    this.rigged = opts.rigged || new Map()
    setFlapSets(opts.flaps)

    this.canvas = document.createElement('canvas')
    this.canvas.className = 'sim-canvas'
    this.canvas.setAttribute('aria-hidden', 'true')
    this.container.appendChild(this.canvas)

    this.gfx = new Scene3D(this.THREE, opts.addons, this.canvas)
    this.gl = this.gfx.renderer.getContext()
    this.renderer = this.gfx.renderer
    // 1.0 names for the two optional paths, so anything asking still gets an answer.
    this.post = { ok: true }
    this.shadows = { ok: true }

    this.hudRoot = document.createElement('div')
    this.hudRoot.className = 'sim-hud'
    this.container.appendChild(this.hudRoot)
    this.hud = new HUD(this.hudRoot, this.L, this.container)

    this.input = new Input(this.canvas, this.container)
    this.gyro = new Gyro()
    this.cameraMode = 0
    this.orbit = { yaw: 0.6, pitch: 0.22, dist: 90 }
    this.timeScale = 1
    this.paused = false
    this.running = false
    this.acc = 0
    this.lastT = 0
    this.camPos = v3(); this.camQ = qnorm({ x: 0, y: 0, z: 0, w: 1 })
    this.fov = 60 * DEG
    this.stats = { fps: 60, frames: 0, t: 0 }
    this.clock = 0

    this.wind = new Wind()
    this.parts = new Particles()
    this.fx = new Effects(this.parts)
    this.clouds = new Clouds({ base: 2150, thickness: 780, spacing: 6600, puffs: 7, radius: 430 })
    this.clouds.cover = 0.45
    this.sCloud = []
    this.sParts = { 0: [], 1: [] }
    this.sound = new Sound(opts.audioBase)
    this.shake = 0
    this.wreck = { t: 0 }
    this.weather = { cover: 0.45, rain: 0 }
    this.landingLights = false
    this.flyby = null
    this.sun = vnorm({ x: 0.38, y: 0.62, z: 0.34 })
    this.setTimeOfDay('noon')

    this.papis = {}
    for (const key of AP_LIST) this.papis[key] = papiUnits(AIRPORTS[key])

    this.setFlight(opts.flight || 'AXZ001')
    this.setAircraft(opts.aircraftId || this.fleet._order[0])
    this.setScenario(opts.scenario || 'takeoff')

    this.stageEl = this.container.closest('[data-sim-stage]') || this.container
    this.fullscreen = false
    this.onFullscreenChange = () => {
      const on = !!(document.fullscreenElement || document.webkitFullscreenElement)
      if (!on && this.fullscreen) this.setFullscreen(false)
    }
    document.addEventListener('fullscreenchange', this.onFullscreenChange)
    document.addEventListener('webkitfullscreenchange', this.onFullscreenChange)
    this.onResize = () => this.resize()
    window.addEventListener('resize', this.onResize)
    this.resize()
  }

  async setFullscreen(on) {
    const el = this.container
    if (!on) {
      this.fullscreen = false
      this.stageEl.removeAttribute('data-fs')
      try { if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen() } catch (e) { /* already out */ }
      this.resize(); this.canvas.focus()
      return false
    }
    this.fullscreen = true
    this.stageEl.setAttribute('data-fs', 'true')
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
    } catch (e) { /* refused; the fixed overlay still fills the viewport */ }
    this.resize(); this.canvas.focus()
    return true
  }

  /* --- Aircraft ------------------------------------------------------------- */
  setAircraft(id) {
    const spec = this.fleet[id]
    if (!spec) return
    this.aircraftId = id
    if (this.view) { this.gfx.scene.remove(this.view.root); this.view.dispose() }
    const loaded = this.rigged.get(id)
    const view = this.view = loaded ? new RiggedAircraft(this.THREE, loaded.gltf, spec, loaded.asset) : new AircraftView(this.THREE, this.hangar, spec)
    for (const m of view.materials) if (m.isMeshStandardMaterial) this.gfx.csm.setupMaterial(m)
    this.gfx.scene.add(view.root)
    const keep = this.ac ? { pos: this.ac.pos, vel: this.ac.vel, q: this.ac.q } : null
    this.ac = new Aircraft(spec, view.contacts, view.restHeight)
    this.ac.bodyMinY = view.bodyMinY
    this.ac.bodyMaxY = view.bodyMaxY
    if (keep) { this.ac.pos = keep.pos; this.ac.vel = keep.vel; this.ac.q = keep.q }
    this.ac.assist = this.opts.assist !== false
    this.ac.surfaceWet = this.weather.rain
    this.sound.setEngine(spec)
    if (this.onAircraft) this.onAircraft()
  }

  /* --- Conditions ----------------------------------------------------------- */
  setTimeOfDay(key) {
    const P = {
      dawn: { dir: { x: -0.86, y: 0.16, z: 0.48 }, amb: 0.30, warm: [1.18, 0.86, 0.62], sky: 0.52 },
      noon: { dir: { x: 0.38, y: 0.62, z: 0.34 }, amb: 0.34, warm: [1.06, 1.00, 0.92], sky: 1.00 },
      dusk: { dir: { x: 0.88, y: 0.13, z: -0.44 }, amb: 0.27, warm: [1.22, 0.74, 0.48], sky: 0.44 },
      night: { dir: { x: 0.20, y: -0.28, z: 0.30 }, amb: 0.10, warm: [0.42, 0.48, 0.62], sky: 0.10 },
    }
    const p = P[key] || P.noon
    this.timeOfDay = P[key] ? key : 'noon'
    this.sun = vnorm(p.dir)
    this.light = p
    this.gfx.setSun(new this.THREE.Vector3(this.sun.x, this.sun.y, this.sun.z), p)
  }

  /** Wind as the METAR reads it, plus what the sky is doing. */
  setWeather({ dirDeg, speedKt, gust, cover, rain } = {}) {
    this.wind.set(
      dirDeg != null ? dirDeg : this.wind.dirDeg,
      speedKt != null ? speedKt : this.wind.speedKt,
      gust != null ? gust : this.wind.gust)
    if (cover != null) { this.weather.cover = cover; this.clouds.cover = cover }
    if (rain != null) { this.weather.rain = rain; if (this.ac) this.ac.surfaceWet = rain }
    // Rain lowers the deck and thickens it.
    this.clouds.base = 2150 - 900 * this.weather.rain
    this.gfx.setWeather({ cover: this.weather.cover, rain: this.weather.rain })
  }

  setFlight(id) {
    if (!LEGS[id]) return
    this.flightId = id
    this.leg = LEGS[id]
    this.origin = AIRPORTS[this.leg.from]
    this.dest = AIRPORTS[this.leg.to]
  }

  /* --- Scenarios --------------------------------------------------------------
     Identical to 1.0 in where they put the aeroplane; a flight is a flight. */
  setScenario(kind) {
    this.scenario = kind
    const ac = this.ac
    if (!this.leg) this.setFlight('AXZ001')
    const ksfo = this.origin, ksns = this.dest
    this.mission = { active: false, phase: 'free', best: null }
    const onRwy = (ap, backFrac) => {
      const d = hdgVec(ap.rwy.hdg)
      const u = -ap.rwy.len / 2 + ap.rwy.len * backFrac
      return { x: ap.x + d.x * u, z: ap.z + d.z * u }
    }
    if (kind === 'runway' || kind === 'takeoff') {
      if (kind === 'runway') {
        const R = ksfo.rwy, d = hdgVec(R.hdg), rgt = { x: -d.z, z: d.x }
        const u = -R.len * 0.18, v = R.width / 2 + 138
        const p = { x: ksfo.x + d.x * u + rgt.x * v, z: ksfo.z + d.z * u + rgt.z * v }
        ac.place(p.x, ksfo.elev + ac.restHeight, p.z, (R.hdg + 90) % 360, 0, { onGround: true })
        ac.throttle = 0; ac.setFlap(0)
        ac.gearDown = true; ac.gearPos = 1
        ac.parkingBrake = true
      } else {
        const p = onRwy(ksfo, 0.06)
        ac.place(p.x, ksfo.elev + ac.restHeight, p.z, ksfo.rwy.hdg, 0, { onGround: true })
        ac.throttle = 0; ac.setFlap(2)
        ac.gearDown = true; ac.gearPos = 1
        ac.parkingBrake = false
      }
      ac.flapPos = ac.flap
      this.input.throttle = 0
      this.mission = { active: true, phase: 'takeoff', best: null }
    } else if (kind === 'approach') {
      const d = hdgVec(ksns.rwy.hdg)
      const back = 11112
      const x = ksns.x - d.x * (back + ksns.rwy.len / 2)
      const z = ksns.z - d.z * (back + ksns.rwy.len / 2)
      ac.setFlap(3); ac.gearDown = true; ac.gearPos = 1
      ac.flapPos = ac.flap
      const vref = ac.vrefMs()
      const w0 = this.wind.sample(582, 0)
      ac.place(x, ksns.elev + 582, z, ksns.rwy.hdg, vref, { gamma: -3 * DEG, trimmed: true, wind: w0 })
      this.input.throttle = ac.throttle
      this.mission = { active: true, phase: 'final', best: null }
    } else {
      const t = 0.45
      const x = ksfo.x + (ksns.x - ksfo.x) * t, z = ksfo.z + (ksns.z - ksfo.z) * t
      const brg = Math.atan2(ksns.x - ksfo.x, -(ksns.z - ksfo.z)) * RAD
      ac.setFlap(0); ac.gearDown = false; ac.gearPos = 0
      ac.flapPos = 0
      const alt = Math.min(this.leg.cruise, ac.ceilingM())
      const spd = ac.cfg.prop ? 58 : (alt > 5000 ? 158 : 128)
      const w1 = this.wind.sample(alt, 0)
      ac.place(x, alt, z, brg, spd, { trimmed: true, wind: w1 })
      this.input.throttle = ac.throttle
      this.mission = { active: true, phase: 'cruise', best: null }
    }
    ac.crashed = false
    ac.crashLatch = false
    ac.lastTouchdownFpm = 0
    ac.surfaceWet = this.weather.rain
    this.shake = 0
    this.wreck.t = 0
    this.flyby = null
    this.landingLights = this.timeOfDay === 'night' || this.timeOfDay === 'dusk'
    this.gfx.recentre(ac.pos.x, ac.pos.z, true)
    this.onEvent({ type: 'scenario', kind, phase: this.mission.phase, from: this.origin.icao, to: this.dest.icao })
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
    document.removeEventListener('fullscreenchange', this.onFullscreenChange)
    document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange)
    this.gfx.dispose()
  }

  tick(dtReal) {
    this.input.poll(dtReal)
    this.handleActions()

    if (!this.paused) {
      const ac = this.ac
      const g = this.gyro.sample(dtReal)
      if (g) { this.input.axes.pitch = g.pitch; this.input.axes.roll = g.roll }
      if (this.mobile) this.mobile.apply()

      if (ac.crashed) {
        ac.ctl.elevator = 0; ac.ctl.aileron = 0; ac.ctl.rudder = 0
        ac.throttle = 0
        ac.brakes = 1
      } else {
        // A hand on the yoke takes the autopilot out.
        if (ac.ap.on && (Math.abs(this.input.axes.pitch) > 0.35 || Math.abs(this.input.axes.roll) > 0.35)) {
          ac.disengageAutopilot()
          this.onEvent({ type: 'autopilot', on: false })
        }
        if (!ac.ap.on) {
          ac.ctl.elevator = -this.input.axes.pitch
          ac.ctl.aileron = this.input.axes.roll
        }
        ac.ctl.rudder = this.input.axes.yaw
        ac.throttle = this.input.throttle
        ac.brakes = this.input.brakes
      }

      if (this.timeScale > 1 && ac.radioAlt < 450 && !ac.onGround) this.setTimeScale(1)
      const step = this.timeScale > 2 ? 1 / 120 : 1 / 240
      this.acc += dtReal * this.timeScale
      let budget = 40 + Math.ceil(this.timeScale * 30)
      const wasReverse = ac.reverse
      while (this.acc >= step && budget-- > 0) {
        const w = this.wind.sample(Math.max(ac.radioAlt || 0, 0), step)
        ac.wind.x = w.x; ac.wind.y = w.y; ac.wind.z = w.z
        ac.step(step)
        this.acc -= step
      }
      if (budget <= 0) this.acc = 0
      if (wasReverse && !ac.reverse) this.onEvent({ type: 'reverse', on: false })

      this.fx.update(ac, Math.min(dtReal, 0.05), this.wind.cur, {
        bodyPoint: p => vadd(ac.pos, qrot(ac.q, p)),
      })
      this.parts.step(Math.min(dtReal, 0.05), this.wind.cur)
      this.gfx.recentre(ac.pos.x, ac.pos.z)
      this.checkEvents(dtReal)
    }

    this.clock = (this.clock + dtReal) % 3600
    this.updateCamera(dtReal)
    // Impacts knock the camera about; the buffet before a stall shakes it a little, all the time.
    const buffet = this.paused ? 0 : (this.ac.buffet || 0) * (CAMERAS[this.cameraMode] === 'cockpit' ? 0.09 : 0.04)
    const k = this.shake * 2.2 + buffet
    if (k > 0.001) {
      this.camPos = vadd(this.camPos, { x: (Math.random() - 0.5) * k, y: (Math.random() - 0.5) * k, z: (Math.random() - 0.5) * k })
      this.shake = Math.max(0, this.shake - dtReal * 1.6)
    }
    this.render(dtReal)

    const inside = CAMERAS[this.cameraMode] === 'cockpit'
    if (this.ac.wentSupersonic || this.ac.wentSubsonic) {
      this.sound.sonicBoom(inside)
      this.shake = Math.max(this.shake, inside ? 0.34 : 0.20)
      this.onEvent({ type: 'mach', up: !!this.ac.wentSupersonic })
      this.ac.wentSupersonic = false
      this.ac.wentSubsonic = false
    }
    this.sound.update(this.ac, dtReal, inside)

    const euler = qToEuler(this.ac.q)
    this.hud.update(this.ac, { euler }, dtReal)
    const L = this.L
    this.hud.setFailures(this.ac.failures.map(f => {
      const name = (L.sysNames && L.sysNames[f.what]) || f.what
      return f.n ? name + ' ' + f.n : name
    }))
    const idKey = this.flightId + this.aircraftId + this.cameraMode
    if (idKey !== this.hudIdKey) {
      this.hudIdKey = idKey
      this.hud.setIdentity(this.flightId, this.ac.spec.reg, this.L.cameras[CAMERAS[this.cameraMode]] || CAMERAS[this.cameraMode])
      this.stageEl.setAttribute('data-view', CAMERAS[this.cameraMode])
    }

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
    if (I.hit('KeyG') && ac.toggleGear()) this.sound.servo(!ac.gearDown)
    if (I.hit('KeyF')) { ac.flapDown(); this.sound.servo(false) }
    if (I.hit('KeyV')) { ac.flapUp(); this.sound.servo(true) }
    if (I.hit('KeyX')) { ac.spoilers = ac.spoilers > 0.5 ? 0 : 1; ac.autoSpoiler = false }
    if (I.hit('KeyP')) ac.parkingBrake = !ac.parkingBrake
    if (I.hit('KeyN')) { ac.assist = !ac.assist; this.onEvent({ type: 'assist', on: ac.assist }) }
    if (I.hit('Comma')) ac.trim = clamp(ac.trim + 0.02, -0.5, 0.5)
    if (I.hit('Period')) ac.trim = clamp(ac.trim - 0.02, -0.5, 0.5)
    if (I.hit('KeyC')) this.cameraMode = (this.cameraMode + 1) % CAMERAS.length
    if (I.hit('BracketRight')) this.setTimeScale(this.timeScale * 2)
    if (I.hit('BracketLeft')) this.setTimeScale(this.timeScale / 2)
    if (I.hit('KeyR')) this.setScenario(this.scenario)
    if (I.hit('KeyZ')) this.setFullscreen(!this.fullscreen)
    if (I.hit('KeyH')) this.toggleAutopilot()
    if (I.hit('KeyL')) this.toggleLights()
    if (I.hit('KeyT')) this.toggleReverse()
    if (I.hit('Escape')) {
      if (this.fullscreen) this.setFullscreen(false)
      else this.setPaused(!this.paused)
    }
  }

  toggleAutopilot() {
    const ac = this.ac
    if (ac.ap.on) { ac.disengageAutopilot(); this.onEvent({ type: 'autopilot', on: false }); return false }
    if (ac.engageAutopilot()) {
      this.onEvent({ type: 'autopilot', on: true, alt: Math.round(ac.ap.alt * M_TO_FT), hdg: Math.round(ac.ap.hdg) })
      return true
    }
    return false
  }
  toggleLights() {
    this.landingLights = !this.landingLights
    this.onEvent({ type: 'lights', on: this.landingLights })
    return this.landingLights
  }
  toggleReverse() {
    const ok = this.ac.toggleReverse()
    if (ok) this.onEvent({ type: 'reverse', on: this.ac.reverse })
    return ok
  }

  setTimeScale(v) {
    this.timeScale = clamp(v, 1, 8)
    this.onEvent({ type: 'timescale', value: this.timeScale })
  }
  setPaused(p) {
    this.paused = p
    this.onEvent({ type: 'paused', paused: p })
  }

  /* --- Mission ------------------------------------------------------------- */
  checkEvents(dt) {
    const ac = this.ac, m = this.mission
    if (!m.active) return

    if (ac.justLanded) {
      const info = ac.justLanded
      ac.justLanded = null
      ac.lastTouchdownFpm = info.fpm
      this.sound.touchdown(info.fpm)
      const nav = navInfo(ac, this.dest)
      const onDest = nav.distM < this.dest.rwy.len * 0.75
      const band = this.bandFor(info.fpm)
      const result = {
        type: 'landing', fpm: Math.round(info.fpm), speedKt: Math.round(info.speedKt),
        band, atDestination: onDest, airport: onDest ? this.dest.icao : null,
        centreline: onDest ? this.centrelineOffset() : null,
      }
      if (onDest) Object.assign(result, this.scorecard(info))
      if (!m.best || info.fpm < m.best.fpm) m.best = result
      this.onEvent(result)
      if (onDest) m.phase = 'landed'
    }
    if (m.phase === 'takeoff' && !ac.onGround && ac.agl > 15) { m.phase = 'climb'; this.onEvent({ type: 'phase', phase: 'climb' }) }
    if (m.phase === 'climb' && ac.pos.y > 1500) { m.phase = 'cruise'; this.onEvent({ type: 'phase', phase: 'cruise' }) }
    const nav = navInfo(ac, this.dest)
    if ((m.phase === 'cruise') && nav.distNm < 15) { m.phase = 'final'; this.onEvent({ type: 'phase', phase: 'final' }) }

    if (!ac.crashed && ac.impact) this.crash(ac.impact)
    if (ac.newFailure) {
      const f = ac.newFailure
      ac.newFailure = null
      this.onEvent({ type: 'failure', what: f.what, why: f.why, n: f.n })
      this.sound.master && this.sound.alertOnce()
      this.shake = Math.max(this.shake, 0.16)
    }
    if (ac.structural && !ac.crashed) {
      const st = ac.structural
      ac.structural = null
      this.crash('structure', st.detail)
    }
    if (!ac.crashLatch && ac.onGround) {
      const bank = Math.abs(qToEuler(ac.q).bank)
      let reason = null
      if (ac.lastTouchdownFpm > 1200) reason = 'hard'
      else if (bank > 32 * DEG && ac.tas > 25) reason = 'bank'
      else if (ac.gearPos < 0.4 && ac.tas > 30) reason = 'gear'
      if (reason) this.crash(reason)
    }
    if (!ac.onGround) ac.crashLatch = false
    if (ac.crashed) {
      const by = ac.onGround ? elevation(ac.pos.x, ac.pos.z) : ac.pos.y
      burn(this.parts, ac.pos.x, by, ac.pos.z, dt, this.wreck)
    }
  }

  /* The scorecard. Five things a check pilot writes down about a landing, each
     read off the physics, each scored on its own, then added up. */
  scorecard(info) {
    const ap = this.dest, R = ap.rwy
    const d = hdgVec(R.hdg), c = rwyCentre(ap, R)
    const along = (this.ac.pos.x - c.x) * d.x + (this.ac.pos.z - c.z) * d.z + R.len / 2   // from the threshold
    const zoneM = Math.round(along)
    const cl = Math.abs(this.centrelineOffset())
    const dSpeed = info.speedKt - info.vrefKt
    const fpm = info.fpm
    const sFpm = fpm <= 60 ? 40 : fpm <= 200 ? 40 - (fpm - 60) / 140 * 10 : fpm <= 400 ? 30 - (fpm - 200) / 200 * 15 : fpm <= 800 ? 15 - (fpm - 400) / 400 * 15 : 0
    const sLine = clamp(20 - cl, 0, 20)
    const sZone = along >= 150 && along <= 900 ? 20 : along < 150 ? clamp(20 - (150 - along) / 10, 0, 20) : clamp(20 - (along - 900) / 60, 0, 20)
    const sSpeed = clamp(10 - Math.max(0, Math.abs(dSpeed) - 4) * 1.2, 0, 10)
    const sBank = clamp(10 - Math.max(0, info.bankDeg - 2) * 2.5, 0, 10)
    const score = Math.round(sFpm + sLine + sZone + sSpeed + sBank)
    const grade = score >= 88 ? 'A' : score >= 72 ? 'B' : score >= 50 ? 'C' : 'D'
    return { zoneM, dSpeedKt: Math.round(dSpeed), bankDeg: Math.round(info.bankDeg), score, grade, fuelKg: Math.round(this.ac.fuel) }
  }

  crash(reason, extra) {
    const ac = this.ac
    if (ac.crashed) return
    ac.crashed = true
    ac.crashLatch = true
    const energy = clamp(0.5 + ac.tas / 90 + (ac.lastTouchdownFpm || 0) / 1400, 0.5, 2.3)
    explode(this.parts, ac.pos.x, ac.pos.y, ac.pos.z, energy, ac.vel)
    this.sound.explosion(energy)
    this.shake = Math.min(1.4, 0.5 + energy * 0.55)
    ac.throttle = 0; ac.thrustLag = 0
    this.input.throttle = 0
    ac.brakes = 1
    ac.ap.on = false
    const bankDeg = Math.abs(qToEuler(ac.q).bank) * RAD
    const detail = reason === 'hard' ? Math.round(ac.lastTouchdownFpm || 0) + ' ' + (this.L.fpm || 'ft/min')
      : reason === 'bank' ? Math.round(bankDeg) + '°'
        : reason === 'structure' ? (extra || 0).toFixed(1) + ' g'
          : Math.round(ac.tas * MS_TO_KT) + ' kt'
    if (reason === 'obstacle' || reason === 'terrain') this.shake = Math.min(1.8, this.shake + 0.5)
    this.onEvent({ type: 'crash', reason, energy, detail })
  }

  bandFor(fpm) {
    const i = fpm <= 60 ? 0 : fpm <= 200 ? 1 : fpm <= 400 ? 2 : 3
    return this.bands[i] || null
  }
  centrelineOffset() {
    const ap = this.dest, d = hdgVec(ap.rwy.hdg)
    return (this.ac.pos.x - ap.x) * -d.z + (this.ac.pos.z - ap.z) * d.x
  }

  /* --- Cameras ------------------------------------------------------------ */
  updateCamera(dt) {
    const ac = this.ac
    const mode = CAMERAS[this.cameraMode]
    const spec = ac.spec
    const eye = this.view ? this.view.eye : { x: 0, y: spec.dia * 0.28, z: -spec.len * 0.33 }
    if (mode === 'cockpit') {
      this.camPos = vadd(ac.pos, qrot(ac.q, { x: 0, y: eye.y + spec.dia * 0.12, z: eye.z }))
      this.camQ = ac.q
      this.fov = 62 * DEG
    } else if (mode === 'chase') {
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
    } else if (mode === 'tower') {
      let best = AIRPORTS.KSFO, bd = Infinity
      for (const k of AP_LIST) {
        const a = AIRPORTS[k], d = Math.hypot(a.x - ac.pos.x, a.z - ac.pos.z)
        if (d < bd) { bd = d; best = a }
      }
      const p = { x: best.x + 320, y: best.elev + 45, z: best.z + 260 }
      this.camPos = p
      this.camQ = this.lookAt(p, ac.pos)
      this.fov = clamp(52 * DEG * (900 / Math.max(bd, 900)), 6 * DEG, 52 * DEG)
    } else if (mode === 'wing') {
      // Over the left wing, looking at the engine and the world beyond it.
      const p = qrot(ac.q, { x: -spec.span * 0.22, y: spec.dia * 0.55, z: spec.len * 0.12 })
      this.camPos = vadd(ac.pos, p)
      this.camQ = this.lookAt(this.camPos, vadd(ac.pos, qrot(ac.q, { x: -spec.span * 0.5, y: -spec.dia * 0.4, z: -spec.len * 0.35 })))
      this.fov = 66 * DEG
    } else {
      /* Fly-by. A fixed point a few seconds ahead on the flight path; the
         aeroplane comes to it, passes, and the camera turns to follow, then
         picks a new point ahead once it is well past. */
      const spd = Math.max(vscale(ac.vel, 1).x ** 2 + ac.vel.y ** 2 + ac.vel.z ** 2, 1) ** 0.5
      const ahead = vadd(ac.pos, vscale(vnorm(spd > 2 ? ac.vel : qrot(ac.q, { x: 0, y: 0, z: -1 })), Math.max(spd * 6, spec.len * 3)))
      if (!this.flyby || vsub(ac.pos, this.flyby).x ** 2 + vsub(ac.pos, this.flyby).y ** 2 + vsub(ac.pos, this.flyby).z ** 2 > (spd * 7 + spec.len * 4) ** 2) {
        const side = ((this.flyby ? 1 : 0) + Math.floor(this.clock / 20)) % 2 ? 1 : -1
        const right = vnorm({ x: -(ahead.z - ac.pos.z), y: 0, z: ahead.x - ac.pos.x })
        const p = vadd(ahead, vadd(vscale(right, side * spec.len * 1.6), { x: 0, y: spec.len * 0.35, z: 0 }))
        p.y = Math.max(p.y, elevation(p.x, p.z) + 4)
        this.flyby = p
      }
      this.camPos = this.flyby
      this.camQ = this.lookAt(this.camPos, ac.pos)
      const dist = Math.hypot(ac.pos.x - this.camPos.x, ac.pos.y - this.camPos.y, ac.pos.z - this.camPos.z)
      this.fov = clamp(50 * DEG * (spec.len * 4 / Math.max(dist, spec.len * 4)), 14 * DEG, 50 * DEG)
    }
  }

  lookAt(from, to) {
    const f = vnorm(vsub(to, from))
    const zAxis = vscale(f, -1)
    let up = { x: 0, y: 1, z: 0 }
    if (Math.abs(zAxis.y) > 0.999) up = { x: 0, y: 0, z: -1 }
    const xAxis = vnorm({ x: up.y * zAxis.z - up.z * zAxis.y, y: up.z * zAxis.x - up.x * zAxis.z, z: up.x * zAxis.y - up.y * zAxis.x })
    const yAxis = { x: zAxis.y * xAxis.z - zAxis.z * xAxis.y, y: zAxis.z * xAxis.x - zAxis.x * xAxis.z, z: zAxis.x * xAxis.y - zAxis.y * xAxis.x }
    const m00 = xAxis.x, m01 = yAxis.x, m02 = zAxis.x
    const m10 = xAxis.y, m11 = yAxis.y, m12 = zAxis.y
    const m20 = xAxis.z, m21 = yAxis.z, m22 = zAxis.z
    const tr = m00 + m11 + m22
    let q
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s } }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s } }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s } }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s } }
    return qnorm(q)
  }

  /* --- Render ------------------------------------------------------------- */
  resize() {
    const r = this.container.getBoundingClientRect()
    this.gfx.resize(Math.max(r.width, 2), Math.max(r.height, 240))
  }

  render(dt) {
    const ac = this.ac
    const inside = CAMERAS[this.cameraMode] === 'cockpit'
    if (this.view) {
      this.view.update(ac, dt, { time: this.clock })
      // You are sitting in it: the airframe is not drawn from the cockpit.
      this.view.model.visible = !inside
      this.gfx.setLandingLights(this.landingLights && ac.gearPos > 0.5 && !ac.crashed, this.view.root, ac.spec)
    }
    this.gfx.update(dt, {
      camPos: this.camPos, ac, clouds: this.clouds, sCloud: this.sCloud,
      parts: this.parts, sParts: this.sParts, wind: this.wind.cur,
      acObject: this.view ? this.view.root : null, night: this.gfx.night,
    })
    this.gfx.render(this.camPos, this.camQ, this.fov || 60 * DEG)
  }

  readout() {
    const ac = this.ac
    const e = qToEuler(ac.q)
    const nav = navInfo(ac, this.dest)
    return {
      ias: ac.ias * MS_TO_KT,
      mach: ac.mach || 0,
      alt: ac.pos.y * M_TO_FT,
      agl: (ac.radioAlt != null ? ac.radioAlt : ac.agl) * M_TO_FT,
      vs: ac.vel.y * MS_TO_FPM,
      hdg: (e.heading * RAD + 360) % 360,
      pitch: e.pitch * RAD, bank: e.bank * RAD, alpha: ac.alpha * RAD,
      throttle: ac.throttle, flap: ac.flapDeg, gear: ac.gearPos > 0.98,
      dist: nav.distNm, brg: nav.bearing, dest: this.dest.icao,
      phase: this.mission.phase, fps: this.stats.fps, timeScale: this.timeScale,
      assist: ac.assist,
      pad: this.input.usingPad ? this.input.padName : '',
      gyro: this.gyro.active,
      camera: CAMERAS[this.cameraMode],
      flight: this.flightId, origin: this.origin.icao,
      windDir: this.wind.dirDeg, windKt: this.wind.speedKt,
      headwind: (() => {
        const d = hdgVec(this.dest.rwy.hdg)
        const from = this.wind.dirDeg * Math.PI / 180
        const wv = { x: -Math.sin(from), z: Math.cos(from) }
        return -(wv.x * d.x + wv.z * d.z) * this.wind.speedKt
      })(),
      papi: (() => {
        const st = papiState(this.papis[this.dest.icao], this.ac.pos)
        return st ? st.map(w => (w ? 'W' : 'R')).join('') : null
      })(),
      // 2.0
      fuel: ac.fuel, fuelFrac: ac.fuel / ac.fuel0,
      n1: ac.thrustLag * 100,
      gs: Math.hypot(ac.vel.x, ac.vel.z) * MS_TO_KT,
      autopilot: ac.ap.on,
      lights: this.landingLights,
      reverse: ac.reverse,
    }
  }
}

export { CAMERAS }
