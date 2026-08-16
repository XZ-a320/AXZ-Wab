/* ==========================================================================
   AXZ sim loader.

   Lives in the ordinary site bundle and does nothing at all on the other
   eleven pages. Its whole job is to hold the simulator back until someone
   asks for it, then fetch it and get out of the way.

   The engine is a dynamic import of an ES module. If the browser cannot do
   that, or has no WebGL, the page keeps its server-rendered description,
   control table and scoring bands, which is the whole of the information.
   ========================================================================== */
;(function () {
  'use strict'
  var stage = document.querySelector('[data-sim-stage]')
  if (!stage) return

  var startBtn = stage.querySelector('[data-sim-start]')
  var status = stage.querySelector('[data-sim-status]')
  var panel = stage.querySelector('[data-sim-panel]')
  if (!startBtn) return

  var src = stage.getAttribute('data-sim-src')
  var labels, fleet, flaps, bands
  try {
    labels = JSON.parse(stage.getAttribute('data-sim-labels'))
    fleet = JSON.parse(stage.getAttribute('data-sim-fleet'))
    // Four flap schedules shared by eleven types, so the table is carried once
    // rather than copied into every row of the fleet.
    flaps = JSON.parse(stage.getAttribute('data-sim-flaps'))
    bands = JSON.parse(stage.getAttribute('data-sim-bands'))
  } catch (e) { return }
  var audioBase = stage.getAttribute('data-sim-audio') || ''

  // WebGL is checked BEFORE the download: there is no reason to pull the
  // engine down on a machine that cannot run it.
  function hasWebGL() {
    try {
      var c = document.createElement('canvas')
      return !!(c.getContext('webgl2') || c.getContext('webgl'))
    } catch (e) { return false }
  }

  var handle = null
  startBtn.addEventListener('click', function () {
    if (handle) return
    if (!hasWebGL()) {
      status.textContent = labels.unsupported
      status.setAttribute('data-kind', 'error')
      startBtn.disabled = true
      return
    }
    startBtn.disabled = true
    status.textContent = labels.loading

    import(src).then(function (mod) {
      return mod.boot({
        stage: stage,
        labels: labels,
        fleet: fleet,
        flaps: flaps,
        audioBase: audioBase,
        bands: bands,
        aircraftId: (stage.querySelector('[data-sim-aircraft]') || {}).value,
        scenario: (stage.querySelector('[data-sim-scenario]') || {}).value,
      })
    }).then(function (h) {
      if (h && h.error) {
        status.textContent = h.error === 'no-webgl' ? labels.unsupported : labels.failed
        status.setAttribute('data-kind', 'error')
        startBtn.disabled = false
        return
      }
      handle = h
      status.textContent = ''
      stage.setAttribute('data-running', 'true')
      if (panel) panel.hidden = false
      startBtn.hidden = true
    }).catch(function (err) {
      status.textContent = labels.failed
      status.setAttribute('data-kind', 'error')
      startBtn.disabled = false
      if (window.console) console.error('[axz-sim]', err)
    })
  })
})();
