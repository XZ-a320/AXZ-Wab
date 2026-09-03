/* ==========================================================================
   AXZ hangar viewer.

   Owns the renderer, the lights, the floor and the camera; the aircraft come
   from models.js. Motion here means three things — the rotors, the beacon
   and the orbit damping — and all three follow the page's motion setting:
   with motion off the rotors spool down, the beacon holds, and the scene is
   drawn only when the camera moves.

   Takes THREE and the two addons as arguments for the same reason models.js
   does: the same file runs inlined in a single page or as a module.
   ========================================================================== */

export function createViewer(THREE, { OrbitControls, RoomEnvironment }, hangar, opts) {
  const { el, canvas, theme = () => 'night', motionOn = () => true } = opts
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000)

  // Studio reflections without a texture: the addon's procedural room.
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.55
  pmrem.dispose()

  const hemi = new THREE.HemisphereLight(0xdfe8f5, 0x5c554a, 0.8)
  const ambient = new THREE.AmbientLight(0xffffff, 0.22)
  const key = new THREE.DirectionalLight(0xfff3e2, 3.4)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0006
  key.shadow.normalBias = 0.02
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.9)
  scene.add(hemi, ambient, key, key.target, fill)

  // Floor: a disc that takes the shadow, and a grid drawn over it.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.9, metalness: 0.05 })
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 96), floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
  let grid = null

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.screenSpacePanning = false
  controls.maxPolarAngle = Math.PI / 2 - 0.02
  controls.listenToKeyEvents(canvas)
  controls.keyPanSpeed = 14

  const THEMES = {
    night: { bg: 0x0b0d10, floor: 0x1a1e24, grid1: 0x2b3138, grid2: 0x20252b, hemiSky: 0xcfd9e6, hemiGround: 0x3a3630, fog: 0x0b0d10 },
    day: { bg: 0xe9e4d8, floor: 0xd9d3c5, grid1: 0xc2bbab, grid2: 0xcfc8b8, hemiSky: 0xffffff, hemiGround: 0x8c8474, fog: 0xe9e4d8 },
  }

  let current = null       // the aircraft group on the floor
  let extent = 20
  let spinSpeed = 0        // 0..1, eased
  let needsDraw = true
  let disposed = false
  let dims = { w: 1, h: 1 }

  function applyTheme() {
    const t = THEMES[theme()] || THEMES.night
    scene.background = new THREE.Color(t.bg)
    floorMat.color.set(t.floor)
    hemi.color.set(t.hemiSky); hemi.groundColor.set(t.hemiGround)
    scene.fog = new THREE.Fog(t.fog, extent * 2.2, extent * 5.5)
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose() }
    grid = new THREE.GridHelper(extent * 6, Math.round(extent * 6 / 2), t.grid1, t.grid2)
    grid.material.transparent = true
    grid.material.opacity = 0.5
    grid.position.y = 0.012
    scene.add(grid)
    needsDraw = true
  }

  function frame(group) {
    const box = new THREE.Box3().setFromObject(group)
    const size = box.getSize(V3())
    const centre = box.getCenter(V3())
    extent = Math.max(size.x, size.z, size.y * 1.6)
    floor.scale.setScalar(extent * 3.2)
    key.position.set(-extent * 0.7, extent * 1.3, extent * 0.8)
    key.target.position.copy(centre)
    const sc = key.shadow.camera
    sc.left = -extent * 0.75; sc.right = extent * 0.75; sc.top = extent * 0.75; sc.bottom = -extent * 0.75
    sc.near = extent * 0.2; sc.far = extent * 4
    sc.updateProjectionMatrix()
    fill.position.set(extent, extent * 0.5, -extent * 0.9)
    camera.near = Math.max(0.05, extent * 0.01)
    camera.far = extent * 12
    camera.updateProjectionMatrix()
    controls.minDistance = extent * 0.35
    controls.maxDistance = extent * 3.5
    controls.target.set(centre.x, Math.min(centre.y, size.y * 0.42), centre.z)
    const dist = (extent / (2 * Math.tan((camera.fov * Math.PI / 180) / 2))) * 0.98 * (dims.w < dims.h ? 1.6 : 1)
    // Nose is at -X. Sit off the starboard bow, a little above the deck.
    const az = 0.68, elv = 0.22
    camera.position.set(
      controls.target.x - dist * Math.cos(elv) * Math.cos(az),
      controls.target.y + dist * Math.sin(elv),
      controls.target.z + dist * Math.cos(elv) * Math.sin(az))
    controls.update()
    applyTheme()
  }

  function show(spec) {
    if (current) {
      scene.remove(current)
      current.traverse(o => { if (o.geometry) o.geometry.dispose() })
    }
    current = hangar.build(spec)
    const off = current.userData.offset || V3(0, 0, 0)
    // Centre the drawn length on the origin so every type turns about its own middle.
    current.position.x += off.x
    current.traverse(o => { if (o.isMesh) { o.castShadow = o.castShadow !== false; o.receiveShadow = true } })
    scene.add(current)
    spinSpeed = 0
    frame(current)
    return current
  }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight
    if (!w || !h) return
    dims = { w, h }
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    needsDraw = true
  }
  const ro = new ResizeObserver(resize)
  ro.observe(el)
  window.addEventListener('resize', resize)
  resize()

  controls.addEventListener('change', () => { needsDraw = true })

  const clock = new THREE.Clock()
  let t = 0
  const RATES = { y: 1.55, z: 5.2, x: 3.0 } // revolutions per second at full speed, by axis convention

  function tick() {
    if (disposed) return
    requestAnimationFrame(tick)
    const dt = Math.min(0.05, clock.getDelta())
    const on = motionOn()
    // Spool up on an ease, spool down on a straight ramp that really reaches
    // zero: an exponential decay never does, and a rotor that is "almost"
    // stopped is still a rotor turning with motion off.
    if (on) { spinSpeed += (1 - spinSpeed) * Math.min(1, dt / 1.6); if (spinSpeed > 0.995) spinSpeed = 1 }
    else spinSpeed = Math.max(0, spinSpeed - dt / 2.0)
    const moving = controls.update() || spinSpeed > 0 || on
    if (current && spinSpeed > 0) {
      t += dt
      for (const s of current.userData.spin || []) {
        const rate = RATES[s.axis] * spinSpeed * Math.PI * 2
        current.traverse(o => { if (o.name === s.name) o.rotation[s.axis] += rate * dt })
      }
      const disc = current.getObjectByName('rotorDisc')
      if (disc) disc.material.opacity = 0.16 * Math.max(0, spinSpeed - 0.5) * 2
      needsDraw = true
    } else if (current) {
      const disc = current.getObjectByName('rotorDisc')
      if (disc && disc.material.opacity !== 0) { disc.material.opacity = 0; needsDraw = true }
    }
    if (current && on) {
      // Anti-collision beacon: a double flash every 1.4 s.
      const ph = (performance.now() / 1400) % 1
      const flash = (ph < 0.06 || (ph > 0.14 && ph < 0.20)) ? 2.6 : 0.25
      current.traverse(o => { if (o.name === 'beacon') o.material.emissiveIntensity = flash })
      needsDraw = true
    }
    if (needsDraw || moving) {
      renderer.render(scene, camera)
      needsDraw = false
    }
  }
  tick()

  function dispose() {
    disposed = true
    ro.disconnect()
    window.removeEventListener('resize', resize)
    controls.dispose()
    renderer.dispose()
  }

  return { show, resize, applyTheme, dispose, renderer, scene, camera, controls, get current() { return current } }
}
