// Beam: neon look. Capsule line batches, type fills, lucky blocks, screens and particles in wall space.

import * as THREE from 'three';

export const PALETTES = {
  cyber: {
    name: 'Cyber', solid: '#19f0ff', platform: '#ff3df2', water: '#2f86ff', lava: '#ff7a1c', ice: '#c8f7ff',
    bounce: '#ff4fd8', lucky: '#ffd23d', screen: '#9d7bff', grass: '#3dff9a', snow: '#e9f6ff', vine: '#46ff7a',
    coin: '#ffd23d', goal: '#5dffb0', players: ['#ffffff', '#ffe14d', '#5dffb0', '#ff7ad9'],
  },
  lod: {
    name: 'Biały lód', solid: '#eaf7ff', platform: '#8fd2ff', water: '#4aa8ff', lava: '#ffb347', ice: '#ffffff',
    bounce: '#c6a8ff', lucky: '#fff1a8', screen: '#bcd7ff', grass: '#b6ffe0', snow: '#ffffff', vine: '#b6ffe0',
    coin: '#fff1a8', goal: '#b6ffe0', players: ['#ffffff', '#8fd2ff', '#ffe9a8', '#d6b8ff'],
  },
  ogien: {
    name: 'Ogień', solid: '#ff9d2e', platform: '#ffd166', water: '#3dd6ff', lava: '#ff5a14', ice: '#ffe7c2',
    bounce: '#ffcf3d', lucky: '#fff07a', screen: '#ffb46b', grass: '#ffd166', snow: '#fff2dc', vine: '#ffae3d',
    coin: '#fff07a', goal: '#3dd6ff', players: ['#ffffff', '#3dd6ff', '#fff07a', '#ff9de0'],
  },
  kwas: {
    name: 'Kwas', solid: '#9dff3d', platform: '#c83dff', water: '#3dffd0', lava: '#ffcf3d', ice: '#e3ffd1',
    bounce: '#ff3dd7', lucky: '#ffef3d', screen: '#7d6bff', grass: '#9dff3d', snow: '#efffe3', vine: '#9dff3d',
    coin: '#ffef3d', goal: '#3dffd0', players: ['#ffffff', '#ff3dd7', '#3dffd0', '#ffef3d'],
  },
  tecza: {
    name: 'Tęcza', rainbow: true, solid: '#19f0ff', platform: '#ff3df2', water: '#2f86ff', lava: '#ff7a1c', ice: '#c8f7ff',
    bounce: '#ff4fd8', lucky: '#ffd23d', screen: '#9d7bff', grass: '#3dff9a', snow: '#e9f6ff', vine: '#46ff7a',
    coin: '#ffd23d', goal: '#5dffb0', players: ['#ffffff', '#ffe14d', '#5dffb0', '#ff7ad9'],
  },
};

export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const GLSL_COMMON = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
vec3 hsv2rgb(vec3 c){ vec3 p = abs(fract(c.xxx + vec3(0., 2./3., 1./3.)) * 6. - 3.); return c.z * mix(vec3(1.), clamp(p - 1., 0., 1.), c.y); }
float sdSeg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0., 1.); return length(pa - ba * h); }
`;

const LINE_VS = `
attribute vec2 aA; attribute vec2 aB; attribute vec2 aCorner; attribute vec3 aColor; attribute vec4 aParams;
varying vec2 vP; varying vec2 vA; varying vec2 vB; varying vec3 vColor; varying vec4 vParams;
void main(){
  vec2 d = aB - aA; float L = length(d);
  vec2 t = L > 1e-5 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float R = aParams.x + aParams.y;
  vec2 base = aCorner.x < 0.0 ? aA - t * R : aB + t * R;
  vec2 p = base + n * aCorner.y * R;
  vP = p; vA = aA; vB = aB; vColor = aColor; vParams = aParams;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
}`;

const LINE_FS = `
uniform float uTime; uniform float uRainbow; uniform float uBright;
varying vec2 vP; varying vec2 vA; varying vec2 vB; varying vec3 vColor; varying vec4 vParams;
${GLSL_COMMON}
void main(){
  float w = vParams.x, g = vParams.y, ph = vParams.z, kind = vParams.w;
  float d = sdSeg(vP, vA, vB);
  float core = 1.0 - smoothstep(w * 0.45, w, d);
  float glow = exp(-pow(max(d - w * 0.25, 0.0) / (g * 0.42 + 1e-4), 2.0));
  vec3 col = vColor;
  if (uRainbow > 0.5 && kind < 2.5) col = hsv2rgb(vec3(fract(ph * 0.137 + uTime * 0.05 + vP.x * 0.002), 0.8, 1.0));
  float k = 1.0;
  if (kind > 0.5 && kind < 1.5) {
    vec2 ab = vB - vA; float L = length(ab);
    float along = L > 1e-5 ? dot(vP - vA, ab / L) : 0.0;
    float m = fract(along / 3.0 - uTime * 0.6);
    k = m < 0.55 ? 1.0 : 0.22;
  }
  float pulse = 1.0 + 0.10 * sin(uTime * 2.6 + ph * 1.7);
  vec3 c = col * (core * 1.5 + glow * 0.6) * pulse * k + vec3(1.0) * core * 0.4 * k;
  if (kind > 3.5) c *= 0.55;
  gl_FragColor = vec4(c * uBright, 1.0);
}`;

export function lineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uRainbow: { value: 0 }, uBright: { value: 1 } },
    vertexShader: LINE_VS,
    fragmentShader: LINE_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
}

export class LineBatch {
  constructor(mat, cap = 1024) {
    this.cap = 0;
    this.n = 0;
    this.geo = new THREE.BufferGeometry();
    this.mat = mat || lineMaterial();
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.ensure(cap);
  }

  ensure(n) {
    if (n <= this.cap) return;
    const cap = Math.max(n, this.cap * 2, 256);
    const old = this.cap ? { a: this.a, b: this.b, c: this.c, p: this.p } : null;
    this.a = new Float32Array(cap * 8);
    this.b = new Float32Array(cap * 8);
    this.c = new Float32Array(cap * 12);
    this.p = new Float32Array(cap * 16);
    const corner = new Float32Array(cap * 8);
    const idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      corner.set([-1, -1, 1, -1, 1, 1, -1, 1], i * 8);
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    if (old) { this.a.set(old.a); this.b.set(old.b); this.c.set(old.c); this.p.set(old.p); this.geo.dispose(); }
    const mk = (arr, size) => { const at = new THREE.BufferAttribute(arr, size); at.setUsage(THREE.DynamicDrawUsage); return at; };
    this.geo.setAttribute('aA', mk(this.a, 2));
    this.geo.setAttribute('aB', mk(this.b, 2));
    this.geo.setAttribute('aColor', mk(this.c, 3));
    this.geo.setAttribute('aParams', mk(this.p, 4));
    this.geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 12), 3));
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.cap = cap;
  }

  begin() { this.n = 0; }

  seg(ax, ay, bx, by, col, w, g, ph = 0, kind = 0) {
    if (this.n >= this.cap) this.ensure(this.n + 1);
    const i = this.n++;
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      this.a[v * 2] = ax; this.a[v * 2 + 1] = ay;
      this.b[v * 2] = bx; this.b[v * 2 + 1] = by;
      this.c[v * 3] = col[0]; this.c[v * 3 + 1] = col[1]; this.c[v * 3 + 2] = col[2];
      this.p[v * 4] = w; this.p[v * 4 + 1] = g; this.p[v * 4 + 2] = ph; this.p[v * 4 + 3] = kind;
    }
  }

  poly(pts, closed, col, w, g, ph = 0, kind = 0) {
    const n = pts.length;
    if (n < 2) return;
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      this.seg(a[0], a[1], b[0], b[1], col, w, g, ph, kind);
    }
  }

  circle(cx, cy, r, col, w, g, ph = 0, segs = 18, kind = 3) {
    let px = cx + r, py = cy;
    for (let i = 1; i <= segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      const x = cx + Math.cos(t) * r, y = cy + Math.sin(t) * r;
      this.seg(px, py, x, y, col, w, g, ph, kind);
      px = x; py = y;
    }
  }

  dot(x, y, r, col, g, ph = 0, kind = 3) {
    this.seg(x, y, x, y, col, r, g, ph, kind);
  }

  end() {
    this.touch();
    for (const name of ['aA', 'aB', 'aColor', 'aParams']) this.geo.getAttribute(name).needsUpdate = true;
    this.geo.setDrawRange(0, this.n * 6);
  }

  touch() {
    for (const name of ['aA', 'aB', 'aColor', 'aParams']) {
      const at = this.geo.getAttribute(name);
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * 4 * at.itemSize);
    }
  }
}

const FILL_VS = `
varying vec2 vW;
void main(){ vW = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FILL_FS = `
uniform vec3 uColor; uniform float uTime; uniform float uType; uniform float uTop; uniform float uAlpha; uniform float uRainbow; uniform float uPhase;
varying vec2 vW;
${GLSL_COMMON}
void main(){
  vec3 col = uColor;
  if (uRainbow > 0.5 && uType < 1.5) col = hsv2rgb(vec3(fract(uPhase * 0.137 + uTime * 0.05), 0.75, 1.0));
  vec3 c = vec3(0.0);
  if (uType < 0.5) {
    float scan = 0.5 + 0.5 * sin(vW.y * 2.2 - uTime * 1.6);
    c = col * (0.035 + 0.025 * scan) * uAlpha;
  } else if (uType < 2.5) {
    float depth = max(uTop - vW.y, 0.0);
    float cau = pow(abs(sin(vW.x * 0.33 + sin(vW.y * 0.27 + uTime * 1.2) * 1.8 + uTime * 0.8) * sin(vW.y * 0.29 - uTime * 0.7 + sin(vW.x * 0.21) * 1.5)), 5.0);
    c = col * (0.10 + 0.32 * exp(-depth * 0.06)) + col * cau * 0.45 + vec3(0.6, 0.8, 1.0) * cau * 0.08;
  } else if (uType < 3.5) {
    float n = fbm(vW * 0.11 + vec2(0.0, -uTime * 0.35));
    float m = fbm(vW * 0.23 + vec2(uTime * 0.15, -uTime * 0.6));
    float h = smoothstep(0.25, 0.85, n * 0.7 + m * 0.5);
    c = mix(vec3(0.9, 0.18, 0.02), vec3(1.0, 0.8, 0.25), h) * (0.45 + 0.75 * h);
    float depth = max(uTop - vW.y, 0.0);
    c *= 0.7 + 0.5 * exp(-depth * 0.08);
  } else if (uType < 4.5) {
    vec2 cell = floor(vW * 1.3);
    float s = step(0.985, hash12(cell)) * (0.5 + 0.5 * sin(uTime * 4.0 + hash12(cell + 7.0) * 40.0));
    c = col * 0.06 + vec3(1.0) * s * 0.9;
  } else {
    float v = fract(vW.y * 0.22 - uTime * 0.9 + abs(fract(vW.x * 0.11) - 0.5) * 0.9);
    float chev = smoothstep(0.0, 0.08, v) * (1.0 - smoothstep(0.18, 0.26, v));
    c = col * (0.05 + chev * 0.28);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

export const FILL_TYPE = { solid: 0, water: 2, lava: 3, ice: 4, bounce: 5 };

export function fillMaterial(type, color, top, phase) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) },
      uTime: { value: 0 },
      uType: { value: FILL_TYPE[type] ?? 0 },
      uTop: { value: top },
      uAlpha: { value: 1 },
      uRainbow: { value: 0 },
      uPhase: { value: phase || 0 },
    },
    vertexShader: FILL_VS,
    fragmentShader: FILL_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

const MAPPED_VS = `
varying vec2 vW;
void main(){ vW = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const LUCKY_FS = `
uniform vec3 uColor; uniform float uTime; uniform float uUsed; uniform float uHit; uniform mat3 uHinv; uniform float uRainbow; uniform float uPhase;
varying vec2 vW;
${GLSL_COMMON}
void main(){
  vec3 h = uHinv * vec3(vW, 1.0);
  vec2 q = h.xy / h.z;
  q.y = 1.0 - q.y;
  vec3 col = uColor;
  if (uRainbow > 0.5) col = hsv2rgb(vec3(fract(uPhase * 0.137 + uTime * 0.05), 0.75, 1.0));
  float edge = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
  float border = 1.0 - smoothstep(0.035, 0.07, edge);
  float inner = 1.0 - smoothstep(0.12, 0.14, edge);
  float rivets = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 rp = vec2(i == 0 || i == 3 ? 0.14 : 0.86, i < 2 ? 0.14 : 0.86);
    rivets += 1.0 - smoothstep(0.025, 0.04, length(q - rp));
  }
  vec2 p = q;
  vec2 c = vec2(0.5, 0.63);
  float r = 0.15;
  float ang = atan(p.y - c.y, p.x - c.x);
  float ring = abs(length(p - c) - r);
  float arc = (ang > -1.5708 || ang < -3.0) ? ring : min(length(p - vec2(0.35, 0.63)), length(p - vec2(0.5, 0.48)));
  if (ang < -1.5708 && ang > -3.0) arc = min(length(p - (c + vec2(-r, 0.0))), length(p - (c + vec2(0.0, -r))));
  float stem = sdSeg(p, vec2(0.5, 0.48), vec2(0.5, 0.37));
  float dotq = length(p - vec2(0.5, 0.25)) - 0.035;
  float glyph = min(min(arc - 0.045, stem - 0.045), dotq);
  float gl = 1.0 - smoothstep(0.0, 0.02, glyph);
  float pulse = 0.75 + 0.25 * sin(uTime * 4.0);
  vec3 outc;
  if (uUsed > 0.5) {
    outc = col * (border * 0.35 + 0.03) + vec3(0.4) * rivets * 0.25;
  } else {
    outc = col * (border * 1.6 + 0.13 + inner * 0.05) + vec3(1.0, 0.95, 0.8) * gl * (1.2 * pulse) + col * rivets * 0.8;
    outc += vec3(1.0) * uHit * 0.8;
  }
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) outc = vec3(0.0);
  gl_FragColor = vec4(outc, 1.0);
}`;

export function luckyMaterial(color, phase) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) }, uTime: { value: 0 }, uUsed: { value: 0 }, uHit: { value: 0 },
      uHinv: { value: new THREE.Matrix3() }, uRainbow: { value: 0 }, uPhase: { value: phase || 0 },
    },
    vertexShader: MAPPED_VS,
    fragmentShader: LUCKY_FS,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export const EFFECTS = {
  plazma: 'Plazma',
  tunel: 'Tunel',
  kosmos: 'Kosmos',
  ogien: 'Ogień',
  fale: 'Fale',
  ramka: 'Sama ramka',
  obraz: 'Obraz z dysku',
};

const SCREEN_FS = `
uniform vec3 uColor; uniform float uTime; uniform float uEffect; uniform mat3 uHinv; uniform sampler2D uTex; uniform float uHasTex; uniform float uAspect;
varying vec2 vW;
${GLSL_COMMON}
vec3 plazma(vec2 q, float t){
  float v = sin(q.x * 9.0 + t) + sin((q.y * 7.0 + t * 1.3)) + sin((q.x + q.y) * 6.0 + t * 0.7) + sin(length(q - 0.5) * 14.0 - t * 2.0);
  float band = 0.5 + 0.5 * sin(v * 2.2);
  return hsv2rgb(vec3(fract(v * 0.12 + t * 0.05), 0.9, 1.0)) * (0.06 + 0.6 * band * band);
}
vec3 tunel(vec2 q, float t){
  vec2 p = (q - 0.5) * vec2(uAspect, 1.0);
  float r = length(p), a = atan(p.y, p.x);
  float z = 0.25 / max(r, 0.02) + t * 1.4;
  float rings = smoothstep(0.42, 0.5, abs(fract(z) - 0.5) * 2.0);
  float spokes = smoothstep(0.9, 1.0, abs(sin(a * 6.0 + t)));
  vec3 c = uColor * (rings * 1.3 + spokes * 0.25) * smoothstep(0.0, 0.25, r);
  return c + vec3(1.0) * pow(max(0.0, 1.0 - r * 4.0), 3.0) * 0.6;
}
vec3 kosmos(vec2 q, float t){
  vec2 p = (q - 0.5) * vec2(uAspect, 1.0);
  vec3 c = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float s = 18.0 + float(i) * 22.0;
    vec2 g = p * s + vec2(0.0, t * (0.6 + float(i) * 0.5));
    vec2 id = floor(g), f = fract(g) - 0.5;
    float h = hash12(id + float(i) * 13.0);
    float star = step(0.88, h) * (1.0 - smoothstep(0.0, 0.08 + h * 0.06, length(f)));
    c += vec3(0.8, 0.9, 1.0) * star * (0.5 + 0.5 * sin(t * 3.0 + h * 50.0));
  }
  vec2 pc = p - vec2(0.18 * uAspect, 0.12);
  float planet = 1.0 - smoothstep(0.17, 0.18, length(pc));
  float ringP = 1.0 - smoothstep(0.004, 0.012, abs(length(pc * vec2(1.0, 3.2)) - 0.3));
  c += uColor * planet * (0.25 + 0.5 * fbm(pc * 9.0 + t * 0.05)) + uColor * ringP * 0.8;
  vec2 rk = p - vec2(-0.2 * uAspect + sin(t * 0.4) * 0.05, -0.05 + fract(t * 0.08) * 0.8 - 0.4);
  float body = 1.0 - smoothstep(0.0, 0.006, max(abs(rk.x) - 0.018, abs(rk.y) - 0.06));
  float nose = 1.0 - smoothstep(0.0, 0.006, length(rk - vec2(0.0, 0.065)) - 0.018);
  float flame = (1.0 - smoothstep(0.0, 0.05, length((rk - vec2(0.0, -0.09)) * vec2(2.6, 1.0)))) * (0.7 + 0.3 * sin(t * 30.0));
  c += vec3(1.0) * (body + nose) + vec3(1.0, 0.6, 0.15) * flame * 1.4;
  return c;
}
vec3 ogien(vec2 q, float t){
  vec2 p = q;
  float n = fbm(vec2(p.x * 4.0, p.y * 3.0 - t * 1.6));
  float h = clamp((1.0 - p.y) * 1.25 - n * 0.75 + 0.15, 0.0, 1.0);
  h = pow(h, 1.6);
  return mix(vec3(0.8, 0.12, 0.02), vec3(1.0, 0.85, 0.35), h) * h * 1.4;
}
vec3 fale(vec2 q, float t){
  vec2 p = (q - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);
  float w = abs(sin(r * 26.0 - t * 3.0));
  return uColor * pow(w, 18.0) * (1.0 - smoothstep(0.3, 0.75, r)) * 1.4;
}
void main(){
  vec3 h = uHinv * vec3(vW, 1.0);
  vec2 q = h.xy / h.z;
  q.y = 1.0 - q.y;
  if (q.x < -0.001 || q.x > 1.001 || q.y < -0.001 || q.y > 1.001) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 c;
  float e = uEffect;
  if (e < 0.5) c = plazma(q, uTime);
  else if (e < 1.5) c = tunel(q, uTime);
  else if (e < 2.5) c = kosmos(q, uTime);
  else if (e < 3.5) c = ogien(q, uTime);
  else if (e < 4.5) c = fale(q, uTime);
  else if (e < 5.5) c = vec3(0.0);
  else c = uHasTex > 0.5 ? texture2D(uTex, vec2(q.x, 1.0 - q.y)).rgb : plazma(q, uTime) * 0.3;
  float edge = min(min(q.x, 1.0 - q.x), min(q.y, 1.0 - q.y));
  float border = 1.0 - smoothstep(0.008, 0.02, edge);
  c += uColor * border * 1.2;
  gl_FragColor = vec4(c, 1.0);
}`;

export const EFFECT_INDEX = { plazma: 0, tunel: 1, kosmos: 2, ogien: 3, fale: 4, ramka: 5, obraz: 6 };

export function screenMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Vector3(...color) }, uTime: { value: 0 }, uEffect: { value: 0 },
      uHinv: { value: new THREE.Matrix3() }, uTex: { value: null }, uHasTex: { value: 0 }, uAspect: { value: 1 },
    },
    vertexShader: MAPPED_VS,
    fragmentShader: SCREEN_FS,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

const PT_VS = `
attribute vec3 aColor; attribute float aSize;
uniform float uPx;
varying vec3 vC;
void main(){ vC = aColor; gl_PointSize = max(1.5, aSize * uPx); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const PT_FS = `
varying vec3 vC;
void main(){ float r = length(gl_PointCoord - 0.5); float a = 1.0 - smoothstep(0.1, 0.5, r); gl_FragColor = vec4(vC * a * 1.5, 1.0); }`;

export class Particles {
  constructor(max = 2400) {
    this.max = max;
    this.n = 0;
    this.x = new Float32Array(max); this.y = new Float32Array(max);
    this.vx = new Float32Array(max); this.vy = new Float32Array(max);
    this.life = new Float32Array(max); this.ttl = new Float32Array(max);
    this.size = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    this.pos = new Float32Array(max * 3);
    this.outCol = new Float32Array(max * 3);
    this.outSize = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    const mk = (a, s) => { const at = new THREE.BufferAttribute(a, s); at.setUsage(THREE.DynamicDrawUsage); return at; };
    this.geo.setAttribute('position', mk(this.pos, 3));
    this.geo.setAttribute('aColor', mk(this.outCol, 3));
    this.geo.setAttribute('aSize', mk(this.outSize, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 4 } },
      vertexShader: PT_VS,
      fragmentShader: PT_FS,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
  }

  emit(x, y, count, o = {}) {
    const col = o.color || [1, 1, 1];
    for (let k = 0; k < count; k++) {
      if (this.n >= this.max) return;
      const i = this.n++;
      const ang = (o.angle ?? Math.PI / 2) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const sp = (o.speed ?? 30) * (0.35 + Math.random() * 0.65);
      this.x[i] = x + (Math.random() - 0.5) * (o.jitter ?? 0);
      this.y[i] = y + (Math.random() - 0.5) * (o.jitter ?? 0);
      this.vx[i] = Math.cos(ang) * sp + (o.vx ?? 0);
      this.vy[i] = Math.sin(ang) * sp + (o.vy ?? 0);
      this.ttl[i] = (o.life ?? 0.8) * (0.6 + Math.random() * 0.6);
      this.life[i] = this.ttl[i];
      this.size[i] = (o.size ?? 0.8) * (0.6 + Math.random() * 0.8);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      const j = o.hueJitter ?? 0;
      this.col[i * 3] = Math.min(1, col[0] + (Math.random() - 0.5) * j);
      this.col[i * 3 + 1] = Math.min(1, col[1] + (Math.random() - 0.5) * j);
      this.col[i * 3 + 2] = Math.min(1, col[2] + (Math.random() - 0.5) * j);
    }
  }

  update(dt) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i] - dt;
      if (l <= 0) continue;
      const dr = Math.exp(-this.drag[i] * dt);
      const vx = this.vx[i] * dr, vy = this.vy[i] * dr - this.grav[i] * dt;
      this.x[w] = this.x[i] + vx * dt; this.y[w] = this.y[i] + vy * dt;
      this.vx[w] = vx; this.vy[w] = vy; this.life[w] = l; this.ttl[w] = this.ttl[i];
      this.size[w] = this.size[i]; this.grav[w] = this.grav[i]; this.drag[w] = this.drag[i];
      this.col[w * 3] = this.col[i * 3]; this.col[w * 3 + 1] = this.col[i * 3 + 1]; this.col[w * 3 + 2] = this.col[i * 3 + 2];
      w++;
    }
    this.n = w;
    for (let i = 0; i < w; i++) {
      const f = this.life[i] / this.ttl[i];
      const a = Math.min(1, f * 1.6);
      this.pos[i * 3] = this.x[i]; this.pos[i * 3 + 1] = this.y[i]; this.pos[i * 3 + 2] = 0;
      this.outCol[i * 3] = this.col[i * 3] * a; this.outCol[i * 3 + 1] = this.col[i * 3 + 1] * a; this.outCol[i * 3 + 2] = this.col[i * 3 + 2] * a;
      this.outSize[i] = this.size[i] * (0.4 + 0.6 * f);
    }
    this.touch();
    for (const name of ['position', 'aColor', 'aSize']) this.geo.getAttribute(name).needsUpdate = true;
    this.geo.setDrawRange(0, w);
  }

  touch() {
    for (const name of ['position', 'aColor', 'aSize']) {
      const at = this.geo.getAttribute(name);
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * at.itemSize);
    }
  }

  clear() { this.n = 0; this.geo.setDrawRange(0, 0); }
}

export function shapeGeometry(multi) {
  const shapes = [];
  for (const poly of multi) {
    const outer = poly[0];
    const sh = new THREE.Shape(outer.map(p => new THREE.Vector2(p[0], p[1])));
    for (let k = 1; k < poly.length; k++) sh.holes.push(new THREE.Path(poly[k].map(p => new THREE.Vector2(p[0], p[1]))));
    shapes.push(sh);
  }
  return new THREE.ShapeGeometry(shapes, 1);
}
