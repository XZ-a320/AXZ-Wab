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
  m4perspective, m4view, m4model, m4identity, m4mul, m4invert,
} from './math.js'
import { Renderer, Mesh } from './gl.js'
import {
  AIRPORTS, AP_LIST, LEGS, elevation, terrainPatch, terrainGrid, runwayMesh,
  runwayLights, scenery, hdgVec, trees, papiUnits, papiState, CITY,
} from './world.js'
import { aircraftMesh, gearMesh, liveryFor, decalQuads, stanceHeight } from './model.js'
import { Aircraft, Wind, setFlapSets } from './fdm.js'
import { Particles, Effects, Clouds, KIND, explode, burn } from './particles.js'
import { Post } from './post.js'
import { ShadowMap } from './shadow.js'
import { Sound } from './sound.js'
import * as TEX from './tex.js'
import { Input, Gyro } from './input.js'
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
    // The flap schedules travel with the page, so they have to be installed
    // before the first Aircraft is constructed.
    setFlapSets(opts.flaps)

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
    this.stats = { fps: 60, frames: 0, t: 0 }

    this.wind = new Wind()
    this.parts = new Particles()
    this.fx = new Effects(this.parts)
    this.clouds = new Clouds({ base: 2150, thickness: 780, spacing: 6600, puffs: 7, radius: 430 })
    // Scratch lists, reused every frame. Rebuilding these as fresh arrays at
    // sixty hertz is the kind of allocation that shows up as stutter.
    this.sCloud = []
    this.sTree = []
    this.sPuff = []
    this.sDot = []
    this.sParts = { 0: [], 1: [] }
    this.treeCentre = { x: 1e9, z: 1e9 }
    this.post = new Post(this.gl)
    this.shadows = new ShadowMap(this.gl, 2048)
    this.shadowsFar = new ShadowMap(this.gl, 2048)
    this.sound = new Sound(opts.audioBase)
    this.shake = 0
    this.wreck = { t: 0 }
    this.sun = vnorm({ x: 0.38, y: 0.62, z: 0.34 })
    this.setTimeOfDay('noon')
    this.buildTextures()

    this.buildStaticWorld()
    this.setFlight(opts.flight || 'AXZ001')
    this.setAircraft(opts.aircraftId || this.fleet._order[0])
    this.setScenario(opts.scenario || 'takeoff')

    /* Fullscreen. The outer stage is what carries the state attribute, because
       the CSS that lays the panel out has to reach both the canvas and the
       instrument overlay, and because a browser that refuses the Fullscreen
       API still gets a viewport-filling overlay out of the same attribute. */
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

  /**
   * Fill the screen with the aeroplane. On a desktop the simulator otherwise
   * lives in a 560 px window inside a scrolling article, which is a keyhole to
   * fly a visual approach through: the PFD alone takes a third of it and the
   * runway is four pixels wide at six miles.
   */
  async setFullscreen(on) {
    const el = this.container
    if (!on) {
      this.fullscreen = false
      this.stageEl.removeAttribute('data-fs')
      try {
        if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen()
      } catch (e) { /* already out */ }
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

  /* --- Textures -----------------------------------------------------------
     All generated on a canvas at start-up; see tex.js for why nothing is
     downloaded. Built once, before any geometry that samples them. */
  buildTextures() {
    const R = this.renderer
    this.tex = {
      puff: R.texture(TEX.puffTexture(192, { seed: 4, lobes: 11 })),
      dot: R.texture(TEX.dotTexture(64)),
      tree: R.texture(TEX.treeSheet(256)),
      fuse: R.texture(TEX.fuselageDecal('AIR XIAO ZE', 'AXZ')),
      fin: R.texture(TEX.finDecal('AXZ')),
      block: R.texture(TEX.blockDecal()),
      win: R.texture(TEX.windowStrip(26)),
      shadow: R.texture(TEX.shadowTexture(128)),
    }
  }

  /* --- Scene ------------------------------------------------------------- */
  buildStaticWorld() {
    const gl = this.gl
    this.far = new Mesh(gl, terrainPatch(20000, 40000, FAR_SIZE, FAR_RES))
    this.near = new Mesh(gl, terrainPatch(0, 0, NEAR_SIZE, NEAR_RES))
    this.nearCentre = { x: 0, z: 0 }
    this.grid = new Mesh(gl, toLine(terrainGrid(0, 0, NEAR_SIZE, 24, [0.55, 0.54, 0.50])), gl.LINES)


    this.runways = []
    this.marks = []
    this.lights = []
    this.props = []
    this.papis = {}
    for (const key of AP_LIST) {
      const ap = AIRPORTS[key]
      this.runways.push(new Mesh(gl, runwayMesh(ap, false)))
      this.marks.push(new Mesh(gl, runwayMesh(ap, true)))
      this.lights.push(new Mesh(gl, toLine(runwayLights(ap)), gl.LINES))
      this.props.push(new Mesh(gl, scenery(ap, CITY[key][0], CITY[key][1])))
      this.papis[key] = papiUnits(ap)
    }
    this.shadowQuad = new Mesh(gl, {
      pos: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, -1, 1, 0, 1, -1, 0, 1],
      normal: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      uv: [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1],
    })
    this.identity = m4identity()
  }

  setAircraft(id) {
    const spec = this.fleet[id]
    if (!spec) return
    this.aircraftId = id
    const livery = liveryFor(spec.reg)
    const geo = aircraftMesh(spec, livery)
    /* The stance comes from the published overall height, and then the mesh
       gets a veto: if anything it actually drew hangs lower than that stance
       allows, the legs grow until it clears. That second clause is the reason
       no aeroplane in this roster can be buried by a future edit to its
       shape — including the three that were added after it was written. */
    const clear = Math.max(0.22, spec.dia * 0.07)
    const stance = Math.max(stanceHeight(spec), -geo.minY + clear)
    const g = gearMesh(spec, stance)
    if (this.acMesh) this.acMesh.dispose()
    if (this.gearMesh) this.gearMesh.dispose()
    this.acMesh = new Mesh(this.gl, geo)
    this.gearMesh = new Mesh(this.gl, g.mesh)
    if (this.decals) for (const d of this.decals) d.mesh.dispose()
    this.decals = decalQuads(spec, spec.reg).map(d => ({ tex: d.tex, mesh: new Mesh(this.gl, d.geo) }))
    const keep = this.ac ? { pos: this.ac.pos, vel: this.ac.vel, q: this.ac.q } : null
    this.ac = new Aircraft(spec, g.contacts, g.restHeight)
    // What the aeroplane draws below its own centre of gravity, so the ground
    // clearance is checkable from outside rather than taken on trust.
    this.ac.bodyMinY = geo.minY
    this.ac.bodyMaxY = geo.maxY
    if (keep) { this.ac.pos = keep.pos; this.ac.vel = keep.vel; this.ac.q = keep.q }
    this.ac.assist = this.opts.assist !== false
    this.sound.setEngine(spec)
  }

  /* --- Scenarios ----------------------------------------------------------
     Where a session starts. "Approach" exists because the interesting ninety
     seconds of a flight are the last ninety, and making someone fly 110 km to
     reach them is not respect for their time. */
  /* --- Conditions ---------------------------------------------------------
     Time of day moves the SUN, and everything else follows from that on its
     own: the shadow cascade already aims along the light vector, the terrain
     shader already takes a hemisphere ambient, and the sky shader already
     takes a zenith and a horizon. So this sets four numbers and the whole
     scene relights itself, rather than tinting the picture at the end. */
  setTimeOfDay(key) {
    const P = {
      // direction TO the sun, ambient level, zenith, horizon, ground bounce
      dawn: { dir: { x: -0.86, y: 0.16, z: 0.48 }, amb: 0.30, warm: [1.18, 0.86, 0.62], sky: 0.52 },
      noon: { dir: { x: 0.38, y: 0.62, z: 0.34 }, amb: 0.34, warm: [1.06, 1.00, 0.92], sky: 1.00 },
      dusk: { dir: { x: 0.88, y: 0.13, z: -0.44 }, amb: 0.27, warm: [1.22, 0.74, 0.48], sky: 0.44 },
      // Below the horizon. A crescent of scattered light is left in the sky so
      // the world is dark rather than a black screen, which is when the runway
      // lighting finally becomes the thing you are flying on.
      night: { dir: { x: 0.20, y: -0.28, z: 0.30 }, amb: 0.10, warm: [0.42, 0.48, 0.62], sky: 0.10 },
    }
    const p = P[key] || P.noon
    this.timeOfDay = P[key] ? key : 'noon'
    this.sun = vnorm(p.dir)
    this.light = p
    // The grid carries its colour in its vertex buffer, so changing the hour
    // has to rebuild it rather than merely change a uniform.
    if (this.grid && this.ac) this.refreshNear(true)
  }

  /** Wind, as the METAR reads it: the direction it comes FROM, and its speed. */
  setWeather({ dirDeg, speedKt, gust } = {}) {
    this.wind.set(
      dirDeg != null ? dirDeg : this.wind.dirDeg,
      speedKt != null ? speedKt : this.wind.speedKt,
      gust != null ? gust : this.wind.gust)
  }

  /** Choose which of the four published flights to fly. */
  setFlight(id) {
    if (!LEGS[id]) return
    this.flightId = id
    this.leg = LEGS[id]
    this.origin = AIRPORTS[this.leg.from]
    this.dest = AIRPORTS[this.leg.to]
  }

  setScenario(kind) {
    this.scenario = kind
    const ac = this.ac
    if (!this.leg) this.setFlight('AXZ001')
    // Origin and destination now come from the FLIGHT, so the same four
    // scenarios work on either route: the airline publishes AXZ001 to AXZ004
    // and all four are flyable rather than only the pair near KSFO.
    const ksfo = this.origin, ksns = this.dest
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
      /* Vref for THIS type. A fixed 72 m/s put the Cessna on final at 136 kt,
         which is nearly three times its approach speed and about twice its
         never-exceed. The glide slope is three degrees for everyone; the speed
         down it is not. */
      const vref = ac.vrefMs()
      const w0 = this.wind.sample(582, 0)
      ac.place(x, ksns.elev + 582, z, ksns.rwy.hdg, vref, { gamma: -3 * DEG, trimmed: true, wind: w0 })
      this.input.throttle = ac.throttle
      this.mission = { active: true, phase: 'final', best: null }
    } else {
      // Cruise, halfway down the route at the level the site publishes.
      const t = 0.45
      const x = ksfo.x + (ksns.x - ksfo.x) * t, z = ksfo.z + (ksns.z - ksfo.z) * t
      const brg = Math.atan2(ksns.x - ksfo.x, -(ksns.z - ksfo.z)) * RAD
      ac.setFlap(0); ac.gearDown = false; ac.gearPos = 0
      // The cruise level the site publishes for THIS leg: 1,676 m on the
      // California pair, 9,500 m on the China pair.
      // A light single cannot hold the airline's cruise level, so it gets the
      // highest it can actually manage, at its own cruise speed.
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
    this.shake = 0
    this.wreck.t = 0
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
    this.grid.upload(toLine(terrainGrid(cx, cz, NEAR_SIZE, 24, this.gridColour())))
  }

  /* Lines are not lit, so the ground grid keeps whatever colour it was built
     with. At full brightness after dark that turned the landscape into a
     glowing wireframe — the one thing in the scene that ignored nightfall. */
  gridColour() {
    const k = 0.20 + 0.80 * (this.light ? this.light.sky : 1)
    return [0.55 * k, 0.54 * k, 0.50 * k]
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
    document.removeEventListener('fullscreenchange', this.onFullscreenChange)
    document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange)
  }

  tick(dtReal) {
    this.input.poll(dtReal)
    this.handleActions()

    if (!this.paused) {
      const ac = this.ac
      /* Gyro overrides pitch and roll when it is live. It is sampled here
         rather than inside Input because it is a whole-device sensor, not a
         key, and because phone mode owns whether it is running at all. */
      const g = this.gyro.sample(dtReal)
      if (g) { this.input.axes.pitch = g.pitch; this.input.axes.roll = g.roll }
      if (this.mobile) this.mobile.apply()

      if (ac.crashed) {
        ac.ctl.elevator = 0; ac.ctl.aileron = 0; ac.ctl.rudder = 0
        ac.throttle = 0
        ac.brakes = 1
      } else {
        ac.ctl.elevator = -this.input.axes.pitch   // pulling back is nose up
        ac.ctl.aileron = this.input.axes.roll
        ac.ctl.rudder = this.input.axes.yaw
        ac.throttle = this.input.throttle
        ac.brakes = this.input.brakes
      }

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
        // The air mass the wing sees, sampled at the aeroplane's own height so
        // the crosswind changes as it descends into the flare.
        const w = this.wind.sample(Math.max(ac.radioAlt || 0, 0), step)
        ac.wind.x = w.x; ac.wind.y = w.y; ac.wind.z = w.z
        ac.step(step)
        this.acc -= step
      }
      if (budget <= 0) this.acc = 0

      // Effects read the finished physics state, so what they show is what the
      // model just did. Stepped on the real clock, not the compressed one:
      // smoke at 8x would be a strobe.
      this.fx.update(ac, Math.min(dtReal, 0.05), this.wind.cur, {
        bodyPoint: p => vadd(ac.pos, qrot(ac.q, p)),
      })
      this.parts.step(Math.min(dtReal, 0.05), this.wind.cur)

      this.refreshNear()
      this.checkEvents(dtReal)
    }

    this.updateCamera(dtReal)
    if (this.shake > 0.001) {
      // Positional only. Shaking the ORIENTATION as well made the horizon
      // swing and read as the aeroplane manoeuvring rather than as an impact.
      const k = this.shake * 2.2
      this.camPos = vadd(this.camPos, {
        x: (Math.random() - 0.5) * k,
        y: (Math.random() - 0.5) * k,
        z: (Math.random() - 0.5) * k,
      })
      this.shake = Math.max(0, this.shake - dtReal * 1.6)
    }
    this.render()

    this.sound.update(this.ac, dtReal, CAMERAS[this.cameraMode] === 'cockpit')

    const euler = qToEuler(this.ac.q)
    this.hud.update(this.ac, { euler }, dtReal)
    // Identity only changes on a press, so it is written on change rather than
    // sixty times a second at a string nobody watches move.
    const idKey = this.flightId + this.aircraftId + this.cameraMode
    if (idKey !== this.hudIdKey) {
      this.hudIdKey = idKey
      this.hud.setIdentity(this.flightId, this.ac.spec.reg,
        this.L.cameras[CAMERAS[this.cameraMode]] || CAMERAS[this.cameraMode])
      // The cockpit shell is CSS on the stage, so the stage has to know which
      // seat the camera is in.
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
    if (I.hit('KeyG')) { ac.toggleGear(); this.sound.servo(!ac.gearDown) }
    if (I.hit('KeyF')) { ac.flapDown(); this.sound.servo(false) }
    if (I.hit('KeyV')) { ac.flapUp(); this.sound.servo(true) }
    if (I.hit('KeyX')) ac.spoilers = ac.spoilers > 0.5 ? 0 : 1
    if (I.hit('KeyP')) ac.parkingBrake = !ac.parkingBrake
    if (I.hit('KeyN')) { ac.assist = !ac.assist; this.onEvent({ type: 'assist', on: ac.assist }) }
    if (I.hit('Comma')) ac.trim = clamp(ac.trim + 0.02, -0.5, 0.5)
    if (I.hit('Period')) ac.trim = clamp(ac.trim - 0.02, -0.5, 0.5)
    if (I.hit('KeyC')) this.cameraMode = (this.cameraMode + 1) % CAMERAS.length
    if (I.hit('BracketRight')) this.setTimeScale(this.timeScale * 2)
    if (I.hit('BracketLeft')) this.setTimeScale(this.timeScale / 2)
    if (I.hit('KeyR')) this.setScenario(this.scenario)
    if (I.hit('KeyZ')) this.setFullscreen(!this.fullscreen)
    /* Escape leaves fullscreen rather than pausing when there is a fullscreen
       to leave, because the browser is going to take us out of it anyway and
       coming back to a paused aeroplane reads as the key having done two
       unrelated things. */
    if (I.hit('Escape')) {
      if (this.fullscreen) this.setFullscreen(false)
      else this.setPaused(!this.paused)
    }
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

    /* Structural failure. Three ways to break an aeroplane, all read off the
       physics rather than scripted: arrive faster than the gear can absorb,
       arrive at a bank the wingtip reaches first, or arrive with the gear up.
       1,200 ft/min is roughly twice a firm airline landing and about where a
       737's gear design limit sits, so it is a fair line to draw. */
    /* Hitting something that is not a runway. The flight model reports it from
       inside the integrator, because the aeroplane can cross a tower block
       between one frame and the next and a per-frame position test would miss
       it entirely at 300 knots. */
    if (!ac.crashed && ac.impact) this.crash(ac.impact)

    if (!ac.crashLatch && ac.onGround) {
      const bank = Math.abs(qToEuler(ac.q).bank)
      let reason = null
      if (ac.lastTouchdownFpm > 1200) reason = 'hard'
      else if (bank > 32 * DEG && ac.tas > 25) reason = 'bank'
      else if (ac.gearPos < 0.4 && ac.tas > 30) reason = 'gear'
      if (reason) this.crash(reason)
    }
    if (!ac.onGround) { ac.crashLatch = false }

    // A wreck goes on burning, and the camera keeps watching it.
    if (ac.crashed) {
      // The wreck burns where it actually lies: still falling, that is the
      // airframe; once it is down, the ground under it.
      const by = ac.onGround ? elevation(ac.pos.x, ac.pos.z) : ac.pos.y
      burn(this.parts, ac.pos.x, by, ac.pos.z, dt, this.wreck)
    }
  }

  /* Break the aeroplane. The airframe stops flying, the wreck sheds its speed
     hard, the site burns, and the camera is knocked about for a second. */
  crash(reason) {
    const ac = this.ac
    if (ac.crashed) return
    ac.crashed = true
    ac.crashLatch = true
    const energy = clamp(0.5 + ac.tas / 90 + (ac.lastTouchdownFpm || 0) / 1400, 0.5, 2.3)
    /* At the AEROPLANE, not at the ground under it. Exploding at terrain level
       put the fireball two thousand feet below a mid-air break-up, which is to
       say off screen. */
    explode(this.parts, ac.pos.x, ac.pos.y, ac.pos.z, energy, ac.vel)
    this.sound.explosion(energy)
    this.shake = Math.min(1.4, 0.5 + energy * 0.55)
    // No thrust, no controls, and a wreck slides rather than rolls.
    ac.throttle = 0; ac.thrustLag = 0
    this.input.throttle = 0
    ac.brakes = 1
    // The numbers that caused it, so the tip has something to point at.
    const bankDeg = Math.abs(qToEuler(ac.q).bank) * RAD
    const detail = reason === 'hard' ? Math.round(ac.lastTouchdownFpm || 0) + ' ' + (this.L.fpm || 'ft/min')
      : reason === 'bank' ? Math.round(bankDeg) + '°'
        : Math.round(ac.tas * MS_TO_KT) + ' kt'
    // An impact is worth more energy than an arrival: a wing against a tower
    // at cruise speed is not a firm landing.
    if (reason === 'obstacle' || reason === 'terrain') this.shake = Math.min(1.8, this.shake + 0.5)
    this.onEvent({ type: 'crash', reason, energy, detail })
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
      /* Tower: a fixed point beside the nearest airport, tracking the aircraft.
         It used to consider only the two Californian fields, so on the Shanghai
         to Nanjing legs the camera sat six hundred kilometres away looking at
         nothing at all. Every field is a candidate now. */
      let best = AIRPORTS.KSFO, bd = Infinity
      for (const k of AP_LIST) {
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
    if (this.post && this.post.ok) this.post.resize(this.canvas.width, this.canvas.height)
  }

  render() {
    const R = this.renderer, ac = this.ac
    const alt = ac.pos.y
    // Sky darkens and haze thins with height — cheap, and it sells altitude
    // better than any amount of extra geometry would.
    const hi = clamp(alt / 9000, 0, 1)
    // `day` is how much daylight there is at all, from the time of day. It
    // multiplies the sky and the haze so dusk is dim and night is dark, rather
    // than midday with a colour cast over it.
    const day = this.light.sky
    const sky = [
      (0.55 - 0.42 * hi) * day, (0.68 - 0.44 * hi) * day, (0.82 - 0.37 * hi) * day,
    ]
    // Haze, not soup. At 900 m / 26 km the terrain was washed to sky colour
    // within a mile of the aeroplane and the whole world looked like an empty
    // blue plane; the point of building a landscape is being able to see it.
    const fogNear = 4200 + alt * 3
    const fogFar = 70000 + alt * 16

    const usePost = this.post && this.post.ok
    if (usePost) {
      this.post.resize(this.canvas.width, this.canvas.height)
      this.post.bindScene()
    }
    R.begin(sky)
    const proj = m4perspective(this.fov || 60 * DEG, R.aspect, 3, 240000)
    const view = m4view(this.camPos, this.camQ)

    /* Sky first, as a full-screen shader. It writes no depth, so everything
       drawn afterwards sits in front of it and the clear colour underneath
       never shows. */
    if (usePost) {
      this.post.drawSky(m4invert(m4mul(proj, view)), this.camPos, this.sun, {
        zenith: (hi > 0.5 ? [0.06, 0.12, 0.30] : [0.20, 0.38, 0.72]).map(v => v * day),
        // At dawn and dusk the horizon takes the sun's own colour, which is
        // most of what makes those two read as times rather than as filters.
        horizon: [0.62, 0.72, 0.86].map((v, i) => v * day * (0.55 + 0.45 * this.light.warm[i])),
        ground: [0.30 * day, 0.30 * day, 0.30 * day],
        sunSize: 0.028,
        haze: (1 - hi * 0.7) * day,
      })
    }
    const env = {
      light: this.sun,
      // Warmer and stronger than the ambient, so the lit faces read as sunlit
      // rather than merely brighter. The tint and the level both come from the
      // time of day.
      sun: this.light.warm,
      skyTint: [(0.42 - 0.28 * hi) * day, (0.58 - 0.34 * hi) * day, (0.86 - 0.30 * hi) * day],
      ambient: this.light.amb,
      camPos: this.camPos,
      fog: sky, fogNear, fogFar,
    }

    /* Depth pass. The cascade follows the AEROPLANE, not the camera: in tower
       view the camera is a mile away while the shadow that matters is still
       the one under the wing. Only what can plausibly cast into that box is
       drawn — the near terrain, the airport furniture and the aircraft. The
       far mesh is 2 km per cell and would contribute nothing but cost. */
    const acModel = m4model(ac.pos, ac.q, 1)
    if (this.shadows.ok) {
      this.shadows.aim(ac.pos, env.light, clamp(120 + ac.radioAlt * 0.55, 140, 900))
      this.shadows.begin()
      this.shadows.draw(this.near, this.identity)
      for (const m of this.runways) this.shadows.draw(m, this.identity)
      for (const m of this.props) this.shadows.draw(m, this.identity)
      this.shadows.draw(this.acMesh, acModel)
      if (ac.gearPos > 0.02) this.shadows.draw(this.gearMesh, acModel)
      this.shadows.end()

      /* Second cascade: an order of magnitude wider, aimed at the ground
         AHEAD of the aeroplane rather than under it, because that is where
         the terrain you are about to look at is. It takes the far mesh too,
         since at this scale distant hills are exactly what should be
         shading each other. */
      if (this.shadowsFar.ok) {
        const fwd = qrot(ac.q, { x: 0, y: 0, z: -1 })
        const aheadDist = clamp(900 + ac.pos.y * 1.2, 900, 4000)
        const focus = {
          x: ac.pos.x + fwd.x * aheadDist, y: elevation(ac.pos.x, ac.pos.z),
          z: ac.pos.z + fwd.z * aheadDist,
        }
        this.shadowsFar.aim(focus, env.light, clamp(1600 + ac.pos.y * 1.6, 1600, 7000))
        this.shadowsFar.begin()
        this.shadowsFar.draw(this.near, this.identity)
        this.shadowsFar.draw(this.far, this.identity)
        for (const mm of this.props) this.shadowsFar.draw(mm, this.identity)
        this.shadowsFar.end()
      }
      // The depth pass rebinds the framebuffer and viewport; put them back.
      if (usePost) this.post.bindScene()
      else R.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    }
    env.shadow = this.shadows
    env.shadowFar = this.shadowsFar

    R.use('solid', proj, view, env)

    /* THE FAR MESH GOES FIRST AND THEN ITS DEPTH IS THROWN AWAY.
       This is the bug that made every aeroplane look like it was parked in a
       field with its wheels buried. The far patch is 2 km per cell, and an
       airport plateau is 2.2 km across, so the coarse mesh cannot resolve it:
       its triangles ramp away from the handful of vertices that land inside
       the flat zone, and over KSFO its surface interpolates to 5.48 m against
       a true field elevation of 4.00. That 1.4 m sheet was drawn over the
       runway at 4.06, over the edge lights, over the PAPI, over the
       aeroplane's ground shadow, and over the bottom metre and a half of the
       aeroplane itself. On the Cessna, whose fuselage top sits at 5.3 m, it
       swallowed everything but the wing.
       Inside its own footprint the NEAR mesh is the authority, and everything
       else in the scene lives inside that footprint. So the horizon is painted
       first, its depth is discarded, and the near mesh and everything on it
       are drawn into a clean buffer. Distant hills still stand above the near
       mesh's horizon, which is the only place they were ever wanted. */
    R.draw(this.far, this.identity)
    R.gl.clear(R.gl.DEPTH_BUFFER_BIT)
    R.draw(this.near, this.identity)

    /* The runway is a decal on the ground, not a slab above it, and six
       centimetres of physical lift is not a depth margin at ten kilometres —
       which is exactly the range at which a runway matters. A polygon offset
       biases in DEPTH-SLOPE units, so it holds at every distance: the asphalt
       wins against the terrain, and the paint wins against the asphalt. */
    const gl2 = this.gl
    gl2.enable(gl2.POLYGON_OFFSET_FILL)
    gl2.polygonOffset(-1.2, -2)
    for (const m of this.runways) R.draw(m, this.identity)
    gl2.polygonOffset(-2.6, -6)
    for (const m of this.marks) R.draw(m, this.identity)
    gl2.polygonOffset(0, 0)
    gl2.disable(gl2.POLYGON_OFFSET_FILL)

    for (const m of this.props) R.draw(m, this.identity)

    // The aeroplane is not drawn in cockpit view — you are sitting in it.
    if (CAMERAS[this.cameraMode] !== 'cockpit') {
      // Painted aluminium: a tight, bright highlight. This is the one object in
      // the scene that should catch the sun as a glint rather than a sheen.
      R.setMaterial(0.55, 68)
      R.draw(this.acMesh, acModel)
      if (ac.gearPos > 0.02) R.draw(this.gearMesh, acModel)
      R.setMaterial(0, 24)
    }

    // Decals: the wordmark, the fin mark and the cabin windows, each a quad
    // sitting a few centimetres off the skin. Type wants a texture, and one
    // textured quad beats trying to letter an aeroplane out of triangles.
    if (CAMERAS[this.cameraMode] !== 'cockpit' && this.decals) {
      for (const d of this.decals) R.textured(d.mesh, acModel, this.tex[d.tex], proj, view, env)
    }

    R.use('line', proj, view, env)
    R.draw(this.grid, this.identity)
    for (const m of this.lights) R.draw(m, this.identity)

    /* --- Sprites, back to front ------------------------------------------
       Order matters and the reasons differ. Trees are opaque cut-outs so they
       could go anywhere, but they are drawn before the soft stuff so the soft
       stuff can blend over them. Clouds are sorted by distance every frame
       inside Clouds.collect. Particles go last because they are the nearest
       and the most transparent. */
    const cam = this.camPos

    if (this.treeDirty(cam)) trees(cam.x, cam.z, 5200, this.sTree)
    if (this.sTree.length) R.sprites(this.sTree, this.tex.tree, proj, view, env, { depthWrite: true })

    this.clouds.collect(cam.x, cam.z, 38000, this.sCloud)
    if (this.sCloud.length) R.sprites(this.sCloud, this.tex.puff, proj, view, env)

    // PAPI. Evaluated against the aeroplane's own position, so the lights say
    // what the approach angle actually is rather than what it should be.
    this.sDot.length = 0
    for (const key of AP_LIST) {
      const papi = this.papis[key]
      const st = papiState(papi, ac.pos)
      if (!st) continue
      papi.units.forEach((u, i) => {
        const white = st[i]
        this.sDot.push({
          x: u.x, y: u.y, z: u.z, size: 3.4,
          r: white ? 1 : 1, g: white ? 0.97 : 0.20, b: white ? 0.92 : 0.16, a: 1,
        })
      })
    }
    if (this.sDot.length) R.sprites(this.sDot, this.tex.dot, proj, view, env)

    /* The aeroplane's shadow: a ground-ALIGNED quad, not a billboard. As a
       camera-facing sprite it stood upright like a coin whenever the view was
       low and from behind, which is precisely the view you land from. It is
       not a shadow map and does not pretend to be; what it supplies is the one
       depth cue that matters on short final, which is how far above the runway
       you actually are. */
    if (ac.radioAlt < 400) {
      const gy = elevation(ac.pos.x, ac.pos.z)
      const fade = clamp(1 - ac.radioAlt / 400, 0, 1)
      const sz = ac.spec.span * (0.34 + ac.radioAlt / 1100)
      const heading = qToEuler(ac.q).heading
      const model = m4model({ x: ac.pos.x, y: gy + 0.9, z: ac.pos.z },
        qFromEuler(heading, 0, 0), sz)
      const gl = this.gl
      gl.enable(gl.BLEND)
      gl.depthMask(false)
      R.textured(this.shadowQuad, model, this.tex.shadow, proj, view,
        { ...env, ambient: clamp(0.55 + fade * 0.45, 0, 1) })
      gl.depthMask(true)
      gl.disable(gl.BLEND)
    }

    this.parts.collect(this.sParts)
    if (this.sParts[KIND.PUFF].length) {
      // Nearest last, or a near puff's transparent edge erases the one behind.
      this.sParts[KIND.PUFF].sort((a, b) =>
        ((b.x - cam.x) ** 2 + (b.y - cam.y) ** 2 + (b.z - cam.z) ** 2) -
        ((a.x - cam.x) ** 2 + (a.y - cam.y) ** 2 + (a.z - cam.z) ** 2))
      R.sprites(this.sParts[KIND.PUFF], this.tex.puff, proj, view, env)
    }
    if (this.sParts[KIND.DOT].length) R.sprites(this.sParts[KIND.DOT], this.tex.dot, proj, view, env)

    /* Tone-map and bloom. Exposure lifts a touch when something is actually
       burning, which is what an eye does looking at a fire. */
    if (usePost) {
      this.post.finish(this.canvas.width, this.canvas.height, {
        bloom: ac.crashed ? 1.0 : 0.85,
        exposure: 1.12,
        vignette: 0.20,
        threshold: 0.80,
      })
    }
  }

  /** Regenerate the tree lattice only when the camera has actually moved on. */
  treeDirty(cam) {
    if (Math.abs(cam.x - this.treeCentre.x) < 900 && Math.abs(cam.z - this.treeCentre.z) < 900) return false
    this.treeCentre = { x: cam.x, z: cam.z }
    return true
  }

  /** A snapshot for the panel beside the canvas. */
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
      gyro: this.gyro.active,
      camera: CAMERAS[this.cameraMode],
      flight: this.flightId,
      origin: this.origin.icao,
      windDir: this.wind.dirDeg,
      windKt: this.wind.speedKt,
      // Headwind component on the destination runway, which is the number that
      // actually changes the approach.
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
    }
  }
}

/** Line builders emit pos+color only; the shared Mesh wants a normal array. */
function toLine(d) {
  return { pos: d.pos, color: d.color, normal: new Array(d.pos.length).fill(0) }
}

export { CAMERAS }
