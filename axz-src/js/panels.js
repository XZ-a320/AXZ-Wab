/* ==========================================================================
   AXZ panels — network map selection, base clocks, dispatch release, landing.

   Same rule as the rest of the site: every behaviour here is an enhancement.
   With scripts off the map is a finished drawing, the clocks name their time
   zone, the release shows the first flight already filled in, and the landing
   game never appears — its scoring table is server-rendered and carries the
   whole of the information the game would give you.
   ========================================================================== */

/* --- Route network selection ---------------------------------------------- */
;(function () {
  'use strict'
  var fig = document.querySelector('[data-netmap]')
  if (!fig) return

  var btns = fig.querySelectorAll('[data-net-select]')
  var clear = fig.querySelector('[data-net-clear]')
  var legs = fig.querySelectorAll('[data-net-leg]')

  function strips(flight) {
    var all = document.querySelectorAll('.strip[data-flight]')
    for (var i = 0; i < all.length; i++) {
      if (flight && all[i].getAttribute('data-flight') === flight) all[i].setAttribute('data-active', '')
      else all[i].removeAttribute('data-active')
    }
  }

  function select(id, flight, btn) {
    for (var i = 0; i < legs.length; i++) {
      if (legs[i].getAttribute('data-net-leg') === id) legs[i].setAttribute('data-active', '')
      else legs[i].removeAttribute('data-active')
    }
    for (var j = 0; j < btns.length; j++) btns[j].setAttribute('aria-pressed', String(btns[j] === btn))
    if (id) fig.setAttribute('data-selected', '')
    else fig.removeAttribute('data-selected')
    strips(flight)
  }

  for (var k = 0; k < btns.length; k++) {
    btns[k].addEventListener('click', function () {
      // A second press on the active button clears it, so the control can undo
      // itself without hunting for the separate "show all".
      var on = this.getAttribute('aria-pressed') === 'true'
      if (on) select(null, null, null)
      else select(this.getAttribute('data-net-select'), this.getAttribute('data-net-flight'), this)
    })
  }
  if (clear) clear.addEventListener('click', function () { select(null, null, null) })
})();

/* --- Base clocks -----------------------------------------------------------
   Real local time at each base, converted through the reader's own device.
   The cell starts out holding its IANA zone name, which is what a reader with
   no script sees, so nothing is blanked before it can be filled.            */
;(function () {
  'use strict'
  var cells = document.querySelectorAll('[data-clock]')
  if (!cells.length) return
  if (typeof Intl === 'undefined' || !Intl.DateTimeFormat) return

  var fmts = []
  for (var i = 0; i < cells.length; i++) {
    try {
      fmts.push(new Intl.DateTimeFormat('en-GB', {
        timeZone: cells[i].getAttribute('data-clock'),
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }))
    } catch (e) { fmts.push(null) }   // unknown zone: leave the name in place
  }

  var root = document.documentElement
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  function tick() {
    var now = new Date()
    for (var i = 0; i < cells.length; i++) {
      if (!fmts[i]) continue
      var t = fmts[i].format(now)
      if (cells[i].textContent === t) continue
      cells[i].textContent = t
      if (reduced || root.getAttribute('data-motion') === 'off') continue
      // Retrigger the flap by removing and re-adding the attribute.
      cells[i].removeAttribute('data-flip')
      void cells[i].offsetWidth
      cells[i].setAttribute('data-flip', '')
    }
  }
  tick()
  setInterval(tick, 1000)
})();

/* --- Dispatch release ------------------------------------------------------
   Both selects drive one document. The release is fully rendered server-side
   for the first flight, so with no script the page still shows a real release
   rather than an empty frame.                                                */
;(function () {
  'use strict'
  var root = document.querySelector('[data-dispatch]')
  if (!root) return

  var legs, acs
  try {
    legs = JSON.parse(root.getAttribute('data-legs'))
    acs = JSON.parse(root.getAttribute('data-ac'))
  } catch (e) { return }

  var legSel = root.querySelector('[data-disp-leg]')
  var acSel = root.querySelector('[data-disp-ac]')
  var flightCode = root.querySelector('[data-disp-flight]')
  var issued = root.querySelector('[data-disp-issued]')
  var dl = root.querySelector('[data-disp-download]')

  function current() {
    return { leg: legs[legSel.value], ac: acs[acSel.value] }
  }

  function paint() {
    var c = current()
    if (!c.leg || !c.ac) return
    var fs = root.querySelectorAll('[data-disp-f]')
    for (var i = 0; i < fs.length; i++) {
      var v = c.leg[fs[i].getAttribute('data-disp-f')]
      if (v != null) fs[i].textContent = v
    }
    var as = root.querySelectorAll('[data-disp-a]')
    for (var j = 0; j < as.length; j++) {
      var w = c.ac[as[j].getAttribute('data-disp-a')]
      if (w != null) as[j].textContent = w
    }
    if (flightCode) flightCode.textContent = c.leg.flight
  }

  legSel.addEventListener('change', paint)
  acSel.addEventListener('change', paint)
  paint()

  if (dl) {
    dl.addEventListener('click', function () {
      var stamp = new Date()
      var pad = function (n) { return n < 10 ? '0' + n : String(n) }
      var when = stamp.getFullYear() + '-' + pad(stamp.getMonth() + 1) + '-' + pad(stamp.getDate()) +
        ' ' + pad(stamp.getHours()) + ':' + pad(stamp.getMinutes())
      if (issued) issued.textContent = when

      // The file is assembled from what is on screen, so the download can never
      // disagree with the release the reader just read.
      var lines = []
      var head = root.querySelector('.release__head')
      if (head) lines.push(head.textContent.replace(/\s+/g, ' ').trim(), '')
      var dts = root.querySelectorAll('.release__body dt')
      var dds = root.querySelectorAll('.release__body dd')
      for (var i = 0; i < dts.length; i++) {
        lines.push(dts[i].textContent.trim() + ': ' + (dds[i] ? dds[i].textContent.trim() : ''))
      }
      var blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' })
      var url = URL.createObjectURL(blob)
      var a = document.createElement('a')
      a.href = url
      a.download = 'AXZ-' + (current().leg ? current().leg.flight : 'release') + '.txt'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(function () { URL.revokeObjectURL(url) }, 1000)
    })
  }
})();

/* --- Landing score ---------------------------------------------------------
   The aeroplane flies a constant descent; pressing flare arrests it. Touchdown
   vertical speed is whatever is left when the wheels arrive, so the score is a
   real consequence of when the key went down rather than a random draw.

   The game reveals itself only once this script runs. Its scoring table is in
   the markup either way — that table, not the game, is the information.      */
;(function () {
  'use strict'
  var host = document.querySelector('[data-landing]')
  if (!host) return
  var game = host.querySelector('[data-lg-game]')
  if (!game) return

  var startBtn = game.querySelector('[data-lg-start]')
  var flareBtn = game.querySelector('[data-lg-flare]')
  var altOut = game.querySelector('[data-lg-alt]')
  var result = game.querySelector('[data-lg-result]')
  var ship = game.querySelector('[data-lg-ship]')

  // Read the bands straight out of the rendered table so the game and the
  // static table can never disagree about what a number is worth.
  var bands = []
  var trs = host.querySelectorAll('.lg-table tbody tr')
  for (var i = 0; i < trs.length; i++) {
    var cells = trs[i].querySelectorAll('td')
    bands.push({ range: cells[0].textContent.trim(), remark: cells[1].textContent.trim() })
  }
  var unit = ''
  var th = host.querySelector('.lg-table thead th')
  if (th) { var m = th.textContent.match(/\(([^)]+)\)/); if (m) unit = m[1] }

  game.hidden = false

  /* The flare model, and why these four numbers.

     Descent is held at DESCENT until the flare goes in. The flare bleeds it off
     at ARREST down to SETTLE, and after that the aeroplane settles again at
     SINK as the speed decays — float, then drop, which is the behaviour the
     whole joke rests on.

     What that produces: no flare at all arrives at the full 500 and reads as a
     重着陆; flaring in the last few feet barely helps; the greaser sits around
     11 ft; and flaring far too high floats a long way and then drops in firmly
     anyway. SETTLE is deliberately non-zero, so an early flare always reaches
     the ground instead of hanging in level flight forever.                   */
  var raf = null, t0 = 0, alt = 0, vs = 0, flared = false, running = false
  var flareAlt = 0, elapsed = 0, settled = false
  var START_ALT = 45         // ft of radio altitude at the top of the run
  var DESCENT = 500          // ft/min down the slope
  var ARREST = 200           // ft/min shed per second once the flare goes in
  var SETTLE = 30            // ft/min the flare can never fully arrest
  var SINK = 50              // ft/min per second regained as the speed decays
  var CAP = 30               // seconds; a run always ends

  function place() {
    // Ship travels left to right and descends as the altitude comes off. In the
    // SVG's own units the ground line is y=170 and the runway is 6 units thick,
    // so y=164 puts the gear ON the runway; y grows DOWNWARD, which is why
    // altitude is subtracted here rather than added.
    var f = Math.max(0, Math.min(1, alt / START_ALT))
    var x = 60 + (1 - f) * 420
    var y = 162 - f * 104
    ship.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')')
  }

  function frame(ts) {
    if (!t0) t0 = ts
    var dt = Math.min((ts - t0) / 1000, 0.1)
    t0 = ts
    elapsed += dt
    // `settled` latches. Comparing vs against SETTLE each frame instead would
    // arrest and re-sink alternately and hold the aeroplane at SETTLE forever,
    // so an early flare would never touch down.
    if (flared) {
      if (!settled) {
        vs -= ARREST * dt
        if (vs <= SETTLE) { vs = SETTLE; settled = true }
      } else {
        vs += SINK * dt
      }
    }
    alt -= (vs / 60) * dt
    if (alt <= 0 || elapsed > CAP) { alt = 0; place(); return land() }
    place()
    altOut.textContent = Math.round(alt)
    raf = requestAnimationFrame(frame)
  }

  function land() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    altOut.textContent = '0'
    flareBtn.hidden = true
    startBtn.hidden = false
    startBtn.textContent = startBtn.getAttribute('data-again') || startBtn.textContent

    var touch = Math.round(vs)
    var band = touch <= 60 ? bands[0] : touch <= 200 ? bands[1] : touch <= 400 ? bands[2] : bands[3]
    // One note at most, and only when it explains the number: never flared,
    // flared so high the aeroplane floated, or flared with nothing left to
    // arrest. Otherwise the verdict speaks for itself.
    var note = ''
    if (!flared) note = host.getAttribute('data-no-flare') || ''
    else if (flareAlt > 20) note = host.getAttribute('data-too-high') || ''
    else if (flareAlt < 4) note = host.getAttribute('data-too-late') || ''
    result.innerHTML = ''
    var p = document.createElement('p')
    var n = document.createElement('span')
    n.className = 'lg-vs'
    n.textContent = String(touch)
    var u = document.createElement('span')
    u.className = 'lg-vs-unit'
    u.textContent = unit
    p.appendChild(n); p.appendChild(u)
    var rk = document.createElement('span')
    rk.className = 'lg-remark'
    rk.textContent = band ? band.remark : ''
    p.appendChild(rk)
    if (note) {
      var nt = document.createElement('span')
      nt.className = 'lg-note'
      nt.textContent = note
      p.appendChild(nt)
    }
    result.appendChild(p)
    startBtn.focus()
  }

  function begin() {
    if (running) return
    running = true
    flared = false
    settled = false
    flareAlt = 0
    elapsed = 0
    alt = START_ALT
    vs = DESCENT
    t0 = 0
    result.innerHTML = ''
    startBtn.hidden = true
    flareBtn.hidden = false
    flareBtn.focus()
    place()
    raf = requestAnimationFrame(frame)
  }

  function flare() {
    if (!running || flared) return
    flared = true
    flareAlt = alt
  }

  startBtn.addEventListener('click', begin)
  flareBtn.addEventListener('click', flare)

  // Space is the pilot's key here, but only while the game is actually running
  // and only when the reader is not typing into something else.
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== ' ' && ev.key !== 'Spacebar') return
    if (!running) return
    var t = ev.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
    // The flare button is a real button; when it has focus let it do its own
    // job rather than handling the same press twice.
    if (t === flareBtn) return
    ev.preventDefault()
    flare()
  })

  place()
})();
