/* ==========================================================================
   AXZ sim — directional shadow map.

   The single biggest thing missing from the picture. Without shadows an
   aeroplane does not sit in a landscape, it floats above one, and terrain
   relief reads only from the flat-shading facets. With them the wing puts a
   shadow on the ground on short final, hills shade their own east faces, and
   the scene acquires a light direction rather than just a brightness.

   One cascade, not four. This is a flight simulator: what needs a crisp shadow
   is the aeroplane and the ground immediately under it, and that is a box a
   few hundred metres across. Distant terrain gets its shading from the
   diffuse term, which at that range is indistinguishable. The box FOLLOWS the
   aircraft rather than the camera, because the camera can be a mile away in
   tower view while the interesting shadow is still under the wing.

   Depth goes into a real depth texture on WebGL2. On WebGL1 without the
   extension the whole pass reports unavailable and the renderer falls back to
   the unshadowed path, which is what it did before this file existed.
   ========================================================================== */

import { m4mul, vnorm, vcross, vadd, vscale } from './math.js'

const DEPTH_VERT = `
attribute vec3 aPos;
uniform mat4 uLightVP, uModel;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`

// Colour is irrelevant; only the depth buffer is read back.
const DEPTH_FRAG = `
precision mediump float;
void main() { gl_FragColor = vec4(1.0); }`

/** Orthographic projection, which is what a directional light casts through. */
function ortho(l, r, b, t, n, f) {
  return new Float32Array([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
  ])
}

/** A view matrix looking from `eye` along `dir`. */
function lookDir(eye, dir) {
  const f = vnorm(dir)
  const upHint = Math.abs(f.y) > 0.99 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 }
  const s = vnorm(vcross(f, upHint))
  const u = vcross(s, f)
  return new Float32Array([
    s.x, u.x, -f.x, 0,
    s.y, u.y, -f.y, 0,
    s.z, u.z, -f.z, 0,
    -(s.x * eye.x + s.y * eye.y + s.z * eye.z),
    -(u.x * eye.x + u.y * eye.y + u.z * eye.z),
    (f.x * eye.x + f.y * eye.y + f.z * eye.z),
    1,
  ])
}

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shadow shader: ' + gl.getShaderInfoLog(s))
  return s
}

export class ShadowMap {
  constructor(gl, size = 2048) {
    this.gl = gl
    this.size = size
    this.ok = false
    this.isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
    try {
      if (!this.isGL2 && !gl.getExtension('WEBGL_depth_texture')) return
      const p = gl.createProgram()
      gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, DEPTH_VERT))
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, DEPTH_FRAG))
      gl.linkProgram(p)
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return
      this.prog = p
      this.loc = {
        aPos: gl.getAttribLocation(p, 'aPos'),
        uLightVP: gl.getUniformLocation(p, 'uLightVP'),
        uModel: gl.getUniformLocation(p, 'uModel'),
      }

      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      const internal = this.isGL2 ? gl.DEPTH_COMPONENT24 : gl.DEPTH_COMPONENT
      const type = this.isGL2 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, size, size, 0, gl.DEPTH_COMPONENT, type, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      // Clamp to edge, and the shader treats anything outside the box as lit,
      // so the world beyond the cascade is never spuriously in shadow.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      const fb = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0)
      if (this.isGL2) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE) }
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      if (status !== gl.FRAMEBUFFER_COMPLETE) return

      this.tex = tex
      this.fb = fb
      this.lightVP = null
      this.ok = true
    } catch (e) {
      this.ok = false
      this.error = String(e)
    }
  }

  /**
   * Aim the cascade. `focus` is the point the box centres on, which is the
   * aeroplane, and `extent` is its half-width in metres.
   */
  aim(focus, sunDir, extent = 340) {
    // Back the light off far enough to clear any terrain between it and the
    // focus, or a hill behind you shadows the runway in front of you.
    const back = 3000
    const eye = vadd(focus, vscale(sunDir, back))
    const view = lookDir(eye, vscale(sunDir, -1))
    const proj = ortho(-extent, extent, -extent, extent, 1, back + extent * 2 + 1200)
    this.lightVP = m4mul(proj, view)
    return this.lightVP
  }

  begin() {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
    gl.viewport(0, 0, this.size, this.size)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.useProgram(this.prog)
    gl.uniformMatrix4fv(this.loc.uLightVP, false, this.lightVP)
    // Front-face culling during the depth pass pushes the recorded surface to
    // the BACK of each object, which removes most shadow acne without needing
    // a large constant bias that would detach the shadow from the wheels.
    gl.cullFace(gl.FRONT)
  }

  draw(mesh, model) {
    const gl = this.gl
    gl.uniformMatrix4fv(this.loc.uModel, false, model)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf)
    gl.enableVertexAttribArray(this.loc.aPos)
    gl.vertexAttribPointer(this.loc.aPos, 3, gl.FLOAT, false, 0, 0)
    gl.drawArrays(mesh.mode, 0, mesh.count)
  }

  end() {
    const gl = this.gl
    gl.cullFace(gl.BACK)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }
}
