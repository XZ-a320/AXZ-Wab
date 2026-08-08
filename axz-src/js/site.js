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
