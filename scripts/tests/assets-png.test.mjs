import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decodePng, encodePng } from '../assets/png.mjs'
import { neutralise } from '../assets/neutralise-livery.mjs'
import { probePng } from '../assets/make-probe.mjs'

test('decodePng round-trips the probe PNG through encodePng', () => {
  const img = decodePng(probePng(16))
  assert.equal(img.width, 16); assert.equal(img.rgba[0], 0); assert.equal(img.rgba[(15) * 4], 255)     // R = u
  const again = decodePng(encodePng(img))
  assert.deepEqual([...again.rgba], [...img.rgba])
})

test('neutralise paints saturated marks with the paint colour and leaves greys alone', () => {
  const w = 8, h = 1, rgba = Buffer.alloc(w * h * 4)
  const px = [[230, 230, 230], [20, 20, 20], [200, 30, 30], [30, 40, 200], [120, 120, 125], [240, 240, 240], [250, 200, 40], [255, 255, 255]]
  px.forEach((p, i) => { rgba[i * 4] = p[0]; rgba[i * 4 + 1] = p[1]; rgba[i * 4 + 2] = p[2]; rgba[i * 4 + 3] = 255 })
  const r = neutralise({ width: w, height: h, rgba, hadAlpha: false }, { fill: [235, 235, 235] })
  assert.equal(r.changed, 3)
  assert.deepEqual([...r.img.rgba.subarray(8, 11)], [235, 235, 235])    // the red mark
  assert.deepEqual([...r.img.rgba.subarray(4, 7)], [20, 20, 20])        // the dark window line
  assert.deepEqual([...r.img.rgba.subarray(16, 19)], [120, 120, 125])   // grey shadow
})
