/* ==========================================================================
   AXZ sim 2.0 — the picture.

   Everything that was a hand-written WebGL program in 1.0 is a Three.js scene
   here: an atmospheric sky with a real sun, cascaded shadow maps that follow
   the camera, a lit and reflective sea, bloom on the lights, and the hangar's
   procedural aircraft. The WORLD is still world.js — one height function,
   the same airports, the same city boxes — so nothing the flight model stands
   on has moved.

   Two render passes, deliberately. The far terrain is 2 km per cell and cannot
   resolve an airport plateau: drawn into the same depth buffer as the near
   mesh it floats a metre and a half over every runway. So the horizon (sky,
   far and middle rings) is painted first, its depth is discarded, and the
   near ring with everything on it is drawn into a clean buffer. That is the
   1.0 fix, kept, because the bug is a property of the terrain and not of the
   renderer.
   ========================================================================== */

import {
  AIRPORTS, AP_LIST, terrainRing, runwayMesh, scenery, trees, papiUnits, papiState,
  lightPoints, cityBoxes, CITY, elevation, hdgVec,
} from './world.js'
import * as TEX from './tex.js'
import { clamp } from './math.js'

const NEAR_SIZE = 11000, NEAR_RES = 96
const MID_SIZE = 46000, MID_RES = 92
const FAR_SIZE = 300000, FAR_RES = 150
export const SNAP = NEAR_SIZE / 8
const LAYER_FAR = 1

const LOGDEPTH_V = `
#include <common>
#include <logdepthbuf_pars_vertex>`
const LOGDEPTH_F = `
#include <common>
#include <logdepthbuf_pars_fragment>`

/* --- Billboard batches ------------------------------------------------------
   Clouds, smoke, tyre puffs, contrails and shock diamonds are all the same
   thing to the GPU: a quad that faces the camera, textured, tinted, faded.
   One instanced draw per texture, refilled from a list each frame.          */
class SpriteBatch {
  constructor(THREE, texture, max, { additive = false, depthWrite = false } = {}) {
    this.THREE = THREE
    this.max = max
    const quad = new THREE.PlaneGeometry(1, 1)
    const geo = new THREE.InstancedBufferGeometry()
    geo.index = quad.index
    geo.attributes.position = quad.attributes.position
    geo.attributes.uv = quad.attributes.uv
    this.offset = new Float32Array(max * 3)
    this.size = new Float32Array(max)
    this.color = new Float32Array(max * 4)
    this.rect = new Float32Array(max * 4)
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(this.offset, 3))
    geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(this.size, 1))
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(this.color, 4))
    geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(this.rect, 4))
    geo.instanceCount = 0
    this.geo = geo
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        fogColor: { value: new THREE.Color(0x000000) },
        fogNear: { value: 1000 }, fogFar: { value: 50000 },
        sunTint: { value: new THREE.Color(1, 1, 1) },
      },
      vertexShader: `
        attribute vec3 aOffset; attribute float aSize; attribute vec4 aColor; attribute vec4 aRect;
        varying vec2 vUv; varying vec4 vColor; varying float vFog;
        uniform float fogNear, fogFar;
        ${LOGDEPTH_V}
        void main() {
          vUv = mix(aRect.xy, aRect.zw, uv);
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
          mv.xy += position.xy * aSize;
          vFog = smoothstep(fogNear, fogFar, length(mv.xyz));
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 fogColor; uniform vec3 sunTint;
        varying vec2 vUv; varying vec4 vColor; varying float vFog;
        ${LOGDEPTH_F}
        void main() {
          #include <logdepthbuf_fragment>
          vec4 t = texture2D(map, vUv);
          float a = t.a * vColor.a;
          if (a < 0.004) discard;
          vec3 c = t.rgb * vColor.rgb * sunTint;
          c = mix(c, fogColor, vFog);
          gl_FragColor = vec4(c, a);
        }`,
      transparent: true,
      depthWrite,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.frustumCulled = false
  }

  /** Refill from a list of { x, y, z, size, r, g, b, a, u0, v0, u1, v1 }. */
  fill(list) {
    const n = Math.min(list.length, this.max)
    for (let i = 0; i < n; i++) {
      const s = list[i]
      this.offset[i * 3] = s.x; this.offset[i * 3 + 1] = s.y; this.offset[i * 3 + 2] = s.z
      this.size[i] = s.size
      this.color[i * 4] = s.r; this.color[i * 4 + 1] = s.g; this.color[i * 4 + 2] = s.b; this.color[i * 4 + 3] = s.a
      this.rect[i * 4] = s.u0 ?? 0; this.rect[i * 4 + 1] = s.v0 ?? 0
      this.rect[i * 4 + 2] = s.u1 ?? 1; this.rect[i * 4 + 3] = s.v1 ?? 1
    }
    this.geo.instanceCount = n
    for (const k of ['aOffset', 'aSize', 'aColor', 'aRect']) this.geo.attributes[k].needsUpdate = true
    this.mesh.visible = n > 0
  }
}

export class Scene3D {
  constructor(THREE, addons, canvas, opts = {}) {
    this.THREE = THREE
    this.A = addons
    this.canvas = canvas
    const R = this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
    })
    R.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    R.shadowMap.enabled = true
    R.shadowMap.type = THREE.PCFSoftShadowMap
    R.toneMapping = THREE.ACESFilmicToneMapping
    R.toneMappingExposure = 0.85
    R.autoClear = false

    const S = this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(60, 1, 2, 320000)
    this.camera.layers.enable(LAYER_FAR)

    /* --- Sky, sun, stars ---------------------------------------------- */
    const sky = this.sky = new addons.Sky()
    sky.scale.setScalar(280000)
    sky.layers.set(LAYER_FAR)
    const su = sky.material.uniforms
    su.turbidity.value = 4.5; su.rayleigh.value = 1.6
    su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.82
    /* The Preetham sky is written for direct output at half exposure. Through
       the composer it arrives as raw radiance, brighter than a sunlit white
       wing, so it is scaled down to sit under the tone curve with the rest. */
    sky.material.onBeforeCompile = shader => {
      shader.uniforms.skyScale = { value: 0.42 }
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float skyScale;\nvoid main() {')
        // Below the horizon the model goes black; the terrain does not always
        // reach that far, so the lower hemisphere wears the horizon's colour.
        .replace(/vec3 direction = normalize\( vWorldPosition - cameraPos \);/, 'vec3 direction = normalize( vWorldPosition - cameraPos ); direction.y = max( direction.y, 0.004 );')
        .replace(/gl_FragColor = vec4\( (\w+), 1\.0 \);/, 'gl_FragColor = vec4( $1 * skyScale, 1.0 );')
    }
    S.add(sky)
    this.sunDir = new THREE.Vector3(0.38, 0.62, 0.34).normalize()
    this.stars = this.makeStars()
    S.add(this.stars)

    /* --- Lights and the cascade ---------------------------------------- */
    this.hemi = new THREE.HemisphereLight(0xbfd4ee, 0x5c5a4a, 0.5)
    this.ambient = new THREE.AmbientLight(0xffffff, 0.12)
    S.add(this.hemi, this.ambient)
    this.csm = new addons.CSM({
      maxFar: 9000, cascades: 4, mode: 'practical', parent: S, shadowMapSize: 2048,
      lightDirection: this.sunDir.clone().negate(), camera: this.camera,
      lightIntensity: 2.2, shadowBias: -0.00025, lightMargin: 400,
    })
    this.csm.fade = true
    /* The horizon pass renders layer 1 alone, and a camera only sees lights on
       its own layers: without this the far rings were drawn unlit, and the
       fog tinted a black landscape into a dark band under the sky. */
    for (const l of [this.hemi, this.ambient, ...this.csm.lights]) l.layers.enableAll()

    /* --- Materials ----------------------------------------------------- */
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 })
    this.terrainFarMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0 })
    this.pavementMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
    this.paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 })
    this.cityMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.05 })
    // The boxes' tones were chosen as seen; as linear light they are a skyline of soot.
    this.cityMat.color.setRGB(2.4, 2.4, 2.4)
    for (const m of [this.terrainMat, this.terrainFarMat, this.pavementMat, this.paintMat, this.cityMat]) this.csm.setupMaterial(m)

    /* --- Terrain rings --------------------------------------------------- */
    this.near = this.ringMesh(null, this.terrainMat, 0)
    this.mid = this.ringMesh(null, this.terrainFarMat, LAYER_FAR)
    this.far = this.ringMesh(null, this.terrainFarMat, LAYER_FAR)
    this.near.castShadow = true; this.near.receiveShadow = true
    S.add(this.near, this.mid, this.far)
    this.nearCentre = { x: 1e9, z: 1e9 }
    this.midCentre = { x: 1e9, z: 1e9 }
    this.farCentre = { x: 1e9, z: 1e9 }

    /* --- Water ----------------------------------------------------------- */
    this.water = this.makeWater()
    S.add(this.water)

    /* --- Airports -------------------------------------------------------- */
    this.papis = {}
    this.papiPoints = {}
    this.lightMat = this.makeLightMaterial()
    for (const key of AP_LIST) {
      const ap = AIRPORTS[key]
      const strip = new THREE.Mesh(this.geo(runwayMesh(ap, false)), this.pavementMat)
      strip.receiveShadow = true
      const marks = new THREE.Mesh(this.geo(runwayMesh(ap, true)), this.paintMat)
      const city = new THREE.Mesh(this.geo(scenery(ap, CITY[key][0], CITY[key][1])), this.cityMat)
      city.castShadow = true; city.receiveShadow = true
      S.add(strip, marks, city)
      S.add(this.lightsFor(ap))
      S.add(this.windowsFor(ap, key))
      this.papis[key] = papiUnits(ap)
      const pp = this.papiFor(this.papis[key])
      this.papiPoints[key] = pp
      S.add(pp)
    }

    /* --- Trees ----------------------------------------------------------- */
    this.treeTex = this.canvasTex(TEX.treeSheet(256))
    this.treeMat = new THREE.MeshStandardMaterial({ map: this.treeTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 })
    // The sheet was painted for a gamma-free renderer; lifted so a tree is green, not black.
    this.treeMat.color.setRGB(2.2, 2.2, 2.2)
    this.csm.setupMaterial(this.treeMat)
    this.treeMeshes = []
    for (let v = 0; v < 4; v++) {
      const g = this.treeGeometry(v)
      const im = new THREE.InstancedMesh(g, this.treeMat, 1400)
      im.count = 0
      im.receiveShadow = false
      im.frustumCulled = false
      this.treeMeshes.push(im)
      S.add(im)
    }
    this.treeCentre = { x: 1e9, z: 1e9 }
    this.sTree = []

    /* --- Sprites --------------------------------------------------------- */
    this.puffTex = this.canvasTex(TEX.puffTexture(192, { seed: 4, lobes: 11 }))
    this.dotTex = this.canvasTex(TEX.dotTexture(64))
    this.cloudBatch = new SpriteBatch(THREE, this.puffTex, 2600)
    this.puffBatch = new SpriteBatch(THREE, this.puffTex, 900)
    this.dotBatch = new SpriteBatch(THREE, this.dotTex, 900, { additive: true })
    this.cloudBatch.mesh.renderOrder = 5
    this.puffBatch.mesh.renderOrder = 6
    this.dotBatch.mesh.renderOrder = 7
    S.add(this.cloudBatch.mesh, this.puffBatch.mesh, this.dotBatch.mesh)

    /* --- Rain ------------------------------------------------------------ */
    this.rain = this.makeRain()
    S.add(this.rain)

    /* --- The shock collar ------------------------------------------------ */
    this.shock = this.makeShock()
    S.add(this.shock)

    /* --- Landing lights -------------------------------------------------- */
    this.landing = [new THREE.SpotLight(0xfff2d8, 0, 1800, 0.22, 0.55, 1.2), new THREE.SpotLight(0xfff2d8, 0, 1800, 0.22, 0.55, 1.2)]
    for (const l of this.landing) { S.add(l); S.add(l.target) }

    /* --- Post ------------------------------------------------------------- */
    this.fog = new THREE.Fog(0x9fb4cc, 4000, 70000)
    S.fog = this.fog
    this.buildComposer()
    this.time = 0
    this.night = 0
    this.weather = { cover: 0.45, rain: 0 }
    this.setSun(this.sunDir, { amb: 0.34, warm: [1.06, 1.0, 0.92], sky: 1 })
  }

  /* --- Helpers ------------------------------------------------------------ */
  /* The world's palette was written for a renderer with no colour management,
     as the values you SEE. Three.js reads vertex colours as linear light and
     brightens them on the way out, so the same numbers come out chalky. They
     are converted here, once, and the landscape keeps the tones it was drawn in. */
  linear(arr) {
    const out = arr instanceof Float32Array ? arr : new Float32Array(arr)
    for (let i = 0; i < out.length; i++) {
      const c = out[i]
      out[i] = c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4)
    }
    return out
  }
  geo(d) {
    const THREE = this.THREE
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.normal, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.linear(d.color), 3))
    return g
  }
  ringMesh(data, mat, layer) {
    const THREE = this.THREE
    const g = new THREE.BufferGeometry()
    const m = new THREE.Mesh(g, mat)
    m.frustumCulled = false
    m.layers.set(layer)
    m.receiveShadow = true
    return m
  }
  setRing(mesh, d) {
    const THREE = this.THREE
    const g = mesh.geometry
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.linear(d.color), 3))
    g.computeBoundingSphere()
  }
  canvasTex(c) {
    const t = new this.THREE.CanvasTexture(c)
    t.colorSpace = this.THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }

  buildComposer() {
    const THREE = this.THREE, A = this.A
    const w = Math.max(this.canvas.width, 2), h = Math.max(this.canvas.height, 2)
    const composer = this.composer = new A.EffectComposer(this.renderer)
    // Pass one: the horizon layer. Pass two: everything else, on a clean depth buffer.
    const farPass = new A.RenderPass(this.scene, this.camera)
    const nearPass = new A.RenderPass(this.scene, this.camera)
    nearPass.clear = false
    nearPass.clearDepth = true
    const cam = this.camera
    const origFar = farPass.render.bind(farPass), origNear = nearPass.render.bind(nearPass)
    farPass.render = (...a) => { cam.layers.set(LAYER_FAR); origFar(...a) }
    nearPass.render = (...a) => { cam.layers.set(0); origNear(...a); cam.layers.enableAll() }
    this.bloom = new A.UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.45, 0.88)
    this.smaa = new A.SMAAPass(w, h)
    composer.addPass(farPass); composer.addPass(nearPass)
    composer.addPass(this.bloom); composer.addPass(this.smaa); composer.addPass(new A.OutputPass())
    this.ok = true
  }

  resize(cssW, cssH) {
    const R = this.renderer
    R.setSize(cssW, cssH, false)
    const w = this.canvas.width, h = this.canvas.height
    this.camera.aspect = cssW / cssH
    this.camera.updateProjectionMatrix()
    this.composer.setSize(w, h)
    this.smaa.setSize(w, h)
    this.csm.updateFrustums()
  }

  /* --- Sky and sun ---------------------------------------------------------
     The time of day is a sun vector and a palette; everything else follows.  */
  setSun(dir, light) {
    const THREE = this.THREE
    this.sunDir.copy(dir).normalize()
    this.light = light
    const day = light.sky
    this.night = clamp(1 - day / 0.35, 0, 1)
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir).multiplyScalar(1000)
    this.sky.material.uniforms.turbidity.value = 4 + 6 * (this.weather ? this.weather.cover : 0.4)
    this.csm.lightDirection.copy(this.sunDir).negate()
    const up = Math.max(this.sunDir.y, 0)
    this.csm.lightIntensity = (2.3 * Math.min(1, up * 4) + 0.05) * (1 - 0.55 * (this.weather ? this.weather.cover : 0))
    const warm = new THREE.Color(light.warm[0] * 0.9, light.warm[1] * 0.9, light.warm[2] * 0.9)
    for (const l of this.csm.lights) l.color.copy(warm)
    /* The sky lights the ground even when the sun barely does: at dusk the
       fill is most of what there is, and a ground that goes black at 7
       degrees of sun is a renderer being literal about one light source. */
    this.hemi.intensity = 0.5 + 0.35 * day
    this.hemi.color.setRGB(0.55 + 0.35 * day, 0.62 + 0.30 * day, 0.75 + 0.20 * day, THREE.SRGBColorSpace)
    this.hemi.groundColor.setRGB(0.30 + 0.2 * day, 0.28 + 0.18 * day, 0.24 + 0.14 * day, THREE.SRGBColorSpace)
    this.ambient.intensity = 0.08 + light.amb * 0.4 * day
    this.stars.material.opacity = clamp(1 - up * 6, 0, 1) * 0.9
    this.stars.visible = this.stars.material.opacity > 0.02
    this.renderer.toneMappingExposure = 0.85 - 0.25 * this.night
    this.bloom.strength = 0.42 + 0.18 * this.night
    this.lightMat.uniforms.intensity.value = 0.9 + 1.4 * this.night
    this.refreshFog(0)
  }

  setWeather({ cover, rain } = {}) {
    if (cover != null) this.weather.cover = cover
    if (rain != null) this.weather.rain = rain
    this.rain.visible = this.weather.rain > 0.01
    if (this.light) this.setSun(this.sunDir, this.light)
  }

  refreshFog(alt) {
    const day = this.light ? this.light.sky : 1
    const hi = clamp(alt / 9000, 0, 1)
    const w = this.weather
    const vis = 1 - 0.55 * w.cover - 0.4 * w.rain
    this.fog.near = (6500 + alt * 4) * vis
    this.fog.far = (95000 + alt * 18) * (0.25 + 0.75 * vis)
    const warm = this.light ? this.light.warm : [1, 1, 1]
    const SRGB = this.THREE.SRGBColorSpace
    // The palette is written as seen; Color.setRGB takes it as linear unless told.
    this.fog.color.setRGB(
      (0.62 - 0.42 * hi) * day * (0.6 + 0.4 * warm[0]) * (1 - 0.3 * w.rain),
      (0.70 - 0.44 * hi) * day * (0.6 + 0.4 * warm[1]) * (1 - 0.3 * w.rain),
      (0.84 - 0.36 * hi) * day * (0.6 + 0.4 * warm[2]) * (1 - 0.25 * w.rain), SRGB)
    for (const b of [this.cloudBatch, this.puffBatch, this.dotBatch]) {
      b.mat.uniforms.fogColor.value.copy(this.fog.color)
      b.mat.uniforms.fogNear.value = this.fog.near; b.mat.uniforms.fogFar.value = this.fog.far
      b.mat.uniforms.sunTint.value.setRGB(0.25 + 0.75 * day * warm[0], 0.25 + 0.75 * day * warm[1], 0.3 + 0.7 * day * warm[2], SRGB)
    }
    const wu = this.water.material.uniforms
    wu.fogColor.value.copy(this.fog.color); wu.fogNear.value = this.fog.near; wu.fogFar.value = this.fog.far
    wu.sunDir.value.copy(this.sunDir)
    wu.sunLevel.value = Math.max(this.sunDir.y, 0) * day
    wu.skyCol.value.setRGB((0.42 - 0.2 * hi) * day, (0.58 - 0.24 * hi) * day, (0.86 - 0.26 * hi) * day, SRGB)
    this.lightMat.uniforms.fogFar.value = this.fog.far
  }

  makeStars() {
    const THREE = this.THREE
    const n = 1800, pos = new Float32Array(n * 3), col = new Float32Array(n * 3)
    let s = 17
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, e = Math.asin(rnd() * 0.98 + 0.02)
      const r = 200000
      pos[i * 3] = Math.cos(e) * Math.cos(a) * r; pos[i * 3 + 1] = Math.sin(e) * r; pos[i * 3 + 2] = Math.cos(e) * Math.sin(a) * r
      const t = 0.6 + rnd() * 0.4, b = rnd()
      col[i * 3] = t * (0.85 + 0.15 * b); col[i * 3 + 1] = t * (0.85 + 0.1 * b); col[i * 3 + 2] = t
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false })
    const p = new THREE.Points(g, m)
    p.layers.set(LAYER_FAR)
    p.frustumCulled = false
    return p
  }

  /* --- Water ----------------------------------------------------------------
     A single lit plane the size of the near ring, following the aeroplane.
     The coarse rings already draw the sea as a flat dark sheet; this is the
     part of it close enough to have waves, a sun glint and a sky reflection. */
  makeWater() {
    const THREE = this.THREE
    const g = new THREE.PlaneGeometry(NEAR_SIZE * 1.02, NEAR_SIZE * 1.02, 1, 1)
    g.rotateX(-Math.PI / 2)
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunLevel: { value: 1 },
        skyCol: { value: new THREE.Color(0x6a8fbf) }, deep: { value: new THREE.Color(0x0d2033) }, shallow: { value: new THREE.Color(0x1a3a52) },
        fogColor: { value: new THREE.Color(0x9fb4cc) }, fogNear: { value: 4000 }, fogFar: { value: 70000 },
      },
      vertexShader: `
        varying vec3 vWorld;
        ${LOGDEPTH_V}
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform float time, sunLevel, fogNear, fogFar;
        uniform vec3 sunDir, skyCol, deep, shallow, fogColor;
        varying vec3 vWorld;
        ${LOGDEPTH_F}
        float wave(vec2 p, float t) {
          return sin(p.x * 0.31 + t * 1.1) * 0.6 + sin(p.y * 0.23 - t * 0.9) * 0.5
               + sin((p.x + p.y) * 0.11 + t * 0.6) * 0.8 + sin((p.x - p.y * 0.7) * 0.052 - t * 0.35) * 1.2;
        }
        void main() {
          #include <logdepthbuf_fragment>
          vec3 toCam = cameraPosition - vWorld;
          float dist = length(toCam);
          vec3 v = toCam / dist;
          // A normal from the slope of the wave field, calmer with distance
          // so the far sea does not shimmer with aliasing.
          float calm = clamp(dist / 6000.0, 0.0, 1.0);
          float e = 0.6;
          vec2 p = vWorld.xz;
          float h0 = wave(p, time), hx = wave(p + vec2(e, 0.0), time), hz = wave(p + vec2(0.0, e), time);
          vec3 n = normalize(vec3(-(hx - h0) / e * 0.35 * (1.0 - calm), 1.0, -(hz - h0) / e * 0.35 * (1.0 - calm)));
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.5) * 0.85 + 0.08;
          vec3 base = mix(deep, shallow, 0.35);
          vec3 c = mix(base, skyCol, fres);
          vec3 r = reflect(-v, n);
          float spec = pow(max(dot(r, sunDir), 0.0), 240.0) * sunLevel * 2.6
                     + pow(max(dot(r, sunDir), 0.0), 18.0) * sunLevel * 0.10;
          c += vec3(1.0, 0.93, 0.8) * spec;
          float f = smoothstep(fogNear, fogFar, dist);
          c = mix(c, fogColor, f);
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    const m = new THREE.Mesh(g, mat)
    m.position.y = 0.12
    m.frustumCulled = false
    m.renderOrder = 1
    return m
  }

  /* --- Airport lights as glowing points -------------------------------------- */
  makeLightMaterial() {
    const THREE = this.THREE
    return new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, intensity: { value: 1 }, pixelRatio: { value: this.renderer.getPixelRatio() }, fogFar: { value: 70000 }, map: { value: this.canvasTex(TEX.dotTexture(64, 0.25)) } },
      vertexShader: `
        attribute vec3 color; attribute float kind; attribute float seq;
        uniform float time, intensity, pixelRatio, fogFar;
        varying vec3 vColor; varying float vA;
        ${LOGDEPTH_V}
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = max(-mv.z, 1.0);
          float s = kind > 1.5 ? 2.2 : kind > 0.5 ? 1.35 : 1.0;
          gl_PointSize = clamp(2200.0 / d, 1.6, 13.0) * s * pixelRatio;
          vA = 1.0 - smoothstep(fogFar * 0.55, fogFar, d);
          if (kind > 1.5) { float ph = fract(time * 0.9); vA *= (abs(ph - seq) < 0.03) ? 1.0 : 0.0; }
          vColor = color * intensity;
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor; varying float vA;
        ${LOGDEPTH_F}
        void main() {
          #include <logdepthbuf_fragment>
          float a = texture2D(map, gl_PointCoord).a * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })
  }
  lightsFor(ap) {
    const THREE = this.THREE
    const d = lightPoints(ap)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(d.color, 3))
    g.setAttribute('kind', new THREE.BufferAttribute(d.kind, 1))
    // Sequence for the strobes: their order along the approach, 0..1.
    const n = d.kind.length, seq = new Float32Array(n)
    let idx = 0, total = 0
    for (let i = 0; i < n; i++) if (d.kind[i] > 1.5) total++
    for (let i = 0; i < n; i++) if (d.kind[i] > 1.5) seq[i] = (idx++ / Math.max(total, 1))
    g.setAttribute('seq', new THREE.BufferAttribute(seq, 1))
    const p = new THREE.Points(g, this.lightMat)
    p.frustumCulled = false
    p.renderOrder = 8
    return p
  }
  papiFor(papi) {
    const THREE = this.THREE
    const n = papi.units.length
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3)
    papi.units.forEach((u, i) => { pos[i * 3] = u.x; pos[i * 3 + 1] = u.y; pos[i * 3 + 2] = u.z; col[i * 3] = 1; col[i * 3 + 1] = 0.2; col[i * 3 + 2] = 0.16 })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1))
    g.setAttribute('seq', new THREE.BufferAttribute(new Float32Array(n), 1))
    const p = new THREE.Points(g, this.lightMat)
    p.frustumCulled = false
    p.renderOrder = 8
    return p
  }
  /** Lit windows: a scatter of warm points on the faces of the city's boxes. */
  windowsFor(ap, key) {
    const THREE = this.THREE
    const boxes = cityBoxes(ap, CITY[key][0], CITY[key][1])
    const pos = [], col = []
    let s = 91
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (const b of boxes) {
      const rows = Math.max(1, Math.floor(b.h / 7))
      const n = Math.min(60, rows * 2)
      for (let i = 0; i < n; i++) {
        const face = (rnd() * 4) | 0
        const y = b.y + 3 + rnd() * (b.h - 4)
        let x = b.x, z = b.z
        if (face === 0) { x += b.w / 2 + 0.3; z += (rnd() - 0.5) * b.d }
        else if (face === 1) { x -= b.w / 2 + 0.3; z += (rnd() - 0.5) * b.d }
        else if (face === 2) { z += b.d / 2 + 0.3; x += (rnd() - 0.5) * b.w }
        else { z -= b.d / 2 + 0.3; x += (rnd() - 0.5) * b.w }
        pos.push(x, y, z)
        const warm = rnd() < 0.7
        col.push(warm ? 1 : 0.8, warm ? 0.82 : 0.9, warm ? 0.55 : 1)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    g.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1))
    g.setAttribute('seq', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1))
    const p = new THREE.Points(g, this.lightMat)
    p.frustumCulled = false
    p.renderOrder = 8
    return p
  }

  treeGeometry(variant) {
    const THREE = this.THREE
    const u0 = (variant % 2) * 0.5, v0 = 1 - ((variant >> 1) * 0.5) - 0.5
    const parts = []
    for (const rot of [0, Math.PI / 2]) {
      const q = new THREE.PlaneGeometry(1, 1)
      q.rotateY(rot)
      const uv = q.attributes.uv
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * 0.5, v0 + uv.getY(i) * 0.5)
      parts.push(q)
    }
    const merged = this.mergeGeos(parts)
    merged.translate(0, 0.5, 0)
    return merged
  }
  mergeGeos(list) {
    const THREE = this.THREE
    const pos = [], uv = [], nrm = [], idx = []
    let base = 0
    for (const g of list) {
      const p = g.attributes.position, u = g.attributes.uv, n = g.attributes.normal
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); uv.push(u.getX(i), u.getY(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)) }
      const ix = g.index.array
      for (let i = 0; i < ix.length; i++) idx.push(ix[i] + base)
      base += p.count
    }
    const out = new THREE.BufferGeometry()
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
    out.setIndex(idx)
    return out
  }

  makeRain() {
    const THREE = this.THREE
    const n = 1400
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * 120; pos[i * 3 + 1] = (Math.random() - 0.5) * 80; pos[i * 3 + 2] = (Math.random() - 0.5) * 120 }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const c = document.createElement('canvas'); c.width = 8; c.height = 32
    const cx = c.getContext('2d')
    const grd = cx.createLinearGradient(0, 0, 0, 32)
    grd.addColorStop(0, 'rgba(210,225,240,0)'); grd.addColorStop(0.5, 'rgba(210,225,240,0.9)'); grd.addColorStop(1, 'rgba(210,225,240,0)')
    cx.fillStyle = grd; cx.fillRect(2, 0, 4, 32)
    const m = new THREE.PointsMaterial({ map: this.canvasTex(c), size: 0.28, transparent: true, opacity: 0.5, depthWrite: false, fog: false, sizeAttenuation: true })
    const p = new THREE.Points(g, m)
    p.frustumCulled = false
    p.visible = false
    p.renderOrder = 9
    return p
  }

  makeShock() {
    const THREE = this.THREE
    const g = new THREE.ConeGeometry(1, 1, 40, 6, true)
    g.rotateX(-Math.PI / 2)      // point forward (-z), open end aft
    g.translate(0, 0, 0.5)
    const mat = new THREE.ShaderMaterial({
      uniforms: { alpha: { value: 0.5 } },
      vertexShader: `
        varying vec3 vN; varying vec3 vV;
        ${LOGDEPTH_V}
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform float alpha; varying vec3 vN; varying vec3 vV;
        ${LOGDEPTH_F}
        void main() {
          #include <logdepthbuf_fragment>
          float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
          gl_FragColor = vec4(vec3(1.0), rim * alpha);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    })
    const m = new THREE.Mesh(g, mat)
    m.visible = false
    m.renderOrder = 6
    return m
  }

  /* --- Terrain rings ----------------------------------------------------------
     The near ring re-centres every SNAP metres, like 1.0. The middle ring
     re-centres every 12 km and the far ring every 60 km, so the whole world
     is drawn out to the horizon wherever the flight goes — including the
     China pair, which 1.0's single far patch never reached.                  */
  recentre(x, z, force = false) {
    const cx = Math.round(x / SNAP) * SNAP, cz = Math.round(z / SNAP) * SNAP
    let moved = false
    if (force || cx !== this.nearCentre.x || cz !== this.nearCentre.z) {
      this.nearCentre = { x: cx, z: cz }
      this.setRing(this.near, terrainRing(cx, cz, NEAR_SIZE, NEAR_RES, null))
      this.water.position.x = cx; this.water.position.z = cz
      moved = true
    }
    if (force || Math.hypot(x - this.midCentre.x, z - this.midCentre.z) > 12000) {
      this.midCentre = { x: cx, z: cz }
      this.setRing(this.mid, terrainRing(cx, cz, MID_SIZE, MID_RES, null))
    }
    if (force || Math.hypot(x - this.farCentre.x, z - this.farCentre.z) > 60000) {
      this.farCentre = { x: cx, z: cz }
      this.setRing(this.far, terrainRing(cx, cz, FAR_SIZE, FAR_RES, null))
    }
    return moved
  }

  refreshTrees(camX, camZ) {
    if (Math.abs(camX - this.treeCentre.x) < 900 && Math.abs(camZ - this.treeCentre.z) < 900) return
    this.treeCentre = { x: camX, z: camZ }
    trees(camX, camZ, 5200, this.sTree)
    const THREE = this.THREE
    const counts = [0, 0, 0, 0]
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3()
    for (const t of this.sTree) {
      const v = (t.u0 > 0 ? 1 : 0) + (t.v0 > 0 ? 2 : 0)
      const im = this.treeMeshes[v]
      if (counts[v] >= im.count + 0 && counts[v] >= 1400) continue
      const h = t.size / 0.62
      p.set(t.x, t.y - h * 0.5, t.z)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (t.x * 0.37 + t.z * 0.11) % 3.14)
      s.set(t.size * 1.4, h, t.size * 1.4)
      m.compose(p, q, s)
      im.setMatrixAt(counts[v]++, m)
    }
    this.treeMeshes.forEach((im, v) => { im.count = counts[v]; im.instanceMatrix.needsUpdate = true })
  }

  /* --- Per-frame ---------------------------------------------------------------- */
  update(dt, frame) {
    const THREE = this.THREE
    this.time += dt
    const { camPos, ac, clouds, parts, sParts, night } = frame
    this.refreshFog(ac.pos.y)
    this.refreshTrees(camPos.x, camPos.z)
    this.water.material.uniforms.time.value = this.time
    this.lightMat.uniforms.time.value = this.time
    this.lightMat.uniforms.pixelRatio.value = this.renderer.getPixelRatio()

    // Clouds, sorted back to front by the collector.
    clouds.collect(camPos.x, camPos.z, 38000, frame.sCloud)
    this.cloudBatch.fill(frame.sCloud)
    // Particles.
    parts.collect(sParts)
    const puffs = sParts[0], dots = sParts[1]
    puffs.sort((a, b) => ((b.x - camPos.x) ** 2 + (b.y - camPos.y) ** 2 + (b.z - camPos.z) ** 2) - ((a.x - camPos.x) ** 2 + (a.y - camPos.y) ** 2 + (a.z - camPos.z) ** 2))
    this.puffBatch.fill(puffs)
    this.dotBatch.fill(dots)

    // PAPI, from the aeroplane's own position.
    for (const key of AP_LIST) {
      const papi = this.papis[key], pp = this.papiPoints[key]
      const st = papiState(papi, ac.pos)
      pp.visible = !!st
      if (!st) continue
      const col = pp.geometry.attributes.color
      st.forEach((white, i) => { col.setXYZ(i, 1, white ? 0.97 : 0.2, white ? 0.92 : 0.16) })
      col.needsUpdate = true
    }

    // Rain follows the camera, falls, and drifts with the wind.
    if (this.rain.visible) {
      const pos = this.rain.geometry.attributes.position
      const w = frame.wind || { x: 0, z: 0 }
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - 22 * dt, x = pos.getX(i) + w.x * dt, z = pos.getZ(i) + w.z * dt
        if (y < -40) y += 80
        if (x > 60) x -= 120; if (x < -60) x += 120
        if (z > 60) z -= 120; if (z < -60) z += 120
        pos.setXYZ(i, x, y, z)
      }
      pos.needsUpdate = true
      this.rain.position.copy(camPos)
      this.rain.material.opacity = 0.35 + 0.35 * this.weather.rain
    }

    // The shock collar, from the Mach number.
    const mach = ac.mach || 0
    if (mach > 0.92 && !ac.onGround && !ac.crashed) {
      const near = clamp(1 - Math.abs(mach - 1.02) / 0.16, 0, 1)
      const moist = clamp(1 - ac.pos.y / 11000, 0, 1)
      const alpha = 0.6 * near * moist
      if (alpha > 0.01) {
        const mu = Math.asin(clamp(1 / Math.max(mach, 1.0001), 0, 1))
        const len = ac.spec.len * 0.75
        const rad = clamp(len * Math.tan(mu) * 0.22, ac.spec.dia * 0.6, ac.spec.span * 0.45)
        this.shock.visible = true
        this.shock.material.uniforms.alpha.value = alpha
        this.shock.position.copy(frame.acObject.position)
        this.shock.quaternion.copy(frame.acObject.quaternion)
        this.shock.scale.set(rad, rad, len)
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.shock.quaternion)
        this.shock.position.addScaledVector(fwd, ac.spec.len * 0.25)
      } else this.shock.visible = false
    } else this.shock.visible = false
  }

  setLandingLights(on, acObject, spec) {
    const THREE = this.THREE
    for (let i = 0; i < 2; i++) {
      const l = this.landing[i]
      l.intensity = on ? 2200 : 0
      if (!on) continue
      const side = i === 0 ? -1 : 1
      const p = new THREE.Vector3(side * spec.span * 0.12, -spec.dia * 0.3, -spec.len * 0.30)
      const t = new THREE.Vector3(side * spec.span * 0.12, -spec.dia * 0.3 - 60, -spec.len * 0.30 - 400)
      l.position.copy(acObject.localToWorld(p))
      l.target.position.copy(acObject.localToWorld(t))
    }
  }

  render(camPos, camQ, fov) {
    const cam = this.camera
    cam.position.set(camPos.x, camPos.y, camPos.z)
    cam.quaternion.set(camQ.x, camQ.y, camQ.z, camQ.w)
    cam.fov = fov * 180 / Math.PI
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    this.sky.position.copy(cam.position)
    this.stars.position.copy(cam.position)
    this.csm.update()
    this.renderer.clear(true, true, true)
    this.composer.render()
  }

  dispose() {
    this.csm.dispose()
    this.renderer.dispose()
  }
}
