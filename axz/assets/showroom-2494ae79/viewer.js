/* ==========================================================================
   AXZ showroom — the sourced models at the resolution they were made in.

   One renderer, a room environment for the paint to reflect, a shadowed
   floor, orbit controls, and the same rig code the simulator flies with, so
   what moves here moves there. Models arrive through the asset hub from the
   assets origin; nothing is bundled.
   ========================================================================== */
import { RiggedAircraft } from './rigged.js'

export function createViewer(THREE, { OrbitControls, RoomEnvironment, GLTFLoader, draco }, mount, labels) {
  const canvas = document.createElement('canvas')
  /* The stylesheet sizes `.hangar-canvas` to its mount; without the class a
     Retina screen lays the canvas out at its buffer size, twice too big. */
  canvas.className = 'hangar-canvas'
  canvas.setAttribute('aria-label', labels.canvasLabel || 'Model viewer')
  canvas.tabIndex = 0
  mount.appendChild(canvas)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b0d10)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture

  const sun = new THREE.DirectionalLight(0xfff2e0, 2.4)
  sun.position.set(30, 50, 20); sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004
  scene.add(sun, new THREE.HemisphereLight(0xdbe6f5, 0x1a1c20, 0.55))
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 96), new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.95, metalness: 0 }))
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true
  scene.add(floor)

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.49; controls.autoRotate = true; controls.autoRotateSpeed = 0.6
  canvas.addEventListener('pointerdown', () => { controls.autoRotate = false })

  const loader = new GLTFLoader()
  if (draco) loader.setDRACOLoader(draco)
  let current = null, currentSpec = null
  let t = 0, motion = true, exercise = true

  /** The box of what is drawn: hidden parts (a packed chute, ground crew) do not frame the shot. */
  function visibleBox(root) {
    const box = new THREE.Box3(), tmp = new THREE.Box3()
    root.updateMatrixWorld(true)
    const shown = o => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true }
    root.traverse(o => { if (o.isMesh && shown(o)) { tmp.setFromObject(o, true); box.union(tmp) } })
    return box
  }
  function fit(view) {
    const box = visibleBox(view.root)
    const size = new THREE.Vector3(); box.getSize(size)
    const c = new THREE.Vector3(); box.getCenter(c)
    const r = Math.max(size.x, size.y, size.z) * 0.62
    camera.position.set(c.x + r * 1.15, c.y + r * 0.55, c.z + r * 1.35)
    camera.near = r / 100; camera.far = r * 40; camera.updateProjectionMatrix()
    controls.target.copy(c); controls.minDistance = r * 0.35; controls.maxDistance = r * 6; controls.update()
    sun.shadow.camera.left = -r * 1.6; sun.shadow.camera.right = r * 1.6; sun.shadow.camera.top = r * 1.6; sun.shadow.camera.bottom = -r * 1.6; sun.shadow.camera.far = 400; sun.shadow.camera.updateProjectionMatrix()
  }

  async function show(bytes, spec, asset) {
    const gltf = await new Promise((res, rej) => loader.parse(bytes, '', res, rej))
    if (current) { scene.remove(current.root); current.dispose() }
    const view = new RiggedAircraft(THREE, gltf, spec, asset)
    // Stand it on the floor: the flight model's rest pose, wheels on y = 0.
    view.root.position.set(0, view.restHeight, 0)
    scene.add(view.root)
    current = view; currentSpec = spec
    fit(view)
    let tris = 0, meshes = 0
    view.model.traverse(o => { if (o.isMesh) { meshes++; const g = o.geometry; tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3 } })
    return { meshes, triangles: Math.round(tris), animated: view.animated.size, wheels: view.stats.wheels, size: view.stats.size }
  }

  /* A flight the aeroplane never leaves the floor for: gear cycles, flaps
     run out and back, the surfaces waggle, the fans turn. */
  function fakeState(time) {
    const ph = (time % 24) / 24
    const gear = ph < 0.25 ? 1 : ph < 0.4 ? 1 - (ph - 0.25) / 0.15 : ph < 0.65 ? 0 : ph < 0.8 ? (ph - 0.65) / 0.15 : 1
    const flap = ph < 0.5 ? 40 * Math.min(1, Math.max(0, (ph - 0.1) / 0.2)) : 40 * Math.max(0, 1 - (ph - 0.5) / 0.2)
    return { pos: { x: 0, y: current ? current.restHeight : 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, gearPos: gear, flapDeg: flap, cfg: { flapMaxDeg: 40 },
      ctl: { aileron: Math.sin(time * 1.3) * 0.8, elevator: Math.sin(time * 0.9) * 0.6, rudder: Math.sin(time * 0.7) * 0.5 },
      thrustLag: 0.35 + 0.15 * Math.sin(time * 0.3), eng: currentSpec ? new Array(currentSpec.engines || 2).fill(1) : [1, 1], throttle: 0.5, reversePos: 0, brakes: 0, onGround: true, vel: { x: 0, y: 0, z: 0 }, spoilerPos: 0 }
  }

  let last = performance.now()
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now
    if (motion) t += dt
    if (current && exercise && motion) current.update(fakeState(t), dt, { time: t })
    controls.autoRotate = controls.autoRotate && motion
    controls.update()
    renderer.render(scene, camera)
    handle.frames++
    requestAnimationFrame(frame)
  }
  function resize() {
    const r = mount.getBoundingClientRect(); const w = Math.max(2, r.width), h = Math.max(240, r.height)
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix()
  }
  window.addEventListener('resize', resize); resize()
  requestAnimationFrame(frame)

  const handle = { renderer, scene, camera, controls, show, frames: 0, get current() { return current },
    setMotion(on) { motion = on; if (on) last = performance.now() }, setExercise(on) { exercise = on; if (!on && current) current.update(fakeState(0), 0, { time: 0 }) },
    dispose() { renderer.dispose() } }
  return handle
}
