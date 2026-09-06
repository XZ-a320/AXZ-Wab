/* ==========================================================================
   AXZ sim 3.0 — a sourced, rigged aeroplane as an object in the scene.

   Same contract as 2.0's AircraftView (root, model, contacts, restHeight,
   eye, exhausts, tips, materials, bodyMinY/MaxY, update, bodyToWorld,
   dispose), so main.js and the flight model do not care which kind of
   aeroplane they were handed. The difference is where the numbers come
   from: the wheels the model draws become the contacts the flight model
   stands on, and the parts move because the model's own authors said how.
   ========================================================================== */
import { evaluateRig, stateFrom, FG_TO_BODY_Q, fgToAc } from './rig.js'

const WHEEL = /tyre|tire|wheel|rim|roue/i
const GEAR_PART = /gear|wheel|strut|bogie|oleo/i

export class RiggedAircraft {
  constructor(THREE, gltf, spec, asset) {
    this.THREE = THREE
    this.spec = spec
    this.asset = asset
    this.rigged = true
    const rig = (gltf.parser && gltf.parser.json && gltf.parser.json.asset && gltf.parser.json.asset.extras && gltf.parser.json.asset.extras.axzRig) || (gltf.asset && gltf.asset.extras && gltf.asset.extras.axzRig) || { parts: [] }
    this.rig = rig
    /* The parse is cached by fleet id and a type can be flown twice, so each
       view poses its own clone; geometry and materials stay shared. */
    this.model = gltf.scene.clone(true)

    /* FlightGear frame → body frame, then origin at the centre of gravity. */
    this.frame = new THREE.Group()
    this.frame.quaternion.set(...FG_TO_BODY_Q)
    this.frame.add(this.model)
    this.root = new THREE.Group()
    this.root.add(this.frame)
    this.model.updateMatrixWorld(true)

    // Every named node, by name (a name can repeat across parts).
    this.byName = new Map()
    this.model.traverse(o => { if (o.name) { if (!this.byName.has(o.name)) this.byName.set(o.name, []); this.byName.get(o.name).push(o) } })
    // Rest transforms and the parent-chain translation (AC3D frame) of every node that an animation names.
    this.animated = new Map()
    for (const part of rig.parts || []) for (const a of part.animations || []) for (const name of a.objects || []) {
      for (const node of this.byName.get(name) || []) if (!this.animated.has(node)) {
        let off = [0, 0, 0], p = node.parent
        while (p && !(p.extras && p.extras.part) && !(p.userData && p.userData.part)) { off = [off[0] + p.position.x, off[1] + p.position.y, off[2] + p.position.z]; p = p.parent }
        this.animated.set(node, { pos: node.position.clone(), quat: node.quaternion.clone(), off })
      }
    }
    this.spin = new Map()

    /* Pose the rig at rest FIRST, so a packed drag chute, a cover, or a
       ground crew that FlightGear hides does not shape the contacts, the
       eye or the box. */
    this.restState = { pos: { x: 0, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, gearPos: 1, flapDeg: 0, cfg: { flapMaxDeg: 40 }, ctl: { aileron: 0, elevator: 0, rudder: 0 }, thrustLag: 0, eng: new Array(spec.engines || 2).fill(1), throttle: 0, reversePos: 0, brakes: 0, onGround: true, vel: { x: 0, y: 0, z: 0 }, spoilerPos: 0 }
    this.poseNodes(this.restState, 0)

    /* Geometry facts, in the frame's coordinates (body axes, model origin). */
    const box = new THREE.Box3(), tmp = new THREE.Box3()
    const wheels = []
    let bodyMin = Infinity, bodyMax = -Infinity
    let fuselage = null, fuselageVol = 0
    const samples = []                               // body vertices near the centreline, for the fuselage level
    const v = new THREE.Vector3()
    this.frame.updateMatrixWorld(true)
    const shown = o => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true }
    this.model.traverse(o => {
      if (!o.isMesh || !shown(o)) return
      o.castShadow = true; o.receiveShadow = true
      tmp.setFromObject(o, true)
      const pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position
      if (pos && !GEAR_PART.test(o.name || '')) for (let i = 0; i < pos.count; i += 16) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); samples.push([Math.abs(v.x), v.y, v.z]) }
      // Gear is gear by its own name or any ancestor's: struts and doors are not fuselage.
      let p = o, inGear = GEAR_PART.test(o.name || '')
      while (p && p !== this.model) { if (GEAR_PART.test(p.name || '')) inGear = true; p = p.parent }
      if (WHEEL.test(o.name || '')) { const c = new THREE.Vector3(); tmp.getCenter(c); wheels.push({ x: c.x, y: tmp.min.y, z: c.z, r: (tmp.max.y - tmp.min.y) / 2 }) }
      else if (!inGear) {
        bodyMin = Math.min(bodyMin, tmp.min.y); bodyMax = Math.max(bodyMax, tmp.max.y)
        // The fuselage: the biggest body mesh by bounding volume, or the one that says so.
        const sz = new THREE.Vector3(); tmp.getSize(sz); const vol = sz.x * sz.y * sz.z
        if (/fus/i.test(o.name || '') ? vol > fuselageVol * 0.5 : vol > fuselageVol) { fuselage = tmp.clone(); fuselageVol = vol }
      }
      box.union(tmp)
    })
    const size = new THREE.Vector3(); box.getSize(size)
    const centre = new THREE.Vector3(); box.getCenter(centre)

    /* Contacts: wheels grouped into legs. The nose leg is the most forward
       (most negative z in body axes); the rest split by side. Without any
       wheel mesh, three points from the published geometry, as 2.0 did. */
    /* The fuselage level: in the nose third there is nothing but fuselage,
       and a fuselage is widest at its own centreline, so the height of the
       widest band of vertices there is the centreline. A vertex mean leans
       toward whichever side the modeller detailed (gear bays, fairings), and
       a box centre sits halfway up the fin. */
    const noseZ = box.min.z + spec.len * 0.3
    const nose = samples.filter(([, , z]) => z < noseZ)
    const widest = nose.reduce((m, [x]) => Math.max(m, x), 0)
    const band = nose.filter(([x]) => x > widest * 0.85)
    const fcBox = new THREE.Vector3(); (fuselage || box).getCenter(fcBox)
    const cgY = band.length >= 30 ? band.reduce((a, [, y]) => a + y, 0) / band.length : fcBox.y

    let legs
    if (wheels.length >= 3) {
      const minZ = Math.min(...wheels.map(w => w.z))
      const nose = wheels.filter(w => w.z < minZ + spec.len * 0.12)
      const mains = wheels.filter(w => !nose.includes(w))
      const leg = (ws, flags) => ws.length ? { x: ws.reduce((s, w) => s + w.x, 0) / ws.length, y: Math.min(...ws.map(w => w.y)), z: ws.reduce((s, w) => s + w.z, 0) / ws.length, ...flags } : null
      legs = [leg(nose, { nose: true }), leg(mains.filter(w => w.x < 0), {}), leg(mains.filter(w => w.x >= 0), {})].filter(Boolean)
    }
    if (!legs || legs.length < 3) {
      /* The flight model squats each leg by a fixed fraction of the stance
         (fdm.js: 0.062, clamped to 3–30 cm), so a contact at the model's
         lowest point would bury the tyres by that much. The contact sits one
         squat lower and the aeroplane settles onto its wheels. */
      const d = cgY - box.min.y
      let squat = 0; for (let i = 0; i < 3; i++) squat = Math.min(0.30, Math.max(0.03, (d + squat) * 0.062))
      /* The spring is sized for a third of the weight per leg, and the mains
         carry more than that: with the nose at −0.35 L, the mains at +0.05 L
         and the CG 0.03 L ahead of the mains, each main takes 0.37 / 0.40 / 2
         of the weight and squats by the same ratio over the nominal third. */
      const mainShare = (0.37 / 0.40) / 2
      const yb = box.min.y - squat * mainShare * 3
      legs = [{ x: 0, y: yb, z: -spec.len * 0.35, nose: true }, { x: -spec.track / 2 || -spec.span * 0.08, y: yb, z: spec.len * 0.05 }, { x: spec.track / 2 || spec.span * 0.08, y: yb, z: spec.len * 0.05 }]
    }
    /* Centre of gravity: a little ahead of the main wheels, on the fuselage centreline. */
    const mains = legs.filter(l => !l.nose)
    const mainZ = mains.reduce((s, l) => s + l.z, 0) / mains.length
    this.cg = new THREE.Vector3(0, cgY, mainZ - spec.len * 0.03)
    this.frame.position.set(-this.cg.x, -this.cg.y, -this.cg.z)
    this.contacts = legs.map(l => ({ x: l.x - this.cg.x, y: l.y - this.cg.y, z: l.z - this.cg.z, nose: !!l.nose, tail: false }))
    this.restHeight = -Math.min(...this.contacts.map(c => c.y))
    this.bodyMinY = bodyMin - this.cg.y
    this.bodyMaxY = bodyMax - this.cg.y
    /* The captain's eye, when no deck says otherwise: a little above the
       fuselage level, in the nose. */
    this.eye = { x: 0, y: spec.dia * 0.15 + 0.3, z: box.min.z - this.cg.z + spec.len * 0.09 }
    this.exhausts = [{ x: -spec.span * 0.18, y: this.bodyMinY + spec.dia * 0.4, z: spec.len * 0.12 }, { x: spec.span * 0.18, y: this.bodyMinY + spec.dia * 0.4, z: spec.len * 0.12 }].slice(0, Math.max(1, spec.engines || 2))
    this.tips = [{ x: -spec.span / 2, y: 0, z: spec.len * 0.05 }, { x: spec.span / 2, y: 0, z: spec.len * 0.05 }]
    this.hasFlames = false
    this.materials = new Set()
    this.model.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => this.materials.add(m)) })
    this.stats = { wheels: wheels.length, legs: legs.length, animated: this.animated.size, nodes: this.byName.size, size: [size.x, size.y, size.z] }
  }

  /** Called once per rendered frame with the flight state. */
  update(ac, dt) {
    this.root.position.set(ac.pos.x, ac.pos.y, ac.pos.z)
    this.root.quaternion.set(ac.q.x, ac.q.y, ac.q.z, ac.q.w)
    this.poseNodes(ac, dt)
  }

  /** Apply the rig to the named nodes for a flight state. */
  poseNodes(ac, dt) {
    const S = stateFrom(ac)
    this.applyOps(evaluateRig(this.rig, S), this.animated, this.spin, dt)
    if (this.cockpit && this.cockpit.root.visible) this.applyOps(evaluateRig(this.cockpit.rig, S), this.cockpit.animated, this.cockpit.spin, dt)
  }

  applyOps(ops, animated, spins, dt) {
    const THREE = this.THREE
    const m = new THREE.Matrix4(), t = new THREE.Matrix4(), q = new THREE.Quaternion(), axis = new THREE.Vector3(), c = new THREE.Vector3()
    for (const [node, rest] of animated) {
      const list = ops.get(node.name)
      node.position.copy(rest.pos); node.quaternion.copy(rest.quat); node.visible = true
      if (!list) continue
      // Build the animation transform in the node's parent frame (AC3D axes, part-relative), then compose with the rest pose.
      m.identity()
      for (const op of list) {
        if (op.type === 'select') { node.visible = node.visible && op.visible; continue }
        if (op.type === 'translate') {
          const a = fgToAc(op.axis)
          t.makeTranslation(a[0] * op.m, a[1] * op.m, a[2] * op.m)
          m.premultiply(t)
        } else if (op.type === 'rotate' || op.type === 'spin') {
          let deg = op.deg
          if (op.type === 'spin') { const s = (spins.get(node) || 0) + op.rpm * 6 * dt; spins.set(node, s % 360); deg = s }
          const a = fgToAc(op.axis); axis.set(a[0], a[1], a[2]).normalize()
          const cc = fgToAc(op.center); c.set(cc[0] - rest.off[0], cc[1] - rest.off[1], cc[2] - rest.off[2])
          q.setFromAxisAngle(axis, deg * Math.PI / 180)
          t.makeRotationFromQuaternion(q)
          t.setPosition(c.clone().sub(c.clone().applyQuaternion(q)))   // T(c) R T(−c)
          m.premultiply(t)
        }
      }
      const local = new THREE.Matrix4().compose(rest.pos, rest.quat, new THREE.Vector3(1, 1, 1)).premultiply(m)
      local.decompose(node.position, node.quaternion, node.scale)
    }
  }

  /** The flight deck: another rigged GLB in the same FlightGear frame,
      drawn only when the camera sits in it. Its rig runs with the same state. */
  setCockpit(gltf) {
    const THREE = this.THREE
    if (this.cockpit) { this.frame.remove(this.cockpit.root); this.cockpit = null }
    const rig = (gltf.parser && gltf.parser.json.asset.extras && gltf.parser.json.asset.extras.axzRig) || { parts: [] }
    const root = gltf.scene.clone(true)
    const byName = new Map(), animated = new Map()
    root.traverse(o => { if (o.name) { if (!byName.has(o.name)) byName.set(o.name, []); byName.get(o.name).push(o) } if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false } })
    for (const part of rig.parts || []) for (const a of part.animations || []) for (const name of a.objects || []) for (const node of byName.get(name) || []) if (!animated.has(node)) {
      let off = [0, 0, 0], p = node.parent
      while (p && !(p.userData && p.userData.part)) { off = [off[0] + p.position.x, off[1] + p.position.y, off[2] + p.position.z]; p = p.parent }
      animated.set(node, { pos: node.position.clone(), quat: node.quaternion.clone(), off })
    }
    this.cockpit = { root, rig, byName, animated, spin: new Map() }
    root.visible = false
    this.frame.add(root)
    /* The eye: FlightGear's view point if the rig carries one, else the
       captain's seat estimated from the deck's own box. */
    const box = new THREE.Box3().setFromObject(root, true)
    const eyeFg = rig.eye || null
    if (eyeFg) this.eye = { x: eyeFg[1] - this.cg.x, y: eyeFg[2] - this.cg.y, z: eyeFg[0] - this.cg.z }
    else this.eye = { x: -0.5, y: box.max.y - 0.9 - this.cg.y, z: box.min.z + 0.55 * (box.max.z - box.min.z) - this.cg.z }
    return this.cockpit
  }

  /** Inside: the deck is drawn and the airframe is not. */
  setInside(inside) {
    this.model.visible = !inside
    if (this.cockpit) this.cockpit.root.visible = inside
  }

  bodyToWorld(p) { return this.root.localToWorld(new this.THREE.Vector3(p.x, p.y, p.z)) }
  /** Nothing to free per view: geometry and materials belong to the cached parse and the next view of this type shares them. */
  dispose() { this.model.clear() }
}
