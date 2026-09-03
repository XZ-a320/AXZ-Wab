/* ==========================================================================
   AXZ hangar — page entry.

   Loaded as a dynamic import once the stage scrolls into view. Three.js and
   its two addons resolve through the page's import map; the models and the
   viewer are siblings in this directory.
   ========================================================================== */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createHangar } from './models.js'
import { createViewer } from './viewer.js'

export function boot({ stage, roster, labels, initial }) {
  const root = document.documentElement
  const mount = stage.querySelector('[data-hangar-mount]')
  if (!mount) return { error: 'no-mount' }

  const canvas = document.createElement('canvas')
  canvas.className = 'hangar-canvas'
  canvas.tabIndex = 0
  canvas.setAttribute('role', 'img')
  mount.appendChild(canvas)

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const theme = () => {
    const t = root.getAttribute('data-theme')
    if (t === 'day' || t === 'night') return t
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'day'
  }
  const motionOn = () => !(reduced || root.getAttribute('data-motion') === 'off')

  let viewer
  try {
    const hangar = createHangar(THREE)
    viewer = createViewer(THREE, { OrbitControls, RoomEnvironment }, hangar, { el: mount, canvas, theme, motionOn })
  } catch (e) {
    if (window.console) console.error('[axz-hangar]', e)
    return { error: 'no-webgl' }
  }

  // Theme and motion are attributes on <html>; follow them live.
  new MutationObserver(() => viewer.applyTheme()).observe(root, { attributes: true, attributeFilter: ['data-theme'] })

  const picks = [...stage.querySelectorAll('[data-hangar-pick]')]
  const cells = {}
  for (const c of stage.querySelectorAll('[data-hangar-field]')) cells[c.getAttribute('data-hangar-field')] = c
  const desc = stage.querySelector('[data-hangar-desc]')
  const fmt = (v, unit) => (v == null ? '—' : `${v}${unit ? ' ' + unit : ''}`)

  function show(id) {
    const spec = roster[id]
    if (!spec) return
    viewer.show(spec)
    for (const b of picks) b.setAttribute('aria-pressed', String(b.getAttribute('data-hangar-pick') === id))
    if (cells.type) cells.type.textContent = spec.name
    if (cells.reg) cells.reg.textContent = spec.reg || '—'
    if (cells.length) cells.length.textContent = fmt(spec.len.toFixed(2), 'm')
    if (cells.span) cells.span.textContent = fmt(spec.span.toFixed(2), 'm')
    if (cells.height) cells.height.textContent = fmt(spec.h.toFixed(2), 'm')
    if (cells.engines) cells.engines.textContent = spec.engineNote || String(spec.engines)
    if (cells.mass) cells.mass.textContent = spec.mass ? fmt((spec.mass / 1000).toFixed(spec.mass < 10000 ? 2 : 0), 't') : '—'
    if (desc) desc.textContent = spec.note || ''
    canvas.setAttribute('aria-label', `${labels.canvas}: ${spec.name}`)
    stage.setAttribute('data-hangar-current', id)
  }

  for (const b of picks) b.addEventListener('click', () => show(b.getAttribute('data-hangar-pick')))
  show(initial && roster[initial] ? initial : Object.keys(roster)[0])

  const handle = { viewer, show, roster }
  window.__axzHangar = handle
  return handle
}
