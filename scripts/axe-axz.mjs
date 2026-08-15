// WCAG 2.2 AA scan across all 10 documents, in both themes.
// Run against the local preview (node .axz-serve.mjs) on :4788.
import { chromium } from '/Users/brookxiao/New/Xiao/Website/node_modules/playwright/index.mjs'
import { readFileSync } from 'node:fs'

const AXE = readFileSync('/Users/brookxiao/New/Xiao/Website/node_modules/axe-core/axe.min.js', 'utf8')
const BASE = 'http://localhost:4788'

const PAGES = [
  '/axz/', '/axz/guestbook/', '/axz/logbook/', '/axz/dispatch/', '/axz/accessibility/', '/axz/aprilfools/',
  '/axz/en/', '/axz/en/guestbook/', '/axz/en/logbook/', '/axz/en/dispatch/', '/axz/en/accessibility/', '/axz/en/aprilfools/',
]

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']

const browser = await chromium.launch()
let total = 0
const all = []

for (const theme of ['day', 'night']) {
  const ctx = await browser.newContext({ colorScheme: theme === 'night' ? 'dark' : 'light' })
  for (const path of PAGES) {
    const page = await ctx.newPage()
    await page.goto(BASE + path, { waitUntil: 'networkidle' })
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)

    // The April Fools original is behind a real button; open it so the scan
    // covers the content, not just the gate.
    const enter = await page.$('[data-af-enter]')
    if (enter) { await enter.click(); await page.waitForTimeout(120) }

    await page.addScriptTag({ content: AXE })
    const res = await page.evaluate(t => window.axe.run(document, { runOnly: { type: 'tag', values: t } }), TAGS)

    for (const v of res.violations) {
      total += v.nodes.length
      all.push({ theme, path, id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
        sample: v.nodes[0]?.html?.slice(0, 130), target: v.nodes[0]?.target?.join(' ') })
    }
    console.log(`  ${theme.padEnd(5)} ${path.padEnd(26)} ${res.violations.length ? '✗ ' + res.violations.length + ' rules' : '✓'} (${res.passes.length} passed)`)
    await page.close()
  }
  await ctx.close()
}
await browser.close()

if (all.length) {
  console.log(`\n✗ ${total} violating nodes across ${all.length} rule/page/theme combinations:\n`)
  const byRule = {}
  for (const v of all) (byRule[v.id] ||= []).push(v)
  for (const [id, vs] of Object.entries(byRule)) {
    console.log(`  ${id} [${vs[0].impact}] — ${vs[0].help}`)
    console.log(`    ${vs.length} occurrence(s), e.g. ${vs[0].theme} ${vs[0].path} ${vs[0].target}`)
    console.log(`    ${vs[0].sample}\n`)
  }
  process.exit(1)
}
console.log(`\n✓ zero axe violations across ${PAGES.length} documents x 2 themes`)
