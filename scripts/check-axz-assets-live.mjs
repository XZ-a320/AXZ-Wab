#!/usr/bin/env node
/* ==========================================================================
   The deployed assets origin, checked from outside.

   verify-axz proves the loader against a local origin. This proves the
   ORIGIN: index.json is reachable, every file the index names is reachable
   at the size the index says, CORS lets xiaobrook.com read it, and the
   caching is what vercel.json promised (immutable for hashed files, short
   for the index). Run it after every deploy of axz-assets, and before any
   merge that points the site at it.

     node scripts/check-axz-assets-live.mjs https://<origin>
     node scripts/check-axz-assets-live.mjs http://localhost:4790 --local   (no cache headers expected)
   ========================================================================== */
const fails = []
const ok = m => console.log(`  ✓ ${m}`)
const bad = m => { fails.push(m); console.log(`  ✗ ${m}`) }

export async function checkOrigin(origin, { local = false, fetchImpl = fetch } = {}) {
  const problems = []
  const res = await fetchImpl(`${origin}/index.json`, { headers: { Origin: 'https://xiaobrook.com' } }).catch(e => ({ ok: false, status: 0, error: e }))
  if (!res.ok) { problems.push(`index.json: ${res.status || res.error}`); return { problems, index: null, checked: 0 } }
  const cors = res.headers.get('access-control-allow-origin')
  if (cors !== '*' && cors !== 'https://xiaobrook.com') problems.push(`index.json: access-control-allow-origin is "${cors}", expected * or https://xiaobrook.com`)
  const cc = res.headers.get('cache-control') || ''
  if (!local && !/max-age=300/.test(cc)) problems.push(`index.json: cache-control "${cc}", expected max-age=300`)
  const index = await res.json()
  let checked = 0
  for (const [id, a] of Object.entries(index.assets || {})) {
    const r = await fetchImpl(`${origin}/${a.url}`, { method: 'HEAD', headers: { Origin: 'https://xiaobrook.com' } }).catch(e => ({ ok: false, status: 0, error: e, headers: new Headers() }))
    checked++
    if (!r.ok) { problems.push(`${id}: ${a.url} → ${r.status || r.error}`); continue }
    const len = Number(r.headers.get('content-length'))
    if (len && len !== a.bytes) problems.push(`${id}: content-length ${len} ≠ index bytes ${a.bytes}`)
    const c = r.headers.get('access-control-allow-origin')
    if (c !== '*' && c !== 'https://xiaobrook.com') problems.push(`${id}: no CORS header on ${a.url}`)
    const cache = r.headers.get('cache-control') || ''
    if (!local && !/immutable/.test(cache)) problems.push(`${id}: cache-control "${cache}", expected immutable`)
  }
  return { problems, index, checked }
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const origin = (process.argv[2] || process.env.AXZ_ASSETS_ORIGIN || '').replace(/\/+$/, '')
  const local = process.argv.includes('--local')
  if (!origin) { console.error('usage: node scripts/check-axz-assets-live.mjs https://<origin> [--local]'); process.exit(2) }
  console.log(`assets origin ${origin}${local ? ' (local: cache headers not expected)' : ''}`)
  const { problems, index, checked } = await checkOrigin(origin, { local })
  if (index) ok(`index.json v${index.version}, built ${index.builtAt}, ${Object.keys(index.assets).length} asset(s), ${index.credits.length} credit(s)`)
  if (checked) ok(`${checked} file(s) HEAD-checked for reachability, size and CORS`)
  for (const p of problems) bad(p)
  console.log(fails.length ? `\n✗ ${fails.length} problem(s)` : `\n✓ the origin serves what the index promises`)
  process.exit(fails.length ? 1 : 0)
}
