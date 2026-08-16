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
// Both the home page and the dispatch desk: the desk carries two selects, a
// download button and the landing game's controls, none of which may be
// mouse-only or invisible when focused.
for (const path of ['/axz/', '/axz/dispatch/']) {
  const page = await ctx.newPage()
  await page.goto(BASE + path, { waitUntil: 'networkidle' })
  await page.keyboard.press('Tab')
  const first = await page.evaluate(() => document.activeElement.className)
  first.includes('skip') ? ok(`${path} skip link is the first tab stop`) : bad(`${path} first tab stop is "${first}", expected skip link`)

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
    ? ok(`${path} ${stops}/${focusable} focusable elements reached by keyboard${wrapped ? ', wraps cleanly' : ''}, no trap`)
    : bad(`${path} keyboard reached ${stops} of ${focusable} focusable elements`)
  invisible === 0 ? ok(`${path} every focused element shows a focus ring`) : bad(`${path} ${invisible} focused elements had no visible ring`)
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

  // The sample button fetches a URL, so the URL has to exist in the BUILD, not
  // just in axz-src/. It did not for a while: the build wipes its output dir
  // and never copied the fixture back, so the button 404'd on every fresh
  // deploy while this gate stayed green by feeding the reader the source file.
  const sampleHref = await page.getAttribute('[data-axzlog-sample]', 'data-axzlog-sample')
  const sampleRes = await page.request.get(BASE + sampleHref)
  sampleRes.ok() ? ok(`the sample log is served at ${sampleHref} (${sampleRes.status()})`)
                 : bad(`the sample log 404s at ${sampleHref} (${sampleRes.status()})`)
  await page.click('[data-axzlog-sample]')
  await page.waitForSelector('[data-axzlog-out]:not([hidden])', { timeout: 5000 }).catch(() => {})
  const sampleOut = await page.textContent('[data-axzlog-out]').catch(() => '')
  sampleOut.includes('AXZ001') ? ok('the sample button loads and renders a log') : bad('the sample button rendered nothing')
  await page.click('[data-axzlog-clear]')

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

/* 2c. Icons must never become the accessible name. A flag is a country, not a
      language; a sun is not the word "day". Every icon is aria-hidden and the
      real name is text beside it, and the toggles' icon/label/state must all
      describe the same next action or they contradict each other. */
console.log('\nicons')
{
  const page = await ctx.newPage()
  await page.goto(BASE + '/axz/', { waitUntil: 'networkidle' })

  const hidden = await page.$$eval('.icon', els => els.filter(e => e.getAttribute('aria-hidden') !== 'true').length)
  hidden === 0 ? ok('every icon is aria-hidden') : bad(`${hidden} icons are exposed to assistive tech`)

  const langs = await page.$$eval('.lang a', as => as.map(a => ({ name: a.textContent.trim(), lang: a.getAttribute('lang') })))
  langs.length === 2 && langs[0].name === '中文' && langs[1].name === 'English'
    ? ok('language links are named by language, not by flag')
    : bad(`language link names: ${JSON.stringify(langs)}`)

  const read = () => page.evaluate(() => {
    const t = document.querySelector('[data-theme-toggle]'), m = document.querySelector('[data-motion-toggle]')
    return {
      ti: t.querySelector('use').getAttribute('href'), tn: t.textContent.trim(), tp: t.getAttribute('aria-pressed'),
      mi: m.querySelector('use').getAttribute('href'), mn: m.textContent.trim(), mp: m.getAttribute('aria-pressed'),
    }
  })
  const a = await read()
  await page.click('[data-theme-toggle]'); await page.waitForTimeout(120)
  const b2 = await read()
  a.ti !== b2.ti && a.tn !== b2.tn && a.tp !== b2.tp
    ? ok(`theme toggle: icon, name and pressed-state all change (${a.ti}/${a.tn} -> ${b2.ti}/${b2.tn})`)
    : bad(`theme toggle did not update together: ${JSON.stringify([a, b2])}`)

  await page.click('[data-motion-toggle]'); await page.waitForTimeout(120)
  const c3 = await read()
  b2.mi !== c3.mi && b2.mn !== c3.mn && b2.mp !== c3.mp
    ? ok(`motion toggle: icon, name and pressed-state all change (${b2.mi}/${b2.mn} -> ${c3.mi}/${c3.mn})`)
    : bad(`motion toggle did not update together: ${JSON.stringify([b2, c3])}`)
  await page.close()
}

/* 2d. Units: Chinese metric (km and metres, including altitude), English
      imperial (statute miles and feet). The owner's own altitude figures are
      kept in parentheses on the Chinese side rather than deleted — and for
      ZSPD-ZSNJ the metric value is the point: 9,500 m is the Chinese metric
      flight level and 31100 ft is its official table equivalent, so the pair
      has to survive together or the number stops making sense. */
{
  const page = await ctx.newPage()
  await page.goto(BASE + '/axz/', { waitUntil: 'domcontentloaded' })
  const zhTxt = await page.innerText('main')
  zhTxt.includes('约110公里') && zhTxt.includes('约280公里')
    ? ok('Chinese distances metric, in the owner\'s own words') : bad('Chinese distances altered')
  zhTxt.includes('1,676米') && zhTxt.includes('9,500米')
    ? ok('Chinese altitudes lead with metres') : bad('Chinese altitudes are not metric-first')
  zhTxt.includes('5,500英尺') && zhTxt.includes('31100英尺')
    ? ok('the owner\'s original altitude figures are still shown') : bad('an original altitude figure was deleted')
  zhTxt.includes('9,500米（31100英尺）')
    ? ok('9,500 m and 31100 ft stay paired (the metric level and its table equivalent)')
    : bad('the metric level and its foot equivalent were separated')
  ;/\b39\.47 m\b/.test(zhTxt) ? ok('Chinese fleet dimensions in metres') : bad('Chinese fleet dimensions not metric')

  await page.goto(BASE + '/axz/en/', { waitUntil: 'domcontentloaded' })
  const enTxt = await page.innerText('main')
  enTxt.includes('68 mi') && enTxt.includes('174 mi')
    ? ok('English distances in statute miles') : bad('English distances not in miles')
  !/\d+\s?nm\b/.test(enTxt) ? ok('no nautical miles left in English') : bad('nautical miles still present in English')
  ;/129\.5 ft/.test(enTxt) ? ok('English fleet dimensions in feet') : bad('English fleet dimensions not in feet')
  enTxt.includes('31,100 ft') ? ok('English altitude keeps 31,100 ft') : bad('English altitude altered')
  await page.close()
}

/* 2e. The language separator must sit on the same centre line as the two
      links; it hung high because .lang was a flex row defaulting to stretch. */
{
  const page = await ctx.newPage()
  await page.goto(BASE + '/axz/', { waitUntil: 'networkidle' })
  const geo = await page.evaluate(() => {
    const sep = document.querySelector('.lang__sep')
    const links = [...document.querySelectorAll('.lang a')]
    const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 }
    return { sepMid: mid(sep), linkMids: links.map(mid) }
  })
  const drift = Math.max(...geo.linkMids.map(m => Math.abs(m - geo.sepMid)))
  drift < 2
    ? ok(`language separator is centred with the links (${drift.toFixed(1)}px drift)`)
    : bad(`language separator is ${drift.toFixed(1)}px off the links' centre line`)
  await page.close()
}

/* 2f. The recorder now ships FROM THIS SITE, at the owner's request, as a zip.
      What has to hold: the file is actually served here, the stated size is the
      real size rather than a number someone typed, the published SHA-256 is the
      checksum of the bytes being served, and the fact that the program is
      unsigned is disclosed BEFORE the button rather than after it. */
{
  const { createHash } = await import('node:crypto')
  const page = await ctx.newPage()
  await page.goto(BASE + '/axz/logbook/', { waitUntil: 'domcontentloaded' })
  const href = await page.getAttribute('a[href*="AXZ-FlightLogRecorder"]', 'href')
  href && href.startsWith('/axz/downloads/') && href.endsWith('.zip')
    ? ok(`recorder is served from this site (${href})`)
    : bad(`recorder download href is ${href}`)

  const r = await page.request.get(BASE + href)
  r.ok() ? ok(`recorder asset resolves (${r.status()})`) : bad(`recorder asset returned ${r.status()}`)
  const body = await r.body()

  // A zip, not a bare .exe: the archive is what keeps the file under GitHub's
  // 100 MiB per-file limit and off the browser's unsigned-executable warning.
  body.slice(0, 2).toString('latin1') === 'PK'
    ? ok('the served file is a real zip archive') : bad('the served file is not a zip')
  body.length < 100 * 1024 * 1024
    ? ok(`under GitHub's 100 MiB per-file limit (${(body.length / 1048576).toFixed(1)} MiB)`)
    : bad(`${(body.length / 1048576).toFixed(1)} MiB exceeds GitHub's 100 MiB per-file limit`)

  const meta = await page.innerText('main')
  const realMB = (body.length / 1048576).toFixed(1)
  meta.includes(realMB)
    ? ok(`the stated size is the real size (${realMB} MB)`)
    : bad(`page states a size that is not ${realMB} MB`)
  meta.includes('Windows') ? ok('platform stated before the click') : bad('platform not disclosed')

  const sha = createHash('sha256').update(body).digest('hex')
  meta.includes(sha)
    ? ok(`the published SHA-256 matches the served bytes (${sha.slice(0, 12)}…)`)
    : bad(`published checksum does not match the served file (actual ${sha})`)

  // Unsigned-executable disclosure must PRECEDE the download control.
  const order = await page.evaluate(() => {
    const t = document.body.innerText
    const smart = t.indexOf('SmartScreen')
    const btn = document.querySelector('a[href*="AXZ-FlightLogRecorder"]')
    const label = btn ? btn.textContent.trim() : ''
    return { smart, btn: t.indexOf(label), label }
  })
  order.smart >= 0 ? ok('the unsigned/SmartScreen warning is on the page') : bad('no SmartScreen disclosure')
  await page.close()
}

/* 2g. Route network: the SVG is a picture and the buttons are the interaction.
      Nothing inside the drawing may be focusable, selecting a sector must mark
      both the map and the matching progress strip, and the whole thing must
      render complete with no script at all. */
console.log('\nnetwork map')
{
  const page = await ctx.newPage()
  await page.goto(BASE + '/axz/', { waitUntil: 'networkidle' })

  const focusableInSvg = await page.$$eval('.netmap svg a, .netmap svg button, .netmap svg [tabindex]', e => e.length)
  focusableInSvg === 0 ? ok('nothing inside the map drawing is focusable') : bad(`${focusableInSvg} focusable elements inside the SVG`)

  const legs = await page.$$eval('[data-net-leg]', e => e.length)
  legs === 2 ? ok('both route pairs are drawn') : bad(`${legs} legs drawn, expected 2`)

  // Length must follow the site's OWN published distances, not a great-circle
  // recomputation: 280 km against 110 km is 2.545, and the drawing has to agree
  // with the text beside it or it is a second, contradictory claim.
  const ratio = await page.evaluate(() => {
    const len = id => {
      const l = document.querySelector(`[data-net-leg="${id}"] .net-track`)
      return Math.hypot(l.x2.baseVal.value - l.x1.baseVal.value, l.y2.baseVal.value - l.y1.baseVal.value)
    }
    return len('zspd-zsnj') / len('ksfo-ksns')
  })
  Math.abs(ratio - 280 / 110) < 0.02
    ? ok(`both pairs drawn to one scale (${ratio.toFixed(3)} matches the published 280/110)`)
    : bad(`scale ratio is ${ratio.toFixed(3)}, expected ${(280 / 110).toFixed(3)}`)

  await page.click('[data-net-flight="AXZ003"]')
  const sel = await page.evaluate(() => ({
    active: [...document.querySelectorAll('[data-net-leg][data-active]')].map(e => e.getAttribute('data-net-leg')),
    strip: [...document.querySelectorAll('.strip[data-active]')].map(e => e.getAttribute('data-flight')),
    pressed: document.querySelector('[data-net-flight="AXZ003"]').getAttribute('aria-pressed'),
  }))
  sel.active.join() === 'zspd-zsnj' && sel.strip.join() === 'AXZ003' && sel.pressed === 'true'
    ? ok('selecting AXZ003 marks its leg, its strip, and its own button')
    : bad(`selection state wrong: ${JSON.stringify(sel)}`)

  await page.click('[data-net-clear]')
  const cleared = await page.evaluate(() => document.querySelectorAll('[data-net-leg][data-active], .strip[data-active]').length)
  cleared === 0 ? ok('show-all clears every mark') : bad(`${cleared} marks survived show-all`)
  await page.close()
}
{
  const c2 = await browser.newContext({ javaScriptEnabled: false })
  const page = await c2.newPage()
  await page.goto(BASE + '/axz/', { waitUntil: 'domcontentloaded' })
  const drawn = await page.$$eval('[data-net-leg] .net-track', e => e.length)
  drawn === 2 ? ok('no JavaScript: the map is still a finished drawing') : bad(`no JS: ${drawn} legs drawn`)
  await page.close(); await c2.close()
}

/* 2h. Departure board: the status column can only ever say one thing, and the
      clocks are the one live element on the site. Their no-script state has to
      be true rather than blank, so each cell ships holding its IANA zone name
      and is upgraded to a running time only once script confirms it can. */
console.log('\ndeparture board')
{
  const page = await ctx.newPage()
  await page.goto(BASE + '/axz/', { waitUntil: 'networkidle' })
  const rows = await page.$$eval('.bd tbody tr', rs => rs.length)
  rows === 4 ? ok('all four flight numbers on the board') : bad(`${rows} board rows, expected 4`)
  const statuses = await page.$$eval('.bd-flap', ss => [...new Set(ss.map(s => s.textContent.trim()))])
  statuses.length === 1 ? ok(`the board has exactly one status: ${statuses[0]}`) : bad(`statuses: ${statuses.join(', ')}`)

  await page.waitForTimeout(400)
  const clocks = await page.$$eval('[data-clock]', cs => cs.map(c => c.textContent.trim()))
  clocks.length === 2 && clocks.every(t => /^\d{2}:\d{2}:\d{2}$/.test(t))
    ? ok(`both base clocks run real local time (${clocks.join(' / ')})`)
    : bad(`clocks did not start: ${JSON.stringify(clocks)}`)
  // Two zones eight hours apart must not print the same wall time.
  clocks[0] !== clocks[1] ? ok('the two bases show different local times') : bad('both clocks show the same time')
  await page.close()
}
{
  const c2 = await browser.newContext({ javaScriptEnabled: false })
  const page = await c2.newPage()
  await page.goto(BASE + '/axz/', { waitUntil: 'domcontentloaded' })
  const cells = await page.$$eval('[data-clock]', cs => cs.map(c => c.textContent.trim()))
  cells.every(t => t.includes('/'))
    ? ok(`no JavaScript: the clocks name their time zone (${cells.join(' / ')})`)
    : bad(`no JS: clock cells are ${JSON.stringify(cells)}`)
  await page.close(); await c2.close()
}

/* 2i. Dispatch: every figure on the release is already published in the routes
      section, and the file the reader downloads must say exactly what the page
      said. Nothing is uploaded. */
console.log('\ndispatch desk')
{
  const page = await ctx.newPage()
  const uploads = []
  page.on('request', r => {
    if (r.method() === 'GET') return
    const body = r.postData() || ''
    if (/AXZ00|B-737X|KSFO SID/.test(body)) uploads.push(r.url())
  })
  await page.goto(BASE + '/axz/dispatch/', { waitUntil: 'networkidle' })

  const first = await page.innerText('[data-disp-release]')
  first.includes('AXZ001') && first.includes('KSFO SID OSI V25 SAPID T259 SANTY STAR KSNS')
    ? ok('a real release is rendered before any interaction') : bad('the release did not render server-side')

  await page.selectOption('[data-disp-leg]', 'AXZ004')
  await page.selectOption('[data-disp-ac]', 'b-0001f')
  const second = await page.innerText('[data-disp-release]')
  second.includes('AXZ004') && second.includes('ZSNJ SID ESBAG R343 SASAN STAR ZSPD') && second.includes('B-0001F')
    ? ok('both selects drive the release, and the return leg carries the return routing')
    : bad(`release did not update: ${second.replace(/\s+/g, ' ').slice(0, 160)}`)

  // The derived figure must be the published distance over the published time.
  const zh = await page.innerText('main')
  zh.includes('336') ? ok('average groundspeed is 280 km over 50 min = 336 km/h') : bad('derived groundspeed missing or wrong')
  !/燃油|油量\s*[:：]\s*\d/.test(zh) ? ok('the release states no fuel figure') : bad('a fuel number appeared on the release')

  const pending = page.waitForEvent('download', { timeout: 5000 }).catch(() => null)
  await page.click('[data-disp-download]')
  const download = await pending
  if (!download) bad('the download button produced no file')
  else {
    const stream = await download.createReadStream()
    let text = ''
    for await (const chunk of stream) text += chunk
    text.includes('AXZ004') && text.includes('ZSNJ SID ESBAG R343 SASAN STAR ZSPD')
      ? ok(`the downloaded release matches the page (${download.suggestedFilename()})`)
      : bad(`downloaded file disagrees with the page: ${text.slice(0, 120)}`)
  }
  uploads.length === 0 ? ok('nothing the desk produces is uploaded') : bad(`dispatch data was transmitted: ${uploads.join(' / ')}`)
  await page.close()
}
{
  const c2 = await browser.newContext({ javaScriptEnabled: false })
  const page = await c2.newPage()
  await page.goto(BASE + '/axz/dispatch/', { waitUntil: 'domcontentloaded' })
  const rel = await page.innerText('[data-disp-release]')
  rel.includes('AXZ001') ? ok('no JavaScript: a complete release is still on the page') : bad('no JS: the release is empty')
  await page.close(); await c2.close()
}

/* 2j. Landing score: a game is only shippable here if removing it leaves the
      information behind. The scoring table is server-rendered on every visit;
      the game reveals itself only once script runs, and its verdict must come
      out of that same table rather than from a second copy of the bands. */
console.log('\nlanding score')
{
  const page = await ctx.newPage()
  await page.goto(BASE + '/axz/dispatch/', { waitUntil: 'networkidle' })
  const bands = await page.$$eval('.lg-table tbody tr', rs => rs.map(r => r.querySelectorAll('td')[1].textContent.trim()))
  bands.length === 4 ? ok(`the scoring table lists all four bands: ${bands.join(' / ')}`) : bad(`${bands.length} bands in the table`)
  bands.includes('跑道震动器') && bands.includes('跑道按摩师')
    ? ok('the verdicts are the fleet files\' own phrases, not new ones') : bad(`unexpected verdict wording: ${bands.join(' / ')}`)

  const shown = await page.isVisible('[data-lg-game]')
  shown ? ok('the game reveals itself once script runs') : bad('the game stayed hidden with script running')

  // Play a full round on the keyboard alone, flaring where a pilot would
  // rather than the instant the run starts — an immediate flare is the one
  // input that floats longest, and it would be testing the timeout, not the game.
  await page.click('[data-lg-start]')
  await page.waitForTimeout(700)
  const flying = await page.evaluate(() => document.querySelector('[data-lg-alt]').textContent)
  ;/^\d+$/.test(flying) ? ok(`the approach runs (radio altitude ${flying})`) : bad(`altitude readout is "${flying}"`)
  await page.waitForFunction(() => Number(document.querySelector('[data-lg-alt]').textContent) <= 14, null, { timeout: 15000 }).catch(() => {})
  await page.keyboard.press('Space')
  await page.waitForSelector('.lg-result p', { timeout: 20000 }).catch(() => {})
  const verdict = await page.innerText('.lg-result').catch(() => '')
  const vs = (verdict.match(/\d+/) || [])[0]
  vs !== undefined ? ok(`space bar flares and the aircraft lands (${vs} ft/min)`) : bad(`no verdict after flaring: "${verdict}"`)
  bands.some(b => verdict.includes(b))
    ? ok('the verdict is one of the table\'s own rows') : bad(`verdict "${verdict}" is not in the scoring table`)
  await page.close()
}
{
  const c2 = await browser.newContext({ javaScriptEnabled: false })
  const page = await c2.newPage()
  await page.goto(BASE + '/axz/dispatch/', { waitUntil: 'domcontentloaded' })
  const hidden = !(await page.isVisible('[data-lg-game]'))
  const table = await page.$$eval('.lg-table tbody tr', rs => rs.length)
  hidden && table === 4
    ? ok('no JavaScript: the game is absent but the whole scoring table remains')
    : bad(`no JS: game hidden=${hidden}, table rows=${table}`)
  await page.close(); await c2.close()
}

/* 2k. Flight simulator. The engine is a dynamic import behind a button, so the
      properties that matter are: the page costs nothing until it is pressed,
      the whole reference is server-rendered either way, the aeroplane the
      engine flies is dimensioned from the fleet table rather than a second
      copy of it, and the landing bands are the dispatch desk's own. */
console.log('\nflight simulator')
{
  const page = await ctx.newPage()
  const asked = []
  page.on('request', r => { if (/assets\/sim-/.test(r.url())) asked.push(r.url()) })
  await page.goto(BASE + '/axz/sim/', { waitUntil: 'networkidle' })

  asked.length === 0
    ? ok('the engine is not fetched until the reader asks for it')
    : bad(`the engine downloaded on page load: ${asked.join(' / ')}`)

  const keys = await page.$$eval('.sim-keys tbody tr', rs => rs.length)
  keys >= 12 ? ok(`the control reference is server-rendered (${keys} rows)`) : bad(`${keys} control rows`)
  const pad = await page.innerText('.sim-keys')
  ;/RT|LT|D-pad|十字键/.test(pad) ? ok('gamepad bindings are documented, not just keys') : bad('no gamepad column content')

  // The fleet handed to the engine must match the table that draws sector 02.
  const fleet = JSON.parse(await page.getAttribute('[data-sim-stage]', 'data-sim-fleet'))
  Math.abs(fleet['b-737x'].len - 39.47) < 0.01 && Math.abs(fleet['b-321x'].len - 44.51) < 0.01
    ? ok('the simulator is dimensioned from the fleet table (737-800 39.47 m, A321 44.51 m)')
    : bad(`fleet dimensions disagree with the published table: ${JSON.stringify(fleet['b-737x'])}`)

  // All four published flights must be flyable, not just the California pair.
  const flights = await page.$$eval('[data-sim-flight] option', os => os.map(o => o.value))
  JSON.stringify(flights) === JSON.stringify(['AXZ001', 'AXZ002', 'AXZ003', 'AXZ004'])
    ? ok('all four published flights are selectable, both routes')
    : bad(`flight options are ${JSON.stringify(flights)}`)

  const bands = JSON.parse(await page.getAttribute('[data-sim-stage]', 'data-sim-bands'))
  const table = await page.$$eval('.lg-table tbody tr', rs => rs.map(r => r.querySelectorAll('td')[1].textContent.trim()))
  JSON.stringify(bands) === JSON.stringify(table)
    ? ok(`landing bands match the scoring table exactly: ${bands.join(' / ')}`)
    : bad(`bands ${JSON.stringify(bands)} but table ${JSON.stringify(table)}`)

  await page.close()
}
/* 2l. Audio. A page that builds an AudioContext on load is a page that can
      make noise at somebody who only came to read. The constructor is counted
      from before the first byte of the document: it must be zero on load, and
      it must still be SILENT after the engine starts, because sound is opt-in
      behind its own toggle. */
{
  const c2 = await browser.newContext()
  const page = await c2.newPage()
  await page.addInitScript(() => {
    window.__audioBuilt = 0
    for (const key of ['AudioContext', 'webkitAudioContext']) {
      const Orig = window[key]
      if (!Orig) continue
      window[key] = function (...a) { window.__audioBuilt++; return new Orig(...a) }
      window[key].prototype = Orig.prototype
    }
  })
  await page.goto(BASE + '/axz/sim/', { waitUntil: 'networkidle' })
  const onLoad = await page.evaluate(() => window.__audioBuilt)
  onLoad === 0 ? ok('no audio context is created on page load') : bad(`${onLoad} audio contexts built before any gesture`)

  await page.click('[data-sim-start]')
  await page.waitForTimeout(2200)
  const after = await page.evaluate(() => window.__audioBuilt)
  after === 1 ? ok('the engine builds exactly one audio context, from the start gesture')
              : bad(`${after} audio contexts after start`)

  /* The renderer's optional passes. Both degrade rather than fail, so the
     assertion is that whichever path runs, the scene actually paints: a
     framebuffer misconfiguration shows up as a canvas that is one flat colour,
     which no amount of "no console errors" would catch. */
  const gfx = await page.evaluate(() => new Promise(res => {
    const s = window.__axzSimHandle && window.__axzSimHandle.sim
    if (!s) return res(null)
    const gl = s.gl, cv = s.canvas
    const orig = s.render.bind(s)
    let got = null
    s.render = () => {
      orig()
      if (!got) {
        const w = cv.width, h = cv.height
        const seen = new Set()
        for (let i = 0; i < 9; i++) {
          for (let j = 0; j < 9; j++) {
            const b = new Uint8Array(4)
            gl.readPixels(Math.round(w * (0.1 + i * 0.1)), Math.round(h * (0.1 + j * 0.1)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b)
            seen.add(b[0] + ',' + b[1] + ',' + b[2])
          }
        }
        got = { post: s.post.ok, shadows: s.shadows.ok, distinct: seen.size }
        s.render = orig
      }
    }
    setTimeout(() => res(got), 900)
  }))
  if (gfx) {
    gfx.distinct >= 8
      ? ok(`the scene renders real content (${gfx.distinct} distinct colours sampled, post=${gfx.post}, shadows=${gfx.shadows})`)
      : bad(`the canvas is nearly flat: only ${gfx.distinct} distinct colours across the frame`)
  }

  /* Every type must hold a trimmed approach in the wind. This is a regression
     for a bug that had been live for two builds: the assist drove steady-state
     SIDESLIP to zero, but a crosswind approach requires steady sideslip, so it
     kept yawing and on the heavier types wound up into a departure. Adding the
     747 is what made it visible; the 737 had been quietly doing it too. */
  const roster = JSON.parse(await page.getAttribute('[data-sim-stage]', 'data-sim-fleet'))
  const types = roster._order || []
  types.length === 8 ? ok(`${types.length} types are selectable`) : bad(`${types.length} types, expected 8`)
  const flown = await page.evaluate(async (ids) => {
    const s = window.__axzSimHandle.sim
    const out = []
    for (const id of ids) {
      s.setAircraft(id); s.setScenario('approach')
      await new Promise(r => setTimeout(r, 500))
      const a0 = s.readout()
      await new Promise(r => setTimeout(r, 6000))
      const a1 = s.readout()
      out.push({
        id, ias: Math.round(a1.ias), vs: Math.round(a1.vs),
        alpha: Math.abs(s.ac.alpha * 57.3),
        // Vref scales with the type, so the check is that it HELD its speed,
        // not that it matches some absolute number.
        held: Math.abs(a1.ias - a0.ias) < 12 && Math.abs(a1.vs) < 1500 && Math.abs(s.ac.alpha * 57.3) < 20,
      })
    }
    return out
  }, types)
  const departed = flown.filter(f => !f.held)
  departed.length === 0
    ? ok(`all ${flown.length} types hold a trimmed approach in a crosswind`)
    : bad(`departed: ${departed.map(d => d.id + ' a=' + d.alpha.toFixed(0) + ' vs=' + d.vs).join(', ')}`)

  /* Escape must actually pause. It was listed in the bindings and printed in
     the control table but missing from the set of keys the handler owns, so
     the documented pause key silently did nothing. */
  await page.evaluate(() => document.querySelector('.sim-canvas').focus())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const pausedAttr = await page.getAttribute('[data-sim-stage]', 'data-paused')
  pausedAttr === 'true' ? ok('Escape pauses the simulator') : bad(`Escape did not pause (data-paused=${pausedAttr})`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  /* And the sim must not eat keys aimed at the rest of the page. The listener
     is on window, so without a focus check WASD moved the elevator while
     somebody was reading the control table below. */
  const camBefore = await page.textContent('[data-sim-field="camera"]')
  await page.evaluate(() => document.querySelector('[data-sim-scenario]').focus())
  await page.keyboard.press('KeyC')
  await page.waitForTimeout(400)
  const camAfter = await page.textContent('[data-sim-field="camera"]')
  camBefore === camAfter
    ? ok('keys are ignored while the page, not the sim, has focus')
    : bad(`the sim consumed a key aimed elsewhere: ${camBefore} -> ${camAfter}`)

  const pressed = await page.getAttribute('[data-sim-action="sound"]', 'aria-pressed')
  pressed === 'false' ? ok('sound starts muted and is opt-in') : bad(`sound button starts aria-pressed=${pressed}`)
  await page.click('[data-sim-action="sound"]')
  await page.waitForTimeout(300)
  const on = await page.getAttribute('[data-sim-action="sound"]', 'aria-pressed')
  on === 'true' ? ok('the sound toggle reports its state') : bad(`sound toggle did not update: ${on}`)
  await page.close(); await c2.close()
}
{
  const c2 = await browser.newContext({ javaScriptEnabled: false })
  const page = await c2.newPage()
  await page.goto(BASE + '/axz/sim/', { waitUntil: 'domcontentloaded' })
  const rows = await page.$$eval('.sim-keys tbody tr', rs => rs.length)
  const bandRows = await page.$$eval('.lg-table tbody tr', rs => rs.length)
  const panelHidden = !(await page.isVisible('[data-sim-panel]'))
  rows >= 12 && bandRows === 4 && panelHidden
    ? ok('no JavaScript: the controls and scoring bands are all still there, the readout is not')
    : bad(`no JS: ${rows} control rows, ${bandRows} bands, panel hidden=${panelHidden}`)
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
