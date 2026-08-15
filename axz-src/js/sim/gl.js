/* ==========================================================================
   AXZ sim — a small WebGL renderer, written rather than imported.

   Three.js would have done this. It is 750 KB for a scene that has no
   textures, no shadow maps, no glTF, no PBR and no post-processing — on a site
   whose fonts were subset from 17.7 MB down to 196 KB because unused bytes are
   not free. What this scene actually needs is a perspective camera, flat-shaded
   triangles, coloured lines and distance fog, which is the file below.

   Flat shading is deliberate, not a shortcut. The rest of this site is drawn
   with two line weights and no gradients; the simulator is the same drawing
   with a third axis, so terrain comes out faceted and banded by elevation
   rather than textured, and the wireframe over the near mesh is the same
   hairline grid the ledger pages use.
   ========================================================================== */

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uProj, uView, uModel;
uniform vec3 uLightDir;
uniform float uAmbient;
varying vec3 vColor;
varying float vFogDepth;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 eye = uView * world;
  gl_Position = uProj * eye;
  vFogDepth = -eye.z;
  // Normals: the model matrix carries rotation and a UNIFORM scale only, so
  // normalising the rotated normal is exact — no inverse-transpose needed.
  vec3 n = normalize((uModel * vec4(aNormal, 0.0)).xyz);
  float d = max(dot(n, uLightDir), 0.0);
  vColor = aColor * (uAmbient + (1.0 - uAmbient) * d);
}`

const FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vFogDepth;
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
void main() {
  float f = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(vColor, uFogColor, f), 1.0);
}`

// Lines carry their own colour and skip lighting entirely: a hairline that
// shaded with the surface under it would disappear on the lit side.
const LINE_VERT = `
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uProj, uView, uModel;
varying vec3 vColor;
varying float vFogDepth;
void main() {
  vec4 eye = uView * uModel * vec4(aPos, 1.0);
  gl_Position = uProj * eye;
  vFogDepth = -eye.z;
  vColor = aColor;
}`

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s))
  }
  return s
}

function program(gl, vsrc, fsrc) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vsrc))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fsrc))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p))
  }
  return p
}

/**
 * A drawable. `mesh.pos/normal/color` are plain arrays of floats; they are
 * uploaded once and then only the model matrix changes per frame.
 */
export class Mesh {
  constructor(gl, data, mode = gl.TRIANGLES) {
    this.gl = gl
    this.mode = mode
    this.count = data.pos.length / 3
    this.posBuf = gl.createBuffer()
    this.norBuf = gl.createBuffer()
    this.colBuf = gl.createBuffer()
    this.upload(data)
  }
  upload(data) {
    const gl = this.gl
    this.count = data.pos.length / 3
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.pos), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.norBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.normal || new Array(data.pos.length).fill(0)), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.color), gl.STATIC_DRAW)
  }
  dispose() {
    const gl = this.gl
    gl.deleteBuffer(this.posBuf); gl.deleteBuffer(this.norBuf); gl.deleteBuffer(this.colBuf)
  }
}

export class Renderer {
  constructor(canvas) {
    const opts = { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance' }
    const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts)
    if (!gl) throw new Error('no-webgl')
    this.gl = gl
    this.canvas = canvas

    this.solid = program(gl, VERT, FRAG)
    this.line = program(gl, LINE_VERT, FRAG)
    this.loc = {}
    for (const [name, p] of [['solid', this.solid], ['line', this.line]]) {
      this.loc[name] = {
        aPos: gl.getAttribLocation(p, 'aPos'),
        aNormal: gl.getAttribLocation(p, 'aNormal'),
        aColor: gl.getAttribLocation(p, 'aColor'),
        uProj: gl.getUniformLocation(p, 'uProj'),
        uView: gl.getUniformLocation(p, 'uView'),
        uModel: gl.getUniformLocation(p, 'uModel'),
        uLightDir: gl.getUniformLocation(p, 'uLightDir'),
        uAmbient: gl.getUniformLocation(p, 'uAmbient'),
        uFogColor: gl.getUniformLocation(p, 'uFogColor'),
        uFogNear: gl.getUniformLocation(p, 'uFogNear'),
        uFogFar: gl.getUniformLocation(p, 'uFogFar'),
      }
    }

    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    this.dpr = 1
  }

  resize(cssW, cssH, dprCap = 2) {
    // Capped device pixel ratio: at dpr 3 on a phone this is 9x the fragment
    // work for a scene whose whole look is flat colour, and the frame budget
    // is better spent on the physics staying at 240 Hz.
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap)
    this.dpr = dpr
    const w = Math.max(1, Math.round(cssW * dpr))
    const h = Math.max(1, Math.round(cssH * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.aspect = w / h
    this.gl.viewport(0, 0, w, h)
  }

  begin(sky) {
    const gl = this.gl
    gl.clearColor(sky[0], sky[1], sky[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  }

  /** Bind a program and the per-frame uniforms every draw in this pass shares. */
  use(kind, proj, view, env) {
    const gl = this.gl
    const p = kind === 'line' ? this.line : this.solid
    const L = this.loc[kind]
    gl.useProgram(p)
    gl.uniformMatrix4fv(L.uProj, false, proj)
    gl.uniformMatrix4fv(L.uView, false, view)
    if (L.uLightDir) gl.uniform3f(L.uLightDir, env.light.x, env.light.y, env.light.z)
    if (L.uAmbient) gl.uniform1f(L.uAmbient, env.ambient)
    gl.uniform3f(L.uFogColor, env.fog[0], env.fog[1], env.fog[2])
    gl.uniform1f(L.uFogNear, env.fogNear)
    gl.uniform1f(L.uFogFar, env.fogFar)
    this.current = { kind, L }
  }

  draw(mesh, model) {
    const gl = this.gl
    const L = this.current.L
    gl.uniformMatrix4fv(L.uModel, false, model)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf)
    gl.enableVertexAttribArray(L.aPos)
    gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 0, 0)
    if (L.aNormal >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.norBuf)
      gl.enableVertexAttribArray(L.aNormal)
      gl.vertexAttribPointer(L.aNormal, 3, gl.FLOAT, false, 0, 0)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.colBuf)
    gl.enableVertexAttribArray(L.aColor)
    gl.vertexAttribPointer(L.aColor, 3, gl.FLOAT, false, 0, 0)
    gl.drawArrays(mesh.mode, 0, mesh.count)
  }
}

/* --- Geometry helpers -----------------------------------------------------
   Everything is built as loose triangles with one normal per face. Sharing
   vertices between faces would average the normals and round off exactly the
   facets this look is made of.                                              */
export function makeBuilder() {
  const pos = [], normal = [], color = []
  const api = {
    pos, normal, color,
    tri(a, b, c, col) {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z
      const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l; ny /= l; nz /= l
      for (const p of [a, b, c]) {
        pos.push(p.x, p.y, p.z)
        normal.push(nx, ny, nz)
        color.push(col[0], col[1], col[2])
      }
      return api
    },
    quad(a, b, c, d, col) { api.tri(a, b, c, col); api.tri(a, c, d, col); return api },
    /** Both faces, for thin surfaces like a fin that is visible from either side. */
    quad2(a, b, c, d, col) { api.quad(a, b, c, d, col); api.quad(d, c, b, a, col); return api },
    build: () => ({ pos, normal, color }),
  }
  return api
}

export function makeLineBuilder() {
  const pos = [], color = []
  const api = {
    pos, color,
    seg(a, b, col) {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
      color.push(col[0], col[1], col[2], col[0], col[1], col[2])
      return api
    },
    build: () => ({ pos, color }),
  }
  return api
}

/** '#RRGGBB' -> [r,g,b] in 0..1, so the sim can be themed from the site tokens. */
export function hex(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}
export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
