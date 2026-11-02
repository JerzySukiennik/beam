// Beam: render pipeline. The game is drawn straight into projector pixels through the wall -> projector homography,
// bloomed (characters go on top unbloomed, so they stay readable), then shown as the HDMI image, as light falling
// on the room photo, and rectified in the wall editor. Each WebGL context (editor, projector window) has its own pipe.
// The room's QR card and the four photo markers are painted last, straight into projector pixels. While a phone takes
// its photo the rest of the image turns into flat grey light, so the wall is evenly lit and only the markers are colored.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import * as H from '../math/homography.js';
import * as P from '../math/poly.js';
import { PALETTES, rgb, LineBatch, lineMaterial, fillMaterial, luckyMaterial, screenMaterial, Particles, shapeGeometry, EFFECT_INDEX } from './neon.js';

const FSQ_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const OUT_FS = `
uniform sampler2D uGame; uniform vec2 uJ; uniform float uMode; uniform float uBright; uniform float uGrid; uniform float uWork;
uniform mat3 uHJW; uniform float uSJW; uniform vec2 uCal; uniform vec2 uC[4];
uniform sampler2D uQR; uniform vec4 uQRBox; uniform float uQROn; uniform float uMarkOn; uniform vec2 uM[4]; uniform float uMarkR;
varying vec2 vUv;
float band(float d, float w){ return 1.0 - smoothstep(w * 0.5, w * 0.5 + 1.0, d); }
vec3 cornerColor(int i){ return i == 0 ? vec3(0.1, 0.95, 1.0) : i == 1 ? vec3(1.0, 0.3, 0.95) : i == 2 ? vec3(1.0, 0.85, 0.15) : vec3(0.35, 1.0, 0.45); }
void main(){
  vec2 j = vec2(vUv.x * uJ.x, (1.0 - vUv.y) * uJ.y);
  vec3 g = max(texture2D(uGame, vUv).rgb, 0.0);
  vec3 c = pow(1.0 - exp(-g * 1.35), vec3(1.0 / 2.2));
  if (uMode > 1.5) c *= 0.55;
  c = 1.0 - (1.0 - c) * (1.0 - uWork);
  if (uMode > 0.5 && uMode < 1.5) {
    vec2 m = mod(j, 80.0);
    float grid = max(band(min(m.x, 80.0 - m.x), 1.5), band(min(m.y, 80.0 - m.y), 1.5));
    float edge = min(min(j.x, uJ.x - j.x), min(j.y, uJ.y - j.y));
    float border = 1.0 - smoothstep(5.0, 6.5, edge);
    vec2 d = abs(j - uJ * 0.5);
    float crs = max(band(d.x, 3.0) * step(d.y, 70.0), band(d.y, 3.0) * step(d.x, 70.0));
    float ring = band(abs(length(j - uJ * 0.5) - uJ.y * 0.3), 3.0);
    c = vec3(0.05) + vec3(0.5) * grid + vec3(1.0) * max(border, max(crs, ring));
    float s = uJ.y * 0.12;
    if (j.x < s && j.y < s) c = cornerColor(0);
    if (j.x > uJ.x - s && j.y < s) c = cornerColor(1);
    if (j.x > uJ.x - s && j.y > uJ.y - s) c = cornerColor(2);
    if (j.x < s && j.y > uJ.y - s) c = cornerColor(3);
  } else if (uMode > 1.5) {
    vec3 h = uHJW * vec3(j, 1.0);
    float ok = step(0.0, h.z * uSJW);
    vec2 w = h.xy / (abs(h.z) < 1e-9 ? 1e-9 : h.z);
    vec2 gw = w / 10.0;
    vec2 fw = fwidth(gw);
    vec2 gd = abs(fract(gw - 0.5) - 0.5) / max(fw, vec2(1e-6));
    float gl = (1.0 - min(min(gd.x, gd.y), 1.0)) * ok * uGrid * step(max(fw.x, fw.y), 0.35);
    c += vec3(0.2, 0.7, 1.0) * gl * 0.5;
    vec2 fr = max(fwidth(w), vec2(1e-6));
    float inX = step(-fr.x, w.x) * step(w.x, uCal.x + fr.x);
    float inY = step(-fr.y, w.y) * step(w.y, uCal.y + fr.y);
    float ex = min(abs(w.x), abs(w.x - uCal.x)) / fr.x;
    float ey = min(abs(w.y), abs(w.y - uCal.y)) / fr.y;
    float rect = max((1.0 - smoothstep(1.0, 2.2, ex)) * inY, (1.0 - smoothstep(1.0, 2.2, ey)) * inX) * ok;
    c = max(c, vec3(1.0, 0.95, 0.75) * rect);
    for (int i = 0; i < 4; i++) {
      vec2 d = j - uC[i];
      vec2 ad = abs(d);
      float arm = max(band(ad.x, 2.5) * step(ad.y, 30.0) * step(7.0, ad.y), band(ad.y, 2.5) * step(ad.x, 30.0) * step(7.0, ad.x));
      float ring = band(abs(length(d) - 16.0), 2.5);
      float dotc = 1.0 - smoothstep(2.0, 3.2, length(d));
      c = mix(c, cornerColor(i), max(max(arm, ring), dotc));
    }
  }
  if (uQROn > 0.5 && uMode < 0.5) {
    vec3 h = uHJW * vec3(j, 1.0);
    if (h.z * uSJW > 0.0) {
      vec2 q = (h.xy / h.z - uQRBox.xy) / (uQRBox.zw - uQRBox.xy);
      if (q.x >= 0.0 && q.x <= 1.0 && q.y >= 0.0 && q.y <= 1.0) c = texture2D(uQR, q).rgb;
    }
  }
  if (uMarkOn > 0.5) {
    c = vec3(0.42);
    for (int i = 0; i < 4; i++) {
      float r = length(j - uM[i]);
      c = mix(c, vec3(0.0), (1.0 - smoothstep(uMarkR * 1.3, uMarkR * 1.3 + 1.5, r)) * 0.9);
      float disk = 1.0 - smoothstep(uMarkR * 0.42, uMarkR * 0.42 + 1.5, r);
      float ring = band(abs(r - uMarkR), uMarkR * 0.16);
      c = mix(c, cornerColor(i), max(disk, ring));
    }
  }
  gl_FragColor = vec4(clamp(c * uBright, 0.0, 1.0), 1.0);
}`;

const ROOM_FS = `
uniform sampler2D uPhoto; uniform vec2 uPhotoSize; uniform float uHasPhoto;
uniform sampler2D uProj; uniform vec2 uJ;
uniform mat3 uHPJ; uniform float uSPJ;
uniform vec4 uFB; uniform vec3 uBg;
uniform float uAmbient; uniform float uGain; uniform float uBlack; uniform float uDirect;
void main(){
  vec2 px = vec2(uFB.x * gl_FragCoord.x + uFB.y, uFB.z * gl_FragCoord.y + uFB.w);
  vec2 pu = vec2(px.x / uPhotoSize.x, 1.0 - px.y / uPhotoSize.y);
  float inP = uHasPhoto * step(0.0, pu.x) * step(pu.x, 1.0) * step(0.0, pu.y) * step(pu.y, 1.0);
  vec3 alb = pow(texture2D(uPhoto, clamp(pu, 0.0, 1.0)).rgb, vec3(2.2));
  vec3 h = uHPJ * vec3(px, 1.0);
  float ok = step(0.0, h.z * uSPJ);
  vec2 j = h.xy / (abs(h.z) < 1e-9 ? 1e-9 : h.z);
  vec2 ju = vec2(j.x / uJ.x, 1.0 - j.y / uJ.y);
  float inJ = ok * step(0.0, ju.x) * step(ju.x, 1.0) * step(0.0, ju.y) * step(ju.y, 1.0);
  if (uDirect > 0.5) {
    gl_FragColor = vec4(mix(uBg, texture2D(uProj, clamp(ju, 0.0, 1.0)).rgb, inJ), 1.0);
    return;
  }
  vec3 L = pow(texture2D(uProj, clamp(ju, 0.0, 1.0)).rgb, vec3(2.2)) * inJ;
  vec3 lit = alb * (uAmbient + L * uGain + inJ * uBlack) + L * 0.035;
  vec3 c = pow(max(lit, 0.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(mix(uBg, c, inP), 1.0);
}`;

const EDIT_FS = `
uniform sampler2D uPhoto; uniform vec2 uPhotoSize; uniform float uHasPhoto;
uniform sampler2D uProj; uniform vec2 uJ;
uniform mat3 uHWP; uniform float uSWP;
uniform mat3 uHWJ; uniform float uSWJ;
uniform vec4 uFB; uniform vec3 uBg; uniform float uGrid; uniform float uDim;
void main(){
  vec2 w = vec2(uFB.x * gl_FragCoord.x + uFB.y, uFB.z * gl_FragCoord.y + uFB.w);
  vec3 hp = uHWP * vec3(w, 1.0);
  float okp = step(0.0, hp.z * uSWP) * uHasPhoto;
  vec2 p = hp.xy / (abs(hp.z) < 1e-9 ? 1e-9 : hp.z);
  vec2 pu = vec2(p.x / uPhotoSize.x, 1.0 - p.y / uPhotoSize.y);
  float inP = okp * step(0.0, pu.x) * step(pu.x, 1.0) * step(0.0, pu.y) * step(pu.y, 1.0);
  vec3 photo = texture2D(uPhoto, clamp(pu, 0.0, 1.0)).rgb;
  vec3 hj = uHWJ * vec3(w, 1.0);
  float okj = step(0.0, hj.z * uSWJ);
  vec2 j = hj.xy / (abs(hj.z) < 1e-9 ? 1e-9 : hj.z);
  vec2 ju = vec2(j.x / uJ.x, 1.0 - j.y / uJ.y);
  float inJ = okj * step(0.0, ju.x) * step(ju.x, 1.0) * step(0.0, ju.y) * step(ju.y, 1.0);
  vec3 proj = texture2D(uProj, clamp(ju, 0.0, 1.0)).rgb * inJ;
  vec3 c = mix(uBg, photo * mix(0.3, uDim, inJ), inP);
  c = 1.0 - (1.0 - c) * (1.0 - proj);
  vec2 g = w / 10.0;
  vec2 fg = max(fwidth(g), vec2(1e-6));
  vec2 dg = abs(fract(g - 0.5) - 0.5) / fg;
  float l10 = (1.0 - min(min(dg.x, dg.y), 1.0)) * (1.0 - smoothstep(0.25, 0.5, max(fg.x, fg.y)));
  vec2 f1 = max(fwidth(w), vec2(1e-6));
  vec2 d1 = abs(fract(w - 0.5) - 0.5) / f1;
  float l1 = (1.0 - min(min(d1.x, d1.y), 1.0)) * (1.0 - smoothstep(0.08, 0.2, max(f1.x, f1.y)));
  vec2 d0 = abs(w) / f1;
  float axis = 1.0 - min(min(d0.x, d0.y), 1.0);
  c += vec3(0.42, 0.55, 0.75) * (l10 * 0.13 + l1 * 0.045 + axis * 0.1) * uGrid;
  gl_FragColor = vec4(c, 1.0);
}`;

const INSET_FS = `uniform sampler2D uProj; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(uProj, vUv).rgb, 1.0); }`;

function fsScene(material) {
  const s = new THREE.Scene();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  m.frustumCulled = false;
  s.add(m);
  return s;
}

function fsMaterial(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: FSQ_VS, fragmentShader, depthTest: false, depthWrite: false });
}

function dim(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }

const UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];

export function shapeQuad(s) {
  if (s.quad && s.quad.length === 4) return s.quad;
  const b = P.bbox(s.geom);
  return [[b.x0, b.y1], [b.x1, b.y1], [b.x1, b.y0], [b.x0, b.y0]];
}

export class Renderer {
  constructor(canvas) {
    THREE.ColorManagement.enabled = false;
    const gl = this.makeGL(canvas, Math.min(window.devicePixelRatio || 1, 1.5));
    this.gl = gl;
    this.jw = 1280;
    this.jh = 720;
    this.bg = new THREE.Color(0.027, 0.031, 0.043);
    this.pal = PALETTES.cyber;
    this.onAsync = null;
    this._v2 = new THREE.Vector2();

    this.camera = new THREE.Camera();
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.fsCam = new THREE.Camera();

    this.game = new THREE.Scene();
    this.maskScene = new THREE.Scene();
    this.shapeGroup = new THREE.Group();
    this.game.add(this.shapeGroup);
    this.lineMat = lineMaterial();
    this.staticLines = new LineBatch(this.lineMat, 2048);
    this.dynLines = new LineBatch(this.lineMat, 4096);
    this.staticLines.mesh.renderOrder = 3;
    this.dynLines.mesh.renderOrder = 4;
    this.particles = new Particles(3000);
    this.particles.points.renderOrder = 5;
    this.game.add(this.staticLines.mesh, this.dynLines.mesh, this.particles.points);
    this.figLines = new LineBatch(this.lineMat, 1024);
    this.figScene = new THREE.Scene();
    this.figScene.add(this.figLines.mesh);
    this.timed = [this.lineMat];
    this.lucky = new Map();
    this.textures = new Map();

    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blank.needsUpdate = true;

    this.main = this.makePipe(gl);

    this.rtJ = new THREE.WebGLRenderTarget(this.jw, this.jh, {
      depthBuffer: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
    });
    this.rtJ.texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());

    const J = () => new THREE.Vector2(this.jw, this.jh);
    this.outMat = fsMaterial(OUT_FS, {
      uGame: { value: null }, uJ: { value: J() }, uMode: { value: 0 }, uBright: { value: 1 }, uGrid: { value: 1 }, uWork: { value: 0 },
      uHJW: { value: new THREE.Matrix3() }, uSJW: { value: 1 }, uCal: { value: new THREE.Vector2(100, 70) },
      uC: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
      uQR: { value: this.blank }, uQRBox: { value: new THREE.Vector4(0, 0, 1, 1) }, uQROn: { value: 0 },
      uMarkOn: { value: 0 }, uMarkR: { value: 30 },
      uM: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    });
    this.roomMat = fsMaterial(ROOM_FS, {
      uPhoto: { value: this.blank }, uPhotoSize: { value: new THREE.Vector2(1, 1) }, uHasPhoto: { value: 0 },
      uProj: { value: this.rtJ.texture }, uJ: { value: J() },
      uHPJ: { value: new THREE.Matrix3() }, uSPJ: { value: 1 },
      uFB: { value: new THREE.Vector4() }, uBg: { value: this.bg },
      uAmbient: { value: 0.36 }, uGain: { value: 1.15 }, uBlack: { value: 0.025 }, uDirect: { value: 0 },
    });
    this.editMat = fsMaterial(EDIT_FS, {
      uPhoto: { value: this.blank }, uPhotoSize: { value: new THREE.Vector2(1, 1) }, uHasPhoto: { value: 0 },
      uProj: { value: this.rtJ.texture }, uJ: { value: J() },
      uHWP: { value: new THREE.Matrix3() }, uSWP: { value: 1 },
      uHWJ: { value: new THREE.Matrix3() }, uSWJ: { value: 1 },
      uFB: { value: new THREE.Vector4() }, uBg: { value: this.bg }, uGrid: { value: 1 }, uDim: { value: 0.5 },
    });
    this.insetMat = fsMaterial(INSET_FS, { uProj: { value: this.rtJ.texture } });
    this.outScene = fsScene(this.outMat);
    this.roomScene = fsScene(this.roomMat);
    this.editScene = fsScene(this.editMat);
    this.insetScene = fsScene(this.insetMat);
  }

  makeGL(canvas, ratio) {
    const gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    gl.autoClear = false;
    gl.setPixelRatio(ratio);
    return gl;
  }

  makePipe(gl) {
    const composer = new EffectComposer(gl, new THREE.WebGLRenderTarget(this.jw, this.jh, { type: THREE.HalfFloatType, depthBuffer: false }));
    composer.renderToScreen = false;
    composer.setPixelRatio(1);
    composer.addPass(new RenderPass(this.game, this.camera, null, new THREE.Color(0, 0, 0), 1));
    const bloom = new UnrealBloomPass(new THREE.Vector2(this.jw, this.jh), 0.85, 0, 0.22);
    bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.72, 0.32, 0.08, 0.015];
    composer.addPass(bloom);
    composer.setSize(this.jw, this.jh);
    return { gl, composer, bloom, w: this.jw, h: this.jh };
  }

  resize(w, h) {
    this.gl.setSize(Math.max(1, w), Math.max(1, h), false);
  }

  setDirect(on) {
    this.roomMat.uniforms.uDirect.value = on ? 1 : 0;
  }

  setQr(canvas) {
    if (this.qrTex) this.qrTex.dispose();
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.NoColorSpace;
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    this.qrTex = t;
    this.outMat.uniforms.uQR.value = t;
  }

  setPhoto(img) {
    if (this.photo) this.photo.dispose();
    this.photo = null;
    let size = [1, 1];
    if (img) {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.NoColorSpace;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = Math.min(8, this.gl.capabilities.getMaxAnisotropy());
      t.needsUpdate = true;
      this.photo = t;
      size = [img.naturalWidth || img.width, img.naturalHeight || img.height];
    }
    for (const m of [this.roomMat, this.editMat]) {
      m.uniforms.uPhoto.value = this.photo || this.blank;
      m.uniforms.uHasPhoto.value = this.photo ? 1 : 0;
      m.uniforms.uPhotoSize.value.set(size[0], size[1]);
    }
  }

  setProjector(jw, jh) {
    if (jw === this.jw && jh === this.jh) return;
    this.jw = jw;
    this.jh = jh;
    this.rtJ.setSize(jw, jh);
    for (const m of [this.outMat, this.roomMat, this.editMat]) m.uniforms.uJ.value.set(jw, jh);
  }

  setSpace(space, state) {
    this.setProjector(state.proj.jw, state.proj.jh);
    if (!space.ok) return;
    const s = space.sWJ;
    const m = space.HWJ.map(v => v * s);
    const jw = this.jw, jh = this.jh;
    this.camera.projectionMatrix.set(
      2 * m[0] / jw - m[6], 2 * m[1] / jw - m[7], 0, 2 * m[2] / jw - m[8],
      m[6] - 2 * m[3] / jh, m[7] - 2 * m[4] / jh, 0, m[8] - 2 * m[5] / jh,
      0, 0, 0, 0,
      m[6], m[7], 0, m[8]);
    const ru = this.roomMat.uniforms, eu = this.editMat.uniforms, ou = this.outMat.uniforms;
    H.toMat3(THREE, space.HPJ, ru.uHPJ.value);
    ru.uSPJ.value = space.sPJ;
    H.toMat3(THREE, space.HWP, eu.uHWP.value);
    eu.uSWP.value = space.sWP;
    H.toMat3(THREE, space.HWJ, eu.uHWJ.value);
    eu.uSWJ.value = space.sWJ;
    H.toMat3(THREE, space.HJW, ou.uHJW.value);
    ou.uSJW.value = space.sJW;
    ou.uCal.value.set(state.calibCm.w, state.calibCm.h);
    state.calibJ.forEach((p, i) => ou.uC.value[i].set(p[0], p[1]));
    this.particles.mat.uniforms.uPx.value = space.pxPerCm();
  }

  texture(url) {
    if (this.textures.has(url)) return this.textures.get(url);
    const t = new THREE.Texture();
    t.colorSpace = THREE.NoColorSpace;
    t.flipY = false;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    const img = new Image();
    img.onload = () => { t.image = img; t.needsUpdate = true; t.userData.ready = true; this.onAsync && this.onAsync(); };
    img.src = url;
    this.textures.set(url, t);
    return t;
  }

  mapQuad(mat, s) {
    const q = shapeQuad(s);
    const hq = H.solve(UNIT, q);
    H.toMat3(THREE, H.inv(hq), mat.uniforms.uHinv.value);
    if (mat.uniforms.uAspect) {
      const wTop = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), wBot = Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1]);
      const hL = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]), hR = Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]);
      mat.uniforms.uAspect.value = (wTop + wBot) / Math.max(1e-6, hL + hR);
    }
  }

  rebuild(state) {
    const pal = PALETTES[state.settings.palette] || PALETTES.cyber;
    this.pal = pal;
    const rainbow = pal.rainbow ? 1 : 0;
    this.lineMat.uniforms.uRainbow.value = rainbow;
    for (const g of [this.shapeGroup, this.maskScene]) {
      for (const ch of [...g.children]) {
        ch.geometry.dispose();
        ch.material.dispose();
        g.remove(ch);
      }
    }
    this.timed = [this.lineMat];
    this.lucky.clear();
    const L = this.staticLines;
    L.begin();
    state.shapes.forEach((s, i) => {
      if (!s.geom || !s.geom.length) return;
      const ph = i * 1.37 + 0.5;
      const col = rgb(pal[s.type] || pal.solid);
      if (s.type === 'mask') {
        const m = new THREE.Mesh(shapeGeometry(s.geom), new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, depthWrite: false }));
        m.frustumCulled = false;
        this.maskScene.add(m);
        return;
      }
      let mat, order = 0;
      if (s.type === 'screen') {
        mat = screenMaterial(col);
        this.mapQuad(mat, s);
        mat.uniforms.uEffect.value = EFFECT_INDEX[s.props.effect] ?? 0;
        const tex = s.props.effect === 'obraz' && s.props.image ? this.texture(s.props.image) : null;
        mat.uniforms.uTex.value = tex || this.blank;
        mat.uniforms.uHasTex.value = tex ? 1 : 0;
        if (tex && !tex.userData.ready) mat.uniforms.uHasTex.value = 0;
        order = 1;
      } else if (s.type === 'lucky') {
        mat = luckyMaterial(col, ph);
        this.mapQuad(mat, s);
        mat.uniforms.uRainbow.value = rainbow;
        order = 2;
      } else {
        mat = fillMaterial(s.type, col, P.bbox(s.geom).y1, ph);
        mat.uniforms.uRainbow.value = rainbow;
        if (s.type === 'platform') mat.uniforms.uAlpha.value = 0.55;
      }
      const mesh = new THREE.Mesh(shapeGeometry(s.geom), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      this.shapeGroup.add(mesh);
      this.timed.push(mat);
      if (s.type === 'lucky') this.lucky.set(s.id, { mat, mesh });
      this.outline(L, s, col, ph);
    });
    L.end();
  }

  outline(L, s, col, ph) {
    const rings = (w, g, c = col, kind = 0) => {
      for (const poly of s.geom) for (const r of poly) L.poly(r, true, c, w, g, ph, kind);
    };
    const chains = (list, w, g, c = col, kind = 0) => {
      for (const ch of list) L.poly(ch.pts, ch.closed, c, w, g, ph, kind);
    };
    switch (s.type) {
      case 'platform':
        rings(0.2, 0.7, dim(col, 0.55), 1);
        chains(P.facingChains(s.geom, 1, 0.35), 0.42, 1.9);
        break;
      case 'water':
        chains(P.chainsWhere(s.geom, (nx, ny) => ny < 0.35), 0.3, 1.2);
        break;
      case 'lava': rings(0.36, 2.0); break;
      case 'ice': rings(0.3, 1.5); break;
      case 'bounce': rings(0.46, 2.0); break;
      case 'lucky': rings(0.32, 1.5); break;
      case 'screen': rings(0.26, 1.0); break;
      default: rings(0.36, 1.6);
    }
  }

  setLucky(id, used, flash, bump) {
    const l = this.lucky.get(id);
    if (!l) return;
    l.mat.uniforms.uUsed.value = used ? 1 : 0;
    l.mat.uniforms.uHit.value = flash;
    l.mesh.position.y = bump;
  }

  prepare(o) {
    for (const m of this.timed) m.uniforms.uTime.value = o.time;
    this.dynLines.begin();
    this.figLines.begin();
    if (o.draw) o.draw(this.dynLines, this.particles, this.pal, this.figLines);
    this.dynLines.end();
    this.figLines.end();
  }

  renderJ(pipe, o, target) {
    const gl = pipe.gl;
    if (pipe.w !== this.jw || pipe.h !== this.jh) {
      pipe.composer.setSize(this.jw, this.jh);
      pipe.w = this.jw;
      pipe.h = this.jh;
    }
    this.dynLines.touch();
    this.figLines.touch();
    this.particles.touch();
    pipe.composer.render(0);
    gl.setRenderTarget(pipe.composer.readBuffer);
    if (this.figLines.n) gl.render(this.figScene, this.camera);
    if (this.maskScene.children.length) gl.render(this.maskScene, this.camera);
    const u = this.outMat.uniforms;
    u.uGame.value = pipe.composer.readBuffer.texture;
    u.uMode.value = o.mode || 0;
    u.uBright.value = o.bright ?? 1;
    u.uGrid.value = o.calibGrid ? 1 : 0;
    u.uWork.value = o.work || 0;
    u.uQROn.value = o.qr && this.qrTex ? 1 : 0;
    if (o.qr) u.uQRBox.value.set(o.qr.x0, o.qr.y0, o.qr.x1, o.qr.y1);
    u.uMarkOn.value = o.marks ? 1 : 0;
    if (o.marks) {
      o.marks.forEach((p, i) => u.uM.value[i].set(p[0], p[1]));
      u.uMarkR.value = Math.min(this.jw, this.jh) * 0.045;
    }
    gl.setRenderTarget(target);
    gl.render(this.outScene, this.fsCam);
  }

  renderMain(views, o) {
    this.renderJ(this.main, o, this.rtJ);
    this.drawPanes(views, o);
  }

  render(views, o) {
    this.prepare(o);
    this.renderMain(views, o);
  }

  drawPanes(views, o) {
    const gl = this.gl;
    gl.setRenderTarget(null);
    gl.setScissorTest(false);
    gl.setViewport(0, 0, views.w, views.h);
    gl.setClearColor(this.bg, 1);
    gl.clear(true, false, false);
    const dpr = gl.getPixelRatio();
    const hfb = gl.getDrawingBufferSize(this._v2).y;
    const set = r => {
      const y = views.h - r.y - r.h;
      gl.setViewport(r.x, y, r.w, r.h);
      gl.setScissor(r.x, y, r.w, r.h);
    };
    gl.setScissorTest(true);
    if (views.room.on) {
      const u = this.roomMat.uniforms;
      u.uFB.value.fromArray(views.fbAffine(views.room, dpr, hfb));
      u.uAmbient.value = o.ambient ?? 0.36;
      u.uGain.value = o.gain ?? 1.15;
      set(views.room);
      gl.render(this.roomScene, this.fsCam);
    }
    if (views.editor.on) {
      const u = this.editMat.uniforms;
      u.uFB.value.fromArray(views.fbAffine(views.editor, dpr, hfb));
      u.uGrid.value = o.editorGrid ? 1 : 0;
      set(views.editor);
      gl.render(this.editScene, this.fsCam);
    }
    if (views.room.on && views.inset.on && o.inset) {
      set(views.inset);
      gl.render(this.insetScene, this.fsCam);
    }
    gl.setScissorTest(false);
  }
}
