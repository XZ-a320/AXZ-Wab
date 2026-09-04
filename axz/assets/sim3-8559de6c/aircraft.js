/* ==========================================================================
   AXZ sim 2.0 — the aeroplane as an object in the scene.

   The hangar builds every type from its published dimensions; this wraps that
   model into the flight model's body frame (+x right, +y up, +z aft, origin at
   the centre of gravity), hands the physics the wheel contacts the model was
   drawn with, and animates what a flight changes: the gear, the fans and
   propeller, the burner, the strobes and the beacon.

   One consequence worth stating: the wheels the model draws are the wheels
   the flight model stands on. There is no second table of contact points to
   drift away from the drawing.
   ========================================================================== */

import * as TEX from './tex.js'

export class AircraftView {
  constructor(THREE, hangar, spec, { decals = true } = {}) {
    this.THREE = THREE
    this.spec = spec
    const model = hangar.build({ ...spec, name: spec.name })
    const u = model.userData
    if (!u.cg || !u.contacts) throw new Error('model has no contacts: ' + spec.name)

    /* Hangar frame -> body frame: rotate about Y by -90 degrees, which sends
       the hangar's +x (aft) to +z and its +z (port) to -x. The centre of
       gravity becomes the origin. */
    const wrapper = new THREE.Group()
    wrapper.rotation.y = -Math.PI / 2
    model.position.set(-u.cg.x, -u.cg.y, 0)
    wrapper.add(model)
    this.root = new THREE.Group()
    this.root.add(wrapper)
    this.model = model

    const toBody = p => ({ x: -p.z, y: p.y - u.cg.y, z: p.x - u.cg.x })
    this.contacts = u.contacts.map(c => ({ ...toBody(c), nose: !!c.nose, tail: !!c.tail }))
    this.restHeight = u.rest
    this.eye = toBody(u.eye || { x: 0.1 * spec.len, y: 0.3 * spec.dia, z: 0 })
    this.exhausts = (u.exhausts || []).map(toBody)
    this.tips = (u.tips || []).map(toBody)
    this.hasFlames = !!u.flames

    // What the body draws above and below the CG, gear excluded.
    const box = new THREE.Box3()
    model.updateMatrixWorld(true)
    let minY = Infinity, maxY = -Infinity
    model.traverse(o => {
      if (!o.isMesh) return
      let p = o, inGear = false
      while (p && p !== model) { if (p.name === 'gear') inGear = true; p = p.parent }
      if (inGear || o.name === 'rotorDisc' || o.name === 'flame') return
      box.setFromObject(o)
      minY = Math.min(minY, box.min.y - (-u.rest) - u.cg.y)
      maxY = Math.max(maxY, box.max.y - (-u.rest) - u.cg.y)
    })
    // The model sits at y = rest above its own origin, so undo that shift.
    this.bodyMinY = minY - u.rest
    this.bodyMaxY = maxY - u.rest

    this.gear = model.getObjectByName('gear')
    this.gearRest = this.gear ? this.gear.position.y : 0
    this.flames = []
    this.spinners = []
    this.beacons = []
    this.strobes = []
    model.traverse(o => {
      if (o.name === 'flame') this.flames.push(o)
      if (o.name === 'fan' || o.name === 'prop' || o.name === 'mainRotor') this.spinners.push(o)
      if (o.name === 'beacon') this.beacons.push(o)
      if (o.name === 'strobe') this.strobes.push(o)
    })
    this.disc = model.getObjectByName('rotorDisc')
    this.spinAngle = 0
    this.spinSpeed = 0

    model.traverse(o => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true } })

    if (decals && spec.axz) this.addDecals(THREE, model, spec, u)
    this.materials = new Set()
    model.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => this.materials.add(m)) })
  }

  /* The airline signs its own aeroplanes: the wordmark on the fuselage and
     the mark on the fin, as textured quads on the constant section and on the
     fin's flank. Guests fly in plain paint. */
  addDecals(THREE, model, spec, u) {
    const L = spec.len, r = spec.dia / 2
    const mk = (canvas, w, h) => {
      const t = new THREE.CanvasTexture(canvas)
      t.colorSpace = THREE.SRGBColorSpace
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.5, metalness: 0.05, polygonOffset: true, polygonOffsetFactor: -1 }))
      m.castShadow = false
      return m
    }
    const th = 0.36
    for (const s of [1, -1]) {
      const d = mk(TEX.fuselageDecal('AIR XIAO ZE', 'AXZ'), 0.26 * L, 0.065 * L)
      d.position.set(0.30 * L, r * Math.sin(th), s * (r * Math.cos(th) + 0.03))
      d.rotation.y = s > 0 ? 0 : Math.PI
      d.rotation.x = -s * th
      if (s < 0) d.scale.x = -1
      model.add(d)
    }
    const finH = spec.h - u.rest - 0.9 * r
    for (const s of [1, -1]) {
      const f = mk(TEX.finDecal('AXZ'), finH * 0.5, finH * 0.5)
      f.position.set(0.78 * L + finH * 0.7 * 0.5 + 0.06 * L, 0.9 * r + finH * 0.5, s * 0.16)
      f.rotation.y = s > 0 ? 0 : Math.PI
      model.add(f)
    }
  }

  /** Called once per rendered frame with the flight state. */
  update(ac, dt, { time }) {
    const THREE = this.THREE
    this.root.position.set(ac.pos.x, ac.pos.y, ac.pos.z)
    this.root.quaternion.set(ac.q.x, ac.q.y, ac.q.z, ac.q.w)

    // Gear: the legs fold up into the body as the lever comes up.
    if (this.gear) {
      const g = ac.gearPos
      this.gear.visible = g > 0.02
      this.gear.position.y = this.gearRest + (1 - g) * this.restHeight * 0.75
      this.gear.scale.y = 0.15 + 0.85 * g
    }
    // Fans and propeller turn with the engines' actual state.
    const target = ac.crashed ? 0 : (ac.spec.prop ? 6 + 34 * ac.thrustLag : 3 + 20 * ac.thrustLag) * (ac.engineFraction > 0 ? 1 : 0.15)
    this.spinSpeed += (target - this.spinSpeed) * Math.min(1, dt * 1.5)
    this.spinAngle += this.spinSpeed * dt
    for (const s of this.spinners) s.rotation.x = this.spinAngle
    if (this.disc) this.disc.material.opacity = 0.18 * Math.min(1, this.spinSpeed / 12)
    // The burner.
    if (this.hasFlames) {
      const ab = ac.abFrac || 0
      for (const f of this.flames) {
        f.visible = ab > 0.03 && !ac.crashed
        const flicker = 0.85 + 0.15 * Math.sin(time * 60 + f.position.z)
        f.scale.set(ab * flicker, ab * flicker, ab * flicker * (0.7 + 0.3 * flicker))
      }
    }
    // Beacon: a double flash; strobes: a sharp one, offset from it.
    const ph = (time % 1.4) / 1.4
    const flash = (ph < 0.05 || (ph > 0.12 && ph < 0.17)) ? 2.6 : 0.2
    for (const b of this.beacons) b.material.emissiveIntensity = flash
    const sp = (time % 1.1) / 1.1
    for (const s of this.strobes) s.material.emissiveIntensity = sp < 0.04 ? 3.5 : 0.1
  }

  /** A body-frame point, in world space. */
  bodyToWorld(p) {
    const v = new this.THREE.Vector3(p.x, p.y, p.z)
    return this.root.localToWorld(v)
  }

  dispose() {
    this.model.traverse(o => { if (o.geometry) o.geometry.dispose() })
  }
}
