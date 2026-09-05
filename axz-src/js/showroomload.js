/* ==========================================================================
   AXZ showroom loader: the same arrangement as the hangar's. Nothing on the
   other pages; on the showroom page, waits for the stage to come into view,
   checks WebGL2, then dynamic-imports the viewer, Three.js and all.
   ========================================================================== */
;(function () {
  'use strict'
  var stage = document.querySelector('[data-showroom-stage]')
  if (!stage) return
  var status = stage.querySelector('[data-showroom-status]')
  var src = stage.getAttribute('data-showroom-src')
  var models, labels
  try { models = JSON.parse(stage.getAttribute('data-showroom-models')); labels = JSON.parse(stage.getAttribute('data-showroom-labels')) } catch (e) { return }
  function hasWebGL2() { try { return !!document.createElement('canvas').getContext('webgl2') } catch (e) { return false } }
  function say(t, kind) { if (!status) return; status.textContent = t; if (kind) status.setAttribute('data-kind', kind); else status.removeAttribute('data-kind') }
  var started = false
  function start() {
    if (started) return
    started = true
    if (!hasWebGL2()) { say(labels.unsupported, 'error'); stage.setAttribute('data-showroom-state', 'unsupported'); return }
    say(labels.loading); stage.setAttribute('data-showroom-state', 'loading')
    import(src).then(function (mod) { return mod.boot({ stage: stage, models: models, labels: labels, initial: stage.getAttribute('data-showroom-initial') }) })
      .then(function (h) {
        if (!h || h.error) { say(h && h.error === 'no-webgl' ? labels.unsupported : h && h.error === 'offline' ? labels.offline : labels.failed, 'error'); stage.setAttribute('data-showroom-state', 'failed'); return }
        stage.setAttribute('data-showroom-state', 'running')
      }).catch(function (err) { say(labels.failed, 'error'); stage.setAttribute('data-showroom-state', 'failed'); if (window.console) console.error('[axz-showroom]', err) })
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) { for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) { io.disconnect(); start(); return } }, { rootMargin: '200px 0px' })
    io.observe(stage)
  } else start()
})();
