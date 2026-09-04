import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpolate, fgProperty, evaluateRig, stateFrom } from '../../axz-src/js/sim3/rig.js'

const S = { gear: 1, gearComp: [0.5, 0.2, 0.2], flap: 0.5, slat: 1, aileron: -0.5, elevator: 0.2, rudder: 0.1, spoiler: 0, speedbrake: 0.3, n1: [0.8, 0.6], reverse: [0, 0], throttle: [0.7, 0.7], wheelSpeed: [10, 10, 10], brakeL: 0, brakeR: 1, steer: 0.1, onGround: true }

test('interpolate follows a table and clamps outside it', () => {
  const t = [[0, 0], [0.5, 10], [1, 90]]
  assert.equal(interpolate(t, -1), 0); assert.equal(interpolate(t, 0.25), 5); assert.equal(interpolate(t, 0.75), 50); assert.equal(interpolate(t, 2), 90)
})

test('fgProperty translates the vocabulary a flight model can answer, and refuses the rest', () => {
  assert.equal(fgProperty('gear/gear[0]/position-norm', S), 1)
  assert.equal(fgProperty('gear/gear[1]/compression-norm', S), 0.2)
  assert.equal(fgProperty('/gear/gear[2]/rollspeed-ms', S), 10)
  assert.equal(fgProperty('surface-positions/flap-pos-norm', S), 0.5)
  assert.equal(fgProperty('controls/flight/flaps', S), 0.5)
  assert.equal(fgProperty('controls/flight/aileron', S), -0.5)
  assert.ok(Math.abs(fgProperty('fdm/jsbsim/fcs/aileron[1]/pos-rad', S) + 0.175) < 1e-9)
  assert.equal(fgProperty('engines/engine[1]/n1', S), 60)
  assert.equal(fgProperty('engines/engine/n1', S), 80)
  assert.equal(fgProperty('controls/engines/engine[0]/throttle', S), 0.7)
  assert.equal(fgProperty('controls/gear/brake-right', S), 1)
  assert.equal(fgProperty('b737/controls/gear/lever', S), 1)
  assert.equal(fgProperty('controls/doors/cargo1/position-norm', S), 0)
  assert.equal(fgProperty('instrumentation/garmin196/light', S), null)
})

test('evaluateRig turns animations into per-object ops, skipping unknown properties', () => {
  const rig = { parts: [{ animations: [
    { type: 'rotate', objects: ['rhngdoor', 'lhngdoor'], property: 'gear/gear[0]/position-norm', table: [[0, 0], [1, 90]], axis: [1, 0, 0], center: [-16.5, 0.5, -1] },
    { type: 'translate', objects: ['noseaxle'], property: 'gear/gear[0]/compression-norm', factor: 0.3048, axis: [0, 0, 1] },
    { type: 'spin', objects: ['fan'], property: 'engines/engine[0]/n1', factor: 60, axis: [1, 0, 0], center: [0, 0, 0] },
    { type: 'rotate', objects: ['gps'], property: 'instrumentation/garmin196/light', factor: 1, axis: [0, 0, 1] },
    { type: 'select', objects: ['chocks'], property: 'gear/gear[0]/wow' },
  ] }] }
  const ops = evaluateRig(rig, S)
  assert.deepEqual([...ops.keys()].sort(), ['chocks', 'fan', 'lhngdoor', 'noseaxle', 'rhngdoor'])
  assert.equal(ops.get('rhngdoor')[0].deg, 90); assert.deepEqual(ops.get('rhngdoor')[0].center, [-16.5, 0.5, -1])
  assert.ok(Math.abs(ops.get('noseaxle')[0].m - 0.1524) < 1e-9)
  assert.equal(ops.get('fan')[0].rpm, 4800)
  assert.equal(ops.get('chocks')[0].visible, true)
})

test('stateFrom reads the 2.0 flight model fields', () => {
  const ac = { gearPos: 0.3, flapDeg: 20, cfg: { flapMaxDeg: 40 }, ctl: { aileron: 0.4, elevator: -0.1, rudder: 0.2 }, thrustLag: 0.5, eng: [1, 0], throttle: 0.9, reverse: true, reversePos: 0.7, brakes: 0.5, onGround: true, vel: { x: 3, y: 0, z: 4 } }
  const s = stateFrom(ac)
  assert.equal(s.gear, 0.3); assert.equal(s.flap, 0.5); assert.equal(s.aileron, 0.4); assert.deepEqual(s.n1, [0.5, 0]); assert.deepEqual(s.reverse, [0.7, 0.7]); assert.equal(s.wheelSpeed[0], 5); assert.equal(s.steer, -0.2)
})

import { FG_TO_BODY_Q, fgToBody, fgToAc, acToFg, rotateByQuat } from '../../axz-src/js/sim3/rig.js'
test('the FlightGear→body quaternion sends fg x (aft) to body z, fg y (starboard) to body x, fg z (up) to body y', () => {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9)
  assert.ok(near(rotateByQuat(FG_TO_BODY_Q, [1, 0, 0]), [0, 0, 1]))
  assert.ok(near(rotateByQuat(FG_TO_BODY_Q, [0, 1, 0]), [1, 0, 0]))
  assert.ok(near(rotateByQuat(FG_TO_BODY_Q, [0, 0, 1]), [0, 1, 0]))
  assert.deepEqual(fgToBody([1, 2, 3]), [2, 3, 1])
  assert.deepEqual(acToFg(fgToAc([1, 2, 3])), [1, 2, 3])
  assert.deepEqual(fgToAc([-16.55, 0.48, -1.09]), [-16.55, -1.09, -0.48])   // the nose gear door centre, measured
})
