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
    var sync = function () {
      var isNight = root.getAttribute('data-theme') === 'night' ||
        (!root.hasAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches)
      themeBtn.setAttribute('aria-pressed', String(isNight))
      themeBtn.textContent = themeBtn.getAttribute(isNight ? 'data-label-day' : 'data-label-night')
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
    var syncM = function () {
      var off = root.getAttribute('data-motion') === 'off'
      motionBtn.setAttribute('aria-pressed', String(off))
      motionBtn.textContent = motionBtn.getAttribute(off ? 'data-label-resume' : 'data-label-stop')
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

  /* --- Route track length -------------------------------------------------
     Set the dash length from the real path so the draw is exact.            */
  var tracks = document.querySelectorAll('.track-path')
  for (var k = 0; k < tracks.length; k++) {
    try {
      var len = tracks[k].getTotalLength()
      tracks[k].style.setProperty('--len', len)
    } catch (e) {}
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
   The original login is preserved for fidelity, but it authenticates nothing:
   the real page fetched users/<name>.txt and string-compared it in the client,
   which published the password to anyone who opened the URL. Here the fields
   are never read, never stored and never sent — submitting only acknowledges.
   The .axzlog reader above is deliberately NOT gated behind it.            */
;(function () {
  'use strict'
  var form = document.querySelector('[data-demo-gate]')
  if (!form) return
  var status = form.querySelector('[data-demo-status]')
  form.addEventListener('submit', function (ev) {
    ev.preventDefault()
    var name = (form.querySelector('#pilot') || {}).value || ''
    status.textContent = (form.getAttribute('data-welcome') || '欢迎') +
      (name.trim() ? '，' + name.trim() : '') + '。' + (form.getAttribute('data-note') || '')
    // Nothing is persisted and the password field is never read at all.
    var pw = form.querySelector('#pilotpw')
    if (pw) pw.value = ''
  })
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