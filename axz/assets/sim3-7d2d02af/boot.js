/* ==========================================================================
   AXZ sim 3.0 — entry point.

   Loaded by dynamic import on a press, never before. Three.js and its addons
   resolve through the page's import map, the model library is the hangar's,
   and everything the page needs in order to describe the simulator is
   server-rendered HTML that exists whether or not this file ever runs.
   ========================================================================== */

import * as THREE from 'three'
import { CSM } from 'three/addons/csm/CSM.js'
import { Sky } from 'three/addons/objects/Sky.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { createHangar } from './models.js'
import { Sim } from './main.js'
import { MobileControls, isPhone } from './mobile.js'
import { AssetHub } from './assets.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'

export async function boot(cfg) {
  const stage = cfg.stage
  const mount = stage.querySelector('[data-sim-mount]')
  const L = cfg.labels

  const cells = {}
  for (const node of stage.querySelectorAll('[data-sim-field]')) cells[node.getAttribute('data-sim-field')] = node
  const log = stage.querySelector('[data-sim-log]')
  const crashBox = stage.querySelector('[data-sim-crash]')
  const setText = (k, v) => { if (cells[k]) cells[k].textContent = v }
  function scenarioText(kind, from, to) {
    return (L.scenarios[kind] || kind).replace('{from}', from || '').replace('{to}', to || '')
  }

  /* The data origin comes from the page. `?assets=` overrides it so a local
     build can be verified against a local assets server without rebuilding
     the page with a different origin baked in. */
  const origin = new URLSearchParams(location.search).get('assets') || stage.getAttribute('data-sim-assets') || ''
  const hub = new AssetHub({ origin })
  await hub.load()

  /* Sourced models come down by fleet id, parsed once, kept for the Sim.
     A type the hub has no model for flies the hangar's procedural one. */
  const rigged = new Map()
  /* Draco-compressed geometry decodes with the decoder the assets origin
     serves, pinned to the same three.js version as the page's import map. */
  const loader = new GLTFLoader()
  const draco = new DRACOLoader()
  draco.setDecoderPath(`${hub.origin}/decoders/three-0.170.0/draco/`)
  draco.setDecoderConfig({ type: 'wasm' })
  loader.setDRACOLoader(draco)
  async function preload(id) {
    if (rigged.has(id) || !hub.online) return rigged.get(id) || null
    const asset = hub.modelFor(id)
    if (!asset) return null
    try {
      const buf = await hub.bytesOf(asset.id)
      const gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej))
      const entry = { gltf, asset }
      const deck = hub.modelFor(id, 'cockpit')
      if (deck && deck.id !== asset.id) {
        try { entry.cockpit = await new Promise((res, rej) => hub.bytesOf(deck.id).then(b => loader.parse(b, '', res, rej), rej)); entry.cockpitAsset = deck } catch (err) { if (window.console) console.warn('[axz-sim3] cockpit', id, err) }
      }
      rigged.set(id, entry)
      return entry
    } catch (err) {
      if (window.console) console.warn('[axz-sim3] model', id, err)
      return null
    }
  }
  const firstId = cfg.aircraftId || cfg.fleet._order[0]
  await preload(firstId)

  let sim
  try {
    const hangar = createHangar(THREE)
    sim = new Sim({
      container: mount,
      labels: L,
      fleet: cfg.fleet,
      flaps: cfg.flaps,
      audioBase: cfg.audioBase,
      bands: cfg.bands,
      aircraftId: cfg.aircraftId,
      scenario: cfg.scenario,
      assist: cfg.assist,
      THREE, hangar, rigged,
      addons: { CSM, Sky, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, SMAAPass },
      onEvent: ev => handleEvent(ev),
    })
  } catch (err) {
    if (window.console) console.error('[axz-sim2]', err)
    return { error: err && err.message === 'no-webgl' ? 'no-webgl' : 'failed', detail: String(err) }
  }

  /* Phase 0 proves the path and nothing else: one authored texture comes
     down through the hub, is counted, and is uploaded to the GPU. Later
     phases hang real models and tiles on the same three calls. */
  if (hub.online) {
    try {
      const buf = await hub.bytesOf('uv-probe')
      const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/png' }))
      const tex = new THREE.CanvasTexture(bitmap)
      tex.colorSpace = THREE.SRGBColorSpace
      sim.renderer.initTexture(tex)
      sim.probeTexture = tex
    } catch (err) {
      if (window.console) console.warn('[axz-sim3] probe', err)
    }
  }
  /* The engine line says which aeroplane this is: a sourced 3.0 model with
     its licence, or the 2.0 airframe. It is repainted on every swap. */
  const tierEl = stage.querySelector('[data-sim-tier]')
  let modelsMeta = {}
  try { modelsMeta = JSON.parse(stage.getAttribute('data-sim-models') || '{}') } catch (e) { modelsMeta = {} }
  function paintTier() {
    if (!tierEl) return
    const mb = (hub.transferred / 1048576).toFixed(2)
    const id = sim.aircraftId
    const meta = rigged.has(id) ? modelsMeta[id] : null
    const model = meta ? `${L.modelLabel}: ${meta.title} · ${meta.license}` : `${L.modelLabel}: ${L.model2}`
    tierEl.textContent = `${L.tierLabel} ${L.tiers.v3} · ${L.tierAuto} · ${hub.online ? `${L.assetsLabel} ${mb} MB` : L.assetsOffline} · ${model}`
    tierEl.hidden = false
  }
  paintTier()

  function handleEvent(ev) {
    if (ev.type === 'landing') {
      const parts = []
      parts.push(`${Math.round(ev.fpm)} ${L.fpm}`)
      if (ev.band) parts.push(ev.band)
      if (ev.atDestination) {
        parts.push(`${ev.airport}`)
        if (ev.centreline != null) parts.push(`${L.centreline} ${Math.abs(ev.centreline).toFixed(0)} m`)
        if (ev.score != null && L.score) {
          parts.push(`${L.score.zone} ${ev.zoneM} m`)
          parts.push(`Vref${ev.dSpeedKt >= 0 ? '+' : ''}${ev.dSpeedKt} kt`)
          parts.push(`${L.score.total} ${ev.score}/100 · ${ev.grade}`)
        }
      }
      pushLog(parts.join(' · '), ev.band && ev.fpm <= 200 ? 'good' : 'warn')
    } else if (ev.type === 'phase') {
      pushLog(L.phases[ev.phase] || ev.phase, 'info')
    } else if (ev.type === 'crash') {
      pushLog((L.crashReasons && L.crashReasons[ev.reason]) || L.crashed, 'warn')
      showCrash(ev)
    } else if (ev.type === 'assist') {
      pushLog(L.assistLabel + ' ' + (ev.on ? L.on : L.off), 'info')
    } else if (ev.type === 'autopilot') {
      pushLog((L.autopilotLabel || 'AP') + ' ' + (ev.on ? `${L.on} · ${ev.alt} ${L.ft} · ${String(ev.hdg).padStart(3, '0')}` : L.off), 'info')
    } else if (ev.type === 'lights') {
      pushLog((L.lightsLabel || 'LTS') + ' ' + (ev.on ? L.on : L.off), 'info')
    } else if (ev.type === 'reverse') {
      pushLog((L.reverseLabel || 'REV') + ' ' + (ev.on ? L.on : L.off), 'info')
    } else if (ev.type === 'timescale') {
      pushLog(L.timeLabel + ' ' + ev.value + '×', 'info')
    } else if (ev.type === 'failure') {
      const name = (L.sysNames && L.sysNames[ev.what]) || ev.what
      const why = (L.failWhy && L.failWhy[ev.why]) || ''
      pushLog((ev.n ? name + ' ' + ev.n : name) + (why ? ' ' + why : ''), 'warn')
    } else if (ev.type === 'mach') {
      pushLog(ev.up ? L.machUp : L.machDown, 'good')
    } else if (ev.type === 'paused') {
      stage.setAttribute('data-paused', String(ev.paused))
      pushLog(ev.paused ? L.paused : L.resumed, 'info')
    } else if (ev.type === 'scenario') {
      hideCrash()
      if (log) log.innerHTML = ''
      pushLog(scenarioText(ev.kind, ev.from, ev.to), 'info')
    }
    paintToggles()
  }

  function showCrash(ev) {
    if (!crashBox) return
    const tip = (L.crashTips && L.crashTips[ev.reason]) || ''
    const reason = (L.crashReasons && L.crashReasons[ev.reason]) || L.crashed
    crashBox.innerHTML = ''
    const h = document.createElement('p'); h.className = 'sim-crash__head'; h.textContent = reason; crashBox.appendChild(h)
    if (ev.detail) { const d = document.createElement('p'); d.className = 'sim-crash__num code'; d.textContent = ev.detail; crashBox.appendChild(d) }
    if (tip) { const t = document.createElement('p'); t.className = 'sim-crash__tip'; t.textContent = L.tipLabel + ' ' + tip; crashBox.appendChild(t) }
    const again = document.createElement('button')
    again.type = 'button'; again.className = 'btn sim-crash__again'; again.textContent = L.restart
    again.addEventListener('click', () => { sim.setScenario(sim.scenario); sim.canvas.focus() })
    crashBox.appendChild(again)
    crashBox.hidden = false
    again.focus()
  }
  function hideCrash() { if (crashBox) { crashBox.hidden = true; crashBox.innerHTML = '' } }
  function pushLog(text, kind) {
    if (!log) return
    const li = document.createElement('li')
    li.className = 'sim-log__row is-' + kind
    li.textContent = text
    log.insertBefore(li, log.firstChild)
    while (log.children.length > 6) log.removeChild(log.lastChild)
  }

  let acc = 0
  const originalTick = sim.tick.bind(sim)
  sim.tick = dt => {
    originalTick(dt)
    acc += dt
    if (acc < 0.1) return
    acc = 0
    const r = sim.readout()
    setText('ias', Math.round(r.ias))
    setText('mach', r.mach.toFixed(2))
    setText('alt', Math.round(r.alt).toLocaleString('en-US'))
    setText('agl', Math.round(r.agl).toLocaleString('en-US'))
    setText('vs', (r.vs >= 0 ? '+' : '') + Math.round(r.vs))
    setText('hdg', String(Math.round(r.hdg) % 360).padStart(3, '0'))
    setText('dist', r.dist.toFixed(1))
    setText('dest', r.dest)
    setText('flight', r.flight + '  ' + r.origin + '-' + r.dest)
    setText('wind', String(Math.round(r.windDir)).padStart(3, '0') + '/' + Math.round(r.windKt) + '  ' + (r.headwind >= 0 ? 'H' : 'T') + Math.abs(Math.round(r.headwind)))
    setText('papi', r.papi || '—')
    setText('camera', L.cameras[r.camera] || r.camera)
    setText('time', r.timeScale + '×')
    setText('assist', r.assist ? L.on : L.off)
    setText('fps', Math.round(r.fps))
    setText('input', r.gyro ? L.gyroscope : r.pad ? L.gamepad : L.keyboard)
    setText('fuel', Math.round(r.fuel).toLocaleString('en-US') + ' kg · ' + Math.round(r.fuelFrac * 100) + '%')
    setText('n1', Math.round(r.n1) + '%')
    setText('gs', Math.round(r.gs))
    setText('autopilot', r.autopilot ? L.on : L.off)
  }

  const paintScenarios = () => {
    if (!scSel) return
    const r = sim.readout()
    for (const opt of scSel.options) opt.textContent = scenarioText(opt.value, r.origin, r.dest)
  }
  const frSel = stage.querySelector('[data-sim-failrate]')
  if (frSel) {
    const applyRate = () => { sim.ac.failureRate = parseFloat(frSel.value) || 0 }
    frSel.addEventListener('change', () => { applyRate(); sim.canvas.focus() })
    sim.onAircraft = applyRate
    applyRate()
  }
  const flSel = stage.querySelector('[data-sim-flight]')
  if (flSel) flSel.addEventListener('change', () => { sim.setFlight(flSel.value); sim.setScenario(scSel ? scSel.value : sim.scenario); paintScenarios() })
  const acSel = stage.querySelector('[data-sim-aircraft]')
  const scSel = stage.querySelector('[data-sim-scenario]')
  if (acSel) acSel.addEventListener('change', async () => {
    const id = acSel.value
    await preload(id)                       // the sourced model, if there is one, before the swap
    if (acSel.value !== id) return          // the reader moved on while it loaded
    sim.setAircraft(id); sim.setScenario(scSel ? scSel.value : sim.scenario)
    paintTier()
  })
  if (scSel) scSel.addEventListener('change', () => sim.setScenario(scSel.value))

  const todSel = stage.querySelector('[data-sim-time]')
  if (todSel) todSel.addEventListener('change', () => { sim.setTimeOfDay(todSel.value); sim.canvas.focus() })
  const wdSel = stage.querySelector('[data-sim-winddir]')
  const wsSel = stage.querySelector('[data-sim-windspeed]')
  const tbSel = stage.querySelector('[data-sim-turb]')
  const wxSel = stage.querySelector('[data-sim-weather]')
  const WX = { clear: { cover: 0.12, rain: 0 }, scattered: { cover: 0.45, rain: 0 }, overcast: { cover: 0.85, rain: 0 }, rain: { cover: 0.95, rain: 1 } }
  const applyWeather = () => {
    const wx = wxSel ? WX[wxSel.value] || WX.scattered : {}
    sim.setWeather({
      dirDeg: wdSel ? Number(wdSel.value) : undefined,
      speedKt: wsSel ? Number(wsSel.value) : undefined,
      gust: tbSel ? Number(tbSel.value) : undefined,
      cover: wx.cover, rain: wx.rain,
    })
    sim.canvas.focus()
  }
  for (const s of [wdSel, wsSel, tbSel, wxSel]) if (s) s.addEventListener('change', applyWeather)
  if (wxSel) sim.setWeather(WX[wxSel.value] || WX.scattered)

  const clearBtn = stage.querySelector('[data-sim-clearlog]')
  if (clearBtn) clearBtn.addEventListener('click', () => { if (log) log.innerHTML = ''; sim.canvas.focus() })

  /* Hoisted, and guarded: the Sim constructor fires the opening scenario
     event before this file has reached the line below, which is the third
     time this boot sequence has been bitten by a binding still in its
     temporal dead zone. A function declaration has no dead zone. */
  function paintToggles() {
    if (!sim) return
    for (const node of stage.querySelectorAll('[data-sim-state]')) {
      const which = node.getAttribute('data-sim-state')
      const on = which === 'assist' ? !!sim.ac.assist : which === 'sound' ? !!sim.sound.enabled
        : which === 'autopilot' ? !!sim.ac.ap.on : which === 'lights' ? !!sim.landingLights : false
      node.textContent = on ? L.on : L.off
      node.setAttribute('data-on', String(on))
      const btn = node.closest('[data-sim-action]')
      if (btn) btn.setAttribute('aria-pressed', String(on))
    }
  }
  for (const btn of stage.querySelectorAll('[data-sim-action]')) {
    btn.addEventListener('click', () => {
      const a = btn.getAttribute('data-sim-action')
      if (a === 'pause') sim.setPaused(!sim.paused)
      else if (a === 'reset') sim.setScenario(sim.scenario)
      else if (a === 'camera') sim.cameraMode = (sim.cameraMode + 1) % 6
      else if (a === 'assist') { sim.ac.assist = !sim.ac.assist; handleEvent({ type: 'assist', on: sim.ac.assist }) }
      else if (a === 'autopilot') sim.toggleAutopilot()
      else if (a === 'lights') sim.toggleLights()
      else if (a === 'sound') {
        const on = !sim.sound.enabled
        sim.sound.init()
        sim.sound.setEnabled(on)
        btn.setAttribute('aria-pressed', String(on))
        pushLog(L.soundLabel + ' ' + (on ? L.on : L.off), 'info')
      }
      paintToggles()
      sim.canvas.focus()
    })
  }
  mount.addEventListener('pointerdown', () => sim.canvas.focus())
  sim.canvas.tabIndex = 0

  const onVis = () => { if (document.hidden) { sim.setPaused(true); sim.sound.suspend() } else { sim.sound.resume() } }
  document.addEventListener('visibilitychange', onVis)

  sim.sound.init()
  sim.sound.setEnabled(true)
  sim.sound.loadClips()
  const sndBtn = stage.querySelector('[data-sim-action="sound"]')
  if (sndBtn) sndBtn.setAttribute('aria-pressed', 'true')
  paintToggles()

  const fsBtn = stage.querySelector('[data-sim-fullscreen]')
  const fsExit = stage.querySelector('[data-sim-fsexit]')
  const syncFs = () => {
    if (fsBtn) { fsBtn.setAttribute('aria-pressed', String(sim.fullscreen)); fsBtn.textContent = sim.fullscreen ? L.exit : L.fullscreen }
  }
  if (fsBtn) { fsBtn.hidden = false; fsBtn.addEventListener('click', async () => { await sim.setFullscreen(!sim.fullscreen); syncFs() }) }
  if (fsExit) fsExit.addEventListener('click', async () => { await sim.setFullscreen(false); syncFs() })
  const fsWatch = setInterval(() => { if (fsBtn && (fsBtn.getAttribute('aria-pressed') === 'true') !== sim.fullscreen) syncFs() }, 400)

  const phoneBtn = stage.querySelector('[data-sim-phone]')
  if (phoneBtn) {
    if (isPhone()) phoneBtn.hidden = false
    phoneBtn.addEventListener('click', async () => {
      if (!sim.mobile) sim.mobile = new MobileControls(stage, sim, L)
      if (sim.mobile.active) { sim.mobile.exit(); phoneBtn.setAttribute('aria-pressed', 'false'); return }
      await sim.mobile.enter(sim.gyro)
      phoneBtn.setAttribute('aria-pressed', 'true')
      if (!sim.mobile.gyroOn) pushLog(L.gyroUnavailable, 'warn')
      else pushLog(L.gyroOn, 'info')
    })
  }

  window.__axzSimHandle = { sim, assets: hub, tier: 'v3', rigged }
  sim.start()
  return {
    sim,
    assets: hub,
    tier: 'v3',
    destroy() {
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(fsWatch)
      sim.destroy()
    },
  }
}
