// Beam: how a phone player looks. Six ready-made characters, a figure drawn with a finger (vector strokes that glow on
// the wall like everything else) and a selfie cut to a circle for the big head. Previews use the wall's own drawer.

import { LOOKS, DEFAULT_LOOK, DRAW_MAX, drawFigure, canvasPen, Look, cleanLook } from '../game/figure.js';
import { loadPhoto } from './photo.js';
import { h } from './dom.js';

const SEL = 'beam.pad.look', DRAW = 'beam.pad.draw', FACE = 'beam.pad.face';
const FACE_PX = 112, MAX_STROKES = 60;
const PENCIL = '<svg viewBox="0 0 24 24"><path d="M15.5 4.5l4 4L9 19l-5 1 1-5z" stroke-linejoin="round"/><path d="M13.5 6.5l4 4"/></svg>';
const CAMERA = '<svg viewBox="0 0 24 24"><path d="M4 8.5h3.2L9 6h6l1.8 2.5H20v10H4z" stroke-linejoin="round"/><circle cx="12" cy="13.2" r="3.4"/></svg>';

const load = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const save = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x19f0ff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const looks = {
  sel: 'ludzik',
  draw: null,
  face: null,
  init() {
    this.draw = cleanLook(load(DRAW));
    this.face = cleanLook(load(FACE));
    const s = load(SEL);
    this.sel = LOOKS[s] || (s === 'draw' && this.draw) || (s === 'face' && this.face) ? s : 'ludzik';
  },
  of(sel) {
    if (sel === 'draw') return this.draw || DEFAULT_LOOK;
    if (sel === 'face') return this.face || DEFAULT_LOOK;
    return LOOKS[sel] ? { k: 'p', id: sel } : DEFAULT_LOOK;
  },
  get cur() { return this.of(this.sel); },
  pick(sel) { this.sel = sel; save(SEL, sel); },
  setDraw(l) { this.draw = l; save(DRAW, l); },
  setFace(l) { this.face = l; save(FACE, l); },
};
looks.init();

const imgs = new Map();
function faceImg(src, onload) {
  let e = imgs.get(src);
  if (!e) {
    e = { img: new Image(), ok: false, wait: [] };
    e.img.onload = () => { e.ok = true; for (const f of e.wait.splice(0)) f(); };
    e.img.src = src;
    imgs.set(src, e);
  }
  if (!e.ok && onload) e.wait.push(onload);
  return e.ok ? e.img : null;
}

export function preview(cv, look, col) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round((cv.clientWidth || 72) * dpr), hh = Math.round((cv.clientHeight || 88) * dpr);
  if (cv.width !== w) cv.width = w;
  if (cv.height !== hh) cv.height = hh;
  const ctx = cv.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, hh);
  const k = Math.min((hh * 0.8) / 1.22, w * 0.95) / 10;
  const pen = canvasPen(ctx, w / 2, hh * 0.92, k);
  const img = look.k === 'f' ? faceImg(look.img, () => preview(cv, look, col)) : null;
  drawFigure(pen, { x: 0, feet: 0, h: 10, face: 1, color: col, squash: 0, lean: 0, swing: 0.35, tuck: 0, arms: 0.12, swim: false, time: 1.3 },
    new Look(look), img ? (x, y, r) => pen.face(img, x, y, r) : null);
}

export class LookPicker {
  constructor(box, { color, drawer, crop, onChange }) {
    this.box = box;
    this.color = color;
    this.drawer = drawer;
    this.crop = crop;
    this.onChange = onChange || null;
    this.sel = looks.sel;
    this.render();
  }

  get value() { return looks.of(this.sel); }

  render() {
    const col = hexRgb(this.color());
    const todo = [];
    const tile = (sel, label, look, icon) => {
      const cv = icon ? null : h('canvas', { class: 'lkc' });
      if (cv) todo.push([cv, look]);
      return h('button', { type: 'button', class: 'lk' + (this.sel === sel ? ' on' : ''), 'aria-label': label, onclick: () => this.tap(sel) },
        cv || h('i', { class: 'lki', html: icon }), h('span', {}, label));
    };
    const kids = Object.entries(LOOKS).map(([id, label]) => tile(id, label, { k: 'p', id }));
    kids.push(tile('draw', looks.draw ? 'Rysunek' : 'Narysuj', looks.draw, looks.draw ? null : PENCIL));
    kids.push(tile('face', 'Selfie', looks.face, looks.face ? null : CAMERA));
    this.box.replaceChildren(...kids);
    requestAnimationFrame(() => { for (const [cv, look] of todo) preview(cv, look, col); });
  }

  async tap(sel) {
    if (sel === 'draw' && (!looks.draw || this.sel === 'draw')) {
      const l = await this.drawer.open(looks.draw, this.color());
      if (!l) return;
      looks.setDraw(l);
    } else if (sel === 'face' && (!looks.face || this.sel === 'face')) {
      const l = await this.crop.pick(this.color());
      if (!l) return;
      looks.setFace(l);
    }
    this.sel = sel;
    this.render();
    if (this.onChange) this.onChange(sel);
  }
}

function glow(ctx, path, col, w, g) {
  const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = css(col);
  ctx.shadowBlur = g;
  ctx.strokeStyle = css(col);
  ctx.lineWidth = w * 2;
  path();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = css([0.5 + col[0] * 0.5, 0.5 + col[1] * 0.5, 0.5 + col[2] * 0.5], 0.85);
  ctx.lineWidth = Math.max(0.8, w * 0.8);
  path();
  ctx.stroke();
}

export class Drawer {
  constructor(root) {
    this.root = root;
    this.cv = root.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.text = root.querySelector('.mtext');
    this.strokes = [];
    this.cur = null;
    this.raf = 0;
    this.done = null;
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => this.move(e));
    this.cv.addEventListener('pointerup', e => this.up(e));
    this.cv.addEventListener('pointercancel', e => this.up(e));
    const on = (a, fn) => root.querySelector(`[data-a="${a}"]`).addEventListener('click', fn);
    on('clear', () => { this.strokes = []; this.invalidate(); });
    on('undo', () => { this.strokes.pop(); this.invalidate(); });
    on('cancel', () => this.finish(null));
    on('ok', () => this.finish(this.strokes.length ? cleanLook({ k: 'd', s: this.strokes }) : null));
    this.onResize = () => { this.layout(); this.invalidate(); };
  }

  open(look, hex) {
    this.strokes = look && look.s ? look.s.map(s => s.slice()) : [];
    this.col = hexRgb(hex);
    this.cur = null;
    this.root.classList.add('on');
    window.addEventListener('resize', this.onResize);
    this.layout();
    this.invalidate();
    return new Promise(res => { this.done = res; });
  }

  finish(v) {
    window.removeEventListener('resize', this.onResize);
    this.root.classList.remove('on');
    const d = this.done;
    this.done = null;
    if (d) d(v);
  }

  layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.root.clientWidth, hh = this.root.clientHeight;
    this.cw = w;
    this.ch = hh;
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(hh * dpr);
    const top = 74, bottom = 84;
    this.u = Math.max(40, Math.min((w - 36) / 2, (hh - top - bottom) / 3.3));
    this.cx = w / 2;
    this.cy = top + this.u * 1.04;
  }

  count() { return this.strokes.reduce((n, s) => n + s.length / 2, 0); }

  uv(e) {
    const r = this.cv.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left - this.cx) / this.u) * 100), Math.round((-(e.clientY - r.top - this.cy) / this.u) * 100)];
  }

  down(e) {
    if (this.cur) return;
    const [u, v] = this.uv(e);
    if (Math.abs(u) > 104 || Math.abs(v) > 104) return;
    if (this.strokes.length >= MAX_STROKES || this.count() >= DRAW_MAX) { this.note(true); return; }
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { }
    this.cur = { id: e.pointerId, s: [clamp(u, -100, 100), clamp(v, -100, 100)] };
    this.strokes.push(this.cur.s);
    this.invalidate();
  }

  move(e) {
    const c = this.cur;
    if (!c || c.id !== e.pointerId) return;
    const [u0, v0] = this.uv(e);
    const u = clamp(u0, -100, 100), v = clamp(v0, -100, 100);
    const s = c.s, n = s.length;
    if (Math.hypot(u - s[n - 2], v - s[n - 1]) < 3.5) return;
    if (this.count() >= DRAW_MAX) { this.note(true); return; }
    s.push(u, v);
    this.invalidate();
  }

  up(e) {
    if (!this.cur || this.cur.id !== e.pointerId) return;
    this.cur = null;
    this.invalidate();
  }

  note(full) {
    this.text.textContent = full
      ? 'Koniec miejsca na kreski. Cofnij coś albo naciśnij Gotowe.'
      : 'Narysuj palcem głowę i tułów w ramce. Nogi i chodzenie dorobi gra.';
  }

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const c = this.ctx, u = this.u, cx = this.cx, cy = this.cy, col = this.col;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#07080b';
    c.fillRect(0, 0, this.cw, this.ch);
    c.strokeStyle = 'rgba(255, 255, 255, 0.13)';
    c.lineWidth = 1;
    c.setLineDash([6, 7]);
    c.strokeRect(cx - u, cy - u, 2 * u, 2 * u);
    c.setLineDash([]);
    const X = x => cx + x * u, Y = y => cy - y * u;
    const dim = col.map(v => v * 0.38);
    glow(c, () => {
      c.beginPath();
      for (const sx of [-1, 1]) {
        c.moveTo(X(0), Y(-0.96));
        c.lineTo(X(sx * 0.2), Y(-1.58));
        c.lineTo(X(sx * 0.27), Y(-2.2));
      }
    }, dim, u * 0.06, u * 0.12);
    glow(c, () => {
      c.beginPath();
      for (const st of this.strokes) {
        c.moveTo(X(st[0] / 100), Y(st[1] / 100));
        if (st.length === 2) c.lineTo(X(st[0] / 100) + 0.01, Y(st[1] / 100));
        for (let i = 2; i < st.length; i += 2) c.lineTo(X(st[i] / 100), Y(st[i + 1] / 100));
      }
    }, col, u * 0.059, u * 0.25);
    this.note(this.count() >= DRAW_MAX || this.strokes.length >= MAX_STROKES);
  }
}

export class FaceCrop {
  constructor(root, file) {
    this.root = root;
    this.file = file;
    this.cv = root.querySelector('canvas');
    this.ctx = this.cv.getContext('2d');
    this.pts = new Map();
    this.raf = 0;
    this.done = null;
    this.src = null;
    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) { this.finish(null); return; }
      try { this.show(await loadPhoto(f, 1280)); } catch (e) { this.finish(null); }
    });
    file.addEventListener('cancel', () => { if (!this.src) this.finish(null); });
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => this.move(e));
    this.cv.addEventListener('pointerup', e => this.up(e));
    this.cv.addEventListener('pointercancel', e => this.up(e));
    this.cv.addEventListener('wheel', e => { e.preventDefault(); this.zoom(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    const on = (a, fn) => root.querySelector(`[data-a="${a}"]`).addEventListener('click', fn);
    on('again', () => this.file.click());
    on('cancel', () => this.finish(null));
    on('ok', () => this.finish(this.result()));
    this.onResize = () => { this.layout(); this.fit(); this.invalidate(); };
  }

  pick(hex) {
    this.col = hex;
    this.src = null;
    if (this.done) this.done(null);
    const p = new Promise(res => { this.done = res; });
    this.file.click();
    return p;
  }

  show(src) {
    this.src = src;
    this.root.classList.add('on');
    window.addEventListener('resize', this.onResize);
    this.layout();
    const m = Math.min(src.width, src.height);
    this.z = (this.R * 2) / (m * 0.72);
    this.px = src.width / 2;
    this.py = src.height * 0.44;
    this.fit();
    this.invalidate();
  }

  finish(v) {
    window.removeEventListener('resize', this.onResize);
    this.root.classList.remove('on');
    this.pts.clear();
    this.src = null;
    const d = this.done;
    this.done = null;
    if (d) d(v);
  }

  layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.root.clientWidth, hh = this.root.clientHeight;
    this.cw = w;
    this.ch = hh;
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(hh * dpr);
    this.R = Math.max(60, Math.min(w * 0.4, (hh - 170) * 0.42));
    this.cx = w / 2;
    this.cy = 74 + (hh - 74 - 90) / 2;
  }

  fit() {
    const s = this.src;
    if (!s) return;
    const zMin = (this.R * 2) / Math.min(s.width, s.height);
    this.z = clamp(this.z, zMin, zMin * 8);
    const r = this.R / this.z;
    this.px = clamp(this.px, r, s.width - r);
    this.py = clamp(this.py, r, s.height - r);
  }

  zoom(k) {
    this.z *= k;
    this.fit();
    this.invalidate();
  }

  xy(e) {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    try { this.cv.setPointerCapture(e.pointerId); } catch (err) { }
    this.pts.set(e.pointerId, this.xy(e));
  }

  move(e) {
    const old = this.pts.get(e.pointerId);
    if (!old || !this.src) return;
    const now = this.xy(e);
    if (this.pts.size === 1) {
      this.px -= (now[0] - old[0]) / this.z;
      this.py -= (now[1] - old[1]) / this.z;
    } else {
      const [a, b] = [...this.pts.values()];
      const other = a === old ? b : a;
      const d0 = Math.hypot(old[0] - other[0], old[1] - other[1]), d1 = Math.hypot(now[0] - other[0], now[1] - other[1]);
      if (d0 > 8) this.z *= d1 / d0;
      this.px -= (now[0] - old[0]) / 2 / this.z;
      this.py -= (now[1] - old[1]) / 2 / this.z;
    }
    this.pts.set(e.pointerId, now);
    this.fit();
    this.invalidate();
  }

  up(e) { this.pts.delete(e.pointerId); }

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const c = this.ctx, s = this.src;
    if (!s) return;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.cw, this.ch);
    c.drawImage(s, this.cx - this.px * this.z, this.cy - this.py * this.z, s.width * this.z, s.height * this.z);
    c.fillStyle = 'rgba(0, 0, 0, 0.66)';
    c.beginPath();
    c.rect(0, 0, this.cw, this.ch);
    c.arc(this.cx, this.cy, this.R, 0, Math.PI * 2, true);
    c.fill();
    c.strokeStyle = this.col || '#19f0ff';
    c.lineWidth = 3;
    c.shadowColor = this.col || '#19f0ff';
    c.shadowBlur = 14;
    c.beginPath();
    c.arc(this.cx, this.cy, this.R, 0, Math.PI * 2);
    c.stroke();
    c.shadowBlur = 0;
  }

  result() {
    const s = this.src;
    if (!s) return null;
    const out = document.createElement('canvas');
    out.width = out.height = FACE_PX;
    const r = this.R / this.z;
    out.getContext('2d').drawImage(s, this.px - r, this.py - r, r * 2, r * 2, 0, 0, FACE_PX, FACE_PX);
    for (const q of [0.82, 0.68, 0.5]) {
      const look = cleanLook({ k: 'f', img: out.toDataURL('image/jpeg', q) });
      if (look) return look;
    }
    return null;
  }
}
