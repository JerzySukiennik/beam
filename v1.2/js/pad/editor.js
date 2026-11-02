// Beam: wall editor on the phone. Shows the wall in cm, or a photo of it matched through the four projector markers,
// and turns taps and drags into ops for the computer, which keeps the only copy of the scene.

import * as H from '../math/homography.js';
import { loadPhoto, detectMarks, MarkPicker } from './photo.js';
import { h } from './dom.js';

const PHOTOS = 'beam.pad.photos.v1';
const ITEM = { coin: '#ffd23d', spawn: '#19f0ff', goal: '#ffffff' };

function pointIn(multi, x, y) {
  let inside = false;
  for (const poly of multi) {
    for (const r of poly) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i], b = r[j];
        if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
    }
  }
  return inside;
}

function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l)) : 0;
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
}

function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-6) return false;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

function photos() {
  try { return JSON.parse(localStorage.getItem(PHOTOS) || '{}') || {}; } catch (e) { return {}; }
}

function savePhoto(wall, rec) {
  const all = photos();
  all[wall] = rec;
  const byAge = () => Object.keys(all).filter(k => k !== wall).sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
  while (Object.keys(all).length > 3) delete all[byAge()[0]];
  for (;;) {
    try { localStorage.setItem(PHOTOS, JSON.stringify(all)); return true; } catch (e) {
      const old = byAge()[0];
      if (!old) return false;
      delete all[old];
    }
  }
}

export class Editor {
  constructor({ root, send, sheet, toast, buzz }) {
    this.root = root;
    this.send = send;
    this.sheet = sheet;
    this.toast = toast;
    this.buzz = buzz;
    this.cv = root.querySelector('#ec');
    this.ctx = this.cv.getContext('2d');
    this.note = root.querySelector('#enote');
    this.file = document.querySelector('#shotFile');
    this.picker = new MarkPicker(document.querySelector('#markv'));
    this.sc = null;
    this.view = 'wall';
    this.tool = 'select';
    this.type = 'solid';
    this.sel = new Set();
    this.ghosts = [];
    this.poly = [];
    this.drag = null;
    this.pointers = new Map();
    this.pinch = null;
    this.block = false;
    this.s = 1;
    this.fitS = 1;
    this.ox = 0;
    this.oy = 0;
    this.photo = null;
    this.M = null;
    this.Mi = null;
    this.auto = true;
    this.marking = false;
    this.seq = 0;
    this.visible = false;
    this.raf = 0;
    this.bind();
  }

  bind() {
    const r = this.root, cv = this.cv;
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', e => this.up(e, false));
    cv.addEventListener('pointercancel', e => this.up(e, true));
    cv.addEventListener('wheel', e => this.wheel(e), { passive: false });
    cv.addEventListener('contextmenu', e => e.preventDefault());
    r.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    r.querySelectorAll('#eview [data-v]').forEach(b => b.addEventListener('click', () => this.setView(b.dataset.v)));
    r.querySelector('#etype').addEventListener('click', () => this.typeSheet());
    r.querySelector('#edel').addEventListener('click', () => this.remove());
    r.querySelector('#eundo').addEventListener('click', () => this.op({ k: 'undo' }));
    r.querySelector('#eredo').addEventListener('click', () => this.op({ k: 'redo' }));
    r.querySelector('#eshot').addEventListener('click', () => this.shot());
    r.querySelector('#ppop').addEventListener('click', () => { this.poly.pop(); this.ui(); this.invalidate(); });
    r.querySelector('#pclose').addEventListener('click', () => this.closePoly());
    this.file.addEventListener('change', () => this.fileChosen());
    this.file.addEventListener('cancel', () => this.stopMarks());
    window.addEventListener('resize', () => { if (this.visible) this.resize(); });
  }

  show() {
    this.visible = true;
    this.resize();
    this.ui();
  }

  hide() {
    this.visible = false;
    this.drag = null;
    this.pinch = null;
    this.pointers.clear();
    this.block = false;
    this.stopMarks();
  }

  op(o) { this.send({ t: 'op', op: o }); }

  scene(m) {
    const fresh = !this.sc || this.sc.wall.id !== m.wall.id;
    this.sc = m;
    const t = performance.now();
    const ids = new Set();
    for (const s of m.shapes) ids.add(s.id);
    for (const i of m.items) ids.add(i.id);
    this.ghosts = this.ghosts.filter(g => !(g.id && ids.has(g.id)) && t - g.at < 5000);
    for (const id of [...this.sel]) if (!ids.has(id) && !this.ghosts.some(g => g.id === id)) this.sel.delete(id);
    if (fresh) {
      this.photo = null;
      this.poly = [];
      this.drag = null;
      this.sel.clear();
      this.auto = true;
      this.view = 'wall';
      if (m.wall.live) this.stored();
      else if (m.wall.photo) this.send({ t: 'photo' });
    }
    this.solve();
    if (fresh) this.fit();
    this.ui();
    this.invalidate();
  }

  hostPhoto(m) {
    if (!this.sc) return;
    if (!m.src) { this.photo = null; this.solve(); this.ui(); this.invalidate(); return; }
    if (m.wall !== this.sc.wall.id) return;
    const img = new Image();
    img.onload = () => {
      if (!this.sc || this.sc.wall.id !== m.wall) return;
      this.photo = { kind: 'host', img, w: m.w, h: m.h };
      this.gotPhoto();
    };
    img.src = m.src;
  }

  stored() {
    const wall = this.sc.wall.id, rec = photos()[wall];
    if (!rec || !rec.src || !rec.G || !rec.J) return;
    const img = new Image();
    img.onload = () => {
      if (!this.sc || this.sc.wall.id !== wall) return;
      this.photo = { kind: 'live', img, w: rec.w, h: rec.h, G: rec.G, J: rec.J };
      this.gotPhoto();
    };
    img.src = rec.src;
  }

  gotPhoto() {
    this.solve();
    if (this.auto && this.M) {
      this.auto = false;
      this.view = 'photo';
      this.fit();
    }
    this.ui();
    this.invalidate();
  }

  solve() {
    const p = this.photo, sc = this.sc;
    let M = null;
    if (p && sc && sc.ok) {
      if (p.kind === 'host') M = sc.pm || null;
      else {
        const S = [sc.J[0] / p.J[0], 0, 0, 0, sc.J[1] / p.J[1], 0, 0, 0, 1];
        const { w, h: hh } = sc.cm;
        const HWJ = H.solve([[0, hh], [w, hh], [w, 0], [0, 0]], sc.calibJ);
        M = HWJ ? H.mul(H.inv(H.mul(S, p.G)), HWJ) : null;
      }
    }
    this.M = M;
    this.Mi = M ? H.inv(M) : null;
    if (!this.Mi) this.M = null;
    if (!this.M && this.view === 'photo') {
      this.view = 'wall';
      this.fit();
    }
  }

  base(x, y) { return this.view === 'photo' ? H.apply(this.M, x, y) : [x, -y]; }
  unbase(x, y) { return this.view === 'photo' ? H.apply(this.Mi, x, y) : [x, -y]; }
  toS(x, y) { const b = this.base(x, y); return [b[0] * this.s + this.ox, b[1] * this.s + this.oy]; }
  fromS(x, y) { return this.unbase((x - this.ox) / this.s, (y - this.oy) / this.s); }

  resize() {
    const w = this.root.clientWidth, hh = this.root.clientHeight;
    if (!w || !hh) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cw = w;
    this.ch = hh;
    this.cv.width = Math.round(w * this.dpr);
    this.cv.height = Math.round(hh * this.dpr);
    this.fit();
  }

  fit() {
    if (!this.cw) return;
    let bb;
    if (this.view === 'photo' && this.photo) bb = [0, 0, this.photo.w, this.photo.h];
    else {
      const b = this.sc && this.sc.box ? this.sc.box : { x0: 0, y0: 0, x1: 100, y1: 70 };
      bb = [b.x0, -b.y1, b.x1, -b.y0];
    }
    const top = 56, bottom = 84, pad = 14;
    const aw = this.cw - pad * 2, ah = this.ch - top - bottom - pad * 2;
    const bw = Math.max(1e-6, bb[2] - bb[0]), bh = Math.max(1e-6, bb[3] - bb[1]);
    this.s = this.fitS = Math.max(1e-4, Math.min(aw / bw, ah / bh));
    this.ox = pad + (aw - bw * this.s) / 2 - bb[0] * this.s;
    this.oy = top + pad + (ah - bh * this.s) / 2 - bb[1] * this.s;
    this.invalidate();
  }

  zoomAt(x, y, s) {
    s = Math.max(this.fitS * 0.4, Math.min(this.fitS * 40, s));
    const bx = (x - this.ox) / this.s, by = (y - this.oy) / this.s;
    this.s = s;
    this.ox = x - bx * s;
    this.oy = y - by * s;
    this.invalidate();
  }

  setView(v) {
    if (v === 'photo' && !this.M) {
      if (this.sc && this.sc.wall.live) this.shot();
      return;
    }
    if (v === this.view) return;
    this.drag = null;
    this.view = v;
    this.fit();
    this.ui();
  }

  setTool(t) {
    if (t !== 'poly') this.poly = [];
    this.tool = t;
    this.ui();
    this.invalidate();
  }

  selShapes() { return this.sc ? this.sc.shapes.filter(s => this.sel.has(s.id)) : []; }

  curType() {
    const sel = this.selShapes();
    return sel.length && sel.every(s => s.type === sel[0].type) ? sel[0].type : this.type;
  }

  ui() {
    const r = this.root, sc = this.sc;
    r.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === this.tool));
    r.querySelectorAll('#eview [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === this.view));
    const live = !!(sc && sc.wall.live);
    r.querySelector('#eview [data-v="photo"]').disabled = !this.M && !live;
    const shot = r.querySelector('#eshot');
    shot.hidden = !live;
    shot.textContent = this.photo ? 'Nowe zdjęcie' : 'Zdjęcie ściany';
    const k = this.curType();
    const sw = r.querySelector('#etype .sw');
    sw.className = 'sw' + (k === 'mask' ? ' mask' : '');
    sw.style.setProperty('--c', (sc && sc.colors[k]) || '#ffffff');
    r.querySelector('#etypeName').textContent = (sc && sc.labels[k]) || 'Typ';
    r.querySelector('#edel').disabled = !this.sel.size;
    r.querySelector('#eundo').disabled = !sc || !sc.undo;
    r.querySelector('#eredo').disabled = !sc || !sc.redo;
    r.querySelector('#epoly').classList.toggle('on', this.tool === 'poly' && this.poly.length > 0);
    r.querySelector('#pclose').disabled = this.poly.length < 3;
    this.note.textContent = this.noteText();
  }

  noteText() {
    const sc = this.sc;
    if (!sc) return 'Ładuję ścianę...';
    if (!sc.ok) return 'Najpierw kalibracja na komputerze, krok 3.';
    if (this.tool === 'poly') return this.poly.length < 3 ? 'Stukaj po kolei w rogi kształtu.' : 'Stuknij pierwszy punkt albo Zamknij kształt.';
    if (this.tool === 'rect') return 'Przeciągnij palcem po skosie.';
    if (!sc.shapes.length && !this.ghosts.length) return sc.wall.live && !this.photo ? 'Zrób zdjęcie ściany i obrysuj na nim rzeczy.' : 'Weź Prostokąt albo Wielokąt i obrysuj rzeczy.';
    return '';
  }

  typeSheet() {
    const sc = this.sc;
    if (!sc) return;
    const sel = this.selShapes(), cur = this.curType();
    const grid = h('div', { class: 'types' }, ...Object.keys(sc.labels).map(k => h('button', {
      class: 'type' + (k === cur ? ' on' : ''),
      type: 'button',
      onclick: () => { this.sheet.close(); this.setType(k); },
    }, h('i', { class: 'sw' + (k === 'mask' ? ' mask' : ''), style: k === 'mask' ? null : `--c:${sc.colors[k]}` }), h('span', {}, sc.labels[k]))));
    const title = sel.length ? (sel.length === 1 ? 'Typ zaznaczonego' : `Typ zaznaczonych (${sel.length})`) : 'Nowy kształt jako';
    this.sheet.open(h('div', { class: 'sh' }, h('h3', {}, title), grid));
  }

  setType(k) {
    this.type = k;
    const ids = this.selShapes().map(s => s.id);
    if (ids.length) {
      this.op({ k: 'type', ids, type: k });
      for (const s of this.sc.shapes) if (ids.includes(s.id)) s.type = k;
    }
    this.ui();
    this.invalidate();
  }

  remove() {
    if (!this.sel.size || !this.sc) return;
    this.op({ k: 'del', ids: [...this.sel] });
    this.sc.shapes = this.sc.shapes.filter(s => !this.sel.has(s.id));
    this.sc.items = this.sc.items.filter(i => !this.sel.has(i.id));
    this.sel.clear();
    this.buzz(10);
    this.ui();
    this.invalidate();
  }

  add(geom) {
    const ref = 'r' + ++this.seq;
    this.ghosts.push({ ref, geom, type: this.type, at: performance.now(), id: null });
    this.op({ k: 'add', type: this.type, geom, ref });
    this.buzz(12);
  }

  added(m) {
    const g = this.ghosts.find(q => q.ref === m.ref);
    if (g) {
      g.id = m.id;
      if (this.sc && this.sc.shapes.some(s => s.id === m.id)) this.ghosts = this.ghosts.filter(q => q !== g);
    }
    this.sel = new Set([m.id]);
    this.ui();
    this.invalidate();
  }

  closePoly() {
    if (this.poly.length < 3) return;
    this.add([[this.poly.map(p => [p[0], p[1]])]]);
    this.poly = [];
    this.ui();
    this.invalidate();
  }

  translate(ids, dx, dy) {
    const set = new Set(ids);
    for (const s of this.sc.shapes) if (set.has(s.id)) s.geom = s.geom.map(poly => poly.map(r => r.map(p => [p[0] + dx, p[1] + dy])));
    for (const it of this.sc.items) if (set.has(it.id)) { it.x += dx; it.y += dy; }
  }

  xy(e) {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    if (!this.sc) return;
    e.preventDefault();
    this.cv.setPointerCapture(e.pointerId);
    const [x, y] = this.xy(e);
    this.pointers.set(e.pointerId, { x, y });
    if (this.pointers.size === 2) {
      this.drag = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, s: this.s, ox: this.ox, oy: this.oy };
      this.block = true;
      this.invalidate();
      return;
    }
    if (this.pointers.size > 2 || this.block) return;
    this.start(x, y);
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    [p.x, p.y] = this.xy(e);
    if (this.pinch) {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()], P = this.pinch;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const s = Math.max(this.fitS * 0.4, Math.min(this.fitS * 40, (P.s * d) / P.d));
      const bx = (P.cx - P.ox) / P.s, by = (P.cy - P.oy) / P.s;
      this.s = s;
      this.ox = cx - bx * s;
      this.oy = cy - by * s;
      this.invalidate();
      return;
    }
    if (this.drag) this.drift(p.x, p.y);
  }

  up(e, cancel) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      if (!this.pointers.size) this.block = false;
      return;
    }
    if (this.block) {
      if (!this.pointers.size) this.block = false;
      return;
    }
    if (!this.drag) return;
    if (cancel) { this.drag = null; this.invalidate(); return; }
    this.end(p.x, p.y);
  }

  wheel(e) {
    e.preventDefault();
    const [x, y] = this.xy(e);
    this.zoomAt(x, y, this.s * Math.exp(-e.deltaY * 0.0015));
  }

  start(x, y) {
    const w = this.fromS(x, y);
    if (!w || !isFinite(w[0]) || !isFinite(w[1])) return;
    if (this.tool === 'select') {
      const hit = this.hit(x, y);
      if (hit) {
        if (!this.sel.has(hit)) this.sel = new Set([hit]);
        this.drag = { kind: 'move', x0: x, y0: y, w0: w, dx: 0, dy: 0, moved: false };
      } else {
        this.drag = { kind: 'pan', x0: x, y0: y, ox: this.ox, oy: this.oy, moved: false };
      }
      this.ui();
    } else if (this.tool === 'rect') {
      this.drag = { kind: 'rect', x0: x, y0: y, a: w, b: w, moved: false };
    } else {
      this.drag = { kind: 'tap', x0: x, y0: y, ox: this.ox, oy: this.oy, moved: false };
    }
    this.invalidate();
  }

  drift(x, y) {
    const d = this.drag;
    if (!d.moved && Math.hypot(x - d.x0, y - d.y0) > 7) d.moved = true;
    if (!d.moved) return;
    if (d.kind === 'move') {
      const w = this.fromS(x, y);
      if (w) { d.dx = w[0] - d.w0[0]; d.dy = w[1] - d.w0[1]; }
    } else if (d.kind === 'pan' || d.kind === 'tap') {
      if (d.kind === 'tap') d.kind = 'span';
      this.ox = d.ox + x - d.x0;
      this.oy = d.oy + y - d.y0;
    } else if (d.kind === 'span') {
      this.ox = d.ox + x - d.x0;
      this.oy = d.oy + y - d.y0;
    } else if (d.kind === 'rect') {
      const w = this.fromS(x, y);
      if (w) d.b = w;
    }
    this.invalidate();
  }

  end(x, y) {
    const d = this.drag;
    this.drag = null;
    if (d.kind === 'move') {
      if (d.moved && (d.dx || d.dy)) {
        const ids = [...this.sel];
        this.op({ k: 'move', ids, dx: d.dx, dy: d.dy });
        this.translate(ids, d.dx, d.dy);
        this.buzz(8);
      }
    } else if (d.kind === 'pan') {
      if (!d.moved) this.sel.clear();
    } else if (d.kind === 'rect') {
      if (d.moved) {
        const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]), y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
        if (x1 - x0 >= 0.8 && y1 - y0 >= 0.8) this.add([[[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]]);
      } else {
        const hit = this.hit(x, y);
        this.sel = hit ? new Set([hit]) : new Set();
      }
    } else if (d.kind === 'tap') {
      const w = this.fromS(x, y);
      if (w && isFinite(w[0]) && isFinite(w[1])) {
        if (this.poly.length >= 3) {
          const f = this.toS(this.poly[0][0], this.poly[0][1]);
          if (Math.hypot(f[0] - x, f[1] - y) < 26) { this.closePoly(); return; }
        }
        this.poly.push(w);
        this.buzz(5);
      }
    }
    this.ui();
    this.invalidate();
  }

  hit(x, y) {
    const sc = this.sc;
    for (let i = sc.items.length - 1; i >= 0; i--) {
      const it = sc.items[i], q = this.toS(it.x, it.y);
      if (Math.hypot(q[0] - x, q[1] - y) < 20) return it.id;
    }
    const w = this.fromS(x, y);
    if (!w) return null;
    for (let i = sc.shapes.length - 1; i >= 0; i--) if (pointIn(sc.shapes[i].geom, w[0], w[1])) return sc.shapes[i].id;
    let best = null, bd = 14;
    for (const s of sc.shapes) {
      for (const poly of s.geom) {
        for (const r of poly) {
          let a = this.toS(r[r.length - 1][0], r[r.length - 1][1]);
          for (const p of r) {
            const b = this.toS(p[0], p[1]);
            const dd = segDist(x, y, a, b);
            if (dd < bd) { bd = dd; best = s.id; }
            a = b;
          }
        }
      }
    }
    return best;
  }

  shot() {
    const sc = this.sc;
    if (!sc || !sc.wall.live) return;
    if (!sc.ok) { this.toast('Najpierw kalibracja na komputerze, krok 3.'); return; }
    this.marking = true;
    this.send({ t: 'marks', on: true });
    this.sheet.open(h('div', { class: 'sh' },
      h('h3', {}, 'Zdjęcie ściany'),
      h('p', {}, 'Na ścianie świecą teraz 4 kolorowe kropki. Stań tak, żeby widzieć całą ścianę, i zrób zdjęcie ze wszystkimi czterema.'),
      h('p', { class: 'fine' }, 'Potem obrysujesz na nim rzeczy palcem, a kształty trafią prosto w nie.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => { this.sheet.close(); this.stopMarks(); } }, 'Anuluj'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { this.sheet.close(); this.file.value = ''; this.file.click(); } }, 'Zrób zdjęcie'))),
    () => this.stopMarks());
  }

  stopMarks() {
    if (!this.marking) return;
    this.marking = false;
    this.send({ t: 'marks', on: false });
  }

  async fileChosen() {
    const f = this.file.files && this.file.files[0];
    if (!f) { this.stopMarks(); return; }
    let photo;
    try { photo = await loadPhoto(f, 1280); } catch (e) { this.stopMarks(); this.toast('Nie da się otworzyć tego zdjęcia.'); return; }
    const pts = await this.picker.open(photo, detectMarks(photo));
    this.stopMarks();
    if (!pts || !this.sc) return;
    if (!convex(pts)) { this.toast('Kółka się krzyżują. Ustaw każde na kropce w swoim kolorze.'); return; }
    const sc = this.sc;
    const G = H.solve(pts, sc.marks);
    if (!G || !H.inv(G)) { this.toast('Nie wyszło dopasowanie, spróbuj jeszcze raz.'); return; }
    const rec = { src: photo.toDataURL('image/jpeg', 0.8), w: photo.width, h: photo.height, G, J: sc.J.slice(), at: Date.now() };
    if (!savePhoto(sc.wall.id, rec)) this.toast('Zdjęcie działa, ale telefon go nie zapamięta, brakuje miejsca.');
    this.photo = { kind: 'live', img: photo, w: rec.w, h: rec.h, G, J: rec.J };
    this.auto = true;
    this.gotPhoto();
    if (this.M) this.toast('Gotowe. Obrysuj rzeczy na zdjęciu.');
  }

  invalidate() {
    if (this.raf || !this.visible) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  path(multi, dx = 0, dy = 0) {
    const c = this.ctx;
    c.beginPath();
    for (const poly of multi) {
      for (const r of poly) {
        r.forEach((p, i) => {
          const q = this.toS(p[0] + dx, p[1] + dy);
          if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]);
        });
        c.closePath();
      }
    }
  }

  draw() {
    const c = this.ctx, sc = this.sc;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#07080b';
    c.fillRect(0, 0, this.cw, this.ch);
    if (!sc) return;
    const photo = this.view === 'photo' && this.photo && this.M;
    if (photo) {
      c.drawImage(this.photo.img, this.ox, this.oy, this.photo.w * this.s, this.photo.h * this.s);
      c.fillStyle = 'rgba(7, 8, 11, 0.16)';
      c.fillRect(0, 0, this.cw, this.ch);
    } else {
      this.grid();
    }
    c.lineJoin = 'round';
    if (sc.ok) {
      this.path(sc.area);
      if (!photo) { c.fillStyle = 'rgba(255, 255, 255, 0.035)'; c.fill('evenodd'); }
      c.setLineDash([6, 6]);
      c.lineWidth = 1;
      c.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      c.stroke();
      c.setLineDash([]);
      const { w, h: hh } = sc.cm;
      this.path([[[[0, 0], [w, 0], [w, hh], [0, hh]]]]);
      c.strokeStyle = 'rgba(255, 240, 190, 0.45)';
      c.stroke();
    }
    const d = this.drag, mv = d && d.kind === 'move' && d.moved ? d : null;
    for (const s of sc.shapes) this.shape(s, this.sel.has(s.id), mv && this.sel.has(s.id) ? mv : null, false);
    for (const g of this.ghosts) if (!g.id || !sc.shapes.some(s => s.id === g.id)) this.shape(g, false, null, true);
    for (const it of sc.items) this.item(it, this.sel.has(it.id), mv && this.sel.has(it.id) ? mv : null);
    if (d && d.kind === 'rect' && d.moved) {
      const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]), y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
      this.shape({ type: this.type, geom: [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]] }, false, null, true);
    }
    if (this.poly.length) this.drawPoly();
  }

  grid() {
    const c = this.ctx, step = 10;
    if (step * this.s < 12) return;
    const a = this.fromS(0, 0), b = this.fromS(this.cw, this.ch);
    const x0 = Math.floor(Math.min(a[0], b[0]) / step) * step, x1 = Math.max(a[0], b[0]);
    const y0 = Math.floor(Math.min(a[1], b[1]) / step) * step, y1 = Math.max(a[1], b[1]);
    c.beginPath();
    for (let x = x0; x <= x1; x += step) { const q = this.toS(x, 0); c.moveTo(q[0], 0); c.lineTo(q[0], this.ch); }
    for (let y = y0; y <= y1; y += step) { const q = this.toS(0, y); c.moveTo(0, q[1]); c.lineTo(this.cw, q[1]); }
    c.lineWidth = 1;
    c.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    c.stroke();
  }

  shape(s, on, mv, ghost) {
    const c = this.ctx, col = this.sc.colors[s.type] || '#ffffff';
    this.path(s.geom, mv ? mv.dx : 0, mv ? mv.dy : 0);
    if (s.type === 'mask') {
      c.fillStyle = 'rgba(0, 0, 0, 0.6)';
      c.fill('evenodd');
      c.setLineDash([4, 4]);
      c.lineWidth = 1.5;
      c.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      c.stroke();
      c.setLineDash([]);
    } else {
      c.fillStyle = col;
      c.globalAlpha = ghost ? 0.12 : 0.24;
      c.fill('evenodd');
      c.strokeStyle = col;
      c.globalAlpha = ghost ? 0.2 : 0.3;
      c.lineWidth = 6;
      c.stroke();
      c.globalAlpha = 1;
      c.lineWidth = 1.8;
      if (ghost) c.setLineDash([5, 4]);
      c.stroke();
      c.setLineDash([]);
    }
    if (on) {
      c.lineWidth = 2;
      c.strokeStyle = '#ffffff';
      c.setLineDash([7, 5]);
      c.stroke();
      c.setLineDash([]);
    }
  }

  item(it, on, mv) {
    const c = this.ctx, col = ITEM[it.type] || '#ffffff';
    const q = this.toS(it.x + (mv ? mv.dx : 0), it.y + (mv ? mv.dy : 0));
    const coin = it.type === 'coin';
    c.beginPath();
    c.arc(q[0], q[1], coin ? 6 : 10, 0, Math.PI * 2);
    c.fillStyle = coin ? col : 'rgba(7, 8, 11, 0.85)';
    c.fill();
    c.lineWidth = 2;
    c.strokeStyle = col;
    c.stroke();
    if (!coin) {
      c.fillStyle = col;
      c.font = '700 11px -apple-system, system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(it.type === 'spawn' ? 'S' : 'M', q[0], q[1] + 0.5);
    }
    if (on) {
      c.beginPath();
      c.arc(q[0], q[1], 15, 0, Math.PI * 2);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.5;
      c.stroke();
    }
  }

  drawPoly() {
    const c = this.ctx, col = this.sc.colors[this.type] || '#ffffff';
    const pts = this.poly.map(p => this.toS(p[0], p[1]));
    c.beginPath();
    pts.forEach((q, i) => { if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
    c.strokeStyle = col;
    c.lineWidth = 2;
    c.stroke();
    pts.forEach((q, i) => {
      c.beginPath();
      c.arc(q[0], q[1], i ? 4 : 7, 0, Math.PI * 2);
      c.fillStyle = i ? col : '#07080b';
      c.fill();
      if (!i) { c.lineWidth = 2; c.strokeStyle = this.poly.length >= 3 ? '#ffffff' : col; c.stroke(); }
    });
  }
}
