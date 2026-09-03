/* ==========================================================================
   AXZ hangar loader.

   Lives in the ordinary site bundle and does nothing on any page without a
   hangar stage. On the hangar page it waits for the stage to come into view,
   checks for WebGL, then dynamic-imports the viewer — Three.js and all — so
   the page's own text arrives first and the 3D arrives when it is looked at.
   ========================================================================== */
;(function () {
  'use strict'
  var stage = document.querySelector('[data-hangar-stage]')
  if (!stage) return
  var status = stage.querySelector('[data-hangar-status]')
  var src = stage.getAttribute('data-hangar-src')
  var roster, labels
  try {
    roster = JSON.parse(stage.getAttribute('data-hangar-roster'))
    labels = JSON.parse(stage.getAttribute('data-hangar-labels'))
  } catch (e) { return }

  function hasWebGL() {
    try {
      var c = document.createElement('canvas')
      return !!(c.getContext('webgl2') || c.getContext('webgl'))
    } catch (e) { return false }
  }
  function say(text, kind) {
    if (!status) return
    status.textContent = text
    if (kind) status.setAttribute('data-kind', kind); else status.removeAttribute('data-kind')
  }

  var started = false
  function start() {
    if (started) return
    started = true
    if (!hasWebGL()) { say(labels.unsupported, 'error'); stage.setAttribute('data-hangar-state', 'unsupported'); return }
    say(labels.loading)
    stage.setAttribute('data-hangar-state', 'loading')
    import(src).then(function (mod) {
      return mod.boot({ stage: stage, roster: roster, labels: labels, initial: stage.getAttribute('data-hangar-initial') })
    }).then(function (h) {
      if (!h || h.error) {
        say(h && h.error === 'no-webgl' ? labels.unsupported : labels.failed, 'error')
        stage.setAttribute('data-hangar-state', 'failed')
        return
      }
      say('')
      stage.setAttribute('data-hangar-state', 'running')
    }).catch(function (err) {
      say(labels.failed, 'error')
      stage.setAttribute('data-hangar-state', 'failed')
      if (window.console) console.error('[axz-hangar]', err)
    })
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) if (entries[i].isIntersecting) { io.disconnect(); start(); return }
    }, { rootMargin: '200px 0px' })
    io.observe(stage)
  } else {
    start()
  }
})();
