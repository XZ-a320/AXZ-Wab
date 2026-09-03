/* ==========================================================================
   AXZ sim — keyboard and gamepad.

   A keyboard has no analogue axis and no spring back to centre, so a raw
   key-down cannot drive a control surface directly: it would be full
   deflection, instantly, every time. Keys therefore RAMP toward full and
   spring back when released, which is what a yoke does anyway.

   A gamepad has both, so its sticks go straight through — with a deadzone and
   a squared response, because the first fifteen percent of a worn thumbstick
   is noise and fine control near centre is where a landing is won.
   ========================================================================== */

import { clamp, approach } from './math.js'

/** Named actions, so the on-screen reference and the handler cannot drift. */
export const BINDINGS = [
  { id: 'pitch', keys: ['KeyS/KeyW', 'ArrowDown/ArrowUp'], kind: 'axis' },
  { id: 'roll', keys: ['KeyA/KeyD', 'ArrowLeft/ArrowRight'], kind: 'axis' },
  { id: 'yaw', keys: ['KeyQ/KeyE'], kind: 'axis' },
  { id: 'throttle', keys: ['ShiftLeft/ControlLeft'], kind: 'axis' },
  { id: 'gear', keys: ['KeyG'], kind: 'toggle' },
  { id: 'flapDown', keys: ['KeyF'], kind: 'press' },
  { id: 'flapUp', keys: ['KeyV'], kind: 'press' },
  { id: 'spoilers', keys: ['KeyX'], kind: 'toggle' },
  { id: 'brakes', keys: ['KeyB'], kind: 'hold' },
  { id: 'parking', keys: ['KeyP'], kind: 'toggle' },
  { id: 'trimUp', keys: ['Comma'], kind: 'press' },
  { id: 'trimDown', keys: ['Period'], kind: 'press' },
  { id: 'camera', keys: ['KeyC'], kind: 'press' },
  { id: 'assist', keys: ['KeyN'], kind: 'toggle' },
  { id: 'slower', keys: ['BracketLeft'], kind: 'press' },
  { id: 'faster', keys: ['BracketRight'], kind: 'press' },
  { id: 'reset', keys: ['KeyR'], kind: 'press' },
  { id: 'fullscreen', keys: ['KeyZ'], kind: 'press' },
  { id: 'pause', keys: ['Escape'], kind: 'press' },
  // 2.0
  { id: 'autopilot', keys: ['KeyH'], kind: 'toggle' },
  { id: 'lights', keys: ['KeyL'], kind: 'toggle' },
  { id: 'reverse', keys: ['KeyT'], kind: 'toggle' },
]

// Keys the sim consumes. Anything not in here keeps its browser behaviour, so
// Tab still moves focus and the page never becomes a keyboard trap.
const OWNED = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyG', 'KeyF', 'KeyV', 'KeyX',
  'KeyB', 'KeyP', 'KeyC', 'KeyN', 'KeyR', 'KeyZ', 'Comma', 'Period',
  'BracketLeft', 'BracketRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ControlLeft', 'Space',
  'KeyH', 'KeyL', 'KeyT',
  // Escape was listed in BINDINGS and documented in the control table but was
  // missing here, so the pause key silently did nothing.
  'Escape',
])

// Escape keeps its default behaviour as well as pausing: preventing it would
// take away the browser's own way out of fullscreen, which on a phone is the
// only way out.
const NO_PREVENT = new Set(['Escape'])

export class Input {
  constructor(target, scope) {
    this.keys = new Set()
    this.pressed = new Set()          // edge-triggered, cleared every frame
    this.axes = { pitch: 0, roll: 0, yaw: 0 }
    this.throttle = 0
    this.pad = null
    this.padName = ''
    this.usingPad = false
    this.enabled = false
    /* Pitch sense. There is no standard for which way a flight stick's Y axis
       runs: a gamepad's left stick reads negative when pushed away, and this
       whole file is written to that convention, but a real sidestick may
       report the opposite and the Thrustmaster Airbus units do. There is no
       way to know from the API which kind of device is attached, so the sense
       is a setting, pre-set from the device name and overridable by hand. */
    this.invertPitch = false
    this.pitchAuto = true

    this.onKeyDown = e => {
      if (!this.enabled) return
      // Never swallow a shortcut the browser or the page owns.
      if (e.metaKey || e.altKey || e.ctrlKey && e.code !== 'ControlLeft') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (!OWNED.has(e.code)) return
      /* Only when the simulator has focus. The listener is on window, so
         without this check WASD moved the elevator while somebody was reading
         the control table further down the page, and Space scrolled nothing
         because the sim had eaten it. */
      if (!this.hasFocus()) return
      if (!NO_PREVENT.has(e.code)) e.preventDefault()
      if (!this.keys.has(e.code)) this.pressed.add(e.code)
      this.keys.add(e.code)
    }
    this.onKeyUp = e => {
      if (!OWNED.has(e.code)) return
      this.keys.delete(e.code)
    }
    // Losing the window with a key held would leave the aeroplane in a turn.
    this.onBlur = () => this.keys.clear()

    this.target = target || window
    this.scope = scope || null
    window.addEventListener('keydown', this.onKeyDown, { passive: false })
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('gamepadconnected', e => {
      this.padName = e.gamepad.id
      this.usingPad = true
      if (this.pitchAuto) this.invertPitch = Input.wantsInvertedPitch(e.gamepad.id)
    })
    window.addEventListener('gamepaddisconnected', () => {
      this.padName = ''
      this.usingPad = false
    })
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  /** True when the canvas, or anything inside the sim stage, holds focus. */
  hasFocus() {
    const a = document.activeElement
    if (!a) return false
    if (a === this.target) return true
    return !!(this.scope && this.scope.contains(a))
  }

  down(code) { return this.keys.has(code) }
  hit(code) { return this.pressed.has(code) }

  /**
   * Does this device report pitch the opposite way round from a gamepad?
   * Flight sticks generally do — a yoke or sidestick pulled back is a positive
   * Y on the HID report, where a thumbstick pushed forward is negative — and
   * the Thrustmaster Airbus sidestick is the one that was reported.
   */
  static wantsInvertedPitch(id) {
    return /thrustmaster|tca|airbus|sidestick|joystick|flight|yoke|t\.?16000|warthog|logitech extreme|saitek/i.test(id || '')
  }

  static dead(v, dz = 0.12) {
    const m = Math.abs(v)
    if (m < dz) return 0
    // Squared past the deadzone: coarse at the edges, fine near centre.
    const n = (m - dz) / (1 - dz)
    return Math.sign(v) * n * n
  }

  poll(dt) {
    const gp = navigator.getGamepads ? navigator.getGamepads() : []
    let pad = null
    for (const g of gp) if (g && g.connected && g.mapping === 'standard') { pad = g; break }
    if (!pad) for (const g of gp) if (g && g.connected) { pad = g; break }
    /* A pad plugged in before this page loaded never fires `gamepadconnected`,
       so the pitch sense is settled the first time one is actually seen. */
    if (pad && pad.id !== this.padName) {
      this.padName = pad.id
      if (this.pitchAuto) this.invertPitch = Input.wantsInvertedPitch(pad.id)
    }
    this.pad = pad

    // Keyboard targets, ramped. Two key sets per axis so WASD and the arrows
    // both work without either shadowing the other.
    const kx = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0)
    // Pitch follows the GAMEPAD's sign, where pulling a stick back reads
    // negative. S and Down are "pull back", so they must be negative too, or
    // the two input devices fly the aeroplane in opposite directions.
    const ky = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0)
    const kz = (this.down('KeyE') ? 1 : 0) - (this.down('KeyQ') ? 1 : 0)

    let tPitch = ky, tRoll = kx, tYaw = kz
    let padActive = false

    if (pad) {
      const a = pad.axes
      const ax0 = Input.dead(a[0] || 0), ax1 = Input.dead(a[1] || 0)
      const ax2 = Input.dead(a[2] || 0)
      if (ax0 || ax1 || ax2) padActive = true
      if (ax0) tRoll = ax0
      if (ax1) tPitch = this.invertPitch ? -ax1 : ax1
      if (ax2) tYaw = ax2

      // Triggers: analogue where the pad reports it, digital where it does not.
      const b = pad.buttons
      const lt = b[6] ? (b[6].value || (b[6].pressed ? 1 : 0)) : 0
      const rt = b[7] ? (b[7].value || (b[7].pressed ? 1 : 0)) : 0
      if (rt > 0.02 || lt > 0.02) {
        padActive = true
        this.throttle = clamp(this.throttle + (rt - lt) * 0.8 * dt, 0, 1)
      }
      if (b[4] && b[4].pressed) { tYaw = -1; padActive = true }
      if (b[5] && b[5].pressed) { tYaw = 1; padActive = true }

      // Buttons are edge-triggered into the same set the keyboard uses, so the
      // rest of the sim never has to ask which device an action came from.
      this.padEdge(b, 0, 'KeyG')          // A      gear
      this.padEdge(b, 2, 'KeyF')          // X      flaps down
      this.padEdge(b, 3, 'KeyV')          // Y      flaps up
      this.padEdge(b, 9, 'Escape')        // Start  pause
      this.padEdge(b, 8, 'KeyR')          // Back   reset
      this.padEdge(b, 10, 'KeyC')         // L3     camera
      this.padEdge(b, 12, 'Comma')        // D-up   trim up
      this.padEdge(b, 13, 'Period')       // D-down trim down
      this.padEdge(b, 11, 'KeyX')         // R3     spoilers
      this.padEdge(b, 14, 'KeyL')         // D-left  landing lights
      this.padEdge(b, 15, 'KeyH')         // D-right autopilot
      this.brakeHeld = !!(b[1] && b[1].pressed)
      if (padActive) this.usingPad = true
    } else {
      this.brakeHeld = false
    }

    if (!padActive && (kx || ky || kz)) this.usingPad = false

    // Keyboard axes ramp; a stick's own value is already the position.
    const rate = padActive ? 60 : 4.2
    const centre = padActive ? 60 : 6.0
    // Pitch ramps slower than roll on a keyboard. A flare is the one input on
    // the whole aeroplane that needs finesse, and at the roll rate a held key
    // reached full deflection in half a second and ballooned every landing.
    const pitchRate = padActive ? 60 : 2.4
    this.axes.pitch = approach(this.axes.pitch, tPitch, tPitch === 0 ? centre : pitchRate, dt)
    this.axes.roll = approach(this.axes.roll, tRoll, tRoll === 0 ? centre : rate, dt)
    this.axes.yaw = approach(this.axes.yaw, tYaw, tYaw === 0 ? centre : rate, dt)

    if (this.down('ShiftLeft')) this.throttle = clamp(this.throttle + 0.55 * dt, 0, 1)
    if (this.down('ControlLeft')) this.throttle = clamp(this.throttle - 0.55 * dt, 0, 1)

    this.brakes = (this.down('Space') || this.brakeHeld) ? 1 : (this.down('KeyB') ? 1 : 0)
  }

  padEdge(buttons, index, code) {
    const b = buttons[index]
    if (!b) return
    this._padPrev = this._padPrev || {}
    const now = !!b.pressed
    if (now && !this._padPrev[index]) this.pressed.add(code)
    this._padPrev[index] = now
  }

  endFrame() { this.pressed.clear() }
}

/* ==========================================================================
   Gyroscope.

   A phone has no keyboard and a thumb on glass is a poor yoke, but it does
   have the one thing a keyboard never had: two real analogue axes, in the
   attitude of the device itself. Tilting a phone to fly an aeroplane is the
   most natural mapping available on that hardware.

   Three things make it usable rather than a novelty:

   CALIBRATION. There is no correct way to hold a phone, so "neutral" is
   wherever the device was when the pilot switched this on, and can be re-taken
   at any time. Without it you have to hold the phone dead flat, which nobody
   does and which is uncomfortable within a minute.

   SCREEN ROTATION. beta and gamma are reported in the DEVICE frame. In
   landscape, the device's long axis is horizontal, so beta and gamma have
   swapped roles and one of them has flipped sign. Ignoring that gives controls
   that are rotated ninety degrees from the picture, which reads as the sim
   being broken.

   SMOOTHING. Raw orientation is noisy at the tenth-of-a-degree level and hands
   shake. The signal is low-passed before it becomes a control input.
   ========================================================================== */
export class Gyro {
  constructor() {
    this.available = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window
    this.active = false
    this.needsPermission = !!(this.available &&
      typeof DeviceOrientationEvent.requestPermission === 'function')
    this.raw = { pitch: 0, roll: 0 }
    this.neutral = { pitch: 0, roll: 0 }
    this.smooth = { pitch: 0, roll: 0 }
    this.got = false
    // Degrees of tilt for full deflection. Twenty-two is about as far as a
    // wrist goes comfortably without losing sight of the screen.
    this.range = { pitch: 22, roll: 26 }
    this.onOrient = e => this.read(e)
  }

  /** Must be called from a user gesture on iOS, which gates the sensor. */
  async enable() {
    if (!this.available) return false
    if (this.needsPermission) {
      try {
        const res = await DeviceOrientationEvent.requestPermission()
        if (res !== 'granted') return false
      } catch (e) { return false }
    }
    window.addEventListener('deviceorientation', this.onOrient)
    this.active = true
    this.got = false
    return true
  }

  disable() {
    window.removeEventListener('deviceorientation', this.onOrient)
    this.active = false
  }

  screenAngle() {
    const so = window.screen && window.screen.orientation
    if (so && typeof so.angle === 'number') return so.angle
    return typeof window.orientation === 'number' ? window.orientation : 0
  }

  read(e) {
    if (e.beta == null || e.gamma == null) return
    const b = e.beta, g = e.gamma
    // Rotate the device-frame tilt into the frame the picture is drawn in.
    let pitch, roll
    switch (((this.screenAngle() % 360) + 360) % 360) {
      case 90: pitch = -g; roll = b; break
      case 180: pitch = -b; roll = -g; break
      case 270: pitch = g; roll = -b; break
      default: pitch = b; roll = g
    }
    this.raw.pitch = pitch
    this.raw.roll = roll
    if (!this.got) { this.calibrate(); this.got = true }
  }

  /** Take the current attitude as neutral. */
  calibrate() {
    this.neutral.pitch = this.raw.pitch
    this.neutral.roll = this.raw.roll
    this.smooth.pitch = 0
    this.smooth.roll = 0
  }

  /**
   * Control axes in the same -1..1 convention the gamepad uses, so the sim
   * never has to ask where an input came from.
   */
  sample(dt) {
    if (!this.active || !this.got) return null
    const dp = this.raw.pitch - this.neutral.pitch
    const dr = this.raw.roll - this.neutral.roll
    // Low-pass, frame-rate independent.
    const k = 1 - Math.exp(-11 * dt)
    this.smooth.pitch += (dp - this.smooth.pitch) * k
    this.smooth.roll += (dr - this.smooth.roll) * k

    const dead = 1.4                    // degrees of slop around neutral
    const shape = (v, range) => {
      const m = Math.abs(v)
      if (m < dead) return 0
      const n = clamp((m - dead) / (range - dead), 0, 1)
      // Squared, like the stick: fine near neutral, quick at the edges.
      return Math.sign(v) * n * n
    }
    return {
      // Tilting the top of the phone AWAY from you pushes the nose down, which
      // is the same direction a stick goes.
      pitch: shape(this.smooth.pitch, this.range.pitch),
      roll: shape(this.smooth.roll, this.range.roll),
    }
  }
}
