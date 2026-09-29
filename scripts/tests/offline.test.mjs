import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inlineModules, zip } from '../offline.mjs'

const SIM = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'axz-src', 'js', 'sim')

test('inlined modules keep named, renamed, star and list exports', () => {
  const code = inlineModules([
    ['math', `export const TWO = 2\nexport function dbl(x) { return x * TWO }\nconst hidden = 9\nexport { hidden as nine }`],
    ['calc', `import {\n  dbl,\n  nine as n,\n} from './math.js'\nimport * as M from './math.js'\nexport async function run() { return dbl(n) + M.TWO }\nexport class K {}`],
  ], 'calc')
  const mod = new Function(`return ${code}`)()
  return mod.run().then(v => { assert.equal(v, 20); assert.equal(typeof mod.K, 'function') })
})

test('an import of a module not yet defined stops the build', () => {
  assert.throws(() => inlineModules([['a', `import { x } from './b.js'`], ['b', 'export const x = 1']], 'a'), /before it is defined/)
})

test('syntax the inliner does not know stops the build', () => {
  assert.throws(() => inlineModules([['a', `export default 5`]], 'a'), /unsupported module syntax/)
})

test('the real 1.0 engine inlines and parses, and exposes boot', () => {
  const order = ['math', 'gl', 'tex', 'post', 'sound', 'world', 'model', 'fdm', 'particles', 'shadow', 'input', 'mobile', 'hud', 'main', 'boot']
  const code = inlineModules(order.map(f => [f, readFileSync(join(SIM, `${f}.js`), 'utf8')]), 'boot')
  // Parse only: the engine needs a DOM to run. A syntax error throws here.
  assert.doesNotThrow(() => new Function(`return ${code}`))
  assert.match(code, /return \{ boot \};/)
})

test('zip output is deterministic and unzips to the same bytes', () => {
  const files = [{ name: 'a.html', data: Buffer.from('<p>hello</p>'.repeat(200)) }, { name: 'b.txt', data: Buffer.from('x') }]
  const one = zip(files), two = zip(files)
  assert.deepEqual(one, two)
  const dir = mkdtempSync(join(tmpdir(), 'axz-zip-'))
  writeFileSync(join(dir, 't.zip'), one)
  execFileSync('unzip', ['-q', join(dir, 't.zip'), '-d', join(dir, 'x')])
  assert.equal(readFileSync(join(dir, 'x', 'a.html'), 'utf8'), '<p>hello</p>'.repeat(200))
  assert.equal(readFileSync(join(dir, 'x', 'b.txt'), 'utf8'), 'x')
})

test('zip refuses non-ASCII entry names', () => {
  assert.throws(() => zip([{ name: '飞行.html', data: Buffer.from('') }]), /ASCII/)
})
