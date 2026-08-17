/* ==========================================================================
   AXZ sim — phone mode.

   A phone is not a small desktop. It has no keyboard, the screen is the
   controls, and a 62vh canvas inside a scrolling article is unusable for
   something that needs both thumbs. So phone mode is a mode: fullscreen,
   landscape, gyro on the two primary axes, and the remaining controls as
   thumb targets in the corners where thumbs already are.

   The layout puts nothing in the middle. On a phone held in landscape the
   middle is where you are looking, and the left and right thirds are the only
   places a thumb reaches without moving your grip.
   ========================================================================== */

import { clamp } from './math.js'

/** Coarse pointer AND a small short edge: a phone or a small tablet. */
export function isPhone() {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  const short = Math.min(window.innerWidth, window.innerHeight) <= 820
  return !!(coarse && short)
}

export class MobileControls {
  /**
   * @param stage  the [data-sim-stage] element, which is what goes fullscreen
   * @param sim    the running Sim
   * @param L      localised labels
   */
  constructor(stage, sim, L) {
    this.stage = stage
    this.sim = sim
    this.L = L
    this.active = false
    this.root = null
    this.gyroOn = false
  }

  build() {
    if (this.root) return this.root
    const L = this.L
    const root = document.createElement('div')
    root.className = 'sim-touch'
    root.setAttribute('data-sim-touch', '')

    /* Throttle: a vertical strip on the left, dragged with the left thumb.
       A slider rather than +/- buttons because throttle is an analogue
       quantity and a jet spends its whole approach at a partial setting. */
    const thr = document.createElement('div')
    thr.className = 'sim-touch__thr'
    thr.innerHTML =
      '<span class="sim-touch__thrlabel">' + esc(L.throttle) + '</span>' +
      '<span class="sim-touch__thrfill" data-thr-fill></span>' +
      '<span class="sim-touch__thrval" data-thr-val>0%</span>'
    root.appendChild(thr)
    this.thrFill = thr.querySelector('[data-thr-fill]')
    this.thrVal = thr.querySelector('[data-thr-val]')

    const setThrottleFromPointer = ev => {
      const r = thr.getBoundingClientRect()
      const v = clamp(1 - (ev.clientY - r.top) / r.height, 0, 1)
      this.sim.input.throttle = v
      this.paintThrottle(v)
    }
    let thrDrag = false
    thr.addEventListener('pointerdown', e => {
      thrDrag = true
      thr.setPointerCapture(e.pointerId)
      setThrottleFromPointer(e)
      e.preventDefault()
    })
    thr.addEventListener('pointermove', e => { if (thrDrag) setThrottleFromPointer(e) })
    thr.addEventListener('pointerup', e => { thrDrag = false; thr.releasePointerCapture(e.pointerId) })
    thr.addEventListener('pointercancel', () => { thrDrag = false })

    /* Rudder: a horizontal strip along the bottom, sprung back to centre.
       Yaw is the one axis the gyro does not carry, and it is needed for
       crosswind landings and for steering on the ground. */
    const rud = document.createElement('div')
    rud.className = 'sim-touch__rud'
    rud.innerHTML = '<span class="sim-touch__rudknob" data-rud-knob></span>'
    root.appendChild(rud)
    this.rudKnob = rud.querySelector('[data-rud-knob]')
    let rudDrag = false
    const setRud = ev => {
      const r = rud.getBoundingClientRect()
      const v = clamp(((ev.clientX - r.left) / r.width) * 2 - 1, -1, 1)
      this.rudder = Math.abs(v) < 0.08 ? 0 : v
      this.rudKnob.style.insetInlineStart = ((this.rudder + 1) / 2 * 100) + '%'
    }
    rud.addEventListener('pointerdown', e => { rudDrag = true; rud.setPointerCapture(e.pointerId); setRud(e); e.preventDefault() })
    rud.addEventListener('pointermove', e => { if (rudDrag) setRud(e) })
    const rudRelease = () => { rudDrag = false; this.rudder = 0; this.rudKnob.style.insetInlineStart = '50%' }
    rud.addEventListener('pointerup', rudRelease)
    rud.addEventListener('pointercancel', rudRelease)
    this.rudder = 0

    /* Buttons, right side, thumb-sized. Brakes is press-and-hold; the rest
       are taps that map onto the same key codes everything else uses. */
    const pad = document.createElement('div')
    pad.className = 'sim-touch__pad'
    const mk = (code, label, hold) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'sim-touch__btn'
      b.textContent = label
      if (hold) {
        b.addEventListener('pointerdown', e => { this.brakeHeld = true; b.setAttribute('data-on', ''); e.preventDefault() })
        const off = () => { this.brakeHeld = false; b.removeAttribute('data-on') }
        b.addEventListener('pointerup', off)
        b.addEventListener('pointercancel', off)
      } else {
        b.addEventListener('click', e => { this.sim.input.pressed.add(code); e.preventDefault() })
      }
      pad.appendChild(b)
      return b
    }
    mk('KeyG', L.gear)
    mk('KeyF', L.flapsDown)
    mk('KeyV', L.flapsUp)
    mk('KeyX', L.spoilers)
    mk(null, L.brakes, true)
    mk('KeyC', L.view)
    root.appendChild(pad)
    this.brakeHeld = false

    /* Top bar: recentre the gyro, pause, restart, and leave. Small, out of the
       way, and never under a thumb that is flying. */
    const bar = document.createElement('div')
    bar.className = 'sim-touch__bar'
    const barBtn = (label, fn) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'sim-touch__barbtn'
      b.textContent = label
      b.addEventListener('click', e => { fn(); e.preventDefault() })
      bar.appendChild(b)
      return b
    }
    barBtn(L.recentre, () => { if (this.gyro) this.gyro.calibrate() })
    barBtn(L.pause, () => this.sim.setPaused(!this.sim.paused))
    barBtn(L.restart, () => this.sim.setScenario(this.sim.scenario))
    barBtn(L.exit, () => this.exit())
    root.appendChild(bar)

    this.root = root
    return root
  }

  paintThrottle(v) {
    if (this.thrFill) this.thrFill.style.height = (v * 100) + '%'
    if (this.thrVal) this.thrVal.textContent = Math.round(v * 100) + '%'
  }

  /** Feed the touch axes into the sim each frame. */
  apply() {
    if (!this.active) return
    const I = this.sim.input
    if (this.rudder) I.axes.yaw = this.rudder
    if (this.brakeHeld) I.brakes = 1
    this.paintThrottle(I.throttle)
  }

  async enter(gyro) {
    this.gyro = gyro
    const stage = this.stage
    stage.appendChild(this.build())
    stage.setAttribute('data-phone', 'true')
    this.active = true

    // Fullscreen, then landscape. The order matters: orientation cannot be
    // locked until the element is actually fullscreen.
    try {
      if (stage.requestFullscreen) await stage.requestFullscreen({ navigationUI: 'hide' })
      else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen()
    } catch (e) { /* iOS Safari refuses on non-video; the layout still works */ }
    try {
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape')
    } catch (e) { /* not supported, or the user has rotation locked */ }

    if (gyro) {
      const ok = await gyro.enable()
      this.gyroOn = ok
      if (ok) gyro.calibrate()
    }
    this.onFsChange = () => {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) this.exit(true)
    }
    document.addEventListener('fullscreenchange', this.onFsChange)
    this.sim.resize()
    // Give the canvas focus so a hardware keyboard, if there is one, still works.
    this.sim.canvas.focus()
    return true
  }

  exit(fromEvent) {
    if (!this.active) return
    this.active = false
    this.stage.removeAttribute('data-phone')
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root)
    if (this.gyro) this.gyro.disable()
    this.gyroOn = false
    document.removeEventListener('fullscreenchange', this.onFsChange)
    if (!fromEvent) {
      try {
        if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen()
        if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock()
      } catch (e) { /* nothing to undo */ }
    }
    this.sim.resize()
  }
}

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
