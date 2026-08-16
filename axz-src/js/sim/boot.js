/* ==========================================================================
   AXZ sim — entry point.

   The page loads this by dynamic import, on a press, and never before: a
   flight simulator has no business costing anything to someone who came to
   read about the airline. Everything the page needs in order to describe the
   simulator — what it is, what the controls are, what the scoring bands are —
   is server-rendered HTML that exists whether or not this file ever runs.
   ========================================================================== */

import { Sim } from './main.js'

export async function boot(cfg) {
  const stage = cfg.stage
  const mount = stage.querySelector('[data-sim-mount]')
  const L = cfg.labels

  /* --- Readout ------------------------------------------------------------
     Resolved BEFORE the Sim is constructed. The constructor sets the opening
     scenario, which fires an event, which writes to the log — so the log has
     to exist by then or the handler reads a binding that is still in its
     temporal dead zone and the whole start fails. */
  const cells = {}
  for (const node of stage.querySelectorAll('[data-sim-field]')) {
    cells[node.getAttribute('data-sim-field')] = node
  }
  const log = stage.querySelector('[data-sim-log]')
  const setText = (k, v) => { if (cells[k]) cells[k].textContent = v }

  let sim
  try {
    sim = new Sim({
      container: mount,
      labels: L,
      fleet: cfg.fleet,
      bands: cfg.bands,
      aircraftId: cfg.aircraftId,
      scenario: cfg.scenario,
      assist: cfg.assist,
      onEvent: ev => handleEvent(ev),
    })
  } catch (err) {
    // The only expected failure is no WebGL. Say so plainly and leave the
    // page's own description of the simulator in place.
    return { error: err && err.message === 'no-webgl' ? 'no-webgl' : 'failed', detail: String(err) }
  }

  function handleEvent(ev) {
    if (ev.type === 'landing') {
      const parts = []
      parts.push(`${Math.round(ev.fpm)} ${L.fpm}`)
      if (ev.band) parts.push(ev.band)
      if (ev.atDestination) {
        parts.push(`${ev.airport}`)
        if (ev.centreline != null) {
          parts.push(`${L.centreline} ${Math.abs(ev.centreline).toFixed(0)} m`)
        }
      }
      pushLog(parts.join(' · '), ev.band && ev.fpm <= 200 ? 'good' : 'warn')
    } else if (ev.type === 'phase') {
      pushLog(L.phases[ev.phase] || ev.phase, 'info')
    } else if (ev.type === 'crash') {
      pushLog(L.crashed, 'warn')
    } else if (ev.type === 'assist') {
      pushLog(L.assistLabel + ' ' + (ev.on ? L.on : L.off), 'info')
    } else if (ev.type === 'timescale') {
      pushLog(L.timeLabel + ' ' + ev.value + '×', 'info')
    } else if (ev.type === 'paused') {
      stage.setAttribute('data-paused', String(ev.paused))
      pushLog(ev.paused ? L.paused : L.resumed, 'info')
    } else if (ev.type === 'scenario') {
      if (log) log.innerHTML = ''
      pushLog(L.scenarios[ev.kind] || ev.kind, 'info')
    }
  }

  function pushLog(text, kind) {
    if (!log) return
    const li = document.createElement('li')
    li.className = 'sim-log__row is-' + kind
    li.textContent = text
    log.insertBefore(li, log.firstChild)
    while (log.children.length > 6) log.removeChild(log.lastChild)
  }

  /* --- Panel refresh ------------------------------------------------------
     Once every 100 ms, not every frame. These are text nodes in the document;
     rewriting them sixty times a second is layout work for numbers nobody can
     read that fast anyway. */
  let acc = 0
  const originalTick = sim.tick.bind(sim)
  sim.tick = dt => {
    originalTick(dt)
    acc += dt
    if (acc < 0.1) return
    acc = 0
    const r = sim.readout()
    setText('ias', Math.round(r.ias))
    setText('alt', Math.round(r.alt).toLocaleString('en-US'))
    setText('agl', Math.round(r.agl).toLocaleString('en-US'))
    setText('vs', (r.vs >= 0 ? '+' : '') + Math.round(r.vs))
    setText('hdg', String(Math.round(r.hdg) % 360).padStart(3, '0'))
    setText('dist', r.dist.toFixed(1))
    setText('dest', r.dest)
    setText('flight', r.flight + '  ' + r.origin + '-' + r.dest)
    setText('wind', String(Math.round(r.windDir)).padStart(3, '0') + '/' + Math.round(r.windKt) +
      '  ' + (r.headwind >= 0 ? 'H' : 'T') + Math.abs(Math.round(r.headwind)))
    setText('papi', r.papi || '—')
    setText('camera', L.cameras[r.camera] || r.camera)
    setText('time', r.timeScale + '×')
    setText('assist', r.assist ? L.on : L.off)
    setText('fps', Math.round(r.fps))
    setText('input', r.pad ? L.gamepad : L.keyboard)
  }

  /* --- Controls around the canvas ---------------------------------------- */
  const flSel = stage.querySelector('[data-sim-flight]')
  if (flSel) flSel.addEventListener('change', () => {
    sim.setFlight(flSel.value)
    sim.setScenario(scSel ? scSel.value : sim.scenario)
  })
  const acSel = stage.querySelector('[data-sim-aircraft]')
  const scSel = stage.querySelector('[data-sim-scenario]')
  if (acSel) acSel.addEventListener('change', () => {
    sim.setAircraft(acSel.value)
    sim.setScenario(scSel ? scSel.value : sim.scenario)
  })
  if (scSel) scSel.addEventListener('change', () => sim.setScenario(scSel.value))

  for (const btn of stage.querySelectorAll('[data-sim-action]')) {
    btn.addEventListener('click', () => {
      const a = btn.getAttribute('data-sim-action')
      if (a === 'pause') sim.setPaused(!sim.paused)
      else if (a === 'reset') sim.setScenario(sim.scenario)
      else if (a === 'camera') sim.cameraMode = (sim.cameraMode + 1) % 4
      else if (a === 'assist') { sim.ac.assist = !sim.ac.assist; handleEvent({ type: 'assist', on: sim.ac.assist }) }
      // Give the keys back to the simulator after a mouse press, or the next
      // key stroke goes to the button that still has focus.
      sim.canvas.focus()
    })
  }

  // A pointer press anywhere on the stage returns keyboard focus to the sim.
  mount.addEventListener('pointerdown', () => sim.canvas.focus())
  // The canvas is focusable so the sim can own the arrow keys without stealing
  // them from the rest of the page.
  sim.canvas.tabIndex = 0

  // Stop flying when the tab is hidden: an aeroplane that kept descending in a
  // background tab would be on the ground by the time anyone looked again.
  const onVis = () => { if (document.hidden) sim.setPaused(true) }
  document.addEventListener('visibilitychange', onVis)

  sim.start()
  return {
    sim,
    destroy() {
      document.removeEventListener('visibilitychange', onVis)
      sim.destroy()
    },
  }
}
