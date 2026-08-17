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
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vFogDepth;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 eye = uView * world;
  gl_Position = uProj * eye;
  vFogDepth = -eye.z;
  vWorld = world.xyz;
  // The model matrix carries rotation and a UNIFORM scale only, so normalising
  // the rotated normal is exact; no inverse-transpose needed.
  vNormal = normalize((uModel * vec4(aNormal, 0.0)).xyz);
  vColor = aColor;
}`

/* Lighting moved into the fragment stage so it can take a shadow lookup and a
   specular term per pixel. Doing it per vertex, as the first version did, put
   the highlight at the corners of the facets and made the shadow edge follow
   the triangulation. */
const FRAG = `
precision highp float;
varying vec3 vColor;
varying vec3 vNormal;
varying vec3 vWorld;
varying float vFogDepth;
uniform vec3 uLightDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform float uAmbient;
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
uniform vec3 uCamPos;
uniform float uSpecular, uShininess;
uniform mat4 uLightVP, uLightVP2;
uniform sampler2D uShadow, uShadow2;
uniform float uShadowOn, uShadowTexel, uShadowTexel2;

bool inBox(vec3 p) {
  return p.x > 0.005 && p.x < 0.995 && p.y > 0.005 && p.y < 0.995 && p.z < 1.0;
}

/* Two cascades. The near one is tight around the aeroplane, where a crisp
   wing shadow matters; the far one is an order of magnitude wider and picks up
   hills, the length of the runway and the city, which the near box cannot
   reach. Sampling the near one first and only falling through to the far one
   outside it means each pixel costs one lookup, not two. */
float sampleMap(sampler2D map, vec3 p, float texel, float bias) {
  float lit = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * texel;
      float d = texture2D(map, p.xy + o).r;
      lit += (p.z - bias > d) ? 0.0 : 1.0;
    }
  }
  return lit / 9.0;
}

float shadowFactor() {
  if (uShadowOn < 0.5) return 1.0;
  // Slope-scaled bias: a surface edge-on to the light needs far more than one
  // facing it, and a single constant bias either acnes or peters.
  float ndl = max(dot(normalize(vNormal), uLightDir), 0.0);
  float slope = tan(acos(clamp(ndl, 0.0, 1.0)));

  vec4 lp = uLightVP * vec4(vWorld, 1.0);
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (inBox(p)) return sampleMap(uShadow, p, uShadowTexel, clamp(0.0016 * slope, 0.0004, 0.006));

  vec4 lp2 = uLightVP2 * vec4(vWorld, 1.0);
  vec3 p2 = lp2.xyz / lp2.w * 0.5 + 0.5;
  // A wider box spreads the same depth range over more world, so it needs a
  // proportionally larger bias or the whole distance acnes.
  if (inBox(p2)) return sampleMap(uShadow2, p2, uShadowTexel2, clamp(0.0042 * slope, 0.0016, 0.020));

  return 1.0;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCamPos - vWorld);
  vec3 base = vColor;

  /* Water. Identified geometrically rather than by a material flag: the sea is
     the only thing in this world that is flat, level and exactly at zero, and
     land starts twenty metres up. Cheaper than an extra vertex attribute and
     it cannot fall out of sync with the terrain builder. */
  float water = (abs(vWorld.y) < 0.25 && n.y > 0.98) ? 1.0 : 0.0;
  float spec = uSpecular;
  float shine = uShininess;
  if (water > 0.5) {
    // Ripple the normal so the glint breaks up instead of being a mirror disc.
    float w = sin(vWorld.x * 0.021 + vWorld.z * 0.013) * 0.5
            + sin(vWorld.x * 0.007 - vWorld.z * 0.031) * 0.5;
    n = normalize(n + vec3(w * 0.035, 0.0, w * 0.028));
    // Fresnel: water seen edge-on reflects the sky, water seen from above is
    // dark. This one term is most of what makes it read as a liquid.
    float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 4.0);
    base = mix(base, uSkyColor, clamp(fres, 0.0, 0.82));
    spec = 1.5;
    shine = 190.0;
  }

  float ndl = max(dot(n, uLightDir), 0.0);
  float sh = shadowFactor();
  // A hemisphere ambient rather than a flat constant: surfaces facing up catch
  // sky light, surfaces facing down do not, which keeps the shaded sides from
  // going uniformly grey.
  vec3 amb = mix(uFogColor * 0.55, uSkyColor, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * uAmbient;
  /* Diffuse is NOT scaled down by the ambient. Splitting the budget between
     them capped a fully sunlit surface at 1.0 before tone mapping, and after
     the ACES shoulder that landed as a mid grey: the aeroplane came out the
     colour of the runway. Let the sum run above 1 and let the tone curve do
     what it is for. */
  vec3 col = base * (amb + uSunColor * ndl * sh);

  if (spec > 0.001) {
    vec3 h = normalize(uLightDir + v);
    float s = pow(max(dot(n, h), 0.0), shine) * spec * sh;
    col += uSunColor * s;
  }

  float fog = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
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

/* Lines need their own fragment stage. They shared the surface one until the
   surface shader grew normals, a world position and a shadow lookup, none of
   which a line emits — and a program whose fragment varyings do not all exist
   in its vertex shader fails to LINK, which took the whole simulator down. */
const LINE_FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vFogDepth;
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
void main() {
  float f = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(vColor, uFogColor, f), 1.0);
}`

/* --- Billboards -----------------------------------------------------------
   Clouds, smoke, tyre puffs, contrails and trees are all the same primitive: a
   textured quad that turns to face the camera. Doing that by offsetting the
   corners in EYE space, after the view transform, is what makes it face the
   camera for free — no per-sprite matrix, no CPU-side rotation, and the whole
   frame's worth of sprites goes up as one buffer.

   Depth is tested but not written (see Renderer.sprites), so overlapping soft
   particles blend instead of punching holes in one another.               */
const SPRITE_VERT = `
attribute vec3 aCenter;
attribute vec2 aOffset;
attribute vec2 aUV;
attribute vec4 aColor;
attribute float aSize;
uniform mat4 uProj, uView;
varying vec2 vUV;
varying vec4 vColor;
varying float vFogDepth;
void main() {
  vec4 eye = uView * vec4(aCenter, 1.0);
  eye.xy += aOffset * aSize;
  vFogDepth = -eye.z;
  gl_Position = uProj * eye;
  vUV = aUV;
  vColor = aColor;
}`

const SPRITE_FRAG = `
precision mediump float;
varying vec2 vUV;
varying vec4 vColor;
varying float vFogDepth;
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
void main() {
  vec4 t = texture2D(uTex, vUV);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  float f = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  // Fog pulls a sprite toward the haze colour AND fades it out, so a distant
  // cloud dissolves into the sky rather than hanging in it as a grey disc.
  vec3 c = mix(t.rgb * vColor.rgb, uFogColor, f);
  gl_FragColor = vec4(c, a * (1.0 - f * 0.85));
}`

/* --- Textured mesh --------------------------------------------------------
   For decals that ride ON the aeroplane rather than facing the camera: the
   wordmark, the fin mark, the window strip. Same model matrix as the airframe,
   so they bank with it.                                                     */
const DECAL_VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uProj, uView, uModel;
uniform vec3 uLightDir;
uniform float uAmbient;
varying vec2 vUV;
varying float vShade;
varying float vFogDepth;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 eye = uView * world;
  gl_Position = uProj * eye;
  vFogDepth = -eye.z;
  vec3 n = normalize((uModel * vec4(aNormal, 0.0)).xyz);
  vShade = uAmbient + (1.0 - uAmbient) * max(dot(n, uLightDir), 0.0);
  vUV = aUV;
}`

const DECAL_FRAG = `
precision mediump float;
varying vec2 vUV;
varying float vShade;
varying float vFogDepth;
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
void main() {
  vec4 t = texture2D(uTex, vUV);
  if (t.a < 0.02) discard;
  float f = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(t.rgb * vShade, uFogColor, f), t.a);
}`

/* --- Ghost ----------------------------------------------------------------
   A translucent shell, unlit, whose opacity comes from the VIEWING ANGLE.

   This exists for the shock cone, and the angle term is the whole reason it
   works. A cone of condensation is a thin shell of vapour: looking straight
   through the face of it you are seeing through a few centimetres and it is
   nearly invisible, while at the edge, where the line of sight runs along the
   shell, you are looking through metres of it and it is opaque white. That is
   why a real vapour cone reads as a bright RIM with a clear middle, and it is
   why a plain translucent cone looks like a plastic bag instead.

   The term is the standard grazing-angle one: 1 - |N·V|, raised to a power to
   tighten the rim. Nothing here is lit, because condensation in front of an
   aeroplane is scattering daylight from every direction at once.            */
const GHOST_VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uProj, uView, uModel;
uniform vec3 uCamPos;
varying vec3 vNormal;
varying vec3 vView;
varying float vFogDepth;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vec4 eye = uView * world;
  gl_Position = uProj * eye;
  vFogDepth = -eye.z;
  vNormal = normalize((uModel * vec4(aNormal, 0.0)).xyz);
  vView = normalize(uCamPos - world.xyz);
}`

const GHOST_FRAG = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vView;
varying float vFogDepth;
uniform vec3 uColor;
uniform float uAlpha, uRim;
uniform vec3 uFogColor;
uniform float uFogNear, uFogFar;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, uRim);
  float a = uAlpha * rim;
  if (a < 0.004) discard;
  float f = clamp((vFogDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(uColor, uFogColor, f), a);
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
    if (data.uv) this.uvBuf = gl.createBuffer()
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
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.color || new Array(data.pos.length).fill(1)), gl.STATIC_DRAW)
    if (data.uv) {
      if (!this.uvBuf) this.uvBuf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.uv), gl.STATIC_DRAW)
    }
  }
  dispose() {
    const gl = this.gl
    gl.deleteBuffer(this.posBuf); gl.deleteBuffer(this.norBuf); gl.deleteBuffer(this.colBuf)
    if (this.uvBuf) gl.deleteBuffer(this.uvBuf)
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
    this.line = program(gl, LINE_VERT, LINE_FRAG)
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
        uSunColor: gl.getUniformLocation(p, 'uSunColor'),
        uSkyColor: gl.getUniformLocation(p, 'uSkyColor'),
        uCamPos: gl.getUniformLocation(p, 'uCamPos'),
        uSpecular: gl.getUniformLocation(p, 'uSpecular'),
        uShininess: gl.getUniformLocation(p, 'uShininess'),
        uLightVP: gl.getUniformLocation(p, 'uLightVP'),
        uShadow: gl.getUniformLocation(p, 'uShadow'),
        uShadowOn: gl.getUniformLocation(p, 'uShadowOn'),
        uShadowTexel: gl.getUniformLocation(p, 'uShadowTexel'),
        uLightVP2: gl.getUniformLocation(p, 'uLightVP2'),
        uShadow2: gl.getUniformLocation(p, 'uShadow2'),
        uShadowTexel2: gl.getUniformLocation(p, 'uShadowTexel2'),
      }
    }

    // The sprite pipeline: one program, one growable buffer, rebuilt each
    // frame from whatever wants to be a billboard this frame.
    this.sprite = program(gl, SPRITE_VERT, SPRITE_FRAG)
    this.sloc = {
      aCenter: gl.getAttribLocation(this.sprite, 'aCenter'),
      aOffset: gl.getAttribLocation(this.sprite, 'aOffset'),
      aUV: gl.getAttribLocation(this.sprite, 'aUV'),
      aColor: gl.getAttribLocation(this.sprite, 'aColor'),
      aSize: gl.getAttribLocation(this.sprite, 'aSize'),
      uProj: gl.getUniformLocation(this.sprite, 'uProj'),
      uView: gl.getUniformLocation(this.sprite, 'uView'),
      uTex: gl.getUniformLocation(this.sprite, 'uTex'),
      uFogColor: gl.getUniformLocation(this.sprite, 'uFogColor'),
      uFogNear: gl.getUniformLocation(this.sprite, 'uFogNear'),
      uFogFar: gl.getUniformLocation(this.sprite, 'uFogFar'),
    }
    this.spriteBuf = gl.createBuffer()
    this.spriteData = new Float32Array(0)

    this.decal = program(gl, DECAL_VERT, DECAL_FRAG)
    this.dloc = {
      aPos: gl.getAttribLocation(this.decal, 'aPos'),
      aNormal: gl.getAttribLocation(this.decal, 'aNormal'),
      aUV: gl.getAttribLocation(this.decal, 'aUV'),
      uProj: gl.getUniformLocation(this.decal, 'uProj'),
      uView: gl.getUniformLocation(this.decal, 'uView'),
      uModel: gl.getUniformLocation(this.decal, 'uModel'),
      uLightDir: gl.getUniformLocation(this.decal, 'uLightDir'),
      uAmbient: gl.getUniformLocation(this.decal, 'uAmbient'),
      uTex: gl.getUniformLocation(this.decal, 'uTex'),
      uFogColor: gl.getUniformLocation(this.decal, 'uFogColor'),
      uFogNear: gl.getUniformLocation(this.decal, 'uFogNear'),
      uFogFar: gl.getUniformLocation(this.decal, 'uFogFar'),
    }

    this.ghostProg = program(gl, GHOST_VERT, GHOST_FRAG)
    this.gloc = {
      aPos: gl.getAttribLocation(this.ghostProg, 'aPos'),
      aNormal: gl.getAttribLocation(this.ghostProg, 'aNormal'),
      uProj: gl.getUniformLocation(this.ghostProg, 'uProj'),
      uView: gl.getUniformLocation(this.ghostProg, 'uView'),
      uModel: gl.getUniformLocation(this.ghostProg, 'uModel'),
      uCamPos: gl.getUniformLocation(this.ghostProg, 'uCamPos'),
      uColor: gl.getUniformLocation(this.ghostProg, 'uColor'),
      uAlpha: gl.getUniformLocation(this.ghostProg, 'uAlpha'),
      uRim: gl.getUniformLocation(this.ghostProg, 'uRim'),
      uFogColor: gl.getUniformLocation(this.ghostProg, 'uFogColor'),
      uFogNear: gl.getUniformLocation(this.ghostProg, 'uFogNear'),
      uFogFar: gl.getUniformLocation(this.ghostProg, 'uFogFar'),
    }

    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    this.dpr = 1
  }

  /**
   * Draw a UV-mapped mesh with a texture, using a model matrix.
   * `mesh` here carries a `uvBuf` as well as pos/normal.
   */
  textured(mesh, model, tex, proj, view, env) {
    const gl = this.gl, L = this.dloc
    gl.useProgram(this.decal)
    gl.uniformMatrix4fv(L.uProj, false, proj)
    gl.uniformMatrix4fv(L.uView, false, view)
    gl.uniformMatrix4fv(L.uModel, false, model)
    gl.uniform3f(L.uLightDir, env.light.x, env.light.y, env.light.z)
    gl.uniform1f(L.uAmbient, env.ambient)
    gl.uniform3f(L.uFogColor, env.fog[0], env.fog[1], env.fog[2])
    gl.uniform1f(L.uFogNear, env.fogNear)
    gl.uniform1f(L.uFogFar, env.fogFar)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(L.uTex, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf)
    gl.enableVertexAttribArray(L.aPos); gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.norBuf)
    gl.enableVertexAttribArray(L.aNormal); gl.vertexAttribPointer(L.aNormal, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuf)
    gl.enableVertexAttribArray(L.aUV); gl.vertexAttribPointer(L.aUV, 2, gl.FLOAT, false, 0, 0)

    gl.enable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
    gl.enable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.disableVertexAttribArray(L.aUV)
  }

  /**
   * Draw a translucent shell. Depth-tested against the scene but not written
   * to, and drawn from both sides, so the far wall of the cone shows through
   * the near one the way a real shell of vapour does.
   */
  ghost(mesh, model, proj, view, env, { color = [1, 1, 1], alpha = 0.5, rim = 2.2 } = {}) {
    const gl = this.gl, L = this.gloc
    gl.useProgram(this.ghostProg)
    gl.uniformMatrix4fv(L.uProj, false, proj)
    gl.uniformMatrix4fv(L.uView, false, view)
    gl.uniformMatrix4fv(L.uModel, false, model)
    gl.uniform3f(L.uCamPos, env.camPos.x, env.camPos.y, env.camPos.z)
    gl.uniform3f(L.uColor, color[0], color[1], color[2])
    gl.uniform1f(L.uAlpha, alpha)
    gl.uniform1f(L.uRim, rim)
    gl.uniform3f(L.uFogColor, env.fog[0], env.fog[1], env.fog[2])
    gl.uniform1f(L.uFogNear, env.fogNear)
    gl.uniform1f(L.uFogFar, env.fogFar)

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf)
    gl.enableVertexAttribArray(L.aPos); gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.norBuf)
    gl.enableVertexAttribArray(L.aNormal); gl.vertexAttribPointer(L.aNormal, 3, gl.FLOAT, false, 0, 0)

    gl.enable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.depthMask(false)
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
    gl.depthMask(true)
    gl.enable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
  }

  /** Upload a canvas as a texture. Everything here is drawn, not downloaded. */
  texture(canvas, { mipmap = true } = {}) {
    const gl = this.gl
    const t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    if (mipmap) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    }
    return t
  }

  /**
   * Draw a batch of billboards.
   * `list` items: { x,y,z, size, r,g,b,a, u0,v0,u1,v1 }
   * Sorted back-to-front by the caller when it matters.
   */
  sprites(list, tex, proj, view, env, { depthWrite = false } = {}) {
    if (!list.length) return
    const gl = this.gl
    const L = this.sloc
    const FLOATS = 12                     // center3 + offset2 + uv2 + color4 + size1
    const need = list.length * 6 * FLOATS
    if (this.spriteData.length < need) this.spriteData = new Float32Array(need * 2)
    const d = this.spriteData
    let o = 0
    // Two triangles per sprite. Corner offsets are in eye-space metres, scaled
    // by aSize in the shader, so one quad definition serves every sprite.
    const C = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]
    for (let i = 0; i < list.length; i++) {
      const s = list[i]
      const u0 = s.u0 === undefined ? 0 : s.u0, v0 = s.v0 === undefined ? 0 : s.v0
      const u1 = s.u1 === undefined ? 1 : s.u1, v1 = s.v1 === undefined ? 1 : s.v1
      for (let k = 0; k < 6; k++) {
        const cx = C[k][0], cy = C[k][1]
        d[o++] = s.x; d[o++] = s.y; d[o++] = s.z
        d[o++] = cx; d[o++] = cy
        d[o++] = cx < 0 ? u0 : u1
        d[o++] = cy < 0 ? v1 : v0
        d[o++] = s.r; d[o++] = s.g; d[o++] = s.b; d[o++] = s.a
        d[o++] = s.size
      }
    }
    gl.useProgram(this.sprite)
    gl.uniformMatrix4fv(L.uProj, false, proj)
    gl.uniformMatrix4fv(L.uView, false, view)
    gl.uniform3f(L.uFogColor, env.fog[0], env.fog[1], env.fog[2])
    gl.uniform1f(L.uFogNear, env.fogNear)
    gl.uniform1f(L.uFogFar, env.fogFar)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(L.uTex, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, this.spriteBuf)
    gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, o), gl.DYNAMIC_DRAW)
    const S = FLOATS * 4
    gl.enableVertexAttribArray(L.aCenter); gl.vertexAttribPointer(L.aCenter, 3, gl.FLOAT, false, S, 0)
    gl.enableVertexAttribArray(L.aOffset); gl.vertexAttribPointer(L.aOffset, 2, gl.FLOAT, false, S, 12)
    gl.enableVertexAttribArray(L.aUV); gl.vertexAttribPointer(L.aUV, 2, gl.FLOAT, false, S, 20)
    gl.enableVertexAttribArray(L.aColor); gl.vertexAttribPointer(L.aColor, 4, gl.FLOAT, false, S, 28)
    gl.enableVertexAttribArray(L.aSize); gl.vertexAttribPointer(L.aSize, 1, gl.FLOAT, false, S, 44)

    gl.enable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.depthMask(depthWrite)
    gl.drawArrays(gl.TRIANGLES, 0, list.length * 6)
    gl.depthMask(true)
    gl.enable(gl.CULL_FACE)
    gl.disable(gl.BLEND)

    gl.disableVertexAttribArray(L.aCenter); gl.disableVertexAttribArray(L.aOffset)
    gl.disableVertexAttribArray(L.aUV); gl.disableVertexAttribArray(L.aColor)
    gl.disableVertexAttribArray(L.aSize)
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
    if (L.uSunColor) {
      const sc = env.sun || [1.0, 0.97, 0.90]
      const sk = env.skyTint || env.fog
      gl.uniform3f(L.uSunColor, sc[0], sc[1], sc[2])
      gl.uniform3f(L.uSkyColor, sk[0], sk[1], sk[2])
      gl.uniform3f(L.uCamPos, env.camPos.x, env.camPos.y, env.camPos.z)
      // Material defaults to matte; setMaterial raises it for the airframe.
      gl.uniform1f(L.uSpecular, 0.0)
      gl.uniform1f(L.uShininess, 24)
      const sm = env.shadow
      gl.uniform1f(L.uShadowOn, sm && sm.ok ? 1 : 0)
      if (sm && sm.ok) {
        gl.uniformMatrix4fv(L.uLightVP, false, sm.lightVP)
        gl.uniform1f(L.uShadowTexel, 1 / sm.size)
        // Unit 3: units 0-1 belong to the sprite and composite passes, and a
        // shadow map that shared one of them would be unbound mid-frame.
        gl.activeTexture(gl.TEXTURE3)
        gl.bindTexture(gl.TEXTURE_2D, sm.tex)
        gl.uniform1i(L.uShadow, 3)
        const far = env.shadowFar
        gl.uniformMatrix4fv(L.uLightVP2, false, (far && far.ok ? far : sm).lightVP)
        gl.uniform1f(L.uShadowTexel2, 1 / ((far && far.ok ? far : sm).size))
        gl.activeTexture(gl.TEXTURE4)
        gl.bindTexture(gl.TEXTURE_2D, (far && far.ok ? far : sm).tex)
        gl.uniform1i(L.uShadow2, 4)
        gl.activeTexture(gl.TEXTURE0)
      }
    }
    this.current = { kind, L }
  }

  /** Specular for the next draws. Terrain is matte; an airframe is not. */
  setMaterial(specular, shininess) {
    const L = this.current && this.current.L
    if (!L || !L.uSpecular) return
    this.gl.uniform1f(L.uSpecular, specular)
    this.gl.uniform1f(L.uShininess, shininess)
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
