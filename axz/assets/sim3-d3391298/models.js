/* ==========================================================================
   AXZ hangar — procedural airframes for Three.js.

   Everything here is geometry made at run time from published dimensions.
   No model files, no textures: a fuselage is a lofted run of superellipse
   sections, a wing is a lofted run of airfoils, a livery is vertex colour.

   Units are metres. +X is the nose, +Y is up, +Z is starboard. The ground is
   y = 0 for every finished aircraft, so the hangar can put them on one floor.

   The library takes THREE as an argument rather than importing it, so the same
   file can be inlined into a single self-contained page or loaded as a module
   next to an import map — whichever the page needs.
   ========================================================================== */

export function createHangar(THREE) {
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z)
  const col = hex => new THREE.Color(hex)
  const TAU = Math.PI * 2
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
  const lerp = (a, b, u) => a + (b - a) * u
  const rad = d => d * Math.PI / 180

  /* ---------------------------------------------------------------------
     Materials. One palette for the whole hangar, so the fleet reads as a
     fleet. Paint is vertex-coloured; everything else is a flat colour.
     --------------------------------------------------------------------- */
  const mats = {
    paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08 }),
    paintDouble: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08, side: THREE.DoubleSide }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0f1c2a, roughness: 0.08, metalness: 0.75, transparent: true, opacity: 0.86 }),
    glassBlue: new THREE.MeshStandardMaterial({ color: 0x18344a, roughness: 0.06, metalness: 0.7, transparent: true, opacity: 0.8 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.55, metalness: 0.3 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.85 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.92, metalness: 0.0 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.3, metalness: 0.9 }),
    engineHot: new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.4, metalness: 0.8 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.5, metalness: 0.4 }),
    bladeTip: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.1 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.95 }),
    red: new THREE.MeshStandardMaterial({ color: 0xd93a2b, roughness: 0.45, metalness: 0.1 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffb020, roughness: 0.4, metalness: 0.1, emissive: 0x9a5a00, emissiveIntensity: 0.35 }),
    navRed: new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 1.4, roughness: 0.3 }),
    navGreen: new THREE.MeshStandardMaterial({ color: 0x2aff5a, emissive: 0x1aff4a, emissiveIntensity: 1.4, roughness: 0.3 }),
    navWhite: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.2, roughness: 0.3 }),
    beacon: new THREE.MeshStandardMaterial({ color: 0xff3a1a, emissive: 0xff2200, emissiveIntensity: 2.2, roughness: 0.3 }),
    canopy: new THREE.MeshStandardMaterial({ color: 0x2a2416, roughness: 0.06, metalness: 0.85, transparent: true, opacity: 0.9 }),
    flame: new THREE.MeshBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    flameCore: new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  }

  /* ---------------------------------------------------------------------
     Lofting. `loftRings` is the one surface builder: hand it an array of
     rings (each an array of Vector3 with the same count) and it stitches
     them into an indexed BufferGeometry with smooth normals, vertex colours
     from `paint`, optional end caps, and material groups from `classify`.

     Winding is checked, not assumed: after building, the mean of
     normal · (vertex − centroid) is measured and the index order flipped if
     it points inward. Every body in this file is convex enough for that to
     be a reliable test, and it is what lets wings, fins and blades share the
     builder no matter which way their sections were traced.
     --------------------------------------------------------------------- */
  function loftRings(rings, opts = {}) {
    const { paint = null, classify = null, caps = false, closed = true } = opts
    const N = rings.length, M = rings[0].length
    const pos = new Float32Array(N * M * 3 + (caps ? 6 : 0))
    const colr = new Float32Array(N * M * 3 + (caps ? 6 : 0))
    const c = new THREE.Color(0xffffff)
    let k = 0
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < M; j++) {
        const p = rings[i][j]
        pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z
        if (paint) { const pc = paint(p, i / (N - 1), j / M); c.set(pc) } else c.set(0xffffff)
        colr[k * 3] = c.r; colr[k * 3 + 1] = c.g; colr[k * 3 + 2] = c.b
        k++
      }
    }
    const groups = new Map()
    const push = (g, a, b, cc) => { let arr = groups.get(g); if (!arr) groups.set(g, arr = []); arr.push(a, b, cc) }
    const seg = closed ? M : M - 1
    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const j1 = (j + 1) % M
        const a = i * M + j, b = i * M + j1, cc = (i + 1) * M + j1, d = (i + 1) * M + j
        const g = classify ? classify((i + 0.5) / (N - 1), (j + 0.5) / M) : 0
        push(g, a, d, cc); push(g, a, cc, b)
      }
    }
    if (caps) {
      const ends = [[0, N * M], [N - 1, N * M + 1]]
      for (const [ri, ci] of ends) {
        const cen = rings[ri].reduce((s, p) => s.add(p), V3(0, 0, 0)).multiplyScalar(1 / M)
        pos[ci * 3] = cen.x; pos[ci * 3 + 1] = cen.y; pos[ci * 3 + 2] = cen.z
        const pc = paint ? paint(cen, ri / (N - 1), 0) : 0xffffff
        c.set(pc); colr[ci * 3] = c.r; colr[ci * 3 + 1] = c.g; colr[ci * 3 + 2] = c.b
        for (let j = 0; j < seg; j++) {
          const j1 = (j + 1) % M
          const a = ri * M + j, b = ri * M + j1
          if (ri === 0) push(0, ci, b, a); else push(0, ci, a, b)
        }
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(colr, 3))
    const index = []
    let start = 0
    const keys = [...groups.keys()].sort((a, b) => a - b)
    for (const g of keys) {
      const arr = groups.get(g)
      index.push(...arr)
      geo.addGroup(start, arr.length, g)
      start += arr.length
    }
    geo.setIndex(index)
    geo.computeVertexNormals()
    orientOutward(geo)
    return geo
  }

  function orientOutward(geo) {
    const p = geo.attributes.position, n = geo.attributes.normal
    const cen = V3(0, 0, 0)
    for (let i = 0; i < p.count; i++) cen.add(V3(p.getX(i), p.getY(i), p.getZ(i)))
    cen.multiplyScalar(1 / p.count)
    let dot = 0
    for (let i = 0; i < p.count; i++) {
      dot += (p.getX(i) - cen.x) * n.getX(i) + (p.getY(i) - cen.y) * n.getY(i) + (p.getZ(i) - cen.z) * n.getZ(i)
    }
    if (dot < 0) {
      const idx = geo.index.array
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t }
      geo.index.needsUpdate = true
      geo.computeVertexNormals()
    }
  }

  /* Monotone cubic (Fritsch–Carlson) interpolation of ys over strictly
     increasing xs. It never overshoots, which is what a fuselage needs: a
     short nose station next to a long cabin station must not bulge. */
  function pchip(xs, ys) {
    const n = xs.length
    const h = [], d = []
    for (let i = 0; i < n - 1; i++) { h.push(xs[i + 1] - xs[i]); d.push((ys[i + 1] - ys[i]) / h[i]) }
    const m = new Array(n).fill(0)
    if (n === 2) { m[0] = m[1] = d[0] } else {
      for (let i = 1; i < n - 1; i++) {
        if (d[i - 1] * d[i] <= 0) m[i] = 0
        else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]) }
      }
      const end = (h0, h1, d0, d1) => {
        let e = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
        if (Math.sign(e) !== Math.sign(d0)) e = 0
        else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(e) > Math.abs(3 * d0)) e = 3 * d0
        return e
      }
      m[0] = end(h[0], h[1], d[0], d[1]); m[n - 1] = end(h[n - 2], h[n - 3], d[n - 2], d[n - 3])
    }
    return x => {
      let i = 0
      while (i < n - 2 && x > xs[i + 1]) i++
      const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1]
    }
  }

  /* ---------------------------------------------------------------------
     Fuselage: superellipse sections along X.
       station: { x, w, hu, hd, yc, k }
         w   full width,  hu / hd  half-height above / below the centre yc,
         k   squareness (2 = ellipse, 3 = well-rounded box)
     Hand stations are resampled through Catmull-Rom into `n` sub-stations,
     which is what turns eight numbers into a streamlined body.
     Returns { geo, at(u, t) } where at() samples the finished surface, so
     windows and doors can be laid onto it exactly.
     --------------------------------------------------------------------- */
  function fuselage(stations, opts = {}) {
    const { n = 100, segs = 64, paint = null, classify = null, caps = false } = opts
    const S = stations
    const keys = ['x', 'w', 'hu', 'hd', 'yc', 'k']
    const xs = S.map(s => s.x)
    const fn = {}
    for (const key of keys) if (key !== 'x') fn[key] = pchip(xs, S.map(s => s[key] ?? (key === 'k' ? 2.2 : 0)))
    const xa = xs[0], xb = xs[xs.length - 1]
    const sub = []
    for (let i = 0; i < n; i++) {
      // Denser at both ends, where the curvature is: the derivative of this
      // mapping is 0.15 at the tips and 1.85 amidships.
      const u = i / (n - 1)
      const x = xa + (xb - xa) * (u - 0.85 * Math.sin(TAU * u) / TAU)
      const st = { x }
      for (const key of keys) if (key !== 'x') st[key] = fn[key](x)
      st.w = Math.max(0.01, st.w); st.hu = Math.max(0.005, st.hu); st.hd = Math.max(0.005, st.hd)
      st.k = Math.max(1.6, st.k)
      sub.push(st)
    }
    const ringOf = st => {
      const ring = []
      for (let j = 0; j < segs; j++) {
        const t = (j / segs) * TAU
        const cz = Math.cos(t), sy = Math.sin(t)
        const e = 2 / st.k
        const z = (st.w / 2) * Math.sign(cz) * Math.pow(Math.abs(cz), e)
        const y = st.yc + (sy >= 0 ? st.hu : st.hd) * Math.sign(sy) * Math.pow(Math.abs(sy), e)
        ring.push(V3(st.x, y, z))
      }
      return ring
    }
    const rings = sub.map(ringOf)
    const geo = loftRings(rings, { paint, classify, caps })
    const x0 = sub[0].x, x1 = sub[n - 1].x
    /* Sample the surface at chord fraction u and ring angle t (radians, 0 =
       starboard beam, π/2 = top). Returns position and outward normal. */
    const at = (u, t) => {
      const fi = clamp(u, 0, 1) * (n - 1)
      const i = Math.min(n - 2, Math.floor(fi)), f = fi - i
      const st = {}
      for (const key of keys) st[key] = lerp(sub[i][key], sub[i + 1][key], f)
      const pt = (tt, s) => {
        const cz = Math.cos(tt), sy = Math.sin(tt), e = 2 / s.k
        return V3(s.x, s.yc + (sy >= 0 ? s.hu : s.hd) * Math.sign(sy) * Math.pow(Math.abs(sy), e),
          (s.w / 2) * Math.sign(cz) * Math.pow(Math.abs(cz), e))
      }
      const p = pt(t, st)
      const dt = pt(t + 0.02, st).sub(pt(t - 0.02, st))
      const st2 = {}
      for (const key of keys) st2[key] = lerp(sub[Math.min(n - 1, i + 1)][key], sub[Math.min(n - 1, i + 2)][key], f)
      const dx = pt(t, st2).sub(p)
      if (dx.lengthSq() < 1e-8) dx.set(1, 0, 0)
      const nrm = dx.cross(dt).normalize()
      const out = p.clone().sub(V3(p.x, st.yc, 0))
      if (nrm.dot(out) < 0) nrm.negate()
      return { p, n: nrm, x0, x1 }
    }
    return { geo, at, x0, x1 }
  }

  /* ---------------------------------------------------------------------
     Airfoil loop: NACA-style thickness on a parabolic camber line, traced
     TE → lower → LE → upper → TE. `a` runs 0..1 along the chord, `b` is the
     offset normal to it (fraction of chord).
     --------------------------------------------------------------------- */
  function airfoilLoop(thick, camber, n = 18) {
    const pts = []
    const yt = x => 5 * thick * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4)
    const yc = x => camber * 4 * x * (1 - x)
    const xs = []
    for (let i = 0; i <= n; i++) { const s = i / n; xs.push(1 - Math.cos(s * Math.PI / 2)) } // clustered at LE
    // lower surface from TE to LE
    for (let i = n; i >= 1; i--) pts.push({ a: xs[i], b: yc(xs[i]) - yt(xs[i]) })
    // LE
    pts.push({ a: 0, b: 0 })
    // upper surface from LE to TE
    for (let i = 1; i < n; i++) pts.push({ a: xs[i], b: yc(xs[i]) + yt(xs[i]) })
    pts.push({ a: 1, b: yc(1) })
    return pts
  }

  /* Lifting surface from spanwise sections.
       section: { x, y, z, chord, thick, camber, twist }
       axis: 'z' (span along Z, thickness along Y) or 'y' (span up Y, thickness along Z)
     Sections are used as given (no resampling) so a kink in the planform
     stays a kink. */
  function surface(sections, opts = {}) {
    const { axis = 'z', paint = null, n = 18, caps = true, subdiv = 6 } = opts
    // Linear sub-sections between the given ones: the planform keeps its
    // kinks, and vertex-coloured paint gets enough rings to hold an edge.
    const secs = []
    for (let i = 0; i < sections.length; i++) {
      const a = sections[i]
      if (i > 0) {
        const p = sections[i - 1]
        for (let k = 1; k < subdiv; k++) {
          const f = k / subdiv, o = {}
          for (const key of Object.keys(a)) o[key] = typeof a[key] === 'number' ? lerp(p[key] ?? a[key], a[key], f) : a[key]
          secs.push(o)
        }
      }
      secs.push(a)
    }
    const rings = secs.map(s => {
      const loop = airfoilLoop(s.thick ?? 0.1, s.camber ?? 0.02, n)
      const tw = rad(s.twist ?? 0)
      const ct = Math.cos(tw), stw = Math.sin(tw)
      return loop.map(({ a, b }) => {
        const lx = a * s.chord, lb = b * s.chord
        const rx = lx * ct + lb * stw, rb = -lx * stw + lb * ct
        return axis === 'z' ? V3(s.x + rx, s.y + rb, s.z) : V3(s.x + rx, s.y, s.z + rb)
      })
    })
    return loftRings(rings, { paint, caps })
  }

  /* Mirror a mesh through the XY plane. Three.js flips winding for a negative
     determinant, so the copy lights correctly. */
  function mirrorZ(mesh) {
    const m = mesh.clone()
    m.scale.z *= -1
    return m
  }

  function mesh(geo, mat, { shadow = true } = {}) {
    const m = new THREE.Mesh(geo, mat)
    m.castShadow = shadow; m.receiveShadow = shadow
    return m
  }

  /* Rounded-rectangle shape, centred. */
  function roundedRect(w, h, r) {
    const s = new THREE.Shape()
    const x = -w / 2, y = -h / 2
    s.moveTo(x + r, y)
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r)
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r)
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y)
    return s
  }

  /* Lay a flat decal (a window, a door frame) on a surface sample. */
  function placeOn(obj, sample, lift = 0.012, roll = 0) {
    const { p, n } = sample
    const up = Math.abs(n.y) > 0.95 ? V3(1, 0, 0) : V3(0, 1, 0)
    const xAxis = V3().crossVectors(up, n).normalize()
    const yAxis = V3().crossVectors(n, xAxis).normalize()
    const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, n)
    obj.quaternion.setFromRotationMatrix(m)
    if (roll) obj.rotateZ(roll)
    obj.position.copy(p).addScaledVector(n, lift)
    return obj
  }

  function cabinWindows(fz, spec) {
    const { from, to, pitch = 0.508, t = 0.2, w = 0.26, h = 0.38, skip = [] } = spec
    const shape = roundedRect(w, h, Math.min(w, h) * 0.32)
    const geo = new THREE.ShapeGeometry(shape)
    const count = Math.floor((to - from) / pitch)
    const inst = new THREE.InstancedMesh(geo, mats.glass, count * 2)
    const dummy = new THREE.Object3D()
    let k = 0
    for (let i = 0; i < count; i++) {
      const x = from + i * pitch
      if (skip.some(([a, b]) => x > a && x < b)) continue
      const u = (x - fz.x0) / (fz.x1 - fz.x0)
      for (const side of [t, Math.PI - t]) {
        placeOn(dummy, fz.at(u, side), 0.012)
        dummy.updateMatrix()
        inst.setMatrixAt(k++, dummy.matrix)
      }
    }
    inst.count = k
    inst.castShadow = false
    return inst
  }

  function doorFrame(fz, x, t, w, h, opts = {}) {
    const outer = roundedRect(w, h, 0.18)
    const inner = roundedRect(w - 0.07, h - 0.07, 0.15)
    outer.holes.push(inner)
    const geo = new THREE.ExtrudeGeometry(outer, { depth: 0.006, bevelEnabled: false })
    const m = new THREE.Mesh(geo, mats.dark)
    const u = (x - fz.x0) / (fz.x1 - fz.x0)
    placeOn(m, fz.at(u, t), 0.012)
    if (opts.window) {
      const win = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(0.26, 0.38, 0.09)), mats.glass)
      placeOn(win, fz.at(u, t), 0.02)
      win.position.y += h * 0.14
      const g = new THREE.Group(); g.add(m, win); return g
    }
    return m
  }

  function wheel(r, width, mat = mats.tyre) {
    const g = new THREE.Group()
    const tyre = mesh(new THREE.CylinderGeometry(r, r, width, 28), mat)
    tyre.rotation.x = Math.PI / 2
    const rim = mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, width * 1.04, 20), mats.rim)
    rim.rotation.x = Math.PI / 2
    const hub = mesh(new THREE.CylinderGeometry(r * 0.2, r * 0.2, width * 1.1, 12), mats.dark)
    hub.rotation.x = Math.PI / 2
    g.add(tyre, rim, hub)
    return g
  }

  function tube(a, b, r, mat = mats.steel, segs = 14) {
    const d = b.clone().sub(a)
    const len = d.length()
    const g = new THREE.CylinderGeometry(r, r, len, segs)
    const m = mesh(g, mat)
    m.position.copy(a).addScaledVector(d, 0.5)
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize())
    return m
  }

  function lamp(mat, r = 0.06) { return mesh(new THREE.SphereGeometry(r, 12, 10), mat, { shadow: false }) }

  /* ---------------------------------------------------------------------
     Liveries. Each returns a paint(p, u, v) → Color for the fuselage loft.
     --------------------------------------------------------------------- */
  const AXZ = { white: col(0xf3f0e9), cyan: col(0x00a2e8), deep: col(0x0b3c5d), grey: col(0x9aa3ad), belly: col(0xbfc6cc), night: col(0x15171b) }

  const liveries = {
    /* Eurowhite with the AXZ cyan belly swept up into a tail band. */
    axz(L, r) {
      return (p, u) => {
        const rel = (p.y) / r
        // The band's upper edge: flat along the cabin, sweeping up the tail.
        const sweep = -0.52 + Math.max(0, (u - 0.66) / 0.34) * 1.7
        if (rel < sweep - 0.10) return AXZ.cyan
        if (rel < sweep) return AXZ.deep
        return AXZ.white
      }
    },
    /* Plain white, dark belly, no band. */
    plain(L, r) {
      return (p, u) => (p.y / r < -0.62 ? AXZ.belly : AXZ.white)
    },
    /* B-1717, the Minecraft collaboration: grass on top, dirt below, in
       half-metre blocks, quantised the way a texture on a block is. */
    minecraft(L, r) {
      const grass = [col(0x5fa943), col(0x4f9a38), col(0x6db14c), col(0x57a03c)]
      const dirt = [col(0x8b5a2b), col(0x7a4f26), col(0x96633a), col(0x7f5429)]
      const stone = [col(0x8a8a8a), col(0x7d7d7d), col(0x939393)]
      const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s) }
      return (p, u) => {
        const bx = Math.floor(p.x / 0.5), by = Math.floor((p.y + 100) / 0.5)
        const h = hash(bx, by)
        const rel = p.y / r
        if (rel > 0.35) return grass[Math.floor(h * grass.length)]
        if (rel > -0.6) return dirt[Math.floor(h * dirt.length)]
        return stone[Math.floor(h * stone.length)]
      }
    },
    /* The heavy: white over a mid-grey belly, cyan cheatline at the deck. */
    heavy(L, r) {
      return (p, u) => {
        const rel = p.y / r
        if (rel < -0.55) return AXZ.grey
        if (rel > -0.55 && rel < -0.42 && u > 0.05 && u < 0.92) return AXZ.cyan
        return AXZ.white
      }
    },
    /* Low-visibility grey, radome darker. */
    lowvis(L, r) {
      const grey = col(0x767d85), belly = col(0x8a9199), radome = col(0x3d4247)
      return (p, u) => (u < 0.055 ? radome : p.y / r < -0.35 ? belly : grey)
    },
    /* Rescue: yellow upper body, red belly and tail boom band. */
    rescue() {
      const yellow = col(0xf2c400), red = col(0xd1261b), white = col(0xf7f4ea)
      return (p, u) => {
        if (p.y < 1.02) return red
        if (p.y < 1.14) return white
        return yellow
      }
    },
  }

  /* =====================================================================
     AIRBUS H145
     Twin Arriel 2E, four-blade bearingless main rotor, Fenestron. Published:
     length 13.64 m rotors turning, height 3.95 m, rotor diameter 11.00 m,
     Fenestron 1.00 m. The fuselage below is drawn to those and to the
     BK117 lineage it comes from: a flat-floored cabin with clamshell rear
     doors, a boom that tapers into a swept fin, and the skids.
     ===================================================================== */
  function buildH145(opts = {}) {
    const g = new THREE.Group()
    g.name = 'H145'
    const paint = liveries.rescue()

    // --- Cabin body. Stations by eye from the three-view; yc is the section
    //     centre above the skid ground.
    const body = fuselage([
      { x: 0.00, w: 0.06, hu: 0.03, hd: 0.03, yc: 1.02, k: 2.0 },
      { x: 0.30, w: 0.78, hu: 0.34, hd: 0.30, yc: 1.05, k: 2.2 },
      { x: 0.85, w: 1.34, hu: 0.60, hd: 0.52, yc: 1.16, k: 2.3 },
      { x: 1.55, w: 1.70, hu: 0.86, hd: 0.66, yc: 1.30, k: 2.5 },
      { x: 2.30, w: 1.92, hu: 1.02, hd: 0.82, yc: 1.42, k: 2.8 },
      { x: 3.30, w: 2.00, hu: 1.05, hd: 0.90, yc: 1.48, k: 3.2 },
      { x: 4.60, w: 2.00, hu: 1.05, hd: 0.90, yc: 1.48, k: 3.2 },
      { x: 5.60, w: 1.84, hu: 0.98, hd: 0.82, yc: 1.56, k: 2.8 },
      { x: 6.30, w: 1.30, hu: 0.70, hd: 0.58, yc: 1.78, k: 2.4 },
      { x: 6.95, w: 0.78, hu: 0.42, hd: 0.36, yc: 1.98, k: 2.2 },
    ], {
      n: 110, segs: 72, paint,
      /* Canopy glazing lives in the loft itself: forward of the cabin, on the
         upper body, less the pillars. The H145 has a big two-pane windscreen,
         chin windows below the nose and two roof panes above the crew. */
      classify: (u, v) => {
        const x = u * 6.95
        const t = v * TAU
        const yv = Math.sin(t)                 // -1 bottom … +1 top
        const zv = Math.cos(t)                 // +1 starboard … -1 port
        if (x > 0.42 && x < 2.28) {
          // centre windscreen post
          if (Math.abs(zv) < 0.05 && yv > 0.1) return 0
          // door-post / A-pillar at the back of the glazing
          if (x > 2.14 && Math.abs(zv) > 0.55) return 0
          // windscreen and side panes
          if (yv > 0.10 && yv < 0.92) return 1
          // chin windows under the nose
          if (x < 1.35 && yv < -0.35 && yv > -0.82 && Math.abs(zv) < 0.75) return 1
          // roof panes
          if (x > 1.10 && yv >= 0.92 && Math.abs(zv) > 0.12) return 1
        }
        // sliding cabin door windows, both sides
        if (x > 2.55 && x < 4.35 && Math.abs(zv) > 0.72 && yv > 0.12 && yv < 0.68) return 1
        return 0
      },
    })
    g.add(mesh(body.geo, [mats.paint, mats.glassBlue]))

    // --- Tail boom: oval, tapering, rising toward the fin.
    const boom = fuselage([
      { x: 6.70, w: 0.80, hu: 0.44, hd: 0.40, yc: 1.96, k: 2.2 },
      { x: 8.20, w: 0.66, hu: 0.40, hd: 0.36, yc: 2.06, k: 2.2 },
      { x: 9.80, w: 0.52, hu: 0.36, hd: 0.30, yc: 2.18, k: 2.2 },
      { x: 10.90, w: 0.36, hu: 0.30, hd: 0.22, yc: 2.30, k: 2.2 },
    ], { n: 40, segs: 40, paint, caps: true })
    g.add(mesh(boom.geo, mats.paint))

    // --- Engine deck and rotor mast fairing on the cabin roof.
    const deck = fuselage([
      { x: 2.75, w: 0.70, hu: 0.06, hd: 0.20, yc: 2.52, k: 2.4 },
      { x: 3.20, w: 1.36, hu: 0.34, hd: 0.30, yc: 2.56, k: 2.8 },
      { x: 4.10, w: 1.56, hu: 0.46, hd: 0.34, yc: 2.60, k: 3.0 },
      { x: 5.20, w: 1.50, hu: 0.42, hd: 0.32, yc: 2.58, k: 3.0 },
      { x: 5.95, w: 1.10, hu: 0.26, hd: 0.26, yc: 2.52, k: 2.6 },
      { x: 6.35, w: 0.60, hu: 0.10, hd: 0.14, yc: 2.46, k: 2.2 },
    ], { n: 40, segs: 40, paint: () => col(0xe8b800), caps: true })
    g.add(mesh(deck.geo, mats.paint))

    // Intakes: two dark scoops either side of the deck.
    for (const s of [1, -1]) {
      const intake = mesh(new THREE.BoxGeometry(0.62, 0.24, 0.16), mats.dark)
      intake.position.set(3.55, 2.72, s * 0.72)
      g.add(intake)
      // Exhausts: paired pipes angled out and aft.
      const ex = mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.5, 20, 1, true), mats.engineHot)
      ex.material = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.5, metalness: 0.85, side: THREE.DoubleSide })
      ex.position.set(5.95, 2.72, s * 0.52)
      ex.rotation.z = Math.PI / 2 - 0.15
      ex.rotation.x = s * 0.35
      g.add(ex)
    }

    // --- Main rotor: mast, hub, four bearingless blades with root cuffs.
    const rotor = new THREE.Group()
    rotor.name = 'mainRotor'
    rotor.position.set(3.95, 3.02, 0)
    const mast = mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.62, 18), mats.steel)
    mast.position.set(3.95, 2.80, 0)
    g.add(mast)
    const hub = mesh(new THREE.CylinderGeometry(0.30, 0.34, 0.26, 24), mats.dark)
    rotor.add(hub)
    const hubCap = mesh(new THREE.SphereGeometry(0.22, 20, 14, 0, TAU, 0, Math.PI / 2), mats.dark)
    hubCap.position.y = 0.13
    rotor.add(hubCap)
    const R = 5.5
    const bladeGeo = surface([
      { x: -0.14, y: 0.00, z: 0.36, chord: 0.30, thick: 0.16, camber: 0.03, twist: 8 },
      { x: -0.16, y: 0.01, z: 0.95, chord: 0.34, thick: 0.13, camber: 0.03, twist: 7 },
      { x: -0.16, y: 0.06, z: 3.00, chord: 0.33, thick: 0.11, camber: 0.03, twist: 3 },
      { x: -0.15, y: 0.12, z: 4.70, chord: 0.31, thick: 0.10, camber: 0.03, twist: 0 },
      { x: -0.09, y: 0.15, z: R - 0.10, chord: 0.22, thick: 0.09, camber: 0.02, twist: -1 },
      { x: -0.03, y: 0.16, z: R, chord: 0.08, thick: 0.08, camber: 0.0, twist: -1 },
    ], { axis: 'z', paint: (p) => (p.z > R - 0.55 ? AXZ.white : col(0x23272c)) })
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group()
      arm.rotation.y = i * Math.PI / 2
      const blade = mesh(bladeGeo, mats.paint)
      const cuff = mesh(new THREE.BoxGeometry(0.30, 0.16, 0.40), mats.dark)
      cuff.position.set(0, 0.02, 0.42)
      const pitchLink = tube(V3(0.16, -0.12, 0.30), V3(0.16, 0.06, 0.34), 0.018, mats.steel, 8)
      arm.add(blade, cuff, pitchLink)
      rotor.add(arm)
    }
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.6, R, 64, 1),
      new THREE.MeshBasicMaterial({ color: 0x1a1d21, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }))
    disc.rotation.x = -Math.PI / 2
    disc.position.y = 0.16
    disc.name = 'rotorDisc'
    rotor.add(disc)
    g.add(rotor)

    // --- Fin with the Fenestron. The fin is an extruded outline with a
    //     circular hole; the fan lives inside it.
    const finShape = new THREE.Shape()
    finShape.moveTo(10.15, 2.40)                      // where the boom meets the fin
    finShape.quadraticCurveTo(10.55, 3.25, 11.05, 3.72) // swept leading edge
    finShape.quadraticCurveTo(11.25, 3.86, 11.55, 3.84)
    finShape.lineTo(11.95, 3.74)
    finShape.quadraticCurveTo(12.12, 3.66, 12.12, 3.45)
    finShape.lineTo(12.08, 2.05)                      // near-vertical trailing edge
    finShape.quadraticCurveTo(12.05, 1.70, 11.70, 1.66)
    finShape.lineTo(11.05, 1.72)                      // ventral part below the boom
    finShape.quadraticCurveTo(10.55, 1.80, 10.40, 2.05)
    finShape.lineTo(10.15, 2.40)
    const fanC = { x: 11.42, y: 2.66 }
    const fanR = 0.50
    const hole = new THREE.Path()
    hole.absarc(fanC.x, fanC.y, fanR + 0.02, 0, TAU, false)
    finShape.holes.push(hole)
    const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.20, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 3, curveSegments: 24 })
    finGeo.translate(0, 0, -0.10)
    const fin = mesh(finGeo, new THREE.MeshStandardMaterial({ color: 0xd1261b, roughness: 0.42, metalness: 0.08 }))
    g.add(fin)
    // Fin fillet into the boom
    const fillet = mesh(new THREE.BoxGeometry(0.7, 0.22, 0.26), fin.material)
    fillet.position.set(10.45, 2.28, 0)
    fillet.rotation.z = 0.35
    g.add(fillet)

    // Fenestron: shroud ring, stator vanes, hub, ten blades.
    const fen = new THREE.Group()
    fen.position.set(fanC.x, fanC.y, 0)
    const shroud = mesh(new THREE.TorusGeometry(fanR + 0.015, 0.035, 10, 40), mats.dark)
    fen.add(shroud)
    for (let i = 0; i < 8; i++) {
      const a = i * TAU / 8 + 0.2
      const vane = mesh(new THREE.BoxGeometry(fanR * 0.9, 0.025, 0.08), mats.steel)
      vane.position.set(Math.cos(a) * fanR * 0.5, Math.sin(a) * fanR * 0.5, 0.09)
      vane.rotation.z = a
      fen.add(vane)
    }
    const tailRotor = new THREE.Group()
    tailRotor.name = 'tailRotor'
    const tHub = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 18), mats.dark)
    tHub.rotation.x = Math.PI / 2
    tailRotor.add(tHub)
    const tBladeGeo = new THREE.BoxGeometry(0.06, fanR - 0.13, 0.012)
    tBladeGeo.translate(0, (fanR - 0.13) / 2 + 0.10, 0)
    for (let i = 0; i < 10; i++) {
      const b = mesh(tBladeGeo, mats.blade)
      b.rotation.z = i * TAU / 10 + (i % 2) * 0.12   // uneven spacing, as on the real fan
      b.rotation.y = 0.45
      tailRotor.add(b)
    }
    fen.add(tailRotor)
    g.add(fen)

    // --- Horizontal stabiliser with endplate fins, on the boom.
    const stabGeo = surface([
      { x: 9.05, y: 2.18, z: 0.00, chord: 0.62, thick: 0.10, camber: 0.0 },
      { x: 9.10, y: 2.18, z: 1.35, chord: 0.52, thick: 0.09, camber: 0.0 },
    ], { axis: 'z', paint: () => col(0xf2c400) })
    const stabR = mesh(stabGeo, mats.paint)
    g.add(stabR, mirrorZ(stabR))
    for (const s of [1, -1]) {
      const plateGeo = surface([
        { x: 8.95, y: 1.90, z: s * 1.36, chord: 0.62, thick: 0.08, camber: 0 },
        { x: 9.25, y: 2.62, z: s * 1.38, chord: 0.42, thick: 0.08, camber: 0 },
      ], { axis: 'y', paint: () => col(0xd1261b) })
      g.add(mesh(plateGeo, mats.paint))
    }

    // --- Skids. Two tubes, upturned at the front, on four cross-tube legs.
    const skidY = 0.05
    for (const s of [1, -1]) {
      const z = s * 1.12
      g.add(tube(V3(1.05, skidY, z), V3(4.85, skidY, z), 0.048))
      // upturned toe
      const toe = mesh(new THREE.TorusGeometry(0.45, 0.048, 10, 20, Math.PI / 2.2), mats.steel)
      toe.position.set(1.05, skidY + 0.45, z)
      toe.rotation.y = Math.PI / 2
      toe.rotation.z = Math.PI / 2 + 0.05
      g.add(toe)
      // heel cap
      const heel = mesh(new THREE.SphereGeometry(0.05, 10, 8), mats.steel)
      heel.position.set(4.85, skidY, z)
      g.add(heel)
      // cross tubes: arched legs from the belly to the skid
      for (const x of [1.95, 4.35]) {
        g.add(tube(V3(x, 0.62, s * 0.62), V3(x, skidY + 0.02, z), 0.045))
        g.add(tube(V3(x, 0.62, s * 0.62), V3(x, 0.60, 0), 0.045))
      }
      // step
      const step = mesh(new THREE.BoxGeometry(1.4, 0.05, 0.22), mats.dark)
      step.position.set(3.1, 0.82, s * 1.14)
      g.add(step)
      // wire strike cutters
    }
    const cutter = mesh(new THREE.ConeGeometry(0.05, 0.42, 6), mats.steel)
    cutter.position.set(0.55, 2.35, 0)
    cutter.rotation.z = -0.9
    g.add(cutter)

    // --- Rescue hoist on the starboard cabin roof, and a searchlight.
    const hoistArm = tube(V3(2.65, 2.45, -1.02), V3(2.65, 2.62, -1.55), 0.05, mats.dark)
    const hoistHead = mesh(new THREE.BoxGeometry(0.26, 0.30, 0.22), mats.dark)
    hoistHead.position.set(2.65, 2.48, -1.55)
    g.add(hoistArm, hoistHead)
    const light = mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.16, 20), mats.steel)
    light.position.set(1.25, 0.50, 0.55)
    light.rotation.x = Math.PI / 2
    g.add(light)

    // --- Lights: nav, strobes, anti-collision beacon.
    const beacon = lamp(mats.beacon, 0.07); beacon.position.set(6.5, 2.66, 0); beacon.name = 'beacon'
    const navL = lamp(mats.navRed, 0.05); navL.position.set(3.0, 1.55, -1.03)
    const navR = lamp(mats.navGreen, 0.05); navR.position.set(3.0, 1.55, 1.03)
    const tailLamp = lamp(mats.navWhite, 0.045); tailLamp.position.set(12.1, 3.62, 0)
    g.add(beacon, navL, navR, tailLamp)

    // Windscreen wipers, a pitot, the door handles: the small things that
    // make a body read as a machine rather than a shape.
    const pitot = tube(V3(0.22, 1.20, 0.30), V3(-0.35, 1.22, 0.30), 0.014, mats.steel, 6)
    g.add(pitot)
    for (const s of [1, -1]) {
      const wiper = tube(V3(1.02, 1.62, s * 0.22), V3(1.55, 2.05, s * 0.64), 0.012, mats.dark, 6)
      g.add(wiper)
    }

    g.userData = {
      spin: [{ name: 'mainRotor', axis: 'y', rpm: 383 }, { name: 'tailRotor', axis: 'z', rpm: 3584 }],
      beacon: 'beacon',
      length: 13.64, extent: 13.6, height: 3.95,
      offset: V3(-5.4, 0, 0),   // centre the drawn body for the camera
    }
    return g
  }

  /* =====================================================================
     AIRLINERS. One builder, parameterised by the published dimensions and a
     handful of type flags. The proportions below are the 737/A32x family's,
     and the 747 adds a second body for its upper deck.
     ===================================================================== */
  function buildAirliner(spec) {
    const g = new THREE.Group()
    g.name = spec.name
    const L = spec.len, D = spec.dia, r = D / 2, B = spec.span
    const clear = spec.clear ?? 0.33 * D           // belly to ground
    const ground = -(r + clear)
    const highWing = !!spec.highWing
    const livery = liveries[spec.livery || (spec.lowVis ? 'lowvis' : 'axz')](L, r)

    // --- Fuselage
    const noseDroop = spec.upperDeck ? -0.10 : highWing ? -0.20 : -0.32
    const st = [
      { x: 0.000 * L, w: 0.04 * D, hu: 0.02 * r, hd: 0.02 * r, yc: noseDroop * r, k: 2.0 },
      { x: 0.004 * L, w: 0.30 * D, hu: 0.22 * r, hd: 0.20 * r, yc: noseDroop * 0.94 * r, k: 2.05 },
      { x: 0.012 * L, w: 0.50 * D, hu: 0.40 * r, hd: 0.35 * r, yc: noseDroop * 0.82 * r, k: 2.1 },
      { x: 0.032 * L, w: 0.70 * D, hu: 0.62 * r, hd: 0.55 * r, yc: noseDroop * 0.55 * r, k: 2.15 },
      { x: 0.060 * L, w: 0.84 * D, hu: 0.78 * r, hd: 0.72 * r, yc: noseDroop * 0.25 * r, k: 2.2 },
      { x: 0.090 * L, w: 0.95 * D, hu: 0.93 * r, hd: 0.88 * r, yc: noseDroop * 0.06 * r, k: 2.2 },
      { x: 0.135 * L, w: 1.00 * D, hu: 1.00 * r, hd: 1.00 * r, yc: 0, k: 2.2 },
      { x: 0.700 * L, w: 1.00 * D, hu: 1.00 * r, hd: 1.00 * r, yc: 0, k: 2.2 },
      { x: 0.780 * L, w: 0.92 * D, hu: 0.92 * r, hd: 0.78 * r, yc: 0.12 * r, k: 2.2 },
      { x: 0.860 * L, w: 0.68 * D, hu: 0.70 * r, hd: 0.48 * r, yc: 0.40 * r, k: 2.2 },
      { x: 0.930 * L, w: 0.40 * D, hu: 0.44 * r, hd: 0.28 * r, yc: 0.68 * r, k: 2.2 },
      { x: 1.000 * L, w: 0.06 * D, hu: 0.08 * r, hd: 0.05 * r, yc: 0.92 * r, k: 2.0 },
    ]
    const cockpit = spec.upperDeck ? null : (u, v) => {
      const t = v * TAU, yv = Math.sin(t), zv = Math.cos(t)
      if (u > 0.062 && u < 0.112) {
        if (Math.abs(zv) < 0.05) return 0                         // centre post
        if (u > 0.086 && u < 0.092) return 0                      // pillar between panes
        if (yv > 0.12 && yv < 0.78) return 1
      }
      return 0
    }
    const fz = fuselage(st, { n: 130, segs: 72, paint: livery, classify: cockpit })
    g.add(mesh(fz.geo, [mats.paint, mats.glass]))

    // 747: the upper deck, a second body on top of the first, carrying the
    // cockpit. Its nose starts just behind the main nose.
    let deck = null
    if (spec.upperDeck) {
      const hump = [
        { x: 0.030 * L, w: 0.20 * D, hu: 0.12 * r, hd: 0.40 * r, yc: 0.55 * r, k: 2.2 },
        { x: 0.050 * L, w: 0.46 * D, hu: 0.34 * r, hd: 0.55 * r, yc: 0.62 * r, k: 2.3 },
        { x: 0.085 * L, w: 0.60 * D, hu: 0.58 * r, hd: 0.70 * r, yc: 0.72 * r, k: 2.4 },
        { x: 0.140 * L, w: 0.64 * D, hu: 0.66 * r, hd: 0.72 * r, yc: 0.78 * r, k: 2.5 },
        { x: 0.250 * L, w: 0.64 * D, hu: 0.64 * r, hd: 0.72 * r, yc: 0.78 * r, k: 2.5 },
        { x: 0.320 * L, w: 0.52 * D, hu: 0.40 * r, hd: 0.70 * r, yc: 0.72 * r, k: 2.3 },
        { x: 0.370 * L, w: 0.30 * D, hu: 0.08 * r, hd: 0.60 * r, yc: 0.62 * r, k: 2.2 },
      ]
      deck = fuselage(hump, {
        n: 70, segs: 56, paint: livery, caps: true,
        classify: (u, v) => {
          const t = v * TAU, yv = Math.sin(t), zv = Math.cos(t)
          if (u > 0.10 && u < 0.22 && yv > 0.05 && yv < 0.70 && Math.abs(zv) > 0.06) return 1
          return 0
        },
      })
      g.add(mesh(deck.geo, [mats.paint, mats.glass]))
    }

    // --- Cabin windows and doors
    if ((!spec.cargo || spec.upperDeck) && !spec.lowVis) {
      const from = spec.upperDeck ? 0.10 * L : 0.155 * L
      g.add(cabinWindows(fz, { from, to: 0.80 * L, pitch: 0.508, t: 0.22, w: 0.26, h: 0.38 }))
      if (deck) g.add(cabinWindows(deck, { from: 0.15 * L, to: 0.30 * L, pitch: 0.508, t: 0.20, w: 0.26, h: 0.36 }))
    }
    const doorH = 1.85, doorW = 0.86
    const doorT = 0.02
    const doorXs = spec.lowVis ? [] : spec.upperDeck ? [0.11, 0.30, 0.52, 0.74, 0.86] : [0.115, 0.775]
    for (const dx of doorXs) {
      g.add(doorFrame(fz, dx * L, Math.PI - doorT, doorW, doorH, { window: true }))
      g.add(doorFrame(fz, dx * L, doorT, doorW, doorH, { window: true }))
    }
    if (!spec.upperDeck && !spec.lowVis) {
      // overwing exits, one each side on a 737, two on an A321
      const exits = spec.len > 42 ? [0.455, 0.49] : [0.47]
      for (const ex of exits) {
        g.add(doorFrame(fz, ex * L, Math.PI - 0.16, 0.5, 0.95))
        g.add(doorFrame(fz, ex * L, 0.16, 0.5, 0.95))
      }
    }
    if (spec.cargo) {
      // Main-deck cargo door, port side forward, hinged at the top.
      g.add(doorFrame(fz, 0.215 * L, 0.12, 3.5, 2.15))
      // A freighter keeps its cockpit and a small crew window behind it.
      g.add(cabinWindows(fz, { from: 0.135 * L, to: 0.16 * L, pitch: 0.5, t: 0.22 }))
    }
    // Belly cargo doors (all types)
    if (!spec.lowVis) for (const bx of [0.24, 0.66]) g.add(doorFrame(fz, bx * L, -0.55, 1.2, 1.0))
    // Radome seam and a dark nose cone tip
    const radome = mesh(new THREE.SphereGeometry(0.02 * D, 12, 10), mats.dark)
    radome.position.set(0.01 * L, noseDroop * r, 0)
    g.add(radome)

    // --- Wing. Root buried in the fuselage side; a kink inboard of which the
    //     trailing edge runs straight (the yehudi), sweep 25° at the LE.
    const half = B / 2
    const zRoot = 0.30 * r, zKink = spec.upperDeck ? 0.36 * half : 0.34 * half
    const yRoot = highWing ? 0.62 * r : -0.58 * r
    const dihedral = rad(spec.dihedralDeg ?? 6)
    const xLE0 = (spec.upperDeck ? 0.34 : 0.375) * L
    const sweepLE = Math.tan(rad(spec.sweepDeg ?? 25))
    const sweepTE = Math.tan(rad(spec.upperDeg ?? 14))
    const meanChord = spec.wingArea ? spec.wingArea / B : 0.16 * L
    const cKink = meanChord * 1.35
    const LE = z => xLE0 + (z - zRoot) * sweepLE
    const TEk = LE(zKink) + cKink
    const TE = z => (z < zKink ? TEk : TEk + (z - zKink) * sweepTE)
    const wingSec = z => ({ x: LE(z), y: yRoot + (z - zRoot) * Math.tan(dihedral), z, chord: TE(z) - LE(z) })
    const raked = spec.winglet === 'raked'
    const tipZ = half - (spec.winglet === 'none' ? 0 : raked ? 0.09 * half : 0.35)
    const secs = [
      { ...wingSec(zRoot), thick: 0.13, camber: 0.025, twist: 1.5 },
      { ...wingSec(zKink), thick: 0.12, camber: 0.025, twist: 0.5 },
      { ...wingSec(lerp(zKink, tipZ, 0.55)), thick: 0.10, camber: 0.02, twist: -1 },
      { ...wingSec(tipZ), thick: 0.09, camber: 0.018, twist: -2.5 },
    ]
    // Raked tip: the wing keeps going, sweeping harder, to a point.
    if (raked) {
      const tip = secs[secs.length - 1]
      for (let i = 1; i <= 3; i++) {
        const f = i / 3
        secs.push({ x: tip.x + f * (half - tipZ) * 1.6, y: tip.y + f * (half - tipZ) * Math.tan(dihedral), z: tip.z + f * (half - tipZ), chord: tip.chord * lerp(1, 0.18, f), thick: 0.08, camber: 0.01, twist: -3 })
      }
    }
    // Winglet: continue the tip round a bend and up.
    if (spec.winglet && spec.winglet !== 'none' && !raked) {
      const tip = secs[secs.length - 1]
      const H = spec.winglet === 'canted' ? 0.055 * B : 0.068 * B
      const bendR = spec.winglet === 'sharklet' ? 0.45 : 0.75
      const steps = 6
      for (let i = 1; i <= steps; i++) {
        const a = (i / steps) * (spec.winglet === 'canted' ? rad(60) : rad(88))
        const f = i / steps
        secs.push({
          x: tip.x + f * (0.55 * tip.chord) + (spec.winglet === 'canted' ? f * 1.2 : 0),
          y: tip.y + bendR * Math.sin(a) + Math.max(0, f - 0.45) * H,
          z: tip.z + bendR * (1 - Math.cos(a)) + (spec.winglet === 'canted' ? f * 0.5 : 0),
          chord: tip.chord * lerp(1, 0.32, f), thick: 0.08, camber: 0.01, twist: -2.5,
        })
      }
    }
    const wingPaint = spec.lowVis ? (() => col(0x737a82)) : (p => (p.y < yRoot + (p.z - zRoot) * Math.tan(dihedral) + 0.02 ? AXZ.belly : AXZ.white))
    const wingGeo = surface(secs, { axis: 'z', paint: wingPaint, n: 22 })
    const wingR = mesh(wingGeo, mats.paint)
    g.add(wingR, mirrorZ(wingR))
    // Wing-body fairing under the centre section (over it on a high wing)
    const fairSign = highWing ? -1 : 1
    const fairY = highWing ? 0.55 * r : -0.55 * r
    const fairing = fuselage([
      { x: xLE0 - 0.05 * L, w: 0.9 * D, hu: highWing ? 0.10 * r : 0.02, hd: highWing ? 0.02 : 0.10 * r, yc: fairY, k: 2.4 },
      { x: xLE0 + 0.03 * L, w: 1.18 * D, hu: highWing ? 0.34 * r : 0.02, hd: highWing ? 0.02 : 0.34 * r, yc: fairY - fairSign * 0.07 * r, k: 2.6 },
      { x: TEk, w: 1.16 * D, hu: highWing ? 0.30 * r : 0.02, hd: highWing ? 0.02 : 0.30 * r, yc: fairY - fairSign * 0.07 * r, k: 2.6 },
      { x: TEk + 0.07 * L, w: 0.86 * D, hu: highWing ? 0.08 * r : 0.02, hd: highWing ? 0.02 : 0.08 * r, yc: fairY, k: 2.4 },
    ], { n: 30, segs: 40, paint: () => (spec.lowVis ? col(0x737a82) : AXZ.belly), caps: true })
    g.add(mesh(fairing.geo, mats.paint))
    // Flap-track fairings under the trailing edge
    const nFtf = spec.upperDeck ? 4 : 3
    for (let i = 0; i < nFtf; i++) {
      const z = lerp(zKink * 1.05, tipZ * 0.85, i / (nFtf - 1))
      const s = wingSec(z)
      const canoe = fuselage([
        { x: s.x + s.chord * 0.62, w: 0.22, hu: 0.05, hd: 0.10, yc: s.y - 0.06, k: 2.2 },
        { x: s.x + s.chord * 0.95, w: 0.32, hu: 0.06, hd: 0.20, yc: s.y - 0.10, k: 2.2 },
        { x: s.x + s.chord * 1.18, w: 0.10, hu: 0.03, hd: 0.06, yc: s.y - 0.08, k: 2.2 },
      ], { n: 16, segs: 20, paint: () => (spec.lowVis ? col(0x737a82) : AXZ.belly), caps: true })
      const mR = mesh(canoe.geo, mats.paint)
      g.add(mR, mirrorZ(mR))
    }

    // --- Engines
    const eng = spec.nacelle ?? 0.53 * D
    const twinPod = spec.engines === 8
    const engZ = twinPod ? [0.38 * half, 0.62 * half] : spec.engines === 4 ? [0.40 * half, 0.69 * half] : [(spec.len > 42 ? 0.32 : 0.28) * half]
    const exhausts = []
    const podOffsets = twinPod ? [-0.58 * eng, 0.58 * eng] : [0]
    for (const zPod of engZ) for (const dz of podOffsets) {
      const z = zPod + dz
      const s = wingSec(zPod)
      const nacL = spec.engines >= 4 ? 2.4 * eng : 2.15 * eng
      const x0 = s.x - nacL * 0.62
      const y0 = s.y - eng * (highWing ? 0.95 : 0.62)
      exhausts.push({ x: x0 + nacL, y: y0, z }, { x: x0 + nacL, y: y0, z: -z })
      const nac = fuselage([
        { x: x0, w: 0.86 * eng, hu: 0.43 * eng, hd: 0.43 * eng, yc: y0, k: 2.2 },
        { x: x0 + 0.05 * nacL, w: 1.00 * eng, hu: 0.50 * eng, hd: 0.50 * eng, yc: y0, k: 2.2 },
        { x: x0 + 0.40 * nacL, w: 1.02 * eng, hu: 0.51 * eng, hd: spec.upperDeck ? 0.51 * eng : 0.44 * eng, yc: y0, k: spec.upperDeck ? 2.2 : 2.6 },
        { x: x0 + 0.72 * nacL, w: 0.80 * eng, hu: 0.40 * eng, hd: 0.36 * eng, yc: y0 + 0.02 * eng, k: 2.3 },
        { x: x0 + 0.88 * nacL, w: 0.50 * eng, hu: 0.26 * eng, hd: 0.26 * eng, yc: y0 + 0.04 * eng, k: 2.2 },
        { x: x0 + 1.00 * nacL, w: 0.30 * eng, hu: 0.15 * eng, hd: 0.15 * eng, yc: y0 + 0.05 * eng, k: 2.2 },
      ], { n: 40, segs: 48, paint: p => (spec.lowVis ? col(0x767d85) : p.y < y0 - 0.1 ? AXZ.belly : AXZ.white) })
      const nm = mesh(nac.geo, mats.paint)
      // inlet lip and the fan behind it
      const lip = mesh(new THREE.TorusGeometry(0.44 * eng, 0.045 * eng, 10, 40), mats.steel)
      lip.position.set(x0, y0, z); lip.rotation.y = Math.PI / 2
      const duct = mesh(new THREE.CylinderGeometry(0.40 * eng, 0.40 * eng, 0.30 * eng, 40, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.6, side: THREE.BackSide }))
      duct.position.set(x0 + 0.15 * eng, y0, z); duct.rotation.z = Math.PI / 2
      const fan = new THREE.Group()
      fan.name = 'fan'
      fan.position.set(x0 + 0.28 * eng, y0, z)
      const spinner = mesh(new THREE.ConeGeometry(0.09 * eng, 0.26 * eng, 20), mats.steel)
      spinner.rotation.z = Math.PI / 2; spinner.position.x = -0.10 * eng
      fan.add(spinner)
      const fb = new THREE.BoxGeometry(0.02 * eng, 0.32 * eng, 0.07 * eng)
      fb.translate(0, 0.22 * eng, 0)
      for (let i = 0; i < 22; i++) {
        const b = mesh(fb, mats.blade, { shadow: false })
        b.rotation.x = i * TAU / 22
        b.rotation.y = 0.5
        fan.add(b)
      }
      const core = mesh(new THREE.CylinderGeometry(0.10 * eng, 0.14 * eng, 0.30 * eng, 20), mats.engineHot)
      core.position.set(x0 + nacL * 1.02, y0 + 0.05 * eng, z); core.rotation.z = Math.PI / 2
      const pylon = mesh(new THREE.BoxGeometry(nacL * 0.55, s.y - y0, 0.09 * eng), mats.paint)
      pylon.geometry = pylon.geometry.toNonIndexed()
      pylon.material = new THREE.MeshStandardMaterial({ color: spec.lowVis ? 0x737a82 : 0xf3f0e9, roughness: 0.42, metalness: 0.08 })
      pylon.position.set(x0 + nacL * 0.55, (s.y + y0) / 2 + 0.05, twinPod ? zPod : z)
      const grp = new THREE.Group()
      grp.add(nm, lip, duct, fan, core, pylon)
      g.add(grp, mirrorZ(grp))
    }

    // --- Empennage
    const topAt = u => fz.at(u, Math.PI / 2).p.y
    const finRootX = 0.78 * L, finRootY = topAt(0.80) - 0.05
    const finTop = ground + spec.h
    const finH = finTop - finRootY
    const finSweep = Math.tan(rad(spec.finSweepDeg ?? 35))
    const finPaint = p => {
      const f = (p.y - finRootY) / finH
      if (spec.lowVis) return col(0x737a82)
      if (spec.livery === 'minecraft') return liveries.minecraft(L, r)(p, 0.8)
      if (f > 0.10 && f < 0.28) return AXZ.deep
      if (f >= 0.28) return AXZ.cyan
      return AXZ.white
    }
    const finSecs = []
    if (spec.dorsal !== false) finSecs.push({ x: finRootX - 0.11 * L, y: finRootY + 0.02, z: 0, chord: 0.28 * L, thick: 0.06, camber: 0 })
    finSecs.push({ x: finRootX, y: finRootY + 0.06 * finH, z: 0, chord: 0.17 * L, thick: 0.09, camber: 0 })
    finSecs.push({ x: finRootX + finH * finSweep, y: finTop, z: 0, chord: 0.065 * L, thick: 0.08, camber: 0 })
    const finGeo = surface(finSecs, { axis: 'y', paint: finPaint, n: 14 })
    g.add(mesh(finGeo, mats.paint))
    // rudder hinge line
    const stabRootX = 0.865 * L, stabY = fz.at(0.88, Math.PI / 2).p.y - 0.36 * r
    const stabSpan = (spec.stabSpan ?? 0.40) * B / 2
    const stabSecs = [
      { x: stabRootX, y: stabY, z: 0.2 * r, chord: 0.10 * L, thick: 0.09, camber: -0.01 },
      { x: stabRootX + stabSpan * Math.tan(rad(30)), y: stabY + stabSpan * Math.tan(rad(7)), z: stabSpan, chord: 0.04 * L, thick: 0.08, camber: -0.01 },
    ]
    const stabGeo = surface(stabSecs, { axis: 'z', paint: () => (spec.lowVis ? col(0x737a82) : AXZ.white), n: 14 })
    const stabR = mesh(stabGeo, mats.paint)
    g.add(stabR, mirrorZ(stabR))
    // APU exhaust at the tail cone
    const apu = mesh(new THREE.CylinderGeometry(0.06 * D, 0.06 * D, 0.03 * L, 16), mats.engineHot)
    apu.rotation.z = Math.PI / 2; apu.position.set(0.995 * L, 0.90 * r, 0)
    g.add(apu)

    // --- Landing gear
    const gear = new THREE.Group()
    gear.name = 'gear'
    const bicycle = spec.gearLayout === 'bicycle'
    const nWheelR = 0.09 * D, mWheelR = 0.13 * D
    const noseX = bicycle ? 0.40 * L : 0.125 * L
    const noseBottom = fz.at(noseX / L, -Math.PI / 2).p.y
    const nose = new THREE.Group()
    nose.add(tube(V3(noseX, noseBottom + 0.1, 0), V3(noseX, ground + nWheelR, 0), 0.05 * D * 0.5))
    for (const s of [1, -1]) { const w = wheel(nWheelR, 0.28 * nWheelR * 2); w.position.set(noseX, ground + nWheelR, s * nWheelR * 0.5); nose.add(w) }
    const nDoor = mesh(new THREE.BoxGeometry(0.09 * L, 0.5 * nWheelR * 2 + 0.3, 0.02), mats.paint)
    nDoor.material = new THREE.MeshStandardMaterial({ color: 0xbfc6cc, roughness: 0.45 })
    nDoor.position.set(noseX + 0.02 * L, noseBottom - 0.2, 0.36 * nWheelR * 2 + 0.05)
    nDoor.rotation.x = 0.3
    nose.add(nDoor, mirrorZ(nDoor))
    if (!bicycle) gear.add(nose)
    const track = spec.track ?? 0.16 * B
    const cgX = spec.upperDeck ? 0.455 * L : bicycle ? 0.49 * L : 0.43 * L
    const mainX = bicycle ? 0.58 * L : cgX + 0.045 * L
    const mainSets = spec.upperDeck
      ? [[mainX, track / 2, 4], [mainX - 0.03 * L, track / 2 * 0.55, 4], [mainX + 0.01 * L, -track / 2, 4], [mainX - 0.03 * L, -track / 2 * 0.55, 4]]
      : bicycle
        ? [[0.40 * L, 1.25, 2], [0.40 * L, -1.25, 2], [0.58 * L, 1.25, 2], [0.58 * L, -1.25, 2]]
        : [[mainX, track / 2, 2], [mainX, -track / 2, 2]]
    for (const [mx, mz, nW] of mainSets) {
      const leg = new THREE.Group()
      const top = bicycle ? -0.6 * r : wingSec(Math.abs(mz)).y - 0.1
      leg.add(tube(V3(mx, top, mz), V3(mx, ground + mWheelR, mz), 0.06 * D * 0.5))
      if (nW === 2) {
        for (const s of [1, -1]) { const w = wheel(mWheelR, 0.36 * mWheelR); w.position.set(mx, ground + mWheelR, mz + s * mWheelR * 0.45); leg.add(w) }
      } else {
        const bogie = mesh(new THREE.BoxGeometry(mWheelR * 3.2, mWheelR * 0.5, mWheelR * 0.5), mats.steel)
        bogie.position.set(mx, ground + mWheelR, mz); leg.add(bogie)
        for (const dx of [-1, 1]) for (const s of [1, -1]) {
          const w = wheel(mWheelR, 0.36 * mWheelR); w.position.set(mx + dx * mWheelR * 1.3, ground + mWheelR, mz + s * mWheelR * 0.55); leg.add(w)
        }
      }
      gear.add(leg)
    }
    // Outriggers near the tips of a bicycle-gear wing, which is what keeps a
    // B-52 off its wingtip tanks on the ground.
    const extra = []
    if (bicycle) {
      for (const s of [1, -1]) {
        const z = s * 0.66 * half, sec = wingSec(Math.abs(z))
        gear.add(tube(V3(sec.x + sec.chord * 0.4, sec.y - 0.1, z), V3(sec.x + sec.chord * 0.4, ground + 0.35, z), 0.07))
        const w = wheel(0.35, 0.22); w.position.set(sec.x + sec.chord * 0.4, ground + 0.35, z); gear.add(w)
        extra.push({ x: sec.x + sec.chord * 0.4, y: ground + 0.06, z })
      }
    }
    g.add(gear)

    // --- Lights
    const beacon = lamp(mats.beacon, 0.05 * D); beacon.position.set(0.42 * L, r + 0.03, 0); beacon.name = 'beacon'
    const beaconL = lamp(mats.beacon, 0.05 * D); beaconL.position.set(0.44 * L, -r - 0.03, 0); beaconL.name = 'beacon'
    const tipR = secs[secs.length - 1], navR = lamp(mats.navGreen, 0.04 * D); navR.position.set(tipR.x + 0.1, tipR.y, -tipR.z)
    const navL = lamp(mats.navRed, 0.04 * D); navL.position.set(tipR.x + 0.1, tipR.y, tipR.z)
    const tailLamp = lamp(mats.navWhite, 0.035 * D); tailLamp.position.set(0.998 * L, 0.92 * r, 0)
    g.add(beacon, beaconL, navR, navL, tailLamp)

    g.position.y = -ground
    g.userData = {
      spin: [{ name: 'fan', axis: 'x', rpm: 900 }],
      beacon: 'beacon',
      length: L, extent: Math.max(L, B), height: spec.h,
      offset: V3(-L / 2, 0, 0),
      cg: { x: cgX, y: 0 }, rest: -ground,
      contacts: bicycle
        ? [
          { x: 0.40 * L, y: ground, z: 1.25, nose: true }, { x: 0.40 * L, y: ground, z: -1.25, nose: true },
          { x: 0.58 * L, y: ground, z: 1.25 }, { x: 0.58 * L, y: ground, z: -1.25 },
          { x: 0.95 * L, y: ground + (0.95 * L - 0.58 * L) * Math.tan(rad(spec.tailStrikeDeg || 11)), z: 0, tail: true },
          ...extra,
        ]
        : contactsFor({ L, ground, noseX, mainX, track, strikeDeg: spec.tailStrikeDeg || 11 }),
      eye: { x: 0.075 * L, y: (spec.upperDeck ? 1.15 : 0.28) * r, z: 0 },
      exhausts,
      tips: [{ x: tipR.x + 0.1, y: tipR.y, z: tipR.z }, { x: tipR.x + 0.1, y: tipR.y, z: -tipR.z }],
      lowVis: !!spec.lowVis,
    }
    return g
  }

  /* =====================================================================
     CONCORDE. The ogee delta is the whole silhouette, so the wing is lofted
     through a leading edge that curves rather than a straight sweep, and
     the fuselage is the slender tube the type is famous for.
     ===================================================================== */
  function buildConcorde(spec) {
    const g = new THREE.Group()
    g.name = spec.name
    const L = spec.len, D = spec.dia, r = D / 2, B = spec.span
    const clear = 2.1
    const ground = -(r + clear)
    const livery = liveries.plain(L, r)

    const st = [
      { x: 0.000 * L, w: 0.03 * D, hu: 0.015 * r, hd: 0.015 * r, yc: -0.62 * r, k: 2.0 },
      { x: 0.030 * L, w: 0.32 * D, hu: 0.24 * r, hd: 0.20 * r, yc: -0.52 * r, k: 2.1 },
      { x: 0.070 * L, w: 0.62 * D, hu: 0.50 * r, hd: 0.44 * r, yc: -0.38 * r, k: 2.1 },
      { x: 0.110 * L, w: 0.86 * D, hu: 0.78 * r, hd: 0.70 * r, yc: -0.18 * r, k: 2.15 },
      { x: 0.150 * L, w: 0.98 * D, hu: 0.98 * r, hd: 0.94 * r, yc: -0.02 * r, k: 2.2 },
      { x: 0.200 * L, w: 1.00 * D, hu: 1.00 * r, hd: 1.00 * r, yc: 0, k: 2.2 },
      { x: 0.820 * L, w: 1.00 * D, hu: 1.00 * r, hd: 1.00 * r, yc: 0, k: 2.2 },
      { x: 0.900 * L, w: 0.74 * D, hu: 0.76 * r, hd: 0.62 * r, yc: 0.10 * r, k: 2.2 },
      { x: 0.960 * L, w: 0.40 * D, hu: 0.42 * r, hd: 0.34 * r, yc: 0.22 * r, k: 2.2 },
      { x: 1.000 * L, w: 0.05 * D, hu: 0.05 * r, hd: 0.04 * r, yc: 0.30 * r, k: 2.0 },
    ]
    const fz = fuselage(st, {
      n: 150, segs: 64, paint: livery,
      classify: (u, v) => {
        const t = v * TAU, yv = Math.sin(t), zv = Math.cos(t)
        // the visor glazing, six panes wrapped around the crown
        if (u > 0.118 && u < 0.152 && yv > 0.20 && yv < 0.80 && Math.abs(zv) > 0.04) return 1
        return 0
      },
    })
    g.add(mesh(fz.geo, [mats.paint, mats.glass]))
    // the droop-nose hinge line
    const hinge = doorFrame(fz, 0.10 * L, Math.PI / 2, 0.2, 0.2)
    hinge.visible = false
    g.add(cabinWindows(fz, { from: 0.215 * L, to: 0.80 * L, pitch: 0.49, t: 0.18, w: 0.16, h: 0.26 }))
    for (const dx of [0.19, 0.50, 0.81]) {
      g.add(doorFrame(fz, dx * L, Math.PI - 0.02, 0.72, 1.6, { window: true }))
      g.add(doorFrame(fz, dx * L, 0.02, 0.72, 1.6, { window: true }))
    }

    // --- Ogee delta wing
    const half = B / 2
    const zRoot = 0.55 * r
    const yRoot = -0.72 * r
    const LE = zn => 0.205 * L + (0.845 - 0.205) * L * (1 - Math.pow(1 - zn, 1.55))
    const TE = zn => 0.935 * L - 0.03 * L * zn
    const secs = []
    const zs = [0, 0.10, 0.22, 0.38, 0.55, 0.72, 0.87, 1.0]
    for (const zn of zs) {
      const z = zRoot + zn * (half - zRoot)
      const chord = Math.max(0.6, TE(zn) - LE(zn))
      secs.push({ x: LE(zn), y: yRoot - zn * 0.35, z, chord, thick: zn < 0.3 ? 0.032 : 0.028, camber: 0.004, twist: -zn * 1.5 })
    }
    const wingGeo = surface(secs, { axis: 'z', paint: p => (p.y < yRoot - 0.03 ? AXZ.belly : AXZ.white), n: 22 })
    const wingR = mesh(wingGeo, mats.paint)
    g.add(wingR, mirrorZ(wingR))
    // elevon hinge lines
    // --- Engine boxes: two nacelles a side, side by side under the wing.
    const engZ0 = 0.30 * half, engW = 0.145 * half, engH = 0.60 * D, engX0 = 0.56 * L, engLen = 0.29 * L
    const nacGroup = new THREE.Group()
    for (let i = 0; i < 2; i++) {
      const z = engZ0 + i * engW
      const zn = (z - zRoot) / (half - zRoot)
      const under = yRoot - zn * 0.35 - 0.03
      const box = mesh(new THREE.BoxGeometry(engLen, engH, engW * 0.98), new THREE.MeshStandardMaterial({ color: 0xf3f0e9, roughness: 0.45, metalness: 0.1 }))
      box.position.set(engX0 + engLen / 2, under - engH / 2 + 0.05, z)
      nacGroup.add(box)
      // ramp intake face
      const intake = mesh(new THREE.BoxGeometry(0.15, engH * 0.82, engW * 0.82), mats.dark)
      intake.position.set(engX0 + 0.02, under - engH / 2, z)
      nacGroup.add(intake)
      // nozzle
      const noz = mesh(new THREE.CylinderGeometry(engH * 0.34, engH * 0.30, 0.6, 20), mats.engineHot)
      noz.rotation.z = Math.PI / 2
      noz.position.set(engX0 + engLen + 0.25, under - engH / 2 - 0.02, z)
      nacGroup.add(noz)
      const fan = new THREE.Group(); fan.name = 'fan'; fan.position.set(engX0 + 0.25, under - engH / 2, z)
      const fb = new THREE.BoxGeometry(0.02, engH * 0.36, 0.06); fb.translate(0, engH * 0.2, 0)
      for (let k = 0; k < 14; k++) { const b = mesh(fb, mats.blade, { shadow: false }); b.rotation.x = k * TAU / 14; b.rotation.y = 0.5; fan.add(b) }
      nacGroup.add(fan)
    }
    g.add(nacGroup, mirrorZ(nacGroup))

    // --- Fin
    const finRootX = 0.79 * L, finRootY = fz.at(0.82, Math.PI / 2).p.y - 0.04
    const finTop = ground + spec.h
    const finH = finTop - finRootY
    const finGeo = surface([
      { x: finRootX - 0.08 * L, y: finRootY, z: 0, chord: 0.24 * L, thick: 0.05, camber: 0 },
      { x: finRootX, y: finRootY + 0.05 * finH, z: 0, chord: 0.155 * L, thick: 0.06, camber: 0 },
      { x: finRootX + finH * Math.tan(rad(45)), y: finTop, z: 0, chord: 0.05 * L, thick: 0.06, camber: 0 },
    ], { axis: 'y', paint: p => ((p.y - finRootY) / finH > 0.22 ? AXZ.cyan : AXZ.white), n: 14 })
    g.add(mesh(finGeo, mats.paint))

    // --- Gear. Tall, because of the landing attitude.
    const gear = new THREE.Group(); gear.name = 'gear'
    const nWheelR = 0.40, mWheelR = 0.62
    const noseX = 0.17 * L
    const noseBottom = fz.at(noseX / L, -Math.PI / 2).p.y
    gear.add(tube(V3(noseX, noseBottom + 0.1, 0), V3(noseX, ground + nWheelR, 0), 0.10))
    for (const s of [1, -1]) { const w = wheel(nWheelR, 0.3); w.position.set(noseX, ground + nWheelR, s * 0.28); gear.add(w) }
    const track = spec.track ?? 7.72
    const mainX = 0.615 * L
    for (const s of [1, -1]) {
      const mx = mainX, mz = s * track / 2
      const zn = (Math.abs(mz) - zRoot) / (half - zRoot)
      const top = yRoot - zn * 0.35 - 0.1
      gear.add(tube(V3(mx, top, mz), V3(mx, ground + mWheelR, mz), 0.14))
      gear.add(tube(V3(mx - 1.6, top - 0.3, mz * 0.8), V3(mx, ground + mWheelR + 0.9, mz), 0.06))
      const bogie = mesh(new THREE.BoxGeometry(mWheelR * 3.0, 0.3, 0.3), mats.steel)
      bogie.position.set(mx, ground + mWheelR, mz); gear.add(bogie)
      for (const dx of [-1, 1]) for (const ss of [1, -1]) {
        const w = wheel(mWheelR, 0.34); w.position.set(mx + dx * mWheelR * 1.25, ground + mWheelR, mz + ss * 0.42); gear.add(w)
      }
    }
    // tail bumper wheel
    const bumper = wheel(0.22, 0.16); bumper.position.set(0.93 * L, ground + 0.22 + 0.9, 0)
    gear.add(tube(V3(0.92 * L, fz.at(0.92, -Math.PI / 2).p.y, 0), V3(0.93 * L, ground + 1.1, 0), 0.05), bumper)
    g.add(gear)
    // Reheat: one flame per nozzle, lit by the simulator.
    const exhausts = []
    for (const s of [1, -1]) for (let i = 0; i < 2; i++) {
      const z = s * (engZ0 + i * engW), zn = (Math.abs(z) - zRoot) / (half - zRoot)
      const y = yRoot - zn * 0.35 - 0.03 - engH / 2 - 0.02
      const fl = flame(engH * 0.30, L * 0.12)
      fl.position.set(engX0 + engLen + 0.55, y, z)
      g.add(fl)
      exhausts.push({ x: engX0 + engLen + 0.55, y, z })
    }

    // --- Lights
    const beacon = lamp(mats.beacon, 0.12); beacon.position.set(0.50 * L, r + 0.03, 0); beacon.name = 'beacon'
    const tip = secs[secs.length - 1]
    const navR = lamp(mats.navGreen, 0.09); navR.position.set(tip.x + 0.2, tip.y, tip.z)
    const navL = lamp(mats.navRed, 0.09); navL.position.set(tip.x + 0.2, tip.y, -tip.z)
    const tailLamp = lamp(mats.navWhite, 0.08); tailLamp.position.set(0.998 * L, 0.30 * r, 0)
    g.add(beacon, navR, navL, tailLamp)

    g.position.y = -ground
    g.userData = {
      spin: [{ name: 'fan', axis: 'x', rpm: 900 }],
      beacon: 'beacon',
      length: L, extent: L, height: spec.h,
      offset: V3(-L / 2, 0, 0),
      cg: { x: 0.57 * L, y: 0 }, rest: -ground,
      contacts: contactsFor({ L, ground, noseX, mainX, track, strikeDeg: spec.tailStrikeDeg || 13, skidFrac: 0.93 }),
      eye: { x: 0.125 * L, y: 0.35 * r, z: 0 },
      exhausts,
      tips: [{ x: tip.x + 0.2, y: tip.y, z: tip.z }, { x: tip.x + 0.2, y: tip.y, z: -tip.z }],
      flames: true,
    }
    return g
  }

  /* ---------------------------------------------------------------------
     Shared by every fixed-wing builder: the contact points the flight model
     stands on, in this file's own frame (nose at x = 0, tail at +x, +z to
     port, y = 0 on the fuselage centreline; ground at y = `ground`). The
     tail skid is not a wheel — it is the bumper that stops a rotation, and
     its height is solved from the published tail-strike angle so an A321
     strikes at 9.7 degrees and a 737 at 11, which is the whole reason a
     stretch is harder to rotate.
     --------------------------------------------------------------------- */
  function contactsFor({ L, ground, noseX, mainX, track, strikeDeg = 11, skidFrac = 0.945, extra = [] }) {
    const skidX = skidFrac * L
    const skidY = ground + (skidX - mainX) * Math.tan(rad(strikeDeg))
    return [
      { x: noseX, y: ground, z: 0, nose: true },
      { x: mainX, y: ground, z: track / 2 },
      { x: mainX, y: ground, z: -track / 2 },
      { x: skidX, y: skidY, z: 0, tail: true },
      ...extra,
    ]
  }

  /* A reheat flame: two nested cones pointing aft, additive, hidden until
     the burner lights. The simulator scales them with the burner fraction. */
  function flame(rn, len) {
    const grp = new THREE.Group()
    grp.name = 'flame'
    const outer = new THREE.Mesh(new THREE.ConeGeometry(rn * 0.95, len, 18, 1, true), mats.flame)
    outer.rotation.z = Math.PI / 2; outer.position.x = len / 2
    const inner = new THREE.Mesh(new THREE.ConeGeometry(rn * 0.55, len * 0.62, 14, 1, true), mats.flameCore)
    inner.rotation.z = Math.PI / 2; inner.position.x = len * 0.31
    grp.add(outer, inner)
    grp.visible = false
    return grp
  }

  /* =====================================================================
     LIGHT SINGLE. The Cessna 172: a strut-braced high wing on a cabin the
     shape of a shoebox with a windscreen, fixed gear in fairings, and a
     two-blade propeller. Nothing about it is fast, and that is the point of
     having it in a roster of jets.
     ===================================================================== */
  function buildLight(spec) {
    const g = new THREE.Group()
    g.name = spec.name
    const L = spec.len, D = spec.dia, r = D / 2, B = spec.span
    const ground = -(r + 0.62)
    const stripe = col(0x0b5fa5)
    const paint = (p, u) => (Math.abs(p.y + 0.10 * r) < 0.09 * r && u > 0.12 && u < 0.98 ? stripe : (p.y < -0.55 * r ? AXZ.belly : AXZ.white))

    const st = [
      { x: 0.000 * L, w: 0.50 * D, hu: 0.38 * r, hd: 0.40 * r, yc: -0.05 * r, k: 2.4 },
      { x: 0.040 * L, w: 0.92 * D, hu: 0.80 * r, hd: 0.82 * r, yc: -0.02 * r, k: 2.6 },
      { x: 0.160 * L, w: 1.00 * D, hu: 0.92 * r, hd: 0.95 * r, yc: 0, k: 2.8 },
      { x: 0.220 * L, w: 1.05 * D, hu: 1.45 * r, hd: 0.95 * r, yc: 0, k: 2.7 },
      { x: 0.300 * L, w: 1.06 * D, hu: 1.56 * r, hd: 0.95 * r, yc: 0, k: 3.0 },
      { x: 0.450 * L, w: 1.06 * D, hu: 1.56 * r, hd: 0.92 * r, yc: 0, k: 3.0 },
      { x: 0.520 * L, w: 0.96 * D, hu: 1.36 * r, hd: 0.80 * r, yc: 0.02 * r, k: 2.8 },
      { x: 0.620 * L, w: 0.70 * D, hu: 0.85 * r, hd: 0.55 * r, yc: 0.15 * r, k: 2.5 },
      { x: 0.800 * L, w: 0.42 * D, hu: 0.55 * r, hd: 0.30 * r, yc: 0.32 * r, k: 2.3 },
      { x: 1.000 * L, w: 0.12 * D, hu: 0.25 * r, hd: 0.08 * r, yc: 0.45 * r, k: 2.1 },
    ]
    const fz = fuselage(st, {
      n: 110, segs: 56, paint,
      classify: (u, v) => {
        const t = v * TAU, yv = Math.sin(t), zv = Math.cos(t)
        if (u > 0.19 && u < 0.31 && yv > 0.28 && yv < 0.97) return 1            // windscreen
        if (u > 0.31 && u < 0.50 && yv > 0.42 && yv < 0.96 && Math.abs(zv) > 0.45) {
          if (u > 0.40 && u < 0.415) return 0                                     // door post
          return 1
        }
        if (u > 0.50 && u < 0.56 && yv > 0.45 && yv < 0.95) return 1            // rear window
        return 0
      },
    })
    g.add(mesh(fz.geo, [mats.paint, mats.glass]))
    // Cowl: air intakes either side of the spinner
    for (const s of [1, -1]) {
      const intake = mesh(new THREE.BoxGeometry(0.06 * L, 0.22 * r, 0.30 * r), mats.dark)
      intake.position.set(0.03 * L, -0.15 * r, s * 0.42 * r)
      g.add(intake)
    }

    // --- Wing, on the roof, braced.
    const half = B / 2
    const roofY = 1.50 * r
    const zRoot = 0.52 * D
    const cRoot = 0.198 * L, cTip = 0.135 * L
    const xLE = 0.255 * L
    const dihedral = rad(1.7)
    const secs = [
      { x: xLE, y: roofY + 0.05, z: zRoot, chord: cRoot, thick: 0.12, camber: 0.03, twist: 1.5 },
      { x: xLE, y: roofY + 0.05 + (0.52 * half - zRoot) * Math.tan(dihedral), z: 0.52 * half, chord: cRoot, thick: 0.12, camber: 0.03, twist: 1 },
      { x: xLE + (cRoot - cTip) * 0.2, y: roofY + 0.05 + (half - zRoot) * Math.tan(dihedral), z: half, chord: cTip, thick: 0.11, camber: 0.03, twist: -2 },
    ]
    const wingGeo = surface(secs, { axis: 'z', paint: p => (p.y < roofY + 0.03 ? AXZ.belly : AXZ.white), n: 18 })
    const wingR = mesh(wingGeo, mats.paint)
    g.add(wingR, mirrorZ(wingR))
    // centre-section fairing over the cabin roof
    const roof = fuselage([
      { x: xLE - 0.02 * L, w: 0.9 * D, hu: 0.04, hd: 0.02, yc: roofY, k: 2.4 },
      { x: xLE + 0.4 * cRoot, w: 1.05 * D, hu: 0.12, hd: 0.02, yc: roofY + 0.02, k: 2.6 },
      { x: xLE + cRoot + 0.02 * L, w: 0.9 * D, hu: 0.03, hd: 0.02, yc: roofY, k: 2.4 },
    ], { n: 16, segs: 24, paint: () => AXZ.white, caps: true })
    g.add(mesh(roof.geo, mats.paint))
    for (const s of [1, -1]) {
      g.add(tube(V3(xLE + 0.35 * cRoot, roofY - 0.02, s * 0.56 * half), V3(0.31 * L, -0.55 * r, s * 0.48 * D), 0.03, mats.steel))
    }

    // --- Tail
    const finTop = ground + spec.h
    const finRootX = 0.79 * L, finRootY = fz.at(0.82, Math.PI / 2).p.y - 0.03
    const finGeo = surface([
      { x: finRootX - 0.12 * L, y: finRootY, z: 0, chord: 0.30 * L, thick: 0.06, camber: 0 },
      { x: finRootX, y: finRootY + 0.12, z: 0, chord: 0.19 * L, thick: 0.09, camber: 0 },
      { x: finRootX + (finTop - finRootY) * Math.tan(rad(33)), y: finTop, z: 0, chord: 0.09 * L, thick: 0.08, camber: 0 },
    ], { axis: 'y', paint: p => ((p.y - finRootY) / (finTop - finRootY) > 0.45 ? stripe : AXZ.white), n: 12 })
    g.add(mesh(finGeo, mats.paint))
    const stabY = fz.at(0.88, Math.PI / 2).p.y - 0.30 * r
    const stabGeo = surface([
      { x: 0.86 * L, y: stabY, z: 0.15 * r, chord: 0.15 * L, thick: 0.09, camber: -0.01 },
      { x: 0.87 * L, y: stabY, z: 0.155 * B, chord: 0.11 * L, thick: 0.08, camber: -0.01 },
    ], { axis: 'z', paint: () => AXZ.white, n: 10 })
    const stabR = mesh(stabGeo, mats.paint)
    g.add(stabR, mirrorZ(stabR))

    // --- Propeller: spinner, two blades, and the disc the blades become.
    const prop = new THREE.Group()
    prop.name = 'prop'
    prop.position.set(-0.02 * L, -0.05 * r, 0)
    const spinner = mesh(new THREE.ConeGeometry(0.24 * r, 0.45 * r, 18), mats.steel)
    spinner.rotation.z = Math.PI / 2; spinner.position.x = -0.22 * r
    prop.add(spinner)
    const bladeGeo = surface([
      { x: -0.05, y: 0, z: 0.16, chord: 0.10, thick: 0.10, camber: 0.03, twist: 22 },
      { x: -0.07, y: 0, z: 0.55, chord: 0.14, thick: 0.08, camber: 0.03, twist: 12 },
      { x: -0.05, y: 0, z: 0.93, chord: 0.09, thick: 0.07, camber: 0.02, twist: 5 },
    ], { axis: 'z', paint: p => (p.z > 0.80 ? AXZ.white : col(0x23272c)), n: 10 })
    for (let i = 0; i < 2; i++) {
      const b = mesh(bladeGeo, mats.paint)
      b.rotation.x = i * Math.PI
      prop.add(b)
    }
    const disc = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.96, 48, 1),
      new THREE.MeshBasicMaterial({ color: 0x1a1d21, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }))
    disc.rotation.y = Math.PI / 2
    disc.name = 'rotorDisc'
    prop.add(disc)
    g.add(prop)

    // --- Gear: fixed, faired.
    const gear = new THREE.Group()
    gear.name = 'gear'
    const noseX = 0.14 * L, mainX = 0.41 * L, track = spec.track ?? 2.51
    const nWheelR = 0.20, mWheelR = 0.22
    gear.add(tube(V3(noseX, fz.at(noseX / L, -Math.PI / 2).p.y + 0.05, 0), V3(noseX + 0.05, ground + nWheelR, 0), 0.035))
    const nw = wheel(nWheelR, 0.16); nw.position.set(noseX + 0.05, ground + nWheelR, 0); gear.add(nw)
    for (const s of [1, -1]) {
      const z = s * track / 2
      // A sprung leg: a flat bar out and down from the belly.
      const leg = mesh(new THREE.BoxGeometry(0.10, 0.05, Math.hypot(z, r + ground + mWheelR) + 0.1), mats.steel)
      leg.position.set(mainX, (ground + mWheelR - 0.7 * r) / 2, z / 2)
      leg.rotation.x = -s * Math.atan2(-0.7 * r - (ground + mWheelR), Math.abs(z))
      gear.add(leg)
      const w = wheel(mWheelR, 0.16); w.position.set(mainX, ground + mWheelR, z); gear.add(w)
      // wheel pant
      const pant = fuselage([
        { x: mainX - 0.55, w: 0.22, hu: 0.05, hd: 0.05, yc: ground + mWheelR + 0.05, k: 2.2 },
        { x: mainX - 0.15, w: 0.30, hu: 0.30, hd: 0.10, yc: ground + mWheelR + 0.05, k: 2.4 },
        { x: mainX + 0.35, w: 0.28, hu: 0.26, hd: 0.10, yc: ground + mWheelR + 0.05, k: 2.4 },
        { x: mainX + 0.75, w: 0.10, hu: 0.05, hd: 0.03, yc: ground + mWheelR + 0.10, k: 2.2 },
      ], { n: 20, segs: 20, paint: () => AXZ.white, caps: true })
      const pm = mesh(pant.geo, mats.paint); pm.position.z = z; gear.add(pm)
    }
    g.add(gear)

    // --- Lights
    const beacon = lamp(mats.beacon, 0.05); beacon.position.set(finRootX + (finTop - finRootY) * 0.6 + 0.4, finTop + 0.02, 0); beacon.name = 'beacon'
    const tip = secs[2]
    const navR = lamp(mats.navGreen, 0.04); navR.position.set(tip.x + 0.15, tip.y, -tip.z)
    const navL = lamp(mats.navRed, 0.04); navL.position.set(tip.x + 0.15, tip.y, tip.z)
    const strobe = lamp(mats.navWhite, 0.035); strobe.position.set(0.995 * L, 0.45 * r, 0); strobe.name = 'strobe'
    g.add(beacon, navR, navL, strobe)

    g.position.y = -ground
    g.userData = {
      spin: [{ name: 'prop', axis: 'x', rpm: 2400 }],
      beacon: 'beacon',
      length: L, extent: Math.max(L, B), height: spec.h,
      offset: V3(-L / 2, 0, 0),
      cg: { x: 0.375 * L, y: 0 }, rest: -ground,
      contacts: contactsFor({ L, ground, noseX: noseX + 0.05, mainX, track, strikeDeg: spec.tailStrikeDeg || 16, skidFrac: 0.96 }),
      eye: { x: 0.30 * L, y: 0.55 * r, z: 0 },
      exhausts: [{ x: 0.10 * L, y: -0.6 * r, z: 0 }],
      tips: [{ x: tip.x + 0.15, y: tip.y, z: tip.z }, { x: tip.x + 0.15, y: tip.y, z: -tip.z }],
      prop: true,
    }
    return g
  }

  /* =====================================================================
     BUSINESS JET. The Gulfstream: a long nose, oval windows, engines on the
     aft fuselage and a T-tail — which is the whole silhouette.
     ===================================================================== */
  function buildBizjet(spec) {
    const g = new THREE.Group()
    g.name = spec.name
    const L = spec.len, D = spec.dia, r = D / 2, B = spec.span
    const ground = -(r + 1.1)
    const livery = liveries.heavy(L, r)
    const droop = -0.26
    const st = [
      { x: 0.000 * L, w: 0.04 * D, hu: 0.02 * r, hd: 0.02 * r, yc: droop * r, k: 2.0 },
      { x: 0.006 * L, w: 0.30 * D, hu: 0.22 * r, hd: 0.20 * r, yc: droop * 0.94 * r, k: 2.05 },
      { x: 0.020 * L, w: 0.55 * D, hu: 0.45 * r, hd: 0.40 * r, yc: droop * 0.78 * r, k: 2.1 },
      { x: 0.050 * L, w: 0.78 * D, hu: 0.70 * r, hd: 0.62 * r, yc: droop * 0.45 * r, k: 2.15 },
      { x: 0.090 * L, w: 0.95 * D, hu: 0.93 * r, hd: 0.88 * r, yc: droop * 0.10 * r, k: 2.2 },
      { x: 0.140 * L, w: 1.00 * D, hu: 1.00 * r, hd: 1.00 * r, yc: 0, k: 2.25 },
      { x: 0.700 * L, w: 1.00 * D, hu: 1.00 * r, hd: 1.00 * r, yc: 0, k: 2.25 },
      { x: 0.800 * L, w: 0.88 * D, hu: 0.90 * r, hd: 0.70 * r, yc: 0.12 * r, k: 2.2 },
      { x: 0.900 * L, w: 0.60 * D, hu: 0.62 * r, hd: 0.40 * r, yc: 0.35 * r, k: 2.2 },
      { x: 0.960 * L, w: 0.35 * D, hu: 0.36 * r, hd: 0.22 * r, yc: 0.50 * r, k: 2.1 },
      { x: 1.000 * L, w: 0.08 * D, hu: 0.09 * r, hd: 0.05 * r, yc: 0.60 * r, k: 2.0 },
    ]
    const fz = fuselage(st, {
      n: 130, segs: 64, paint: livery,
      classify: (u, v) => {
        const t = v * TAU, yv = Math.sin(t), zv = Math.cos(t)
        if (u > 0.068 && u < 0.128) {
          if (Math.abs(zv) < 0.05) return 0
          if (u > 0.096 && u < 0.102) return 0
          if (yv > 0.12 && yv < 0.80) return 1
        }
        return 0
      },
    })
    g.add(mesh(fz.geo, [mats.paint, mats.glass]))
    g.add(cabinWindows(fz, { from: 0.19 * L, to: 0.70 * L, pitch: 1.05, t: 0.14, w: 0.56, h: 0.42 }))
    g.add(doorFrame(fz, 0.16 * L, 0.02, 0.82, 1.75, { window: true }))
    g.add(doorFrame(fz, 0.16 * L, Math.PI - 0.02, 0.82, 1.75, { window: true }))
    g.add(doorFrame(fz, 0.72 * L, -0.6, 1.3, 0.9))

    // --- Wing: low, swept, big blended winglets.
    const half = B / 2
    const zRoot = 0.30 * r, zKink = 0.33 * half
    const yRoot = -0.62 * r
    const dihedral = rad(spec.dihedralDeg ?? 3.5)
    const xLE0 = 0.40 * L
    const sweepLE = Math.tan(rad(33)), sweepTE = Math.tan(rad(15))
    const meanChord = spec.wingArea ? spec.wingArea / B : 0.13 * L
    const cKink = meanChord * 1.3
    const LE = z => xLE0 + (z - zRoot) * sweepLE
    const TEk = LE(zKink) + cKink
    const TE = z => (z < zKink ? TEk : TEk + (z - zKink) * sweepTE)
    const wingSec = z => ({ x: LE(z), y: yRoot + (z - zRoot) * Math.tan(dihedral), z, chord: TE(z) - LE(z) })
    const tipZ = half - 0.4
    const secs = [
      { ...wingSec(zRoot), thick: 0.12, camber: 0.02, twist: 1.5 },
      { ...wingSec(zKink), thick: 0.11, camber: 0.02, twist: 0.5 },
      { ...wingSec(lerp(zKink, tipZ, 0.55)), thick: 0.10, camber: 0.02, twist: -1 },
      { ...wingSec(tipZ), thick: 0.09, camber: 0.018, twist: -2.5 },
    ]
    const tip = secs[3]
    for (let i = 1; i <= 6; i++) {
      const f = i / 6, a = f * rad(85)
      secs.push({ x: tip.x + f * 0.5 * tip.chord, y: tip.y + 0.7 * Math.sin(a) + Math.max(0, f - 0.4) * 0.07 * B, z: tip.z + 0.7 * (1 - Math.cos(a)), chord: tip.chord * lerp(1, 0.3, f), thick: 0.08, camber: 0.01, twist: -2.5 })
    }
    const wingGeo = surface(secs, { axis: 'z', paint: p => (p.y < yRoot + (p.z - zRoot) * Math.tan(dihedral) + 0.02 ? AXZ.belly : AXZ.white), n: 20 })
    const wingR = mesh(wingGeo, mats.paint)
    g.add(wingR, mirrorZ(wingR))
    const fairing = fuselage([
      { x: xLE0 - 0.04 * L, w: 0.9 * D, hu: 0.02, hd: 0.10 * r, yc: -0.55 * r, k: 2.4 },
      { x: xLE0 + 0.04 * L, w: 1.14 * D, hu: 0.02, hd: 0.30 * r, yc: -0.62 * r, k: 2.6 },
      { x: TEk, w: 1.12 * D, hu: 0.02, hd: 0.26 * r, yc: -0.62 * r, k: 2.6 },
      { x: TEk + 0.08 * L, w: 0.86 * D, hu: 0.02, hd: 0.08 * r, yc: -0.55 * r, k: 2.4 },
    ], { n: 24, segs: 32, paint: () => AXZ.belly, caps: true })
    g.add(mesh(fairing.geo, mats.paint))

    // --- Engines on the aft fuselage.
    const eng = 0.62 * D
    const nacL = 0.15 * L, x0 = 0.71 * L, y0 = 0.28 * r, ez = r + 0.55 * eng
    const nac = fuselage([
      { x: x0, w: 0.88 * eng, hu: 0.44 * eng, hd: 0.44 * eng, yc: y0, k: 2.2 },
      { x: x0 + 0.06 * nacL, w: 1.00 * eng, hu: 0.50 * eng, hd: 0.50 * eng, yc: y0, k: 2.2 },
      { x: x0 + 0.55 * nacL, w: 0.98 * eng, hu: 0.49 * eng, hd: 0.49 * eng, yc: y0, k: 2.2 },
      { x: x0 + 0.85 * nacL, w: 0.62 * eng, hu: 0.31 * eng, hd: 0.31 * eng, yc: y0 + 0.03 * eng, k: 2.2 },
      { x: x0 + 1.00 * nacL, w: 0.36 * eng, hu: 0.18 * eng, hd: 0.18 * eng, yc: y0 + 0.04 * eng, k: 2.2 },
    ], { n: 30, segs: 40, paint: () => AXZ.white })
    const grp = new THREE.Group()
    const nm = mesh(nac.geo, mats.paint); nm.position.z = ez
    const lip = mesh(new THREE.TorusGeometry(0.45 * eng, 0.04 * eng, 10, 36), mats.steel)
    lip.position.set(x0, y0, ez); lip.rotation.y = Math.PI / 2
    const fan = new THREE.Group(); fan.name = 'fan'; fan.position.set(x0 + 0.25 * eng, y0, ez)
    const spinner = mesh(new THREE.ConeGeometry(0.08 * eng, 0.22 * eng, 16), mats.steel)
    spinner.rotation.z = Math.PI / 2; spinner.position.x = -0.08 * eng; fan.add(spinner)
    const fb = new THREE.BoxGeometry(0.02 * eng, 0.30 * eng, 0.06 * eng); fb.translate(0, 0.2 * eng, 0)
    for (let i = 0; i < 18; i++) { const b = mesh(fb, mats.blade, { shadow: false }); b.rotation.x = i * TAU / 18; b.rotation.y = 0.5; fan.add(b) }
    const duct = mesh(new THREE.CylinderGeometry(0.42 * eng, 0.42 * eng, 0.3 * eng, 36, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.6, side: THREE.BackSide }))
    duct.position.set(x0 + 0.15 * eng, y0, ez); duct.rotation.z = Math.PI / 2
    const core = mesh(new THREE.CylinderGeometry(0.11 * eng, 0.14 * eng, 0.25 * eng, 20), mats.engineHot)
    core.position.set(x0 + nacL * 1.02, y0 + 0.04 * eng, ez); core.rotation.z = Math.PI / 2
    const pylon = mesh(new THREE.BoxGeometry(nacL * 0.6, 0.30 * eng, ez - r * 0.7), new THREE.MeshStandardMaterial({ color: 0xf3f0e9, roughness: 0.42, metalness: 0.08 }))
    pylon.position.set(x0 + nacL * 0.5, y0 + 0.05, (ez + r * 0.7) / 2)
    grp.add(nm, lip, fan, duct, core, pylon)
    g.add(grp, mirrorZ(grp))

    // --- T-tail
    const finTop = ground + spec.h
    const finRootX = 0.80 * L, finRootY = fz.at(0.83, Math.PI / 2).p.y - 0.03
    const finH = finTop - finRootY
    const finSweep = Math.tan(rad(40))
    const finGeo = surface([
      { x: finRootX - 0.07 * L, y: finRootY, z: 0, chord: 0.23 * L, thick: 0.07, camber: 0 },
      { x: finRootX, y: finRootY + 0.05 * finH, z: 0, chord: 0.17 * L, thick: 0.09, camber: 0 },
      { x: finRootX + (finH - 0.3) * finSweep, y: finTop - 0.3, z: 0, chord: 0.10 * L, thick: 0.08, camber: 0 },
    ], { axis: 'y', paint: p => ((p.y - finRootY) / finH > 0.3 ? AXZ.cyan : AXZ.white), n: 14 })
    g.add(mesh(finGeo, mats.paint))
    const stabX = finRootX + (finH - 0.3) * finSweep + 0.01 * L, stabY = finTop - 0.3
    const stabSpan = 0.34 * B / 2
    const stabGeo = surface([
      { x: stabX, y: stabY, z: 0, chord: 0.09 * L, thick: 0.09, camber: -0.01 },
      { x: stabX + stabSpan * Math.tan(rad(32)), y: stabY, z: stabSpan, chord: 0.045 * L, thick: 0.08, camber: -0.01 },
    ], { axis: 'z', paint: () => AXZ.white, n: 12 })
    const stabR = mesh(stabGeo, mats.paint)
    g.add(stabR, mirrorZ(stabR))
    const bullet = fuselage([
      { x: stabX - 0.03 * L, w: 0.05 * D, hu: 0.02, hd: 0.02, yc: stabY, k: 2.2 },
      { x: stabX + 0.02 * L, w: 0.14 * D, hu: 0.06 * D, hd: 0.06 * D, yc: stabY, k: 2.2 },
      { x: stabX + 0.12 * L, w: 0.04 * D, hu: 0.015, hd: 0.015, yc: stabY, k: 2.2 },
    ], { n: 16, segs: 20, paint: () => AXZ.cyan, caps: true })
    g.add(mesh(bullet.geo, mats.paint))

    // --- Gear
    const gear = new THREE.Group(); gear.name = 'gear'
    const nWheelR = 0.09 * D, mWheelR = 0.12 * D
    const noseX = 0.12 * L, cgX = 0.485 * L, mainX = cgX + 0.045 * L, track = spec.track ?? 3.63
    const noseBottom = fz.at(noseX / L, -Math.PI / 2).p.y
    gear.add(tube(V3(noseX, noseBottom + 0.1, 0), V3(noseX, ground + nWheelR, 0), 0.05 * r))
    for (const s of [1, -1]) { const w = wheel(nWheelR, 0.3 * nWheelR); w.position.set(noseX, ground + nWheelR, s * nWheelR * 0.45); gear.add(w) }
    for (const s of [1, -1]) {
      const z = s * track / 2
      gear.add(tube(V3(mainX, wingSec(Math.abs(z)).y - 0.1, z), V3(mainX, ground + mWheelR, z), 0.07 * r))
      for (const ss of [1, -1]) { const w = wheel(mWheelR, 0.36 * mWheelR); w.position.set(mainX, ground + mWheelR, z + ss * mWheelR * 0.45); gear.add(w) }
    }
    g.add(gear)

    // --- Lights
    const beacon = lamp(mats.beacon, 0.05 * D); beacon.position.set(0.45 * L, r + 0.03, 0); beacon.name = 'beacon'
    const beaconL = lamp(mats.beacon, 0.05 * D); beaconL.position.set(0.47 * L, -r - 0.03, 0); beaconL.name = 'beacon'
    const navR = lamp(mats.navGreen, 0.04 * D); navR.position.set(tip.x + 0.1, tip.y, -tip.z)
    const navL = lamp(mats.navRed, 0.04 * D); navL.position.set(tip.x + 0.1, tip.y, tip.z)
    const tailLamp = lamp(mats.navWhite, 0.035 * D); tailLamp.position.set(0.998 * L, 0.60 * r, 0)
    g.add(beacon, beaconL, navR, navL, tailLamp)

    g.position.y = -ground
    g.userData = {
      spin: [{ name: 'fan', axis: 'x', rpm: 900 }],
      beacon: 'beacon',
      length: L, extent: Math.max(L, B), height: spec.h,
      offset: V3(-L / 2, 0, 0),
      cg: { x: cgX, y: 0 }, rest: -ground,
      contacts: contactsFor({ L, ground, noseX, mainX, track, strikeDeg: spec.tailStrikeDeg || 12 }),
      eye: { x: 0.10 * L, y: 0.30 * r, z: 0 },
      exhausts: [{ x: x0 + nacL, y: y0, z: ez }, { x: x0 + nacL, y: y0, z: -ez }],
      tips: [{ x: tip.x + 0.1, y: tip.y, z: tip.z }, { x: tip.x + 0.1, y: tip.y, z: -tip.z }],
    }
    return g
  }

  /* =====================================================================
     FIGHTER. One builder for the F-16, F-22 and F-35: a blended body with a
     bubble canopy, a trapezoidal wing, all-moving tails, and either a single
     fin or a canted pair. What separates the three is the chine — the F-22
     and F-35 are flat, wide bodies with a knife edge along the side — the
     intakes, and the nozzles.
     ===================================================================== */
  function buildFighter(spec) {
    const g = new THREE.Group()
    g.name = spec.name
    const L = spec.len, D = spec.dia, r = D / 2, B = spec.span
    const chined = !!spec.chined, twin = !!spec.twinFin
    const ground = -(r + 0.55 * D)
    const paint = liveries.lowvis(L, r)

    const W = chined ? 1.85 : 1.15
    const st = [
      { x: 0.000 * L, w: 0.03 * D, hu: 0.015 * r, hd: 0.015 * r, yc: -0.10 * r, k: 2.0 },
      { x: 0.020 * L, w: 0.22 * D, hu: 0.18 * r, hd: 0.16 * r, yc: -0.09 * r, k: 2.0 },
      { x: 0.060 * L, w: 0.46 * D, hu: 0.38 * r, hd: 0.34 * r, yc: -0.06 * r, k: 2.1 },
      { x: 0.120 * L, w: 0.78 * D, hu: 0.64 * r, hd: 0.60 * r, yc: -0.02 * r, k: 2.2 },
      { x: 0.180 * L, w: 0.96 * D, hu: 0.82 * r, hd: 0.72 * r, yc: 0, k: chined ? 2.6 : 2.3 },
      { x: 0.240 * L, w: (chined ? 1.35 : 1.05) * D, hu: 1.04 * r, hd: 0.80 * r, yc: 0, k: chined ? 3.0 : 2.4 },
      { x: 0.320 * L, w: (chined ? 1.70 : 1.15) * D, hu: 0.98 * r, hd: 0.95 * r, yc: 0, k: chined ? 3.4 : 2.5 },
      { x: 0.450 * L, w: W * D, hu: 0.86 * r, hd: 1.00 * r, yc: 0, k: chined ? 3.6 : 2.6 },
      { x: 0.620 * L, w: (chined ? 1.80 : 1.15) * D, hu: 0.80 * r, hd: 0.95 * r, yc: 0, k: chined ? 3.4 : 2.5 },
      { x: 0.800 * L, w: (chined ? 1.40 : 1.00) * D, hu: 0.70 * r, hd: 0.75 * r, yc: 0, k: chined ? 3.0 : 2.4 },
      { x: 0.930 * L, w: (chined ? 1.00 : 0.80) * D, hu: 0.55 * r, hd: 0.55 * r, yc: 0, k: 2.4 },
      { x: 1.000 * L, w: (twin ? 0.90 : 0.55) * D, hu: 0.42 * r, hd: 0.42 * r, yc: 0, k: twin ? 2.8 : 2.2 },
    ]
    const fz = fuselage(st, {
      n: 140, segs: 72, paint,
      classify: (u, v) => {
        const t = v * TAU, yv = Math.sin(t), zv = Math.cos(t)
        if (u > 0.155 && u < 0.335 && yv > 0.32 && Math.abs(zv) < 0.88) {
          if (chined && u > 0.235 && u < 0.245) return 0        // canopy bow
          return 1
        }
        return 0
      },
    })
    const body = mesh(fz.geo, [mats.paint, mats.canopy])
    g.add(body)
    // Intakes: a chin scoop on the single-fin type, a pair of side ducts on the others.
    if (!chined) {
      const box = mesh(new THREE.BoxGeometry(0.18 * L, 0.55 * D, 0.72 * D), mats.paint)
      box.material = new THREE.MeshStandardMaterial({ color: 0x747b83, roughness: 0.5, metalness: 0.15 })
      box.position.set(0.40 * L, -0.95 * r, 0)
      const face = mesh(new THREE.BoxGeometry(0.02 * L, 0.42 * D, 0.60 * D), mats.dark)
      face.position.set(0.31 * L, -0.95 * r, 0)
      g.add(box, face)
    } else {
      for (const s of [1, -1]) {
        const duct = mesh(new THREE.BoxGeometry(0.16 * L, 0.55 * D, 0.30 * D), new THREE.MeshStandardMaterial({ color: 0x747b83, roughness: 0.5, metalness: 0.15 }))
        duct.position.set(0.38 * L, -0.25 * r, s * 0.92 * D)
        const face = mesh(new THREE.BoxGeometry(0.02 * L, 0.42 * D, 0.24 * D), mats.dark)
        face.position.set(0.30 * L, -0.25 * r, s * 0.92 * D)
        g.add(duct, face)
      }
    }
    // Strakes along the forebody, into the wing root.
    const half = B / 2
    const zRoot = 0.5 * W * D * 0.92
    const strakeGeo = surface([
      { x: 0.20 * L, y: -0.05 * r, z: 0.5 * 0.96 * D, chord: 0.26 * L, thick: 0.015, camber: 0 },
      { x: 0.40 * L, y: -0.05 * r, z: zRoot + 0.02 * B, chord: 0.08 * L, thick: 0.015, camber: 0 },
    ], { axis: 'z', paint: () => col(0x6f7780), n: 8 })
    const strakeR = mesh(strakeGeo, mats.paint)
    g.add(strakeR, mirrorZ(strakeR))

    // --- Wing: trapezoid, thin, mid-set.
    const xLE0 = (chined ? 0.36 : 0.42) * L
    const sweepLE = Math.tan(rad(spec.sweepDeg ?? (chined ? 42 : 40)))
    const cRoot = (chined ? 0.50 : 0.36) * L, cTip = 0.10 * L
    const yW = -0.08 * r
    const tipLE = xLE0 + (half - zRoot) * sweepLE
    const secs = [
      { x: xLE0, y: yW, z: zRoot, chord: cRoot, thick: 0.05, camber: 0.012, twist: 0.5 },
      { x: lerp(xLE0, tipLE, 0.5), y: yW, z: lerp(zRoot, half, 0.5), chord: lerp(cRoot, cTip, 0.5), thick: 0.045, camber: 0.01, twist: -0.5 },
      { x: tipLE, y: yW, z: half, chord: cTip, thick: 0.04, camber: 0.008, twist: -1.5 },
    ]
    const wingGeo = surface(secs, { axis: 'z', paint: () => col(0x737a82), n: 16 })
    const wingR = mesh(wingGeo, mats.paint)
    g.add(wingR, mirrorZ(wingR))

    // --- Stabilators
    const stabZ0 = 0.5 * (twin ? 0.9 : 0.55) * D + 0.05
    const stabSpan = 0.28 * B
    const stabGeo = surface([
      { x: 0.82 * L, y: -0.10 * r, z: stabZ0, chord: 0.17 * L, thick: 0.05, camber: 0 },
      { x: 0.82 * L + stabSpan * Math.tan(rad(42)), y: -0.10 * r, z: stabZ0 + stabSpan, chord: 0.06 * L, thick: 0.04, camber: 0 },
    ], { axis: 'z', paint: () => col(0x6f7780), n: 10 })
    const stabR = mesh(stabGeo, mats.paint)
    g.add(stabR, mirrorZ(stabR))

    // --- Fins
    const finTop = ground + spec.h
    if (!twin) {
      const finRootX = 0.66 * L, finRootY = fz.at(0.70, Math.PI / 2).p.y - 0.03
      const finH = finTop - finRootY
      const finGeo = surface([
        { x: finRootX - 0.10 * L, y: finRootY, z: 0, chord: 0.32 * L, thick: 0.04, camber: 0 },
        { x: finRootX, y: finRootY + 0.06 * finH, z: 0, chord: 0.24 * L, thick: 0.05, camber: 0 },
        { x: finRootX + finH * Math.tan(rad(45)), y: finTop, z: 0, chord: 0.07 * L, thick: 0.05, camber: 0 },
      ], { axis: 'y', paint: () => col(0x6f7780), n: 12 })
      g.add(mesh(finGeo, mats.paint))
      // ventral strakes
      for (const s of [1, -1]) {
        const v = mesh(new THREE.BoxGeometry(0.12 * L, 0.35 * r, 0.02), mats.paint)
        v.material = new THREE.MeshStandardMaterial({ color: 0x6f7780, roughness: 0.5 })
        v.position.set(0.80 * L, -1.0 * r - 0.15 * r, s * 0.45 * D)
        v.rotation.x = s * 0.45
        g.add(v)
      }
    } else {
      const cant = rad(27)
      const finRootX = 0.64 * L, finRootY = fz.at(0.68, Math.PI / 2).p.y - 0.10 * r
      const finH = (finTop - finRootY) / Math.cos(cant)
      for (const s of [1, -1]) {
        const finGeo = surface([
          { x: finRootX, y: 0, z: 0, chord: 0.30 * L, thick: 0.04, camber: 0 },
          { x: finRootX + finH * Math.tan(rad(35)), y: finH, z: 0, chord: 0.09 * L, thick: 0.045, camber: 0 },
        ], { axis: 'y', paint: () => col(0x6f7780), n: 12 })
        const fin = mesh(finGeo, mats.paint)
        fin.position.set(0, finRootY, s * 0.14 * B)
        fin.rotation.x = -s * cant
        g.add(fin)
      }
    }

    // --- Nozzles and the burner.
    const noz = []
    const rn = (twin ? 0.30 : 0.40) * D
    const nzs = twin ? [0.20 * D, -0.20 * D] : [0]
    for (const z of nzs) {
      const ring = mesh(new THREE.CylinderGeometry(rn, rn * 0.82, 0.05 * L, 22, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x3a3630, roughness: 0.5, metalness: 0.85, side: THREE.DoubleSide }))
      ring.rotation.z = Math.PI / 2
      ring.position.set(1.0 * L + 0.02 * L, 0, z)
      const petals = mesh(new THREE.CylinderGeometry(rn * 0.82, rn * 0.72, 0.03 * L, 22, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.4, metalness: 0.9, side: THREE.DoubleSide }))
      petals.rotation.z = Math.PI / 2
      petals.position.set(1.0 * L + 0.06 * L, 0, z)
      const fl = flame(rn * 0.8, L * 0.32)
      fl.position.set(1.0 * L + 0.07 * L, 0, z)
      g.add(ring, petals, fl)
      noz.push({ x: 1.06 * L, y: 0, z })
    }

    // --- Gear
    const gear = new THREE.Group(); gear.name = 'gear'
    const nWheelR = 0.14 * D, mWheelR = 0.21 * D
    const noseX = (chined ? 0.20 : 0.26) * L, cgX = 0.46 * L, mainX = cgX + 0.075 * L, track = spec.track ?? 0.24 * B
    const noseBottom = fz.at(noseX / L, -Math.PI / 2).p.y
    gear.add(tube(V3(noseX, noseBottom + 0.05, 0), V3(noseX, ground + nWheelR, 0), 0.08 * r))
    const nw = wheel(nWheelR, 0.5 * nWheelR); nw.position.set(noseX, ground + nWheelR, 0); gear.add(nw)
    for (const s of [1, -1]) {
      const z = s * track / 2
      gear.add(tube(V3(mainX, -0.6 * r, z * 0.6), V3(mainX, ground + mWheelR, z), 0.09 * r))
      const w = wheel(mWheelR, 0.5 * mWheelR); w.position.set(mainX, ground + mWheelR, z); gear.add(w)
    }
    g.add(gear)

    // --- Lights
    const beacon = lamp(mats.beacon, 0.04 * D); beacon.position.set(0.45 * L, -1.0 * r - 0.02, 0); beacon.name = 'beacon'
    const tip = secs[2]
    const navR = lamp(mats.navGreen, 0.035 * D); navR.position.set(tip.x + 0.05, tip.y, -tip.z)
    const navL = lamp(mats.navRed, 0.035 * D); navL.position.set(tip.x + 0.05, tip.y, tip.z)
    const strobe = lamp(mats.navWhite, 0.03 * D); strobe.position.set(0.72 * L, fz.at(0.72, Math.PI / 2).p.y + 0.02, 0); strobe.name = 'strobe'
    g.add(beacon, navR, navL, strobe)

    g.position.y = -ground
    g.userData = {
      spin: [],
      beacon: 'beacon',
      length: L, extent: Math.max(L, B), height: spec.h,
      offset: V3(-L / 2, 0, 0),
      cg: { x: cgX, y: 0 }, rest: -ground,
      contacts: contactsFor({ L, ground, noseX, mainX, track, strikeDeg: spec.tailStrikeDeg || 15, skidFrac: 0.96 }),
      eye: { x: 0.22 * L, y: 0.55 * r, z: 0 },
      exhausts: noz,
      tips: [{ x: tip.x, y: tip.y, z: tip.z }, { x: tip.x, y: tip.y, z: -tip.z }],
      flames: true,
    }
    return g
  }

  /* =====================================================================
     FLYING WING. The B-2 is one lofted surface with a sawtooth trailing
     edge, a cockpit hump and two engine humps on top. It has no fin at all,
     which is why the published height is the top of the hump.
     ===================================================================== */
  function buildWing(spec) {
    const g = new THREE.Group()
    g.name = spec.name
    const L = spec.len, D = spec.dia, B = spec.span
    const ground = -(1.0 + 1.6)
    const dark = col(0x474b52), darker = col(0x3b3f45)
    const half = B / 2
    // [spanwise z, leading edge x, trailing edge x, thickness fraction]
    const rows = [
      [0.000, 0.00, 1.000, 0.150], [0.095, 0.076, 0.962, 0.145], [0.190, 0.155, 0.800, 0.115],
      [0.300, 0.243, 0.695, 0.080], [0.400, 0.324, 0.838, 0.060], [0.500, 0.404, 0.686, 0.050],
      [0.610, 0.495, 0.810, 0.048], [0.705, 0.571, 0.710, 0.045], [0.840, 0.681, 0.805, 0.040],
      [1.000, 0.810, 0.828, 0.035],
    ]
    const secs = rows.map(([zn, le, te, th]) => ({
      x: le * L, y: -0.20 * zn - 0.3 * zn * zn, z: zn * half, chord: (te - le) * L, thick: th, camber: 0.02 * (1 - zn), twist: -zn * 1.5,
    }))
    const wingGeo = surface(secs, { axis: 'z', paint: p => (p.y > 0.1 ? dark : darker), n: 24, subdiv: 4 })
    const wingR = mesh(wingGeo, mats.paint)
    g.add(wingR, mirrorZ(wingR))

    // Cockpit hump, with the flight deck glazing on its face.
    const hump = fuselage([
      { x: 0.14 * L, w: 0.10 * L, hu: 0.02, hd: 0.9, yc: 1.2, k: 2.4 },
      { x: 0.20 * L, w: 0.16 * L, hu: 0.9, hd: 1.2, yc: 1.25, k: 2.6 },
      { x: 0.30 * L, w: 0.19 * L, hu: 1.25, hd: 1.4, yc: 1.3, k: 2.8 },
      { x: 0.45 * L, w: 0.18 * L, hu: 1.10, hd: 1.4, yc: 1.3, k: 2.8 },
      { x: 0.62 * L, w: 0.12 * L, hu: 0.40, hd: 1.2, yc: 1.2, k: 2.5 },
      { x: 0.75 * L, w: 0.05 * L, hu: 0.02, hd: 0.8, yc: 1.1, k: 2.3 },
    ], {
      n: 60, segs: 48, paint: () => dark, caps: true,
      classify: (u, v) => {
        const t = v * TAU, yv = Math.sin(t), zv = Math.cos(t)
        return (u > 0.12 && u < 0.28 && yv > 0.25 && yv < 0.92 && Math.abs(zv) < 0.8) ? 1 : 0
      },
    })
    g.add(mesh(hump.geo, [mats.paint, mats.canopy]))
    // Engine humps and their intakes.
    for (const s of [1, -1]) {
      const z = s * 0.20 * half
      const eh = fuselage([
        { x: 0.22 * L, w: 0.16 * half, hu: 0.02, hd: 0.8, yc: 0.55, k: 2.6 },
        { x: 0.30 * L, w: 0.20 * half, hu: 0.85, hd: 1.0, yc: 0.55, k: 2.8 },
        { x: 0.45 * L, w: 0.20 * half, hu: 0.80, hd: 1.0, yc: 0.55, k: 2.8 },
        { x: 0.66 * L, w: 0.14 * half, hu: 0.30, hd: 0.9, yc: 0.5, k: 2.5 },
        { x: 0.76 * L, w: 0.06 * half, hu: 0.02, hd: 0.7, yc: 0.4, k: 2.3 },
      ], { n: 40, segs: 40, paint: () => dark, caps: true })
      const m = mesh(eh.geo, mats.paint); m.position.z = z
      const intake = mesh(new THREE.BoxGeometry(0.03 * L, 0.55, 0.16 * half), mats.dark)
      intake.position.set(0.27 * L, 1.05, z)
      const exhaust = mesh(new THREE.BoxGeometry(0.06 * L, 0.25, 0.10 * half), mats.engineHot)
      exhaust.position.set(0.74 * L, 0.55, z)
      g.add(m, intake, exhaust)
    }

    // --- Gear
    const gear = new THREE.Group(); gear.name = 'gear'
    const noseX = 0.22 * L, cgX = 0.44 * L, mainX = cgX + 0.09 * L, track = spec.track ?? 12.19
    const nWheelR = 0.45, mWheelR = 0.56
    gear.add(tube(V3(noseX, -0.6, 0), V3(noseX, ground + nWheelR, 0), 0.14))
    for (const s of [1, -1]) { const w = wheel(nWheelR, 0.34); w.position.set(noseX, ground + nWheelR, s * 0.42); gear.add(w) }
    for (const s of [1, -1]) {
      const z = s * track / 2
      gear.add(tube(V3(mainX, -0.5, z), V3(mainX, ground + mWheelR, z), 0.18))
      const bogie = mesh(new THREE.BoxGeometry(mWheelR * 3.0, 0.3, 0.3), mats.steel)
      bogie.position.set(mainX, ground + mWheelR, z); gear.add(bogie)
      for (const dx of [-1, 1]) for (const ss of [1, -1]) {
        const w = wheel(mWheelR, 0.36); w.position.set(mainX + dx * mWheelR * 1.25, ground + mWheelR, z + ss * 0.46); gear.add(w)
      }
    }
    g.add(gear)

    // --- Lights
    const beacon = lamp(mats.beacon, 0.14); beacon.position.set(0.40 * L, 2.6, 0); beacon.name = 'beacon'
    const beaconL = lamp(mats.beacon, 0.14); beaconL.position.set(0.55 * L, -1.02, 0); beaconL.name = 'beacon'
    const tip = secs[secs.length - 1]
    const navR = lamp(mats.navGreen, 0.10); navR.position.set(tip.x + 0.2, tip.y, -tip.z)
    const navL = lamp(mats.navRed, 0.10); navL.position.set(tip.x + 0.2, tip.y, tip.z)
    g.add(beacon, beaconL, navR, navL)

    g.position.y = -ground
    g.userData = {
      spin: [],
      beacon: 'beacon',
      length: L, extent: Math.max(L, B), height: spec.h,
      offset: V3(-L / 2, 0, 0),
      cg: { x: cgX, y: 0 }, rest: -ground,
      contacts: contactsFor({ L, ground, noseX, mainX, track, strikeDeg: spec.tailStrikeDeg || 12, skidFrac: 0.97 }),
      eye: { x: 0.24 * L, y: 1.9, z: 0 },
      exhausts: [{ x: 0.77 * L, y: 0.55, z: 0.20 * half }, { x: 0.77 * L, y: 0.55, z: -0.20 * half }],
      tips: [{ x: tip.x, y: tip.y, z: tip.z }, { x: tip.x, y: tip.y, z: -tip.z }],
      lowVis: true,
    }
    return g
  }

  /* ---------------------------------------------------------------------
     Registry. Each entry builds from a spec; the page supplies the
     published dimensions so the hangar and the fleet table cannot disagree.
     --------------------------------------------------------------------- */
  function build(spec) {
    if (spec.kind === 'h145') return buildH145(spec)
    if (spec.kind === 'concorde' || spec.shape === 'delta') return buildConcorde(spec)
    if (spec.shape === 'light') return buildLight(spec)
    if (spec.shape === 'bizjet') return buildBizjet(spec)
    if (spec.shape === 'fighter') return buildFighter(spec)
    if (spec.shape === 'wing') return buildWing(spec)
    return buildAirliner(spec)
  }

  return { build, buildH145, buildAirliner, buildConcorde, buildLight, buildBizjet, buildFighter, buildWing, mats, liveries, fuselage, surface, loftRings }
}
