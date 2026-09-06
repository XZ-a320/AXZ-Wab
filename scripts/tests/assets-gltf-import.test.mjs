import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orient, planYaw } from '../assets/gltf-import.mjs'

/* A synthetic airframe as a point cloud in FlightGear's own frame (x aft,
   y starboard, z up): a fuselage line, a swept wing, a tailplane and a fin
   on top at the tail. Every test permutes and flips axes, or yaws it, and
   asks orient() to find the frame again. */
function airframe({ len = 40, span = 35, fin = 10, sweep = 0.35 } = {}) {
  const pts = []
  for (let i = 0; i <= 200; i++) { const x = -len / 2 + len * i / 200; for (const dy of [-1.8, 0, 1.8]) for (const dz of [-1.8, 0, 1.8]) pts.push([x, dy, dz]) }
  for (let j = -50; j <= 50; j++) { const y = span / 2 * j / 50; const x0 = -len * 0.05 + Math.abs(y) * sweep; for (let k = 0; k < 4; k++) pts.push([x0 + k * 1.5, y, -0.5]) }
  for (let j = -12; j <= 12; j++) { const y = span * 0.2 * j / 12; pts.push([len * 0.42 + Math.abs(y) * 0.4, y, 0.5]) }
  for (let k = 0; k <= 30; k++) pts.push([len * 0.38 + k * 0.1, 0, 1 + fin * k / 30])
  return pts
}
const meas = pts => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const p of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]) } return { mn, mx, ext: mx.map((v, i) => v - mn[i]), pts } }
const apply = (pts, f) => pts.map(f)
const frameOf = o => o.rows.map(r => (r.findIndex(v => v !== 0) + 1) * (r.find(v => v !== 0) > 0 ? 1 : -1))  // signed 1-based source axis per FG axis

test('orient: a Y-up export (x aft, y up, z port) comes back as x aft, y starboard, z up', () => {
  const src = apply(airframe(), ([x, y, z]) => [x, z, -y])
  const o = orient(meas(src), { len: 40, span: 35 })
  assert.deepEqual(frameOf(o), [1, -3, 2])
})

test('orient: a Z-up export with the nose at +x flips aft', () => {
  const src = apply(airframe(), ([x, y, z]) => [-x, y, z])
  const o = orient(meas(src), { len: 40, span: 35 })
  assert.equal(o.sx, -1)
  assert.equal(frameOf(o)[0], -1)
})

test('orient: an inverted export (fin below) turns the right way up', () => {
  const src = apply(airframe(), ([x, y, z]) => [x, -y, -z])
  const o = orient(meas(src), { len: 40, span: 35 })
  assert.equal(o.sz, -1)
  assert.ok(o.finRatio < 0.8)
})

test('orient: length is found by nose-tail asymmetry even when the model is nearly square', () => {
  const src = apply(airframe({ len: 30.4, span: 30.6 }), ([x, y, z]) => [y, z, x])   // span on X, length on Z, ratio ~1
  const o = orient(meas(src), { len: 30.41, span: 30.36 })
  assert.equal(o.L, 2)
  assert.equal(o.S, 0)
  assert.ok(o.asym[0] > 0.5 && o.asym[1] < 0.1 || o.asym[1] > 0.5 && o.asym[0] < 0.1)
})

test('orient: a flying wing (wider than long, no fin) keeps its apex forward and its hump up', () => {
  const pts = []
  for (let j = -60; j <= 60; j++) { const y = 26 * j / 60; const xle = -10 + Math.abs(y) * 0.6; for (let k = 0; k < 6; k++) pts.push([xle + k * (16 - Math.abs(y) * 0.2) / 5, y, Math.abs(y) < 4 ? 1.5 - k * 0.2 : 0]) }
  const o = orient(meas(pts), { len: 21, span: 52 })
  assert.deepEqual({ L: o.L, sx: o.sx, sz: o.sz }, { L: 0, sx: 1, sz: 1 }, JSON.stringify({ asym: o.asym, fin: o.finRatio, H: o.H }))
})

test('planYaw: a model posed 33° in plan reports the yaw within a degree', () => {
  const th = 33 * Math.PI / 180
  const src = apply(airframe(), ([x, y, z]) => [x * Math.cos(th) - y * Math.sin(th), x * Math.sin(th) + y * Math.cos(th), z])
  const { theta } = planYaw(meas(src), 2)
  assert.ok(Math.abs(Math.abs(theta) * 180 / Math.PI - 33) < 1, `got ${theta * 180 / Math.PI}`)
})
