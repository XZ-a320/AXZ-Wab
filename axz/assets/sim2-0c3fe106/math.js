/* ==========================================================================
   AXZ sim — vectors, matrices, quaternions.

   Frames, fixed once here so every other file can stop re-deriving them:

     WORLD   X = east, Y = up, Z = south.  Right-handed (x cross y = z).
             Heading 000 (north) is therefore -Z, which is also the direction
             a default WebGL camera looks. That is not a coincidence — it is
             why this frame was chosen, and it means an aircraft's orientation
             quaternion can drive the cockpit camera with no fix-up rotation.

     BODY    X = right wing, Y = up through the roof, Z = aft.
             The nose is -Z. Same handedness, same reason.

   Rotations about the body axes, with signs stated once:
     about +X  ->  nose UP     (pitch up is positive)
     about +Y  ->  nose LEFT   (so a nose-RIGHT yaw is negative about Y)
     about +Z  ->  right wing UP (so a right-wing-DOWN roll is negative about Z)

   The two inversions above are the whole reason this comment exists. Every
   moment in fdm.js is written in the aerodynamicist's convention (positive
   yaw = nose right, positive roll = right wing down) and negated exactly once,
   at the point where it becomes a torque.
   ========================================================================== */

export const DEG = Math.PI / 180
export const RAD = 180 / Math.PI
export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v
export const lerp = (a, b, t) => a + (b - a) * t
/** Frame-rate independent approach: reaches `to` at a rate set by `perSecond`. */
export const approach = (from, to, perSecond, dt) => from + (to - from) * (1 - Math.exp(-perSecond * dt))

/* --- vec3 ----------------------------------------------------------------- */
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z })
export const vset = (a, x, y, z) => { a.x = x; a.y = y; a.z = z; return a }
export const vcopy = a => ({ x: a.x, y: a.y, z: a.z })
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
export const vlen = a => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
export const vcross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
export function vnorm(a) {
  const l = vlen(a)
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 }
}

/* --- Quaternion ----------------------------------------------------------
   Stored {x,y,z,w}. Always unit length; qnorm is called after every
   integration step because error accumulates fast at 240 Hz.               */
export const q4 = (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w })

export function qmul(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

export function qnorm(q) {
  const l = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
  if (l < 1e-9) return { x: 0, y: 0, z: 0, w: 1 }
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l }
}

export const qconj = q => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w })

export function qFromAxisAngle(axis, angle) {
  const a = vnorm(axis), h = angle / 2, s = Math.sin(h)
  return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(h) }
}

/** Rotate a vector from BODY into WORLD. */
export function qrot(q, v) {
  // t = 2 * (qv x v); v' = v + q.w * t + qv x t
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  }
}

/** Rotate a vector from WORLD into BODY. */
export const qinv = (q, v) => qrot(qconj(q), v)

/**
 * Heading / pitch / bank read out of the orientation, in radians.
 * Heading is measured from north (-Z) clockwise when seen from above, which is
 * what a compass card shows; pitch and bank are the usual attitude angles.
 */
export function qToEuler(q) {
  const fwd = qrot(q, { x: 0, y: 0, z: -1 })   // nose
  const up = qrot(q, { x: 0, y: 1, z: 0 })     // roof
  const heading = Math.atan2(fwd.x, -fwd.z)
  const pitch = Math.asin(clamp(fwd.y, -1, 1))
  /* Bank: angle of the roof vector away from the vertical plane holding the
     nose, POSITIVE WITH THE RIGHT WING DOWN — which is the sign qFromEuler
     below takes, and the sign every aerodynamic coefficient in fdm.js is
     written in. It used to come back with the opposite sign, so the pair did
     not round-trip: qToEuler(qFromEuler(0, 0, +0.3)).bank was -0.3. The only
     consumer that could see it was the attitude indicator, and it saw it
     backwards — a right bank rolled the artificial horizon the wrong way. */
  const right = qrot(q, { x: 1, y: 0, z: 0 })
  const bank = Math.atan2(-right.y, up.y)
  return { heading, pitch, bank }
}

export function qFromEuler(heading, pitch, bank) {
  const qh = qFromAxisAngle({ x: 0, y: 1, z: 0 }, -heading)  // +Y rotation is nose-left
  const qp = qFromAxisAngle({ x: 1, y: 0, z: 0 }, pitch)
  const qb = qFromAxisAngle({ x: 0, y: 0, z: 1 }, -bank)     // +Z rotation lifts the right wing
  return qnorm(qmul(qmul(qh, qp), qb))
}

/* --- mat4 (column-major, WebGL order) ------------------------------------- */
export const m4identity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])

export function m4perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far)
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ])
}

/** World -> view, built directly from the camera's position and orientation. */
export function m4view(pos, q) {
  const r = qrot(q, { x: 1, y: 0, z: 0 })
  const u = qrot(q, { x: 0, y: 1, z: 0 })
  const b = qrot(q, { x: 0, y: 0, z: 1 })
  return new Float32Array([
    r.x, u.x, b.x, 0,
    r.y, u.y, b.y, 0,
    r.z, u.z, b.z, 0,
    -(r.x * pos.x + r.y * pos.y + r.z * pos.z),
    -(u.x * pos.x + u.y * pos.y + u.z * pos.z),
    -(b.x * pos.x + b.y * pos.y + b.z * pos.z),
    1,
  ])
}

/** Model matrix from position + orientation (+ uniform scale). */
export function m4model(pos, q, scale = 1) {
  const r = qrot(q, { x: scale, y: 0, z: 0 })
  const u = qrot(q, { x: 0, y: scale, z: 0 })
  const b = qrot(q, { x: 0, y: 0, z: scale })
  return new Float32Array([
    r.x, r.y, r.z, 0,
    u.x, u.y, u.z, 0,
    b.x, b.y, b.z, 0,
    pos.x, pos.y, pos.z, 1,
  ])
}

export function m4mul(a, b) {
  const o = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  }
  return o
}

/* --- Units. The sim thinks in SI; every instrument reads in aviation units. */
export const M_TO_FT = 3.280839895
export const MS_TO_KT = 1.943844492
export const MS_TO_FPM = 196.850393701
export const KM_TO_NM = 0.539956803

/**
 * General 4x4 inverse. Needed for exactly one thing: the sky shader unprojects
 * each pixel back into a world-space ray, which wants the inverse of
 * projection * view. Everything else in the sim builds its matrices directly
 * and never needs to undo one.
 */
export function m4invert(m) {
  const o = new Float32Array(16)
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3]
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7]
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11]
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15]

  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!det) return m4identity()
  det = 1 / det

  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
  o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
  o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
  o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
  o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
  o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
  o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
  o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
  o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
  return o
}
