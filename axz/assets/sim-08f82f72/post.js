/* ==========================================================================
   AXZ sim — sky and post-processing.

   Two passes that between them do most of the work of "looking like a
   simulator rather than a diagram":

   SKY is a full-screen shader rather than a clear colour. A single flat blue
   cannot show a horizon, a sun, or the way the air whitens toward the ground,
   and those three things are what tell you which way is up when the terrain is
   out of frame.

   BLOOM is what makes a fireball look hot. Without it an explosion is orange
   paint; with it the bright core bleeds into its surroundings the way a real
   overexposed highlight does. It also does the runway lights and the sun a
   considerable favour. The scene is rendered to a texture, the bright parts
   are extracted and blurred at quarter resolution, and the result is added
   back under an ACES-style tone curve.

   Everything degrades: if a framebuffer will not allocate, `ok` goes false and
   the caller draws straight to the canvas with no sky quad and no bloom.
   ========================================================================== */

const FS_VERT = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

/* --- Sky ------------------------------------------------------------------
   Not a physical scattering model. It is a horizon-to-zenith ramp with a sun
   disc, a broad forward-scatter halo around it, and a ground haze band, all
   driven by the camera's own ray direction so it behaves correctly as you look
   around and as you climb. That is enough to read as sky, and it costs one
   quad.                                                                      */
const SKY_FRAG = `
precision highp float;
varying vec2 vUV;
uniform mat4 uInvVP;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uZenith, uHorizon, uGround;
uniform float uSunSize, uHaze;
void main() {
  // Unproject the pixel to a world-space ray.
  vec4 far = uInvVP * vec4(vUV * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);

  float up = dir.y;
  // Sky above, haze at the horizon, a dimmer band below it.
  float t = clamp(up * 1.35 + 0.10, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(t, 0.62));
  float below = clamp(-up * 3.0, 0.0, 1.0);
  col = mix(col, uGround, below * 0.85);

  // Forward scatter: the sky brightens broadly toward the sun.
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uHorizon * pow(sd, 5.0) * 0.55 * uHaze;
  col += vec3(1.0, 0.86, 0.66) * pow(sd, 220.0) * 0.9;

  // The disc itself, soft-edged so it does not alias into a hexagon.
  float disc = smoothstep(uSunSize, uSunSize * 0.35, acos(clamp(sd, -1.0, 1.0)));
  col += vec3(1.6, 1.45, 1.15) * disc;

  gl_FragColor = vec4(col, 1.0);
}`

const BRIGHT_FRAG = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(uTex, vUV).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee, so a highlight eases into the bloom instead of popping.
  float k = clamp((l - uThreshold) / max(uThreshold, 0.0001), 0.0, 1.0);
  gl_FragColor = vec4(c * k * k, 1.0);
}`

const BLUR_FRAG = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  // Nine-tap Gaussian, separable. Two passes give a 9x9 kernel for 18 taps.
  vec3 sum = texture2D(uTex, vUV).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += (texture2D(uTex, vUV + o1).rgb + texture2D(uTex, vUV - o1).rgb) * 0.3162162162;
  sum += (texture2D(uTex, vUV + o2).rgb + texture2D(uTex, vUV - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}`

const COMPOSITE_FRAG = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uScene, uBloom;
uniform float uBloomAmount, uExposure, uVignette, uShake;
vec3 aces(vec3 x) {
  // Narkowicz's ACES fit: a filmic shoulder that keeps a fireball from
  // clipping to a flat white disc.
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec2 uv = vUV;
  vec3 c = texture2D(uScene, uv).rgb;
  c += texture2D(uBloom, uv).rgb * uBloomAmount;
  c = aces(c * uExposure);
  float d = distance(uv, vec2(0.5));
  c *= 1.0 - uVignette * smoothstep(0.42, 0.95, d);
  gl_FragColor = vec4(c, 1.0);
}`

function compile(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('post shader: ' + gl.getShaderInfoLog(s))
  return s
}
function prog(gl, v, f) {
  const p = gl.createProgram()
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, v))
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, f))
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('post link: ' + gl.getProgramInfoLog(p))
  return p
}

function makeTarget(gl, w, h, depth) {
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fb = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  let rb = null
  if (depth) {
    rb = gl.createRenderbuffer()
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb)
    /* 24 bits where the context has them, which is every WebGL2 context. At 16
       the depth range this scene needs — a 3 m near plane and a 240 km far
       plane — resolves to about a third of a metre at 260 m and two metres at
       ten kilometres, and the runway sits six centimetres above the terrain.
       The strip therefore lost the depth test to the ground it is painted on:
       at every airport the aeroplane appeared to be parked in a field, and on
       final there was nothing to aim at. */
    const fmt = gl.DEPTH_COMPONENT24 || gl.DEPTH_COMPONENT16
    gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h)
    if (gl.getError && gl.getError() !== gl.NO_ERROR) {
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h)
    }
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb)
  }
  const okay = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  return okay ? { fb, tex, rb, w, h } : null
}

export class Post {
  constructor(gl) {
    this.gl = gl
    this.ok = false
    try {
      this.sky = prog(gl, FS_VERT, SKY_FRAG)
      this.bright = prog(gl, FS_VERT, BRIGHT_FRAG)
      this.blur = prog(gl, FS_VERT, BLUR_FRAG)
      this.comp = prog(gl, FS_VERT, COMPOSITE_FRAG)
      this.quad = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      this.ok = true
    } catch (e) {
      this.ok = false
      this.error = String(e)
    }
    this.scene = null
    this.pingA = null
    this.pingB = null
  }

  resize(w, h) {
    if (!this.ok) return
    if (this.scene && this.scene.w === w && this.scene.h === h) return
    const gl = this.gl
    for (const t of [this.scene, this.pingA, this.pingB]) {
      if (!t) continue
      gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb)
      if (t.rb) gl.deleteRenderbuffer(t.rb)
    }
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2)
    this.scene = makeTarget(gl, w, h, true)
    this.pingA = makeTarget(gl, bw, bh, false)
    this.pingB = makeTarget(gl, bw, bh, false)
    if (!this.scene || !this.pingA || !this.pingB) this.ok = false
  }

  bindScene() {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb)
    gl.viewport(0, 0, this.scene.w, this.scene.h)
  }

  drawQuad(p) {
    const gl = this.gl
    const loc = gl.getAttribLocation(p, 'aPos')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Paint the sky. Runs first, with depth writes off so it never occludes. */
  drawSky(invVP, camPos, sunDir, palette) {
    const gl = this.gl, p = this.sky
    gl.useProgram(p)
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)
    gl.uniformMatrix4fv(gl.getUniformLocation(p, 'uInvVP'), false, invVP)
    gl.uniform3f(gl.getUniformLocation(p, 'uCamPos'), camPos.x, camPos.y, camPos.z)
    gl.uniform3f(gl.getUniformLocation(p, 'uSunDir'), sunDir.x, sunDir.y, sunDir.z)
    gl.uniform3fv(gl.getUniformLocation(p, 'uZenith'), palette.zenith)
    gl.uniform3fv(gl.getUniformLocation(p, 'uHorizon'), palette.horizon)
    gl.uniform3fv(gl.getUniformLocation(p, 'uGround'), palette.ground)
    gl.uniform1f(gl.getUniformLocation(p, 'uSunSize'), palette.sunSize)
    gl.uniform1f(gl.getUniformLocation(p, 'uHaze'), palette.haze)
    this.drawQuad(p)
    gl.enable(gl.DEPTH_TEST)
    gl.depthMask(true)
  }

  /** Bright-pass, blur, and composite back to the canvas. */
  finish(canvasW, canvasH, { bloom = 0.9, exposure = 1.05, vignette = 0.22, threshold = 0.78 } = {}) {
    const gl = this.gl
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)

    // Bright pass into the quarter-res ping target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pingA.fb)
    gl.viewport(0, 0, this.pingA.w, this.pingA.h)
    gl.useProgram(this.bright)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex)
    gl.uniform1i(gl.getUniformLocation(this.bright, 'uTex'), 0)
    gl.uniform1f(gl.getUniformLocation(this.bright, 'uThreshold'), threshold)
    this.drawQuad(this.bright)

    // Two separable blur passes, ping-ponging.
    for (const [src, dst, dx, dy] of [
      [this.pingA, this.pingB, 1 / this.pingA.w, 0],
      [this.pingB, this.pingA, 0, 1 / this.pingA.h],
      [this.pingA, this.pingB, 2 / this.pingA.w, 0],
      [this.pingB, this.pingA, 0, 2 / this.pingA.h],
    ]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
      gl.viewport(0, 0, dst.w, dst.h)
      gl.useProgram(this.blur)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex)
      gl.uniform1i(gl.getUniformLocation(this.blur, 'uTex'), 0)
      gl.uniform2f(gl.getUniformLocation(this.blur, 'uDir'), dx, dy)
      this.drawQuad(this.blur)
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvasW, canvasH)
    gl.useProgram(this.comp)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.scene.tex)
    gl.uniform1i(gl.getUniformLocation(this.comp, 'uScene'), 0)
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.pingA.tex)
    gl.uniform1i(gl.getUniformLocation(this.comp, 'uBloom'), 1)
    gl.uniform1f(gl.getUniformLocation(this.comp, 'uBloomAmount'), bloom)
    gl.uniform1f(gl.getUniformLocation(this.comp, 'uExposure'), exposure)
    gl.uniform1f(gl.getUniformLocation(this.comp, 'uVignette'), vignette)
    this.drawQuad(this.comp)

    gl.activeTexture(gl.TEXTURE0)
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
  }
}
