import { test } from 'node:test'
import assert from 'node:assert/strict'
import { interpolate, fgProperty, evaluateRig, stateFrom, evalCondition } from '../../axz-src/js/sim3/rig.js'

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

test('a select on an unknown property hides its objects, as FlightGear does with an unset one', () => {
  const rig = { parts: [{ animations: [
    { type: 'select', objects: ['chute'], property: 'sim/model/f16/chute' },
    { type: 'select', objects: ['chocks'], property: 'gear/gear[0]/wow' },
    { type: 'select', objects: ['covers'], condition: { op: 'not', a: { op: 'property', name: 'sim/model/c172p/securing/covers' } } },
    { type: 'rotate', objects: ['door'], property: 'gear/gear[0]/position-norm', factor: 90, axis: [1, 0, 0], condition: { op: 'gt', left: { property: 'engines/engine[0]/n1' }, right: { value: 50 } } },
  ] }] }
  const ops = evaluateRig(rig, S)
  assert.equal(ops.get('chute')[0].visible, false)
  assert.equal(ops.get('chocks')[0].visible, true)
  assert.equal(ops.get('covers')[0].visible, true)      // not(unset) = shown
  assert.equal(ops.get('door')[0].deg, 90)             // n1 80 > 50: the condition holds
  assert.equal(evalCondition({ op: 'and', list: [{ op: 'property', name: 'gear/gear[0]/wow' }, { op: 'lt', left: { property: 'controls/flight/flaps' }, right: { value: 1 } }] }, S), true)
})

test('two selects on one object AND, as FlightGear shows an object only when every select passes', () => {
  const rig = { parts: [{ name: 'fx', animations: [
    { type: 'select', objects: ['ShockWave'], condition: { op: 'and', list: [{ op: 'not', a: { op: 'or', list: [{ op: 'lt', left: { property: '/velocities/mach' }, right: { value: 0.89 } }, { op: 'gt', left: { property: '/velocities/mach' }, right: { value: 1.05 } }] } }, { op: 'lt', left: { property: '/position/altitude-ft' }, right: { value: 60000 } }] } },
    { type: 'select', objects: ['ShockWave'], condition: { op: 'not', a: { op: 'property', name: '/sim/rendering/rembrandt/enabled' } } },
  ] }] }
  const S = stateFrom({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ctl: {}, eng: [1], onGround: true, mach: 0 })
  const ops = evaluateRig(rig, S)
  const sel = ops.get('ShockWave').filter(o => o.type === 'select')
  assert.equal(sel.length, 1)
  assert.equal(sel[0].visible, false, 'at rest the shock cone is hidden even though the renderer select passes')
  const fast = evaluateRig(rig, stateFrom({ pos: { x: 0, y: 3000, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ctl: {}, eng: [1], onGround: false, mach: 0.97 }))
  assert.equal(fast.get('ShockWave').find(o => o.type === 'select').visible, true, 'transonic and low, both selects pass')
})
