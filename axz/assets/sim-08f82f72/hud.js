/* ==========================================================================
   AXZ sim — the instrument panel.

   SVG and DOM over the canvas, not drawn inside it. Three reasons, in order:
   the panel then uses the site's real subset fonts instead of a bitmap glyph
   atlas; the numbers are selectable text a screen reader can reach; and it
   scales with the page rather than with the framebuffer.

   Layout follows a PFD, because a simmer reads one without being taught:
   speed tape left, attitude centre, altitude and vertical speed right.

   THE LAYOUT RULE, and the bug it exists to prevent. The configuration line —
   throttle, flaps, gear, brakes, spoilers — used to be written at y=30 and
   y=50 across the middle of the panel, and the attitude ball is a disc of
   radius 98 centred at y=142, so its top edge is at y=44. Everything from the
   gear indication inward was drawn UNDER the ball: on the runway the word for
   "gear down" was a green smear behind a yellow bank pointer. Nothing here may
   overlap anything else, so the panel is built as four horizontal bands with
   gaps between them, and every element declares which band it lives in.

     band 1   y   4 ..  44   configuration rail, full width
     band 2   y  60 .. 284   instruments: tapes, ball, vertical speed
     band 3   y 294 .. 326   heading strip, centred
     band 4   corners        flight identity and camera, clear of all of it
   ========================================================================== */

import { clamp, MS_TO_FPM, MS_TO_KT, M_TO_FT, RAD, KM_TO_NM } from './math.js'

const NS = 'http://www.w3.org/2000/svg'
const el = (tag, attrs = {}, parent = null) => {
  const n = document.createElementNS(NS, tag)
  for (const k in attrs) n.setAttribute(k, attrs[k])
  if (parent) parent.appendChild(n)
  return n
}

const W = 1000                 // viewBox width
const ADI_X = 500, ADI_Y = 172, ADI_R = 96
const RAIL_Y = 4, RAIL_H = 40
const HDG_Y = 318

export class HUD {
  /**
   * @param root   the instrument band, anchored to the bottom of the stage
   * @param L      localised labels, from the catalogue
   * @param stage  the whole stage. The cockpit shell mounts HERE and not in
   *               the band: the band is 40% tall and absolutely positioned, so
   *               a shell inside it is laid out against the band rather than
   *               against the picture, and the windscreen ends up squashed
   *               into the bottom third with the countryside showing through
   *               the glareshield.
   */
  constructor(root, L, stage) {
    this.root = root
    this.stage = stage || root
    this.L = L
    this.build()
  }

  build() {
    const L = this.L
    const svg = el('svg', {
      class: 'sim-pfd', viewBox: `0 0 ${W} 340`,
      preserveAspectRatio: 'xMidYMax meet',
      role: 'img', 'aria-label': L.pfdLabel,
    })
    /* --- The cockpit shell --------------------------------------------------
       Drawn BEHIND the instruments and shown only in the first-person view.
       Before this, "cockpit" was a camera position and nothing else: the
       horizon filled the frame, the flight display floated in the middle of
       it, and there was nothing to say you were sitting in an aeroplane rather
       than flying alongside one.

       It is a drawn shell rather than modelled geometry for the same reason
       the panel is SVG: it has to scale with the page, it must not cost a
       frame, and everything it covers is behind the aeroplane's own structure
       anyway — which is to say, it hides only what a real windscreen hides. */
    /* Part one: the WINDOW FRAME. Its own element, stretched over the whole
       stage, because a windscreen post has to reach the top of the picture and
       the instrument panel is anchored to the bottom of it. It aligns with
       nothing and needs to align with nothing. */
    /* The whole shell lives in ONE full-bleed drawing, stretched edge to edge
       over the stage. That is not a style choice, it is the only way it works:
       the instrument panel keeps its aspect ratio and is letterboxed inside
       its band, so anything drawn in the panel's coordinates stops short of
       the sides of the screen. Built that way the glareshield left a wedge of
       open countryside down each edge of the flight deck.

       Everything here is a fraction of the same 1000 x 1000 box, and the CSS
       gives the instrument band the matching 40% of the stage, so the panel
       ends exactly where the instruments begin. */
    const DECK = 600            // top of the glareshield, per mille of height
    const shell = el('svg', {
      class: 'sim-cockpit', viewBox: '0 0 1000 1000',
      preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false',
    })
    // Coaming across the top of the windscreen, dipping in the middle.
    el('path', { d: 'M0 0 L1000 0 L1000 44 Q500 104 0 44 Z', class: 'sim-ck-coam' }, shell)
    // Window posts down each side, splayed the way a windscreen frame is, and
    // stopping at the glareshield rather than running across the instruments.
    el('path', { d: `M0 0 L104 0 Q64 300 56 ${DECK} L0 ${DECK} Z`, class: 'sim-ck-post' }, shell)
    el('path', { d: `M1000 0 L896 0 Q936 300 944 ${DECK} L1000 ${DECK} Z`, class: 'sim-ck-post' }, shell)
    // The centre post, between the two windscreen panes.
    el('path', { d: `M492 0 L508 0 L506 ${DECK} L494 ${DECK} Z`, class: 'sim-ck-post' }, shell)
    // The glareshield itself, and the lit lip along its leading edge.
    el('path', { d: `M0 1000 L0 ${DECK} Q500 ${DECK - 34} 1000 ${DECK} L1000 1000 Z`, class: 'sim-ck-panel' }, shell)
    el('path', { d: `M0 ${DECK} Q500 ${DECK - 34} 1000 ${DECK}`, class: 'sim-ck-lip' }, shell)
    this.stage.appendChild(shell)
    this.shell = shell

    this.root.appendChild(svg)
    this.svg = svg

    /* --- Band 1: the configuration rail ------------------------------------
       Seven chips across the full width, each a box with a caption above the
       value inside it. Boxes rather than loose text because the panel sits
       over a moving scene, and a caption in 11 px grey over a cloud is not
       readable however carefully it is coloured. */
    this.modes = el('g', { class: 'sim-rail' }, svg)
    this.modeTexts = {}
    this.modeBoxes = {}
    const chips = [
      ['thr', L.throttle], ['n1', L.n1], ['flap', L.flaps], ['gear', L.gear],
      ['spd', L.spoilers], ['brk', L.brakes], ['mach', L.machLabel],
    ]
    const gap = 8
    const cw = (W - gap * (chips.length + 1)) / chips.length
    chips.forEach(([key, label], i) => {
      const x = gap + i * (cw + gap)
      const box = el('rect', {
        x, y: RAIL_Y, width: cw, height: RAIL_H, rx: 2, class: 'sim-chip',
      }, this.modes)
      const t = el('text', {
        x: x + 9, y: RAIL_Y + 15, class: 'sim-chip-l', 'text-anchor': 'start',
      }, this.modes)
      t.textContent = label
      this.modeTexts[key] = el('text', {
        x: x + cw - 9, y: RAIL_Y + 32, class: 'sim-chip-v', 'text-anchor': 'end',
      }, this.modes)
      this.modeBoxes[key] = box
    })

    /* --- Band 2: attitude ---------------------------------------------------
       The horizon rotates and slides behind a fixed aircraft symbol, which is
       the way the real instrument works: the world moves, you do not. */
    const clip = el('clipPath', { id: 'sim-adi-clip' }, svg)
    el('circle', { cx: ADI_X, cy: ADI_Y, r: ADI_R }, clip)

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
      const r1 = ADI_R, r2 = ADI_R - (a % 30 === 0 ? 12 : 7)
      const rad = (a - 90) * Math.PI / 180
      el('line', {
        x1: ADI_X + Math.cos(rad) * r1, y1: ADI_Y + Math.sin(rad) * r1,
        x2: ADI_X + Math.cos(rad) * r2, y2: ADI_Y + Math.sin(rad) * r2,
        class: 'sim-bank-tick',
      }, bankG)
    }
    this.bankPtr = el('path', {
      d: `M${ADI_X} ${ADI_Y - ADI_R + 2} l-8 14 l16 0 Z`, class: 'sim-bank-ptr',
    }, svg)
    el('path', {
      d: `M${ADI_X - 62} ${ADI_Y} h34 l10 12 l10 -12 h34`,
      class: 'sim-aircraft-sym',
    }, svg)
    el('circle', { cx: ADI_X, cy: ADI_Y, r: ADI_R, class: 'sim-adi-ring' }, svg)

    /* --- Band 2: tapes ------------------------------------------------------ */
    this.spdTape = this.tape(svg, 168, ADI_Y, L.speed, 'kt')
    this.altTape = this.tape(svg, 832, ADI_Y, L.altitude, 'ft')

    // Vertical speed, as a needle rather than a number: rate is a trend and a
    // needle shows a trend, which is why every aeroplane has one.
    const vsX = 940
    el('line', { x1: vsX, y1: ADI_Y - 92, x2: vsX, y2: ADI_Y + 92, class: 'sim-vs-rail' }, svg)
    for (const v of [-2000, -1000, 0, 1000, 2000]) {
      const y = ADI_Y - this.vsY(v)
      el('line', { x1: vsX - 6, y1: y, x2: vsX + 6, y2: y, class: 'sim-bank-tick' }, svg)
    }
    this.vsNeedle = el('line', { x1: vsX, y1: ADI_Y, x2: vsX - 18, y2: ADI_Y, class: 'sim-vs-needle' }, svg)
    this.vsText = el('text', { x: vsX - 4, y: ADI_Y - 100, class: 'sim-small', 'text-anchor': 'middle' }, svg)
    this.vsX = vsX

    /* Radio altimeter, in the lower part of the attitude display where an
       EFIS puts it, and blank above 2,500 ft as a real one is. Below the ball
       it collided with the heading strip: 274 to 304 against 294 to 324, which
       is exactly the kind of overlap this layout exists to prevent. */
    this.raBox = el('rect', {
      x: ADI_X - 52, y: ADI_Y + 48, width: 104, height: 28, rx: 2, class: 'sim-ra-box',
    }, svg)
    this.raText = el('text', {
      x: ADI_X, y: ADI_Y + 68, class: 'sim-ra', 'text-anchor': 'middle',
    }, svg)

    /* --- Band 3: heading ---------------------------------------------------- */
    el('rect', { x: ADI_X - 160, y: HDG_Y - 24, width: 320, height: 30, class: 'sim-box' }, svg)
    this.hdgTicks = el('g', {}, svg)
    this.hdgClip = el('clipPath', { id: 'sim-hdg-clip' }, svg)
    el('rect', { x: ADI_X - 160, y: HDG_Y - 24, width: 320, height: 30 }, this.hdgClip)
    this.hdgTicks.setAttribute('clip-path', 'url(#sim-hdg-clip)')
    el('path', { d: `M${ADI_X} ${HDG_Y - 26} l-6 -9 l12 0 Z`, class: 'sim-bank-ptr' }, svg)
    this.hdgX = ADI_X; this.hdgY = HDG_Y

    /* --- Band 4: identity --------------------------------------------------
       Flight, type and phase bottom left; camera bottom right. In a window
       these repeat what the panel under the canvas already says, which is why
       they were not here before — but fullscreen has no panel under the
       canvas, and an instrument display you cannot tell the aeroplane from is
       not finished. */
    this.idText = el('text', { x: 10, y: HDG_Y - 2, class: 'sim-id', 'text-anchor': 'start' }, svg)
    this.camText = el('text', { x: W - 10, y: HDG_Y - 2, class: 'sim-id', 'text-anchor': 'end' }, svg)

    /* --- Warnings -----------------------------------------------------------
       Boxed, and over the upper half of the ball where a real EFIS puts its
       alerts. The box is the point: red letters alone were unreadable against
       a bright sky and invisible against brown terrain. */
    this.warnBox = el('rect', {
      x: ADI_X - 120, y: ADI_Y - 84, width: 240, height: 34, rx: 2, class: 'sim-warn-box',
    }, svg)
    this.warn = el('text', {
      x: ADI_X, y: ADI_Y - 60, class: 'sim-warn', 'text-anchor': 'middle',
    }, svg)

    /* --- Live text mirror --------------------------------------------------
       The SVG is decorative to assistive tech; this is the readable state, and
       it is polite so it never interrupts. */
    this.live = document.createElement('p')
    this.live.className = 'sim-live sr-only'
    this.live.setAttribute('role', 'status')
    this.root.appendChild(this.live)
    this.liveTick = 0
  }

  vsY(fpm) { return clamp(fpm / 2000, -1, 1) * 88 }

  tape(svg, cx, cy, label, unit) {
    const g = el('g', {}, svg)
    const w = 104, h = 196
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
      `translate(${ADI_X} ${ADI_Y}) rotate(${(-e.bank * RAD).toFixed(2)}) translate(0 ${px.toFixed(1)})`)
    this.bankPtr.setAttribute('transform',
      `rotate(${(-e.bank * RAD).toFixed(2)} ${ADI_X} ${ADI_Y})`)

    this.paintTape(this.spdTape, kt, 20, 1.9)
    this.paintTape(this.altTape, ft, 500, 0.13, v => String(Math.round(v)))

    // Low-speed cue: the band below the stall, drawn from the model's own
    // current stall speed rather than a fixed number, so flaps move it.
    const vs = ac.stallSpeedKt()
    const cueTop = this.spdTape.cy + (kt - vs) * 1.9
    this.spdTape.cue.setAttribute('y', Math.max(cueTop, this.spdTape.cy - 98))
    this.spdTape.cue.setAttribute('height', Math.max(0, Math.min(this.spdTape.cy + 98 - cueTop, 196)))

    const vy = this.vsY(fpm)
    this.vsNeedle.setAttribute('y1', ADI_Y - vy)
    this.vsNeedle.setAttribute('y2', ADI_Y - vy)
    this.vsText.textContent = (fpm >= 0 ? '+' : '') + Math.round(fpm / 10) * 10

    // Heading strip.
    while (this.hdgTicks.firstChild) this.hdgTicks.removeChild(this.hdgTicks.firstChild)
    let hdg = (e.heading * RAD + 360) % 360
    for (let d = -70; d <= 70; d += 10) {
      const val = Math.round((hdg + d) / 10) * 10
      const x = this.hdgX + (val - hdg) * 2.4
      if (x < this.hdgX - 156 || x > this.hdgX + 156) continue
      const shown = ((val % 360) + 360) % 360
      el('line', { x1: x, y1: this.hdgY - 24, x2: x, y2: this.hdgY - 17, class: 'sim-ladder' }, this.hdgTicks)
      const t = el('text', { x, y: this.hdgY - 2, class: 'sim-tape-t', 'text-anchor': 'middle' }, this.hdgTicks)
      t.textContent = shown === 0 ? 'N' : shown === 90 ? 'E' : shown === 180 ? 'S' : shown === 270 ? 'W'
        : String(shown / 10).padStart(2, '0')
    }

    /* The configuration rail. Throttle is lever position; N1 is what the
       engines have actually reached, and on a big fan those two are seconds
       apart — which is the whole reason a go-around is a decision you make
       early. A type with a burner shows it here instead of a number over 100. */
    const ab = ac.abFrac || 0
    this.modeTexts.thr.textContent = Math.round(ac.throttle * 100) + '%'
    this.setChip('n1', ab > 0.02 ? L.reheat : Math.round(ac.thrustLag * 100) + '%', ab > 0.02 ? 'hot' : '')
    // A single-detent wing has no flap lever to report, and printing "0" for
    // Concorde would imply there was a setting it was not at.
    this.modeTexts.flap.textContent = ac.flaps.length < 2 ? L.none
      : ac.flapDeg === 0 ? L.up : String(ac.flapDeg)
    this.setChip('gear', ac.gearPos > 0.98 ? L.down : ac.gearPos < 0.02 ? L.up : '···',
      ac.gearPos > 0.98 ? 'on' : ac.gearPos < 0.02 ? '' : 'warn')
    this.setChip('brk', ac.parkingBrake ? L.park : ac.brakes > 0.5 ? L.on : L.off,
      ac.parkingBrake || ac.brakes > 0.5 ? 'warn' : '')
    this.setChip('spd', ac.spoilers > 0.5 ? L.on : L.off, ac.spoilers > 0.5 ? 'warn' : '')
    // Mach matters on two of the eleven and is quietly informative on the rest.
    const mach = ac.mach || 0
    this.setChip('mach', mach.toFixed(2), mach >= 1 ? 'hot' : '')

    /* Radio altimeter: blank above 2,500 ft, which is what a real one does. */
    const ra = (ac.radioAlt != null ? ac.radioAlt : ac.agl) * M_TO_FT
    const raOn = ra < 2500 && !ac.onGround
    this.raBox.setAttribute('opacity', raOn ? '1' : '0')
    this.raText.textContent = raOn ? 'RA ' + Math.round(ra / 5) * 5 : ''

    // One warning at a time, in the order a pilot would want it.
    let w = ''
    if (ac.crashed) w = L.crashed
    else if (ac.stalling) w = L.stall
    else if (ac.overspeed) w = L.overspeed
    else if (!ac.onGround && ac.radioAlt < 150 && ac.vel.y < -8 && ac.gearPos < 0.5) w = L.pullup
    else if (!ac.onGround && ac.radioAlt < 300 && ac.gearPos < 0.5 && ac.vel.y < 0) w = L.gearWarn
    this.warn.textContent = w
    this.warn.setAttribute('class', 'sim-warn' + (w ? ' is-on' : ''))
    this.warnBox.setAttribute('opacity', w ? '1' : '0')

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

  /** Identity block. Set when the aeroplane or the camera changes, not per frame. */
  setIdentity(flight, reg, camera) {
    if (this.idText) this.idText.textContent = `${flight}  ${reg}`
    if (this.camText) this.camText.textContent = camera
  }

  /** A rail chip's value and its state colour. */
  setChip(key, text, state) {
    const t = this.modeTexts[key]
    if (!t) return
    t.textContent = text
    t.setAttribute('class', 'sim-chip-v' + (state ? ' is-' + state : ''))
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
