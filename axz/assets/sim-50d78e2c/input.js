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
  { id: 'pause', keys: ['Escape'], kind: 'press' },
]

// Keys the sim consumes. Anything not in here keeps its browser behaviour, so
// Tab still moves focus and the page never becomes a keyboard trap.
const OWNED = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyG', 'KeyF', 'KeyV', 'KeyX',
  'KeyB', 'KeyP', 'KeyC', 'KeyN', 'KeyR', 'Comma', 'Period',
  'BracketLeft', 'BracketRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ControlLeft', 'Space',
])

export class Input {
  constructor(target) {
    this.keys = new Set()
    this.pressed = new Set()          // edge-triggered, cleared every frame
    this.axes = { pitch: 0, roll: 0, yaw: 0 }
    this.throttle = 0
    this.pad = null
    this.padName = ''
    this.usingPad = false
    this.enabled = false

    this.onKeyDown = e => {
      if (!this.enabled) return
      // Never swallow a shortcut the browser or the page owns.
      if (e.metaKey || e.altKey || e.ctrlKey && e.code !== 'ControlLeft') return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (!OWNED.has(e.code)) return
      e.preventDefault()
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
    window.addEventListener('keydown', this.onKeyDown, { passive: false })
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('gamepadconnected', e => {
      this.padName = e.gamepad.id
      this.usingPad = true
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

  down(code) { return this.keys.has(code) }
  hit(code) { return this.pressed.has(code) }

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
      if (ax1) tPitch = ax1
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
