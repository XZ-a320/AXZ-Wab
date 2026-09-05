/* ==========================================================================
   AXZ showroom — entry point. Loaded on a scroll into view, never before.
   ========================================================================== */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { AssetHub } from './assets.js'
import { createViewer } from './viewer.js'

export async function boot(cfg) {
  const stage = cfg.stage, L = cfg.labels
  const mount = stage.querySelector('[data-showroom-mount]')
  const status = stage.querySelector('[data-showroom-status]')
  const say = (t, kind) => { if (!status) return; status.textContent = t; if (kind) status.setAttribute('data-kind', kind); else status.removeAttribute('data-kind') }
  const origin = new URLSearchParams(location.search).get('assets') || stage.getAttribute('data-showroom-assets') || ''
  const hub = new AssetHub({ origin, budgetBytes: 200 * 1024 * 1024 })
  await hub.load()
  if (!hub.online) return { error: 'offline', detail: hub.error }
  let viewer
  try { viewer = createViewer(THREE, { OrbitControls, RoomEnvironment, GLTFLoader }, mount, L) } catch (err) { return { error: err && err.message === 'no-webgl' ? 'no-webgl' : 'failed', detail: String(err) } }

  const cells = {}
  for (const n of stage.querySelectorAll('[data-showroom-field]')) cells[n.getAttribute('data-showroom-field')] = n
  const set = (k, v) => { if (cells[k]) cells[k].textContent = v }
  const credit = stage.querySelector('[data-showroom-credit]')
  const buttons = [...stage.querySelectorAll('[data-showroom-pick]')]
  const models = cfg.models
  let loading = null

  async function pick(id) {
    const m = models.find(x => x.id === id)
    if (!m) return
    for (const b of buttons) b.setAttribute('aria-pressed', b.getAttribute('data-showroom-pick') === id ? 'true' : 'false')
    stage.setAttribute('data-showroom-current', id)
    loading = id
    say(`${L.loading} ${(m.bytes / 1048576).toFixed(1)} MB`)
    try {
      const bytes = await hub.bytesOf(id)
      if (loading !== id) return
      const st = await viewer.show(bytes, m.spec, m)
      if (loading !== id) return
      say('')
      set('parts', String(m.parts != null ? m.parts : '—'))
      set('triangles', st.triangles.toLocaleString())
      set('animated', String(st.animated))
      set('textures', String(m.textures != null ? m.textures : '—'))
      set('size', `${(m.bytes / 1048576).toFixed(1)} MB`)
      set('length', `${st.size[2].toFixed(1)} m`)
      if (credit) credit.innerHTML = m.creditHtml
    } catch (err) {
      say(L.failed, 'error'); if (window.console) console.error('[axz-showroom]', err)
    }
  }
  for (const b of buttons) b.addEventListener('click', () => pick(b.getAttribute('data-showroom-pick')))
  const motion = stage.querySelector('[data-showroom-motion]')
  if (motion) motion.addEventListener('click', () => { const on = motion.getAttribute('aria-pressed') !== 'true'; motion.setAttribute('aria-pressed', String(on)); viewer.setMotion(on) })
  const rigBtn = stage.querySelector('[data-showroom-rig]')
  if (rigBtn) rigBtn.addEventListener('click', () => { const on = rigBtn.getAttribute('aria-pressed') !== 'true'; rigBtn.setAttribute('aria-pressed', String(on)); viewer.setExercise(on) })
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce || localStorage.getItem('axz-motion') === 'off') { viewer.setMotion(false); if (motion) motion.setAttribute('aria-pressed', 'false') }

  await pick(cfg.initial || (models[0] && models[0].id))
  window.__axzShowroom = { viewer, hub, pick, models }
  return { viewer, hub, pick }
}
