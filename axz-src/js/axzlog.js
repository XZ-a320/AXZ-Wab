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
