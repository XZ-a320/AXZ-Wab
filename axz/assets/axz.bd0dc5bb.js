;(function(){
/* ==========================================================================
   AXZ site chrome — theme toggle, motion toggle, reveal observer.
   Every behaviour here is an enhancement: with JS off, the page is complete.
   ========================================================================== */
(function () {
  'use strict'

  var root = document.documentElement
  root.classList.remove('no-js')

  /* --- Theme ------------------------------------------------------------- */
  var THEME_KEY = 'axz-theme'
  try {
    var saved = localStorage.getItem(THEME_KEY)
    if (saved === 'day' || saved === 'night') root.setAttribute('data-theme', saved)
  } catch (e) {}

  var themeBtn = document.querySelector('[data-theme-toggle]')
  if (themeBtn) {
    /* The icon shows what a press will DO, and the accessible name says the
       same thing, so the two can never drift apart: a moon when a press would
       switch to night, a sun when it would switch back to day. */
    var themeIcon = themeBtn.querySelector('[data-theme-icon] use')
    var themeLabel = themeBtn.querySelector('[data-theme-label]')
    var sync = function () {
      var isNight = root.getAttribute('data-theme') === 'night' ||
        (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
      themeBtn.setAttribute('aria-pressed', String(isNight))
      var label = themeBtn.getAttribute(isNight ? 'data-label-day' : 'data-label-night')
      if (themeLabel) themeLabel.textContent = label
      if (themeIcon) themeIcon.setAttribute('href', isNight ? '#i-sun' : '#i-moon')
    }
    sync()
    themeBtn.addEventListener('click', function () {
      var isNight = root.getAttribute('data-theme') === 'night' ||
        (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
      var next = isNight ? 'day' : 'night'
      root.setAttribute('data-theme', next)
      try { localStorage.setItem(THEME_KEY, next) } catch (e) {}
      sync()
    })
  }

  /* --- Motion -------------------------------------------------------------
     The toggle is not a preference echo: it applies the same finished state
     that prefers-reduced-motion does, and it also stops the observer from
     queueing any further work.                                              */
  var MOTION_KEY = 'axz-motion'
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  try {
    if (localStorage.getItem(MOTION_KEY) === 'off') root.setAttribute('data-motion', 'off')
  } catch (e) {}

  var motionBtn = document.querySelector('[data-motion-toggle]')
  if (motionBtn) {
    /* Pause while motion runs, play once it is stopped — again matching the
       label to the icon so both describe the same next action. */
    var motionIcon = motionBtn.querySelector('[data-motion-icon] use')
    var motionLabel = motionBtn.querySelector('[data-motion-label]')
    var syncM = function () {
      var off = root.getAttribute('data-motion') === 'off'
      motionBtn.setAttribute('aria-pressed', String(off))
      var label = motionBtn.getAttribute(off ? 'data-label-resume' : 'data-label-stop')
      if (motionLabel) motionLabel.textContent = label
      if (motionIcon) motionIcon.setAttribute('href', off ? '#i-play' : '#i-pause')
    }
    syncM()
    motionBtn.addEventListener('click', function () {
      var off = root.getAttribute('data-motion') === 'off'
      if (off) { root.removeAttribute('data-motion'); try { localStorage.removeItem(MOTION_KEY) } catch (e) {} }
      else { root.setAttribute('data-motion', 'off'); try { localStorage.setItem(MOTION_KEY, 'off') } catch (e) {} }
      syncM()
    })
  }

  /* --- Reveal -------------------------------------------------------------
     Skip observer registration entirely when motion is off, so no work is
     queued rather than queued-and-suppressed.                               */
  var motionOff = reduced || root.getAttribute('data-motion') === 'off'
  var items = document.querySelectorAll('.reveal')
  if (motionOff || !('IntersectionObserver' in window)) {
    for (var i = 0; i < items.length; i++) items[i].setAttribute('data-shown', 'true')
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return
        en.target.setAttribute('data-shown', 'true')
        io.unobserve(en.target)
      })
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 })
    for (var j = 0; j < items.length; j++) io.observe(items[j])
  }

})()

/* --- April Fools gate -----------------------------------------------------
   The original renders only after a real button press. Every interval sits
   behind the motion preference and is never started when motion is off.
   Leading semicolon: without it this reads as calling the previous IIFE's
   return value, which throws and kills every script after it.              */
;(function () {
  'use strict'
  var enter = document.querySelector('[data-af-enter]')
  var panel = document.getElementById('af')
  if (!enter || !panel) return

  enter.addEventListener('click', function () {
    var open = panel.hidden === false
    panel.hidden = open
    enter.setAttribute('aria-expanded', String(!open))
    if (!open) {
      panel.setAttribute('tabindex', '-1')
      panel.focus()
      start()
    }
  })

  var timer = null
  function start() {
    var root = document.documentElement
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (root.getAttribute('data-motion') === 'off') return
    var cell = panel.querySelector('[data-af-cmd]')
    if (!cell || timer) return
    var cmds = [
      './入侵证据清除.sh --force',
      'rm -rf /var/log/hack*',
      "echo 'I was here' > /home/axz/readme.txt",
      'lastlog -u root',
      'service apache2 stop',
      'chattr +i /var/www/html/index.html'
    ]
    var i = 0
    timer = setInterval(function () {
      i = (i + 1) % cmds.length
      cell.textContent = cmds[i]
    }, 3000)
  }

  var dec = panel.querySelector('[data-af-decrypt]')
  if (dec) {
    var out = document.createElement('p')
    out.setAttribute('role', 'status')
    dec.parentNode.insertBefore(out, dec.nextSibling)
    dec.addEventListener('click', function () {
      out.textContent = dec.getAttribute('data-msg') || '无法解密。这是模拟页面。'
    })
  }
})()

/* --- Demo gate ------------------------------------------------------------
   The original login is preserved and made honest: it authenticates nothing.
   The real page fetched users/<name>.txt and string-compared it in the client,
   which published the password to anyone who opened the URL. Here the fields
   are never read, never stored and never sent.

   The gating happens HERE rather than in the markup, so with scripts off both
   the login and the reader render and the reader still works. A mock login
   that could not be passed without JS would lock people out of the page for
   no gain.                                                                  */
;(function () {
  'use strict'
  var form = document.querySelector('[data-demo-gate]')
  var gate = document.querySelector('[data-gate]')
  var viewer = document.querySelector('[data-viewer]')
  if (!form || !gate || !viewer) return

  viewer.hidden = true            // only now, once JS is known to run

  form.addEventListener('submit', function (ev) {
    ev.preventDefault()
    var name = ((form.querySelector('#pilot') || {}).value || '').trim()
    var pw = form.querySelector('#pilotpw')
    if (pw) pw.value = ''         // the password field is never even read
    gate.hidden = true
    viewer.hidden = false
    var h = viewer.querySelector('#viewer-h')
    if (h) {
      h.textContent = (form.getAttribute('data-welcome') || '') +
        (name ? '，' + name : '') + '。' + (form.getAttribute('data-note') || '')
      h.focus()                   // move focus to what just appeared
    }
  })
})()

/* --- Draw-in measurement + reveal -----------------------------------------
   Every stroke-draw needs the REAL length of its path or the dash offset is
   wrong and the line either snaps in or never completes.

   getTotalLength() returns USER units (the airframe viewBox is in metres), but
   `vector-effect: non-scaling-stroke` makes stroke-dasharray operate in SCREEN
   pixels, so the raw value produces a short repeating dash instead of one long
   one. Convert through the element's on-screen scale.

   data-anim is set HERE, not in the markup: the hidden start state is opt-in,
   so if JS never runs, the observer is unavailable, or a measurement fails,
   the drawing renders complete rather than invisible.                       */
;(function () {
  'use strict'
  var root = document.documentElement
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  if (root.getAttribute('data-motion') === 'off') return

  function measure(sel, prop, screenSpace) {
    var els = document.querySelectorAll(sel)
    for (var i = 0; i < els.length; i++) {
      var el = els[i]
      try {
        var len = el.getTotalLength()
        if (!len) continue
        if (screenSpace) {
          var svg = el.ownerSVGElement
          var vb = svg && svg.viewBox && svg.viewBox.baseVal
          var w = svg ? svg.getBoundingClientRect().width : 0
          if (vb && vb.width && w) len = len * (w / vb.width)
        }
        el.style.setProperty(prop, Math.ceil(len))
      } catch (e) {}
    }
  }
  measure('.af-part, .af-fin', '--dlen', true)
  measure('.prof-path', '--plen', false)

  var figs = document.querySelectorAll('.fleet-scale, .profile')
  if (!figs.length || !('IntersectionObserver' in window)) return
  for (var a = 0; a < figs.length; a++) figs[a].setAttribute('data-anim', 'on')

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting) return
      en.target.setAttribute('data-shown', 'true')
      io.unobserve(en.target)
    })
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.12 })
  for (var k = 0; k < figs.length; k++) io.observe(figs[k])
})()

})();
;(function(){
/* ==========================================================================
   .axzlog reader — entirely client-side. Nothing is uploaded.

   Format, read from the owner's own C# logger (小泽航空飞行日志记录程序/Program.cs):
     bytes 0..5  ASCII "AXZLOG"
     bytes 6..   GZipStream over UTF-8 JSON of FlightLogData

   DecompressionStream does the gzip, so this needs no library and no server.
   ========================================================================== */
(function () {
  'use strict'

  var MAGIC = 'AXZLOG'

  // Field order per band, verbatim from the C# form.
  var BANDS = [
    { key: 'pre', fields: ['FlightNumber', 'AircraftType', 'Registration', 'Date', 'DepartureAirport', 'DepartureGate', 'DepartureTime', 'DepartureWeather', 'FlightPlan'] },
    { key: 'takeoff', fields: ['V1', 'VR', 'V2', 'TakeoffConfig', 'TakeoffRunway'] },
    { key: 'cruise', remark: 'CruiseRemark', remarkNone: 'CruiseRemarkNone' },
    { key: 'landing', fields: ['ArrivalAirport', 'LandingRunway', 'LandingMethod', 'LandingConfig', 'LandingWeather', 'LandingTime', 'ArrivalGate'] },
    { key: 'post', remark: 'PostFlightRemark', remarkNone: 'PostFlightRemarkNone' }
  ]

  // Values that are codes and must render in mono, never reflowed.
  var CODE = /^(FlightNumber|Registration|DepartureAirport|ArrivalAirport|FlightPlan|V1|VR|V2|TakeoffRunway|LandingRunway|DepartureGate|ArrivalGate)$/

  var root = document.querySelector('[data-axzlog]')
  if (!root) return

  var L = JSON.parse(root.getAttribute('data-strings'))
  var out = root.querySelector('[data-axzlog-out]')
  var status = root.querySelector('[data-axzlog-status]')
  var zone = root.querySelector('[data-axzlog-zone]')
  var input = root.querySelector('[data-axzlog-input]')

  function say(msg, kind) {
    status.textContent = msg || ''
    if (kind) status.setAttribute('data-kind', kind)
    else status.removeAttribute('data-kind')
  }

  function pad(n) { return (n < 10 ? '0' : '') + n }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function decode(buf) {
    var head = new TextDecoder('ascii').decode(new Uint8Array(buf, 0, 6))
    if (buf.byteLength < 6 || head !== MAGIC) throw new Error('format')
    if (typeof DecompressionStream !== 'function') throw new Error('unsupported')
    var body = buf.slice(6)
    var stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('gzip'))
    return new Response(stream).text().then(function (txt) {
      var data = JSON.parse(txt)
      if (!data) throw new Error('empty')
      return data
    })
  }

  function value(d, f) {
    if (f === 'Date') {
      if (!d.Year) return ''
      return d.Year + '-' + pad(d.Month || 1) + '-' + pad(d.Day || 1)
    }
    if (f === 'DepartureTime') return pad(d.DepartureHour || 0) + ':' + pad(d.DepartureMinute || 0)
    if (f === 'LandingTime') return pad(d.LandingHour || 0) + ':' + pad(d.LandingMinute || 0)
    return d[f]
  }

  function render(d) {
    var html = ''
    for (var i = 0; i < BANDS.length; i++) {
      var b = BANDS[i]
      html += '<section class="band"><h3 class="band__name">' + esc(L.bands[b.key]) + '</h3>'

      if (b.remark) {
        // Both 备注 fields render into the remarks column, in red, in the Kai
        // face — the site's own thesis applied to the owner's own schema.
        var none = d[b.remarkNone] === true
        var text = value(d, b.remark)
        html += '<div class="ledger__remarks" style="border:0;padding:0">'
        html += '<span class="ledger__remarks-label">' + esc(L.fields[b.remark]) + '</span>'
        if (none || !text) {
          html += '<p class="remark-none">' + esc(L.noRemark) + '</p>'
        } else {
          html += '<p class="remark-cell">' + esc(text) + '</p>'
        }
        html += '</div>'
      } else {
        html += '<dl class="spec">'
        for (var j = 0; j < b.fields.length; j++) {
          var f = b.fields[j]
          var v = value(d, f)
          if (v === '' || v === null || v === undefined) continue
          html += '<dt>' + esc(L.fields[f]) + '</dt>'
          html += '<dd' + (CODE.test(f) ? ' class="code"' : '') + '>' + esc(v) + '</dd>'
        }
        html += '</dl>'
      }
      html += '</section>'
    }
    out.innerHTML = html
    out.hidden = false
  }

  function handle(file) {
    if (!file) return
    if (!/\.axzlog$/i.test(file.name)) { say(L.errorFormat, 'error'); return }
    say('')
    file.arrayBuffer().then(decode).then(function (d) {
      render(d)
      say(file.name)
    }).catch(function (err) {
      out.hidden = true
      say(err && err.message === 'unsupported' ? L.unsupported
        : err && err.message === 'format' ? L.errorFormat
        : err && err.message === 'empty' ? L.errorEmpty
        : L.errorRead, 'error')
    })
  }

  if (input) {
    input.addEventListener('change', function () { handle(this.files[0]); this.value = '' })
  }

  if (zone) {
    ;['dragenter', 'dragover'].forEach(function (e) {
      zone.addEventListener(e, function (ev) { ev.preventDefault(); zone.setAttribute('data-over', 'true') })
    })
    ;['dragleave', 'drop'].forEach(function (e) {
      zone.addEventListener(e, function (ev) { ev.preventDefault(); zone.removeAttribute('data-over') })
    })
    zone.addEventListener('drop', function (ev) {
      handle(ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0])
    })
  }

  var sample = root.querySelector('[data-axzlog-sample]')
  if (sample) {
    sample.addEventListener('click', function () {
      say('')
      fetch(sample.getAttribute('data-axzlog-sample'))
        .then(function (r) { if (!r.ok) throw new Error('read'); return r.arrayBuffer() })
        .then(decode)
        .then(function (d) { render(d); say(L.sampleNotice) })
        .catch(function () { out.hidden = true; say(L.errorRead, 'error') })
    })
  }

  var clear = root.querySelector('[data-axzlog-clear]')
  if (clear) {
    clear.addEventListener('click', function () {
      out.hidden = true
      out.innerHTML = ''
      say('')
    })
  }
})()

})();
;(function(){
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

})();