// Functional + keyboard + safety checks that axe cannot see.
import { chromium } from '/Users/brookxiao/New/Xiao/Website/node_modules/playwright/index.mjs'
const BASE = 'http://localhost:4788'
const browser = await chromium.launch()
const ctx = await browser.newContext()
const fails = []
const ok = m => console.log('  ✓ ' + m)
const bad = m => { fails.push(m); console.log('  ✗ ' + m) }

/* 1. Keyboard: every interactive element reachable, focus always visible,
      no trap, skip link first. */
console.log('\nkeyboard')
{
  const page = await ctx.newPage()
  await page.goto(BASE + '/axz/', { waitUntil: 'networkidle' })
  await page.keyboard.press('Tab')
  const first = await page.evaluate(() => document.activeElement.className)
  first.includes('skip') ? ok('skip link is the first tab stop') : bad(`first tab stop is "${first}", expected skip link`)

  // Identity by marking the element itself — two controls can share a class,
  // so a className/text key collides and looks like a focus trap.
  let invisible = 0, stops = 0, wrapped = false
  for (let i = 0; i < 200; i++) {
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body || el === document.documentElement) return null
      const already = el.hasAttribute('data-tab-seen')
      el.setAttribute('data-tab-seen', '1')
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        already,
        ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
        box: r.width > 0 && r.height > 0,
      }
    })
    if (!info) break
    if (info.already) { wrapped = true; break }
    stops++
    if (!info.ring && info.box) invisible++
    await page.keyboard.press('Tab')
  }
  // The meaningful assertion is that tabbing reaches EVERY focusable element —
  // not that it reaches some arbitrary number of them.
  const focusable = await page.evaluate(() => document.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])'
  ).length)
  stops === focusable
    ? ok(`${stops}/${focusable} focusable elements reached by keyboard${wrapped ? ', wraps cleanly' : ''}, no trap`)
    : bad(`keyboard reached ${stops} of ${focusable} focusable elements`)
  invisible === 0 ? ok('every focused element shows a focus ring') : bad(`${invisible} focused elements had no visible ring`)
  await page.close()
}

/* 2. Pilot gate then reader. The gate is a mock — anything gets in — and the
      reader loads a file the moment it is chosen, with no extra step. */
console.log('\nlogbook: mock gate then reader')
{
  const page = await ctx.newPage()
  // The property that matters is that the LOG DATA never leaves the browser —
  // not that the page makes zero POSTs. On xiaobrook.com Cloudflare injects a
  // RUM beacon at the edge that POSTs paint timings; that is the host's, not
  // ours, and it carries none of the file. Assert the real invariant.
  const uploads = []
  page.on('request', r => {
    if (r.method() === 'GET') return
    const body = r.postData() || ''
    if (/AXZ001|B-737X|AXZLOG|axzlog|KSFO SID/.test(body)) uploads.push(`${r.url()} :: ${body.slice(0, 120)}`)
  })
  await page.goto(BASE + '/axz/logbook/', { waitUntil: 'networkidle' })

  // Gate first.
  const gateSeen = await page.isVisible('[data-gate]')
  const viewerHidden = !(await page.isVisible('[data-viewer]'))
  gateSeen && viewerHidden ? ok('pilot login is shown first, reader is gated')
    : bad(`gate visible=${gateSeen}, reader hidden=${viewerHidden}`)

  // Mock: arbitrary input gets in.
  await page.fill('#pilot', 'zzzz-not-a-real-user')
  await page.fill('#pilotpw', 'anything-at-all')
  await page.click('[data-demo-gate] button[type=submit]')
  await page.waitForTimeout(200)
  const inNow = await page.isVisible('[data-viewer]')
  inNow ? ok('any credentials get in (mock gate)') : bad('mock gate did not open the reader')
  const gateGone = !(await page.isVisible('[data-gate]'))
  gateGone ? ok('the login form is dismissed once through') : bad('login form still showing after entry')

  // Choosing a file loads it immediately — no second button to press.
  await page.setInputFiles('[data-axzlog-input]', 'axz-src/fixtures/sample.axzlog')
  await page.waitForSelector('[data-axzlog-out]:not([hidden])', { timeout: 5000 }).catch(() => {})
  const out = await page.textContent('[data-axzlog-out]').catch(() => '')
  out.includes('AXZ001') ? ok('file renders immediately on selection, no extra load step') : bad('selection did not load the file')
  out.includes('B-737X') ? ok('registration rendered') : bad('registration missing')
  out.includes('KSFO SID OSI V25') ? ok('filed route string rendered intact') : bad('route string missing/altered')
  const bands = await page.$$eval('.band__name', ns => ns.map(n => n.textContent.trim()))
  bands.length === 5 ? ok(`all five flight bands rendered: ${bands.join(' / ')}`) : bad(`${bands.length} bands, expected 5`)
  const none = await page.$$eval('.remark-none', ns => ns.map(n => n.textContent.trim()))
  none.length >= 1 ? ok(`备注 empty state rendered as "${none[0]}"`) : bad('CruiseRemarkNone did not render the 无 empty state')
  uploads.length === 0 ? ok('the log data never leaves the browser (no request carries it)') : bad(`log data was transmitted: ${uploads.join(' / ')}`)
  await page.close()
}

/* 2b. With scripts off the gate must not lock anyone out: both the login and
      the reader render, because a mock gate that cannot be passed is a dead end. */
{
  const c2 = await browser.newContext({ javaScriptEnabled: false })
  const page = await c2.newPage()
  await page.goto(BASE + '/axz/logbook/', { waitUntil: 'domcontentloaded' })
  const both = (await page.isVisible('[data-gate]')) && (await page.isVisible('[data-viewer]'))
  both ? ok('no JavaScript: reader is not locked behind the mock gate')
       : bad('no JavaScript: the reader is unreachable')
  await page.close(); await c2.close()
}

/* 3. April Fools: sanitized, gated, exit works, noindex. */
console.log('\napril fools')
{
  const BANNED = ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'hack@darkweb.xx', 'xiaoze_ransom.onion', 'dark://']
  for (const p of ['/axz/aprilfools/', '/axz/en/aprilfools/']) {
    const page = await ctx.newPage()
    await page.goto(BASE + p, { waitUntil: 'networkidle' })
    const html = await page.content()
    const hit = BANNED.filter(b => html.includes(b))
    hit.length === 0 ? ok(`${p} contains none of the banned strings`) : bad(`${p} still contains: ${hit.join(', ')}`)
    const robots = await page.getAttribute('meta[name="robots"]', 'content')
    robots?.includes('noindex') ? ok(`${p} is noindex`) : bad(`${p} missing noindex`)
    // Disclosure must precede any ransom text in document order.
    const order = await page.evaluate(() => {
      const t = document.body.innerText
      return { disclosure: t.indexOf('玩笑') >= 0 ? t.indexOf('玩笑') : t.toLowerCase().indexOf('joke'), ransom: t.indexOf('0.5') }
    })
    ;(order.ransom === -1 || (order.disclosure >= 0 && order.disclosure < order.ransom))
      ? ok(`${p} discloses before any ransom text`) : bad(`${p} shows ransom text before the disclosure`)
    // The gate opens, and the exit link resolves (the original 404'd).
    await page.click('[data-af-enter]')
    const shown = await page.isVisible('#af')
    shown ? ok(`${p} gate opens the original`) : bad(`${p} gate did not open`)
    const exit = await page.getAttribute('#af a.af-btn', 'href')
    const r = await page.request.get(BASE + exit)
    r.ok() ? ok(`${p} exit link resolves (${exit})`) : bad(`${p} exit link 404s: ${exit}`)
    await page.close()
  }
}

/* 4. No credential file, no password input anywhere. */
console.log('\nsafety')
{
  const page = await ctx.newPage()
  const r = await page.request.get(BASE + '/axz/users/XZ.txt')
  !r.ok() ? ok('no credential file is served at /axz/users/') : bad('a credential file is still reachable')
  // The demo login is kept for fidelity, so a password field exists. What must
  // hold is that it is INERT: no name, no form action, never persisted, never
  // sent, and cleared on submit. That is the property worth testing.
  for (const p of ['/axz/logbook/', '/axz/en/logbook/']) {
    // Same reasoning as the log-data check: assert the CREDENTIALS are never
    // transmitted, not that the page makes zero requests. The host's RUM
    // beacon is not ours and carries none of this.
    const sent = []
    page.on('request', r => {
      if (r.method() === 'GET') return
      const body = r.postData() || ''
      if (/hunter2-canary/.test(body) || /hunter2-canary/.test(r.url())) sent.push(r.url())
    })
    await page.goto(BASE + p, { waitUntil: 'networkidle' })
    const pw = await page.$('input[type="password"]')
    if (!pw) { bad(`${p} demo login is missing its password field (fidelity)`); continue }
    const attrs = await pw.evaluate(el => ({
      name: el.getAttribute('name'), ac: el.getAttribute('autocomplete'),
      action: el.form?.getAttribute('action'),
    }))
    !attrs.name ? ok(`${p} password field has no name (never submitted)`) : bad(`${p} password field has name="${attrs.name}"`)
    !attrs.action ? ok(`${p} demo form has no action`) : bad(`${p} demo form posts to ${attrs.action}`)

    await pw.fill('hunter2-canary')
    await page.fill('#pilot', 'XZ')
    await page.click('[data-demo-gate] button[type=submit]')
    await page.waitForTimeout(150)
    const after = await pw.inputValue()
    after === '' ? ok(`${p} password field is cleared on submit`) : bad(`${p} retained the typed password`)
    const stored = await page.evaluate(() => JSON.stringify({ ls: { ...localStorage }, ss: { ...sessionStorage } }))
    !stored.includes('hunter2-canary') && !stored.includes('XZ')
      ? ok(`${p} nothing typed was persisted to storage`) : bad(`${p} persisted credentials: ${stored}`)
    sent.length === 0 ? ok(`${p} the typed password was never transmitted`) : bad(`${p} transmitted the password to ${sent.join(' / ')}`)
    page.removeAllListeners('request')
  }
  // The credential-fetch pattern itself must be gone from the shipped JS.
  const js = await (await page.request.get(BASE + '/axz/')).text()
  const bundle = js.match(/assets\/axz\.[a-f0-9]{8}\.js/)?.[0]
  const jsSrc = bundle ? await (await page.request.get(`${BASE}/axz/${bundle}`)).text() : ''
  // Strip comments first — the source documents the removed pattern by name,
  // and matching that would flag the explanation rather than the code.
  const code = jsSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  !/users\s*\/|users\/\$|['"`]users\//.test(code)
    ? ok('shipped JS has no credential-fetch code path') : bad('shipped JS still fetches a credential file')
  await page.close()
}

/* 5. Bilingual wiring: hreflang reciprocity and lang-of-parts. */
console.log('\nbilingual')
{
  const page = await ctx.newPage()
  for (const [p, want] of [['/axz/', 'zh-Hans'], ['/axz/en/', 'en']]) {
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded' })
    const lang = await page.getAttribute('html', 'lang')
    lang === want ? ok(`${p} html lang="${lang}"`) : bad(`${p} lang is "${lang}", expected "${want}"`)
    const alts = await page.$$eval('link[rel=alternate]', ls => ls.map(l => l.hreflang))
    ;['zh-Hans', 'en', 'x-default'].every(h => alts.includes(h))
      ? ok(`${p} declares all three hreflang alternates`) : bad(`${p} hreflang incomplete: ${alts}`)
  }
  // Chinese guestbook entries must stay Chinese on the English page.
  await page.goto(BASE + '/axz/en/guestbook/', { waitUntil: 'domcontentloaded' })
  const q = await page.$$eval('blockquote', bs => bs.map(b => ({ lang: b.getAttribute('lang'), t: b.textContent.trim() })))
  q.every(x => x.lang === 'zh-Hans') ? ok('guestbook entries kept lang="zh-Hans" on the EN page') : bad('guestbook entries not language-tagged on EN')
  q.some(x => x.t.includes('做的网站真好')) ? ok('guestbook entries are untranslated, byte-for-byte') : bad('a guestbook entry was translated or altered')
  await page.close()
}


/* 6. Motion: every animated graphic must leave a COMPLETE static state.
      The site's own rule is that a motion which cannot be removed and leave a
      legible, information-equivalent frame is not shipped. Three ways to remove
      it — the OS preference, the in-page toggle, and no JS at all — must each
      leave the graphics fully drawn rather than blank. */
console.log('\nmotion')
{
  async function drawnState(label, makeCtx, prep, suppressed) {
    const c = await makeCtx()
    const page = await c.newPage()
    if (prep) await prep(page)
    await page.goto(BASE + '/axz/', { waitUntil: 'networkidle' })
    await page.evaluate(() => document.querySelector('.fleet-scale')?.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(400)
    const r = await page.evaluate(() => {
      const af = document.querySelector('.af-part')
      const pf = document.querySelector('.prof-path')
      const cs = el => el ? getComputedStyle(el) : null
      const a = cs(af), p = cs(pf)
      return {
        // "drawn" means: no dash offset hiding the stroke, and fill visible.
        afHidden: a ? (parseFloat(a.strokeDashoffset) > 1 || parseFloat(a.fillOpacity) < 0.99) : null,
        profHidden: p ? parseFloat(p.strokeDashoffset) > 1 : null,
      }
    })
    await page.close(); await c.close()
    const drawn = r.afHidden === false && r.profHidden === false
    drawn ? okMsg(`${label}: airframes and profile fully drawn`)
          : bad(`${label}: ${JSON.stringify(r)}`)
  }
  const okMsg = ok
  await drawnState('prefers-reduced-motion', () => browser.newContext({ reducedMotion: 'reduce' }))
  await drawnState('stop-animation toggle', () => browser.newContext(),
    p => p.addInitScript(() => { try { localStorage.setItem('axz-motion', 'off') } catch (e) {} }))
  await drawnState('no JavaScript', () => browser.newContext({ javaScriptEnabled: false }))

  /* The draw-in silently stopped working once before: a later edit deleted the
     block that measures path lengths, so --dlen was never set, the dash rules
     became invalid, and every drawing just appeared complete. Nothing failed —
     it simply stopped animating. Assert the measurement actually happens. */
  {
    const c = await browser.newContext()
    const page = await c.newPage()
    await page.goto(BASE + '/axz/', { waitUntil: 'networkidle' })
    await page.evaluate(() => document.querySelector('.fleet-scale')?.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(150)
    const m = await page.evaluate(() => {
      const af = document.querySelector('.af-part')
      const pf = document.querySelector('.prof-path')
      const fig = document.querySelector('.fleet-scale')
      return {
        dlen: af && af.style.getPropertyValue('--dlen'),
        plen: pf && pf.style.getPropertyValue('--plen'),
        anim: fig && fig.getAttribute('data-anim'),
        drawing: af ? parseFloat(getComputedStyle(af).strokeDashoffset) > 1 : null,
      }
    })
    m.dlen && m.plen && m.anim === 'on'
      ? ok(`draw-in is wired: --dlen=${m.dlen}, --plen=${m.plen}, data-anim=on`)
      : bad(`draw-in not wired: ${JSON.stringify(m)}`)
    m.drawing === true ? ok('airframe strokes are mid-draw shortly after reveal')
                       : bad('airframe appeared complete instantly — the draw-in is not running')
    await page.close(); await c.close()
  }

  // The route section is a document now, not an animation. Guard it, or the
  // flying aircraft and the track draw quietly come back on a later change.
  {
    const page = await ctx.newPage()
    await page.goto(BASE + '/axz/', { waitUntil: 'domcontentloaded' })
    const leftovers = await page.evaluate(() => ({
      ship: document.querySelectorAll('.plate-ship').length,
      track: document.querySelectorAll('.track-path').length,
      svg: document.querySelectorAll('.plate svg').length,
      img: document.querySelectorAll('.plate__img').length,
    }))
    leftovers.ship === 0 && leftovers.track === 0 && leftovers.svg === 0
      ? ok('route plates carry no motion and no traced SVG')
      : bad(`route plates still animated: ${JSON.stringify(leftovers)}`)
    leftovers.img === 2 ? ok("both plates show the owner's own chart render") : bad(`${leftovers.img} chart images, expected 2`)
    await page.close()
  }
}

await browser.close()
console.log(fails.length ? `\n✗ ${fails.length} failure(s)` : '\n✓ all functional checks pass')
process.exit(fails.length ? 1 : 0)
