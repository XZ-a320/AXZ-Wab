/* ==========================================================================
   AXZ sim — textures, drawn rather than downloaded.

   Every texture here is generated on a 2D canvas at start-up. That is not a
   purity exercise: image files would be network weight on a page that already
   defers its whole engine behind a button, they would need cache-busting
   filenames in a build that hashes directories, and a cloud puff is four lines
   of gradient code against a 40 KB PNG.

   It also means the livery can carry the airline's own wordmark and the
   B-1717 collaboration paint without shipping a single asset.
   ========================================================================== */

const cv = (w, h) => {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c
}

/* --- Soft puff ------------------------------------------------------------
   The workhorse: clouds, smoke, tyre puffs, contrails, wingtip vapour. A plain
   radial gradient reads as a billiard ball, so lobes of varying density are
   stamped inside it and the whole thing is masked by a soft falloff.        */
export function puffTexture(size = 192, { seed = 1, lobes = 11, hard = 0.0 } = {}) {
  const c = cv(size, size), g = c.getContext('2d')
  let s = seed * 9301 + 49297
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)

  g.clearRect(0, 0, size, size)
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < lobes; i++) {
    const a = rnd() * Math.PI * 2
    const d = rnd() * size * 0.20
    const x = size / 2 + Math.cos(a) * d
    const y = size / 2 + Math.sin(a) * d
    const r = size * (0.20 + rnd() * 0.22)
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, 'rgba(255,255,255,0.55)')
    grd.addColorStop(hard, 'rgba(255,255,255,0.42)')
    grd.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  // Circular mask so nothing touches the quad edge, which would show as a seam.
  g.globalCompositeOperation = 'destination-in'
  const m = g.createRadialGradient(size / 2, size / 2, size * 0.10, size / 2, size / 2, size * 0.5)
  m.addColorStop(0, 'rgba(255,255,255,1)')
  m.addColorStop(0.72, 'rgba(255,255,255,0.92)')
  m.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = m
  g.fillRect(0, 0, size, size)
  return c
}

/** A tight round dot: landing lights, PAPI, strobes, rain. */
export function dotTexture(size = 64, core = 0.16) {
  const c = cv(size, size), g = c.getContext('2d')
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(core, 'rgba(255,255,255,0.95)')
  grd.addColorStop(0.45, 'rgba(255,255,255,0.30)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return c
}

/* --- Trees ----------------------------------------------------------------
   Four variants on one sheet, picked per instance by UV. One texture bind for
   the whole landscape's vegetation.                                         */
export function treeSheet(size = 256) {
  const c = cv(size, size), g = c.getContext('2d')
  const q = size / 2
  const draw = (ox, oy, kind) => {
    g.save()
    g.translate(ox, oy)
    const trunk = '#3b3126'
    if (kind === 0 || kind === 2) {
      // Conifer: stacked triangles.
      g.fillStyle = trunk
      g.fillRect(q * 0.46, q * 0.70, q * 0.08, q * 0.26)
      const green = kind === 0 ? '#2f4a24' : '#33532a'
      g.fillStyle = green
      for (let i = 0; i < 3; i++) {
        const t = i / 3
        const w = q * (0.40 - t * 0.10), yTop = q * (0.08 + t * 0.22), yBot = q * (0.46 + t * 0.24)
        g.beginPath()
        g.moveTo(q * 0.5, yTop)
        g.lineTo(q * 0.5 - w, yBot)
        g.lineTo(q * 0.5 + w, yBot)
        g.closePath(); g.fill()
      }
    } else {
      // Broadleaf: a clump of overlapping discs.
      g.fillStyle = trunk
      g.fillRect(q * 0.47, q * 0.62, q * 0.07, q * 0.34)
      g.fillStyle = kind === 1 ? '#3a4f26' : '#44562c'
      for (const [dx, dy, r] of [[0, 0, 0.26], [-0.16, 0.08, 0.19], [0.16, 0.07, 0.19], [0, -0.14, 0.18]]) {
        g.beginPath()
        g.arc(q * (0.5 + dx), q * (0.40 + dy), q * r, 0, Math.PI * 2)
        g.fill()
      }
    }
    g.restore()
  }
  g.clearRect(0, 0, size, size)
  draw(0, 0, 0); draw(q, 0, 1); draw(0, q, 2); draw(q, q, 3)
  return c
}

/* --- Livery decals --------------------------------------------------------
   The wordmark on the fuselage and the fin. This is the only place in the
   simulator where the airline actually signs its own aeroplane, and it is the
   reason the texture module exists at all: the mark is TYPE, and type wants a
   texture rather than geometry.                                             */
export function fuselageDecal(text = 'AIR XIAO ZE', mark = 'AXZ', accent = '#00A2E8') {
  const w = 1024, h = 256
  const c = cv(w, h), g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  // Mark, heavy and italic, the way it sits on the site's own wordmark.
  g.fillStyle = '#15171B'
  g.font = 'italic 900 150px Archivo, Helvetica, Arial, sans-serif'
  g.textBaseline = 'middle'
  g.fillText(mark, 40, h * 0.42)
  const mw = g.measureText(mark).width
  g.fillStyle = accent
  g.fillRect(40, h * 0.70, mw, 16)
  g.fillStyle = '#43484F'
  g.font = '600 52px Archivo, Helvetica, Arial, sans-serif'
  g.fillText(text, 44 + mw + 34, h * 0.44)
  return c
}

/** The fin mark: big letters over the accent, plus the tagline underneath. */
export function finDecal(mark = 'AXZ', accent = '#00A2E8', ink = '#F3F0E9') {
  const w = 512, h = 512
  const c = cv(w, h), g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  g.fillStyle = ink
  g.font = 'italic 900 210px Archivo, Helvetica, Arial, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(mark, w / 2, h * 0.44)
  g.fillStyle = accent
  g.font = '700 54px Archivo, Helvetica, Arial, sans-serif'
  g.fillText('FLY ON TIME', w / 2, h * 0.68)
  return c
}

/* --- Minecraft collaboration ----------------------------------------------
   B-1717 is the fleet's collaboration aircraft, and the one fact the site
   repeats about it is 发誓永不退涂 — it swore it would never lose its paint.
   A blocky texture is the honest way to say "collaboration livery" without
   reproducing anybody's artwork: it is a grid of green squares, which is a
   pattern, not a character.                                                 */
export function blockDecal() {
  const w = 512, h = 128
  const c = cv(w, h), g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  const cell = 32
  const tones = ['#4f7a34', '#5c8a3c', '#436b2c', '#689646']
  let s = 7
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      if (rnd() < 0.22) continue                 // gaps, so it reads as pixels
      g.fillStyle = tones[(rnd() * tones.length) | 0]
      g.fillRect(x + 1, y + 1, cell - 2, cell - 2)
    }
  }
  return c
}

/* --- Cabin windows --------------------------------------------------------
   A row of windows as one strip. Geometry for forty windows would be forty
   times the triangles for something four pixels across at any useful range. */
export function windowStrip(count = 26) {
  const w = 1024, h = 64
  const c = cv(w, h), g = c.getContext('2d')
  g.clearRect(0, 0, w, h)
  const step = w / count
  for (let i = 0; i < count; i++) {
    const x = i * step + step * 0.30
    g.fillStyle = 'rgba(18,26,34,0.92)'
    const rw = step * 0.34, rh = h * 0.42
    const y = h * 0.30
    g.beginPath()
    if (g.roundRect) g.roundRect(x, y, rw, rh, rw * 0.35)
    else g.rect(x, y, rw, rh)
    g.fill()
  }
  return c
}

/** Terrain detail: a soft mottle multiplied over the elevation bands. */
export function groundDetail(size = 256) {
  const c = cv(size, size), g = c.getContext('2d')
  g.fillStyle = '#808080'
  g.fillRect(0, 0, size, size)
  let s = 3
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size, y = rnd() * size, r = 3 + rnd() * 22
    const v = 108 + rnd() * 52
    const grd = g.createRadialGradient(x, y, 0, x, y, r)
    grd.addColorStop(0, `rgba(${v},${v},${v},0.55)`)
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`)
    g.fillStyle = grd
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  return c
}

/* --- Shadow ---------------------------------------------------------------
   Drawn dark rather than tinted white, because it is painted by the decal
   program, which uses the texture's own colour. A billboard version of this
   stood up like a disc when viewed from behind at low level, so it is mapped
   onto a ground-aligned quad instead and this texture is what that quad wears.  */
export function shadowTexture(size = 128) {
  const c = cv(size, size), g = c.getContext('2d')
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  grd.addColorStop(0, 'rgba(14,16,14,0.62)')
  grd.addColorStop(0.45, 'rgba(14,16,14,0.40)')
  grd.addColorStop(1, 'rgba(14,16,14,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, size, size)
  return c
}
