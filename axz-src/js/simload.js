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

    /* 3.0 pages carry a tier chooser. It is tiny, it runs BEFORE the engine
       is fetched, and if this device belongs on 2.0 or 1.0 it goes there
       now, engine unfetched, with the same hash so the reader lands on the
       same panel. */
    var tierSrc = stage.getAttribute('data-sim-tier-src')
    var choose = tierSrc
      ? import(tierSrc).then(function (T) {
          var tier = T.chooseTier(T.probeEnvironment(window))
          if (tier === 'v3') return src
          var href = stage.getAttribute(tier === 'vintage' ? 'data-sim-vintage-href' : 'data-sim-classic-href')
          window.location.href = href + window.location.hash
          return null
        })
      : Promise.resolve(src)

    choose.then(function (entry) {
      if (!entry) return null
      return import(entry).then(function (mod) {
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
      })
    }).then(function (h) {
      if (h === null) return
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
