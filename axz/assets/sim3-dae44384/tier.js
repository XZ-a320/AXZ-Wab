/* ==========================================================================
   AXZ sim 3.0 — which engine this device gets.

   Decided once, on the press, BEFORE the 3.0 engine is fetched: a phone
   should not download an engine it cannot run. `chooseTier` is pure so the
   rule can be tested; `probeEnvironment` is the one function that touches
   the browser.

   3.0 is Three.js with real data; vintage is 2.0 (Three.js, procedural);
   classic is 1.0 (raw WebGL1). Three.js 0.170 needs WebGL2, so a machine
   without it goes to classic, not vintage.
   ========================================================================== */

export const TIERS = ['v3', 'vintage', 'classic']
export const LOW_END = /Mali-G5\d|Adreno \(TM\) 5\d\d|Intel\(R\) HD Graphics 4\d\d\d/i

export function readTierOverride(search) {
  const v = new URLSearchParams(search || '').get('tier')
  if (v === '3' || v === 'v3') return 'v3'
  if (v === 'vintage' || v === 'classic') return v
  return null
}

export function chooseTier(env) {
  if (env.override && TIERS.includes(env.override)) return env.override
  if (!env.webgl2) return 'classic'
  if (env.maxTouchPoints > 1 && env.innerWidth < 900) return 'vintage'
  if (env.deviceMemory != null && env.deviceMemory < 4) return 'vintage'
  if (env.renderer && LOW_END.test(env.renderer)) return 'vintage'
  return 'v3'
}

export function probeEnvironment(win) {
  const nav = win.navigator || {}
  let webgl2 = false, renderer = ''
  try {
    const gl = win.document.createElement('canvas').getContext('webgl2')
    webgl2 = !!gl
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info')
      renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER))
    }
  } catch (e) { webgl2 = false }
  return {
    override: readTierOverride(win.location ? win.location.search : ''),
    maxTouchPoints: nav.maxTouchPoints || 0,
    innerWidth: win.innerWidth || 0,
    deviceMemory: nav.deviceMemory,
    webgl2, renderer,
  }
}
