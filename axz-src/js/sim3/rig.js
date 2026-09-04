/* ==========================================================================
   AXZ sim 3.0 — evaluating a FlightGear rig against our flight model.

   A rig is a list of animations, each naming objects, a property, an axis,
   a centre and either a factor or an interpolation table. FlightGear's
   property names are a vocabulary; this file translates the ones a flight
   model can answer into numbers, evaluates each animation, and returns the
   operations to apply per object. No Three.js here, so it is tested in Node.
   ========================================================================== */

/** Linear interpolation through a FlightGear <interpolation> table. */
export function interpolate(table, x) {
  if (!table || !table.length) return x
  if (x <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1], [x1, y1] = table[i]
    if (x <= x1) return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0)
  }
  return table[table.length - 1][1]
}

/**
 * The flight model, in FlightGear's words. `S` is the normalised state:
 *   gear 0..1 (1 down), gearComp[i] 0..1, flap 0..1, slat 0..1, aileron/elevator/rudder −1..1,
 *   spoiler 0..1, speedbrake 0..1, n1[i] 0..1, reverse[i] 0..1, throttle[i] 0..1,
 *   wheelSpeed[i] m/s, brakeL/brakeR 0..1, steer −1..1, onGround
 */
export function fgProperty(name, S) {
  const p = name.replace(/^\//, '')
  const idx = /\[(\d+)\]/.exec(p); const i = idx ? +idx[1] : 0
  const arr = (a, dflt = 0) => (Array.isArray(a) ? (a[i] != null ? a[i] : a[0] != null ? a[0] : dflt) : (a != null ? a : dflt))
  if (/^gear\/gear(\[\d+\])?\/position-norm$/.test(p)) return S.gear
  if (/^gear\/gear(\[\d+\])?\/compression-(norm|m)$/.test(p)) return arr(S.gearComp) * (p.endsWith('-m') ? 0.3 : 1)
  if (/^gear\/gear(\[\d+\])?\/rollspeed-ms$/.test(p)) return arr(S.wheelSpeed)
  if (/^gear\/gear(\[\d+\])?\/(caster-angle-deg|steering-norm)/.test(p) || /steering-angle-deg$/.test(p)) return S.steer * (p.includes('deg') ? 70 : 1)
  if (/^gear\/gear(\[\d+\])?\/wow$/.test(p)) return S.onGround ? 1 : 0
  if (/tailhook\/position-norm$/.test(p)) return 0
  if (/^(surface-positions\/flap-pos-norm|controls\/flight\/flaps|fdm\/jsbsim\/fcs\/flap-pos-norm|controls\/flight\/flaps-pos)$/.test(p)) return S.flap
  if (/slat/.test(p)) return S.slat
  if (/^(controls\/flight\/aileron|surface-positions\/(left|right)-aileron-pos-norm|surface-positions\/aileron-pos-norm)$/.test(p)) return S.aileron
  if (/^fdm\/jsbsim\/fcs\/aileron(\[\d+\])?\/pos-rad$/.test(p)) return S.aileron * 0.35
  if (/^(controls\/flight\/elevator|surface-positions\/elevator-pos-norm)$/.test(p)) return S.elevator
  if (/^fdm\/jsbsim\/fcs\/elevator(\[\d+\])?\/pos-rad$/.test(p)) return S.elevator * 0.3
  if (/^(controls\/flight\/rudder|surface-positions\/rudder-pos-norm)$/.test(p)) return S.rudder
  if (/^fdm\/jsbsim\/fcs\/rudder-pos-rad$/.test(p)) return S.rudder * 0.45
  if (/^(surface-positions\/speedbrake-pos-norm|surface-positions\/speedbrake-pos-anim-lag|controls\/flight\/speedbrake)$/.test(p)) return S.speedbrake
  if (/^(controls\/flight\/spoiler(-\d+|s)?|b737\/controls\/flight\/spoilers-lever-pos|fdm\/jsbsim\/fcs\/spoiler(\[\d+\])?\/pos-norm)$/.test(p)) return S.spoiler
  if (/^fdm\/jsbsim\/fcs\/spoiler(\[\d+\])?\/pos-deg$/.test(p)) return S.spoiler * 45
  if (/^engines\/engine(\[\d+\])?\/(n1|n2|rpm)$/.test(p)) return arr(S.n1) * (p.endsWith('rpm') ? 2400 : 100)
  if (/^engines\/engine(\[\d+\])?\/reverser-pos-norm$/.test(p) || /^controls\/engines\/engine(\[\d+\])?\/reverser$/.test(p)) return arr(S.reverse)
  if (/^controls\/engines\/engine(\[\d+\])?\/throttle(-movement)?$/.test(p)) return arr(S.throttle)
  if (/^controls\/gear\/brake-left$/.test(p)) return S.brakeL
  if (/^controls\/gear\/brake-right$/.test(p)) return S.brakeR
  if (/^controls\/gear\/(gear-down|gear-down-command)$/.test(p)) return S.gear > 0.5 ? 1 : 0
  if (/^b737\/controls\/gear\/lever$/.test(p)) return S.gear > 0.5 ? 1 : 0
  if (/^controls\/doors\//.test(p) || /door-positions/.test(p) || /baydoors/.test(p)) return 0
  if (/^sim\/multiplay\//.test(p)) return 0
  return null                                          // not a thing a flight model knows; the animation is skipped
}

/** Evaluate every animation; returns Map<objectName, op[]> with ops in rig order. */
export function evaluateRig(rig, S) {
  const ops = new Map()
  for (const part of rig.parts || []) {
    for (const a of part.animations || []) {
      if (!a.objects || !a.objects.length) continue
      const v = a.property ? fgProperty(a.property, S) : 0
      if (v == null) continue
      let op = null
      if (a.type === 'rotate') {
        let d = a.table ? interpolate(a.table, v) : v * (a.factor == null ? 1 : a.factor) + (a.offsetDeg || 0)
        if (a.min != null) d = Math.max(a.min, d); if (a.max != null) d = Math.min(a.max, d)
        if (!a.axis) continue
        op = { type: 'rotate', axis: a.axis, center: a.center || [0, 0, 0], deg: d }
      } else if (a.type === 'translate') {
        let m = a.table ? interpolate(a.table, v) : v * (a.factor == null ? 1 : a.factor) + (a.offsetM || 0)
        if (a.min != null) m = Math.max(a.min, m); if (a.max != null) m = Math.min(a.max, m)
        if (!a.axis) continue
        op = { type: 'translate', axis: a.axis, m }
      } else if (a.type === 'spin') {
        if (!a.axis) continue
        op = { type: 'spin', axis: a.axis, center: a.center || [0, 0, 0], rpm: v * (a.factor == null ? 1 : a.factor) }
      } else if (a.type === 'select') {
        op = { type: 'select', visible: v > 0.5 }
      } else continue
      for (const name of a.objects) { if (!ops.has(name)) ops.set(name, []); ops.get(name).push(op) }
    }
  }
  return ops
}

/** Our flight model → the normalised state the rig reads. */
export function stateFrom(ac) {
  const nEng = (ac.eng && ac.eng.length) || 1
  const rev = ac.reversePos != null ? ac.reversePos : (ac.reverse ? 1 : 0)
  const flapDeg = ac.flapDeg != null ? ac.flapDeg : 0
  const flapMax = (ac.cfg && ac.cfg.flapMaxDeg) || 40
  return {
    gear: ac.gearPos == null ? 1 : ac.gearPos,
    gearComp: ac.gearComp || [0.4, 0.4, 0.4],
    flap: Math.max(0, Math.min(1, flapDeg / flapMax)),
    slat: Math.max(0, Math.min(1, flapDeg > 0.5 ? 1 : 0)),
    aileron: (ac.ctl && ac.ctl.aileron) || 0, elevator: (ac.ctl && ac.ctl.elevator) || 0, rudder: (ac.ctl && ac.ctl.rudder) || 0,
    spoiler: ac.spoilerPos != null ? ac.spoilerPos : 0, speedbrake: ac.speedbrakePos != null ? ac.speedbrakePos : (ac.spoilerPos || 0),
    n1: new Array(nEng).fill(ac.crashed ? 0 : (ac.thrustLag || 0)).map((v, i) => (ac.eng && ac.eng[i] === 0 ? 0 : v)),
    reverse: new Array(nEng).fill(rev), throttle: new Array(nEng).fill(ac.throttle || 0),
    wheelSpeed: new Array(3).fill(ac.onGround && ac.vel ? Math.hypot(ac.vel.x, ac.vel.z) : 0),
    brakeL: ac.brakes || 0, brakeR: ac.brakes || 0, steer: (ac.ctl && -ac.ctl.rudder) || 0, onGround: !!ac.onGround,
  }
}

/* --- Frames ---------------------------------------------------------------
   The assembled GLB is in FlightGear's frame (x aft, y starboard, z up).
   The flight model's body frame is +x right, +y up, +z aft. So
   body = (fg.y, fg.z, fg.x): a cyclic permutation, which is a proper rotation
   (120° about the (1,1,1) diagonal). Objects inside a part are still in AC3D
   coordinates, where AC3D = (fg.x, fg.z, −fg.y). Both are exact, both pure. */
export const FG_TO_BODY_Q = [-0.5, -0.5, -0.5, 0.5]          // rotates fg x→body z, fg y→body x, fg z→body y
export const fgToBody = v => [v[1], v[2], v[0]]
export const fgToAc = v => [v[0], v[2], -v[1]]
export const acToFg = v => [v[0], -v[2], v[1]]

/** Rotate a vector by a quaternion (x, y, z, w): pure, for the tests. */
export function rotateByQuat(q, v) {
  const [qx, qy, qz, qw] = q, [x, y, z] = v
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx]
}
