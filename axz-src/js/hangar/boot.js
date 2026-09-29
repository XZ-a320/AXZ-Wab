/* ==========================================================================
   AXZ hangar — page entry.

   One picker, one stage, two kinds of model. The 2.0 model is computed here
   from published dimensions and costs nothing to show; the 3.0 model is a
   sourced file from the assets origin and is fetched only when it is picked.
   Each has its own viewer on its own canvas inside the same mount, and only
   the one in view draws.

   Loaded as a dynamic import once the stage scrolls into view. Three.js and
   its addons resolve through the page's import map; the 3.0 half (glTF,
   Draco, the rig, the asset hub) is imported the first time it is needed.
   ========================================================================== */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { createHangar } from './models.js'
import { createViewer } from './viewer.js'

export function boot({ stage, roster, labels, initial }) {
  const root = document.documentElement
  const L = labels
  const mount = stage.querySelector('[data-hangar-mount]')
  if (!mount) return { error: 'no-mount' }
  const status = stage.querySelector('[data-hangar-status]')
  const say = (t, kind) => {
    if (!status) return
    status.textContent = t
    if (kind) status.setAttribute('data-kind', kind); else status.removeAttribute('data-kind')
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const theme = () => {
    const t = root.getAttribute('data-theme')
    if (t === 'day' || t === 'night') return t
    return 'night'
  }
  const motionOn = () => !(reduced || root.getAttribute('data-motion') === 'off')

  /* --- The page's two switches ------------------------------------------
     Both are STATES, so each carries its setting in words in the corner,
     the way the simulator's toggles do. */
  const spinBtn = stage.querySelector('[data-hangar-spin]')
  const exBtn = stage.querySelector('[data-hangar-exercise]')
  const exHint = stage.querySelector('[data-hangar-exhint]')
  const paint = (btn, on) => {
    if (!btn) return
    btn.setAttribute('aria-pressed', String(on))
    const st = btn.querySelector('.sim-tog__st')
    if (st) { st.textContent = on ? L.on : L.off; st.setAttribute('data-on', String(on)) }
  }
  let spin = motionOn()
  let exercise = true
  paint(spinBtn, spin)
  paint(exBtn, exercise)

  const onUserOrbit = () => { spin = false; paint(spinBtn, false) }

  /* --- 2.0 viewer: always available -------------------------------------- */
  const canvas = document.createElement('canvas')
  canvas.className = 'hangar-canvas'
  canvas.tabIndex = 0
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', L.canvas)
  mount.appendChild(canvas)
  let proc
  try {
    proc = createViewer(THREE, { OrbitControls, RoomEnvironment }, createHangar(THREE), { el: mount, canvas, theme, motionOn, onUserOrbit })
    proc.setAutoRotate(spin)
  } catch (e) {
    if (window.console) console.error('[axz-hangar]', e)
    return { error: 'no-webgl' }
  }

  /* --- 3.0 viewer: built on first use ------------------------------------ */
  let three = null
  function sourced() {
    if (three) return three
    three = (async () => {
      if (!document.createElement('canvas').getContext('webgl2')) return { error: 'unsupported3' }
      const [{ GLTFLoader }, { DRACOLoader }, { AssetHub }, { createViewer: createGltfViewer }] = await Promise.all([
        import('three/addons/loaders/GLTFLoader.js'),
        import('three/addons/loaders/DRACOLoader.js'),
        import('./assets.js'),
        import('./gltf.js'),
      ])
      const origin = new URLSearchParams(location.search).get('assets') || stage.getAttribute('data-hangar-assets') || ''
      const hub = new AssetHub({ origin, budgetBytes: 200 * 1024 * 1024 })
      await hub.load()
      if (!hub.online) return { error: 'offline' }
      const draco = new DRACOLoader()
      draco.setDecoderPath(`${hub.origin}/decoders/three-0.170.0/draco/`)
      draco.setDecoderConfig({ type: 'wasm' })
      const viewer = createGltfViewer(THREE, { OrbitControls, RoomEnvironment, GLTFLoader, draco }, mount, { canvasLabel: L.canvas }, { theme, onUserOrbit })
      viewer.setActive(false)
      viewer.setMotion(motionOn())
      viewer.setAutoRotate(spin)
      viewer.setExercise(exercise)
      return { hub, viewer }
    })().catch(err => {
      if (window.console) console.error('[axz-hangar]', err)
      return { error: 'failed3' }
    })
    return three
  }

  /* --- Readout ------------------------------------------------------------ */
  const picks = [...stage.querySelectorAll('[data-hangar-pick]')]
  const variantRow = stage.querySelector('[data-hangar-variants]')
  const cells = {}
  for (const c of stage.querySelectorAll('[data-hangar-field]')) cells[c.getAttribute('data-hangar-field')] = c
  const set = (k, v) => { if (cells[k]) cells[k].textContent = v }
  const desc = stage.querySelector('[data-hangar-desc]')
  const credit = stage.querySelector('[data-hangar-credit]')
  const fmt = (v, unit) => (v == null ? '—' : `${v}${unit ? ' ' + unit : ''}`)
  const mb = bytes => `${(bytes / 1048576).toFixed(1)} MB`

  function specCells(spec) {
    set('type', spec.name)
    set('reg', spec.reg || '—')
    set('length', fmt(spec.len.toFixed(2), 'm'))
    set('span', fmt(spec.span.toFixed(2), 'm'))
    set('height', fmt(spec.h.toFixed(2), 'm'))
    set('engines', spec.engineNote || String(spec.engines))
    set('mass', spec.mass ? fmt((spec.mass / 1000).toFixed(spec.mass < 10000 ? 2 : 0), 't') : '—')
    if (desc) desc.textContent = spec.note || ''
  }

  function paintVariants(spec, index) {
    if (!variantRow) return
    variantRow.replaceChildren(...spec.variants.map((v, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'btn hangar-variant'
      b.setAttribute('data-hangar-variant', String(i))
      b.setAttribute('aria-pressed', String(i === index))
      b.textContent = L.variants[v.key]
      b.addEventListener('click', () => show(spec.id, i))
      return b
    }))
  }

  function showProcedural(spec, note) {
    if (three) three.then(s => { if (s.viewer) s.viewer.setActive(false) })
    proc.setActive(true)
    on3 = false
    const group = proc.show(spec)
    let tris = 0
    group.traverse(o => { if (o.isMesh) { const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3 } })
    set('model', L.variants.procedural)
    set('triangles', Math.round(tris).toLocaleString('en-US'))
    set('animated', '—')
    set('size', L.noDownload)
    if (credit) credit.textContent = L.creditProcedural
    if (exBtn) exBtn.hidden = true
    if (exHint) exHint.hidden = true
    canvas.setAttribute('aria-label', `${L.canvas}: ${spec.name} · ${L.variants.procedural}`)
    say(note || '', note ? 'error' : null)
  }

  let token = 0
  let on3 = false          // the 3.0 viewer holds the mount
  async function show(id, index) {
    const spec = roster[id]
    if (!spec) return
    const my = ++token
    for (const b of picks) b.setAttribute('aria-pressed', String(b.getAttribute('data-hangar-pick') === id))
    const vi = index != null ? index : 0
    const v = spec.variants[vi]
    paintVariants(spec, vi)
    specCells(spec)
    stage.setAttribute('data-hangar-current', id)
    stage.setAttribute('data-hangar-variant', v.key)

    if (v.key === 'procedural') { showProcedural(spec); return }

    say(`${L.downloading} ${mb(v.bytes)}`)
    // Nothing on the floor yet: stand the 2.0 airframe there while the file comes down.
    if (!on3) { proc.show(spec); canvas.setAttribute('aria-label', `${L.canvas}: ${spec.name}`) }
    const s = await sourced()
    if (my !== token) return
    if (s.error) { markFallback(spec); showProcedural(spec, L[s.error]); return }
    try {
      const bytes = await s.hub.bytesOf(v.id)
      if (my !== token) return
      const st = await s.viewer.show(bytes, v.spec, v)
      if (my !== token) return
      proc.setActive(false)
      s.viewer.setActive(true)
      on3 = true
      set('model', L.variants[v.key])
      // The build's own count, so the figure does not change as the model lands.
      set('triangles', (v.triangles != null ? v.triangles : st.triangles).toLocaleString('en-US'))
      set('animated', v.animations ? String(v.animations) : st.animated ? String(st.animated) : '—')
      set('size', mb(v.bytes))
      if (credit) credit.innerHTML = v.creditHtml
      const moving = st.animated > 0
      if (exBtn) exBtn.hidden = !moving
      if (exHint) exHint.hidden = !moving
      s.viewer.canvas.setAttribute('aria-label', `${L.canvas}: ${spec.name} · ${L.variants[v.key]}`)
      say('')
    } catch (err) {
      if (window.console) console.error('[axz-hangar]', err)
      if (my !== token) return
      showProcedural(spec, L.failed3)
    }
  }
  /* When 3.0 cannot be drawn at all, the variant row says so by pressing 2.0. */
  function markFallback(spec) {
    const last = spec.variants.length - 1
    if (variantRow) for (const b of variantRow.children) b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-hangar-variant')) === last))
    stage.setAttribute('data-hangar-variant', 'procedural')
  }

  for (const b of picks) b.addEventListener('click', () => show(b.getAttribute('data-hangar-pick')))
  if (spinBtn) spinBtn.addEventListener('click', () => {
    spin = !spin; paint(spinBtn, spin)
    proc.setAutoRotate(spin)
    if (three) three.then(s => { if (s.viewer) s.viewer.setAutoRotate(spin) })
  })
  if (exBtn) exBtn.addEventListener('click', () => {
    exercise = !exercise; paint(exBtn, exercise)
    if (three) three.then(s => { if (s.viewer) s.viewer.setExercise(exercise) })
  })

  // Theme and motion are attributes on <html>; follow them live.
  new MutationObserver(() => {
    proc.applyTheme()
    if (three) three.then(s => { if (s.viewer) { s.viewer.applyTheme(); s.viewer.setMotion(motionOn()) } })
  }).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-motion'] })

  const first = initial && roster[initial] ? initial : Object.keys(roster)[0]
  const ready = show(first)
  const handle = { viewer: proc, show, roster, ready, get sourced() { return three } }
  window.__axzHangar = handle
  return handle
}
