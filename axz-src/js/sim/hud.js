/* ==========================================================================
   AXZ sim — the instrument panel.

   SVG and DOM over the canvas, not drawn inside it. Three reasons, in order:
   the panel then uses the site's real subset fonts instead of a bitmap glyph
   atlas; the numbers are selectable text a screen reader can reach; and it
   scales with the page rather than with the framebuffer.

   Layout follows a PFD, because a simmer reads one without being taught:
   speed tape left, attitude centre, altitude and vertical speed right.
   ========================================================================== */

import { clamp, MS_TO_FPM, MS_TO_KT, M_TO_FT, RAD, KM_TO_NM } from './math.js'

const NS = 'http://www.w3.org/2000/svg'
const el = (tag, attrs = {}, parent = null) => {
  const n = document.createElementNS(NS, tag)
  for (const k in attrs) n.setAttribute(k, attrs[k])
  if (parent) parent.appendChild(n)
  return n
}

export class HUD {
  constructor(root, L) {
    this.root = root
    this.L = L                       // localised labels, from the catalogue
    this.build()
  }

  build() {
    const L = this.L
    const svg = el('svg', {
      class: 'sim-pfd', viewBox: '0 0 900 300',
      preserveAspectRatio: 'xMidYMax meet',
      role: 'img', 'aria-label': L.pfdLabel,
    })
    this.root.appendChild(svg)
    this.svg = svg

    /* --- Attitude ---------------------------------------------------------
       The horizon rotates and slides behind a fixed aircraft symbol, which is
       the way the real instrument works: the world moves, you do not. */
    const adiX = 450, adiY = 142, adiR = 98
    const clip = el('clipPath', { id: 'sim-adi-clip' }, svg)
    el('circle', { cx: adiX, cy: adiY, r: adiR }, clip)

    const adi = el('g', { 'clip-path': 'url(#sim-adi-clip)' }, svg)
    this.horizon = el('g', {}, adi)
    el('rect', { x: -700, y: -700, width: 1400, height: 700, class: 'sim-sky' }, this.horizon)
    el('rect', { x: -700, y: 0, width: 1400, height: 700, class: 'sim-ground' }, this.horizon)
    el('line', { x1: -700, y1: 0, x2: 700, y2: 0, class: 'sim-horizon-line' }, this.horizon)
    // Pitch ladder, every 10 degrees, long bars on the tens.
    for (let d = -90; d <= 90; d += 10) {
      if (d === 0) continue
      const y = -d * 3.4
      const w = d % 20 === 0 ? 46 : 28
      el('line', { x1: -w, y1: y, x2: w, y2: y, class: 'sim-ladder' }, this.horizon)
      const t = el('text', { x: -w - 8, y: y + 4, class: 'sim-ladder-t', 'text-anchor': 'end' }, this.horizon)
      t.textContent = String(Math.abs(d))
    }

    // Fixed symbols: bank pointer and the aircraft reference.
    const bankG = el('g', {}, svg)
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r1 = adiR, r2 = adiR - (a % 30 === 0 ? 12 : 7)
      const rad = (a - 90) * Math.PI / 180
      el('line', {
        x1: adiX + Math.cos(rad) * r1, y1: adiY + Math.sin(rad) * r1,
        x2: adiX + Math.cos(rad) * r2, y2: adiY + Math.sin(rad) * r2,
        class: 'sim-bank-tick',
      }, bankG)
    }
    this.bankPtr = el('path', { d: `M${adiX} ${adiY - adiR + 2} l-8 14 l16 0 Z`, class: 'sim-bank-ptr' }, svg)
    el('path', {
      d: `M${adiX - 62} ${adiY} h34 l10 12 l10 -12 h34`,
      class: 'sim-aircraft-sym',
    }, svg)
    el('circle', { cx: adiX, cy: adiY, r: adiR, class: 'sim-adi-ring' }, svg)

    /* --- Speed tape -------------------------------------------------------- */
    this.spdTape = this.tape(svg, 150, adiY, L.speed, 'kt')
    this.altTape = this.tape(svg, 750, adiY, L.altitude, 'ft')

    // Vertical speed, as a needle rather than a number: rate is a trend and a
    // needle shows a trend, which is why every aeroplane has one.
    const vsX = 856
    el('line', { x1: vsX, y1: adiY - 96, x2: vsX, y2: adiY + 96, class: 'sim-vs-rail' }, svg)
    for (const v of [-2000, -1000, 0, 1000, 2000]) {
      const y = adiY - this.vsY(v)
      el('line', { x1: vsX - 6, y1: y, x2: vsX + 6, y2: y, class: 'sim-bank-tick' }, svg)
    }
    this.vsNeedle = el('line', { x1: vsX, y1: adiY, x2: vsX + 18, y2: adiY, class: 'sim-vs-needle' }, svg)
    this.vsText = el('text', { x: vsX + 4, y: adiY - 104, class: 'sim-small', 'text-anchor': 'middle' }, svg)

    /* --- Heading ----------------------------------------------------------- */
    const hdgY = 268
    el('rect', { x: adiX - 150, y: hdgY - 22, width: 300, height: 30, class: 'sim-box' }, svg)
    this.hdgTicks = el('g', {}, svg)
    this.hdgClip = el('clipPath', { id: 'sim-hdg-clip' }, svg)
    el('rect', { x: adiX - 150, y: hdgY - 22, width: 300, height: 30 }, this.hdgClip)
    this.hdgTicks.setAttribute('clip-path', 'url(#sim-hdg-clip)')
    el('path', { d: `M${adiX} ${hdgY - 24} l-6 -9 l12 0 Z`, class: 'sim-bank-ptr' }, svg)
    this.hdgX = adiX; this.hdgY = hdgY

    /* --- Mode line: gear, flaps, brakes, throttle, assist ------------------ */
    this.modes = el('g', {}, svg)
    this.modeTexts = {}
    const modeDefs = [
      // Spread across the gap BETWEEN the two tapes. Chinese labels are wider
      // than their English counterparts, and at the old spacing 起落架 and 刹车
      // ran into each other.
      ['thr', 268, L.throttle], ['flap', 372, L.flaps], ['gear', 466, L.gear],
      ['brk', 558, L.brakes], ['spd', 648, L.spoilers],
    ]
    for (const [key, x, label] of modeDefs) {
      const t = el('text', { x, y: 30, class: 'sim-mode-l', 'text-anchor': 'middle' }, this.modes)
      t.textContent = label
      this.modeTexts[key] = el('text', { x, y: 50, class: 'sim-mode-v', 'text-anchor': 'middle' }, this.modes)
    }

    /* --- Warnings ---------------------------------------------------------- */
    this.warn = el('text', { x: adiX, y: 96, class: 'sim-warn', 'text-anchor': 'middle' }, svg)

    /* --- Live text mirror --------------------------------------------------
       The SVG is decorative to assistive tech; this is the readable state, and
       it is polite so it never interrupts. */
    this.live = document.createElement('p')
    this.live.className = 'sim-live sr-only'
    this.live.setAttribute('role', 'status')
    this.root.appendChild(this.live)
    this.liveTick = 0
  }

  vsY(fpm) { return clamp(fpm / 2000, -1, 1) * 90 }

  tape(svg, cx, cy, label, unit) {
    const g = el('g', {}, svg)
    const w = 104, h = 200
    el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, class: 'sim-box' }, g)
    const cid = `sim-tape-${cx}`
    const clip = el('clipPath', { id: cid }, g)
    el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h }, clip)
    const inner = el('g', { 'clip-path': `url(#${cid})` }, g)
    const ticks = el('g', {}, inner)
    // The readout box sits on the centreline and never moves.
    el('rect', { x: cx - w / 2 - 4, y: cy - 17, width: w + 8, height: 34, class: 'sim-readout' }, g)
    const value = el('text', { x: cx, y: cy + 7, class: 'sim-value', 'text-anchor': 'middle' }, g)
    const cap = el('text', { x: cx, y: cy - h / 2 - 8, class: 'sim-small', 'text-anchor': 'middle' }, g)
    cap.textContent = `${label} (${unit})`
    const cue = el('rect', { x: cx - w / 2, y: cy, width: 6, height: 0, class: 'sim-cue' }, inner)
    return { g, ticks, value, cue, cx, cy, w, h }
  }

  /** Redraw a tape's moving scale around the current value. */
  paintTape(tape, value, step, pxPerUnit, fmt) {
    const { ticks, cx, cy, h } = tape
    while (ticks.firstChild) ticks.removeChild(ticks.firstChild)
    const span = h / 2 + step
    const first = Math.floor((value - span / pxPerUnit) / step) * step
    const last = Math.ceil((value + span / pxPerUnit) / step) * step
    for (let v = first; v <= last; v += step) {
      const y = cy + (value - v) * pxPerUnit
      if (y < cy - h / 2 - 12 || y > cy + h / 2 + 12) continue
      el('line', { x1: cx + tape.w / 2 - 14, y1: y, x2: cx + tape.w / 2, y2: y, class: 'sim-ladder' }, ticks)
      const t = el('text', { x: cx + tape.w / 2 - 20, y: y + 4, class: 'sim-tape-t', 'text-anchor': 'end' }, ticks)
      t.textContent = fmt ? fmt(v) : String(v)
    }
    tape.value.textContent = fmt ? fmt(Math.round(value)) : String(Math.round(value))
  }

  update(ac, view, dt) {
    const L = this.L
    const e = view.euler
    const kt = ac.ias * MS_TO_KT
    const ft = ac.pos.y * M_TO_FT
    const fpm = ac.vel.y * MS_TO_FPM

    // Attitude: translate for pitch, rotate for bank, about the ADI centre.
    const px = -e.pitch * RAD * 3.4
    this.horizon.setAttribute('transform',
      `translate(450 142) rotate(${(-e.bank * RAD).toFixed(2)}) translate(0 ${px.toFixed(1)})`)
    this.bankPtr.setAttribute('transform',
      `rotate(${(-e.bank * RAD).toFixed(2)} 450 142)`)

    this.paintTape(this.spdTape, kt, 20, 1.9)
    this.paintTape(this.altTape, ft, 500, 0.13, v => String(Math.round(v)))

    // Low-speed cue: the band below the stall, drawn from the model's own
    // current stall speed rather than a fixed number, so flaps move it.
    const vs = ac.stallSpeedKt()
    const cueTop = this.spdTape.cy + (kt - vs) * 1.9
    this.spdTape.cue.setAttribute('y', Math.max(cueTop, this.spdTape.cy - 100))
    this.spdTape.cue.setAttribute('height', Math.max(0, Math.min(this.spdTape.cy + 100 - cueTop, 200)))

    const vy = this.vsY(fpm)
    this.vsNeedle.setAttribute('y1', 140 - vy)
    this.vsNeedle.setAttribute('y2', 140 - vy)
    this.vsText.textContent = (fpm >= 0 ? '+' : '') + Math.round(fpm / 10) * 10

    // Heading strip.
    while (this.hdgTicks.firstChild) this.hdgTicks.removeChild(this.hdgTicks.firstChild)
    let hdg = (e.heading * RAD + 360) % 360
    for (let d = -60; d <= 60; d += 10) {
      const val = Math.round((hdg + d) / 10) * 10
      const x = this.hdgX + (val - hdg) * 2.4
      if (x < this.hdgX - 148 || x > this.hdgX + 148) continue
      const shown = ((val % 360) + 360) % 360
      el('line', { x1: x, y1: this.hdgY - 22, x2: x, y2: this.hdgY - 15, class: 'sim-ladder' }, this.hdgTicks)
      const t = el('text', { x, y: this.hdgY, class: 'sim-tape-t', 'text-anchor': 'middle' }, this.hdgTicks)
      t.textContent = shown === 0 ? 'N' : shown === 90 ? 'E' : shown === 180 ? 'S' : shown === 270 ? 'W'
        : String(shown / 10).padStart(2, '0')
    }

    this.modeTexts.thr.textContent = Math.round(ac.throttle * 100) + '%'
    this.modeTexts.flap.textContent = ac.flapDeg === 0 ? L.up : String(ac.flapDeg)
    this.modeTexts.gear.textContent = ac.gearPos > 0.98 ? L.down : ac.gearPos < 0.02 ? L.up : '···'
    this.modeTexts.gear.setAttribute('class', 'sim-mode-v' + (ac.gearPos > 0.98 ? ' is-on' : ''))
    this.modeTexts.brk.textContent = ac.parkingBrake ? L.park : ac.brakes > 0.5 ? L.on : L.off
    this.modeTexts.spd.textContent = ac.spoilers > 0.5 ? L.on : L.off

    // One warning at a time, in the order a pilot would want it.
    let w = ''
    if (ac.crashed) w = L.crashed
    else if (ac.stalling) w = L.stall
    else if (ac.overspeed) w = L.overspeed
    else if (!ac.onGround && ac.radioAlt < 150 && ac.vel.y < -8 && ac.gearPos < 0.5) w = L.pullup
    else if (!ac.onGround && ac.radioAlt < 300 && ac.gearPos < 0.5 && ac.vel.y < 0) w = L.gearWarn
    this.warn.textContent = w
    this.warn.setAttribute('class', 'sim-warn' + (w ? ' is-on' : ''))

    // Throttle the live region hard: once a second is informative, sixty times
    // a second is a screen reader that never stops talking.
    this.liveTick += dt
    if (this.liveTick > 1.2) {
      this.liveTick = 0
      this.live.textContent =
        `${L.speed} ${Math.round(kt)} kt, ${L.altitude} ${Math.round(ft)} ft, ` +
        `${L.heading} ${Math.round(hdg).toString().padStart(3, '0')}, ` +
        `${L.vs} ${Math.round(fpm)} ${L.fpm}` + (w ? `. ${w}` : '')
    }
  }
}

/* --- Navigation strip -----------------------------------------------------
   Distance and bearing to the destination, plus the deviation from the
   extended centreline once you are close enough for it to mean anything.   */
export function navInfo(ac, dest) {
  const dx = dest.x - ac.pos.x, dz = dest.z - ac.pos.z
  const distM = Math.hypot(dx, dz)
  let brg = Math.atan2(dx, -dz) * RAD
  if (brg < 0) brg += 360
  return {
    distNm: (distM / 1000) * KM_TO_NM,
    bearing: brg,
    distM,
  }
}
