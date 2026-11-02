// Beam: editor interaction. Drawing tools with boolean modes, selection, vertex edit, items, projector and calibration handles, and the 2D overlay.

import * as P from '../math/poly.js';
import * as H from '../math/homography.js';
import { makeShape, newId, clone, TYPES, defaultProps } from '../scene.js';
import { PALETTES } from '../render/neon.js';

export const TOOLS = [
  { id: 'select', key: 'v', label: 'Zaznacz i przesuń', hint: 'Klik: zaznacz. Przeciągnij: przesuń. Shift: kilka naraz. Przeciągnij po pustym: ramka zaznaczenia.' },
  { id: 'vertex', key: 'a', label: 'Punkty', hint: 'Przeciągnij punkt kształtu. Dwuklik na krawędzi: nowy punkt. Alt+klik na punkcie: usuń.' },
  { id: 'quad', key: 'q', label: 'Narożniki', hint: 'Kliknij 4 rogi obiektu (ramy, półki). Najlepiej na zdjęciu po lewej.' },
  { id: 'rect', key: 'r', label: 'Prostokąt', hint: 'Przeciągnij. Shift: dodaj do zaznaczonego. Alt: wytnij (np. ramka z prostokąta).' },
  { id: 'ellipse', key: 'o', label: 'Koło i elipsa', hint: 'Przeciągnij. Shift: dodaj. Alt: wytnij.' },
  { id: 'poly', key: 'p', label: 'Wielokąt', hint: 'Klikaj punkty. Enter, dwuklik albo klik w pierwszy punkt: zamknij. Backspace: cofnij punkt. Esc: anuluj.' },
  { id: 'brush', key: 'b', label: 'Pędzel', hint: 'Maluj kształt. Dokleja się do zaznaczonego. [ i ]: rozmiar.' },
  { id: 'line', key: 'l', label: 'Gruba linia', hint: 'Przeciągnij: pas o grubości pędzla, np. cienka półka albo kabel.' },
  { id: 'eraser', key: 'e', label: 'Gumka', hint: 'Ściera z zaznaczonego kształtu, a bez zaznaczenia ze wszystkich.' },
  { id: 'bucket', key: 'g', label: 'Wiadro', hint: 'Klik w lukę między kształtami: wypełnia ją do wysokości kliknięcia. Shift: wszystko w dół.' },
  { id: 'items', key: 'i', label: 'Przedmioty', hint: 'Klik: postaw monetę, start albo metę. Przeciągnij: przesuń. Alt+klik: usuń.' },
];

export const ITEM_TYPES = { coin: 'Moneta', spawn: 'Start', goal: 'Meta' };

const CAL_COLORS = ['#19f0ff', '#ff4df2', '#ffd726', '#59ff73'];

function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-6) return false;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return true;
}

function jCorners(st) {
  const { jw, jh } = st.proj;
  return [[0, 0], [jw, 0], [jw, jh], [0, jh]];
}

function orderQuad(pts) {
  const c = [pts.reduce((s, p) => s + p[0], 0) / 4, pts.reduce((s, p) => s + p[1], 0) / 4];
  const a = pts.map(p => ({ p, a: Math.atan2(p[1] - c[1], p[0] - c[0]) })).sort((u, v) => v.a - u.a);
  let k = 0, best = Infinity;
  a.forEach((q, i) => {
    const d = Math.abs(Math.atan2(Math.sin(q.a - (3 * Math.PI) / 4), Math.cos(q.a - (3 * Math.PI) / 4)));
    if (d < best) { best = d; k = i; }
  });
  return [0, 1, 2, 3].map(i => a[(k + i) % 4].p);
}

function overlaps(a, b) {
  const A = P.bbox(a), B = P.bbox(b);
  if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) return false;
  return Math.abs(P.area(P.inter(a, b))) > 0.01;
}

function alpha(hex, a) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function rectRing(a, b) {
  return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
}

function ellipseRing(a, b, n = 48) {
  const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
  }
  return out;
}

export class Tools {
  constructor(app) {
    this.app = app;
    this.tool = 'select';
    this.type = 'solid';
    this.bool = 'new';
    this.brush = 1.2;
    this.itemType = 'coin';
    this.snapGrid = true;
    this.snapPts = true;
    this.sel = new Set();
    this.drag = null;
    this.poly = null;
    this.hover = null;
    this.mouse = null;
    this.snapHit = null;
    this.calSel = -1;
    this.spaceDown = false;
    this.canvas = app.overlay;
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    const st = app.stage;
    st.addEventListener('pointerdown', e => this.down(e));
    st.addEventListener('pointermove', e => this.move(e));
    st.addEventListener('pointerup', e => this.up(e));
    st.addEventListener('pointercancel', e => this.up(e));
    st.addEventListener('pointerleave', () => { if (!this.drag) { this.mouse = null; this.hover = null; this.app.overlayDirty(); this.app.ui.coords(null); } });
    st.addEventListener('dblclick', e => this.dbl(e));
    st.addEventListener('wheel', e => this.wheel(e), { passive: false });
    st.addEventListener('contextmenu', e => e.preventDefault());
  }

  get st() { return this.app.scene.state; }
  get space() { return this.app.space; }
  get views() { return this.app.views; }
  get pal() { return PALETTES[this.st.settings.palette] || PALETTES.cyber; }

  resize(w, h) {
    this.w = w;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  local(e) {
    const r = this.app.stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  toW(pane, mx, my) {
    const [a, b] = this.views.toSpace(pane, mx, my);
    if (pane.id === 'editor') return [a, b];
    return this.space.ok ? this.space.pToW(a, b) : null;
  }

  wToS(pane, x, y) {
    if (pane.id === 'editor') return this.views.toScreen(pane, x, y);
    const p = this.space.ok ? this.space.wToP(x, y) : null;
    return p ? this.views.toScreen(pane, p[0], p[1]) : null;
  }

  jToS(pane, x, y) {
    const p = this.space.jToP(x, y);
    return p ? this.views.toScreen(pane, p[0], p[1]) : null;
  }

  toPane(pane, w) {
    return pane.id === 'editor' ? w : this.space.wToP(w[0], w[1]);
  }

  paneToW(pane, p) {
    return pane.id === 'editor' ? p : this.space.pToW(p[0], p[1]);
  }

  tolW(pane, mx, my, px) {
    const a = this.toW(pane, mx, my), b = this.toW(pane, mx + px, my);
    if (!a || !b) return px / pane.z;
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  selected() {
    return this.st.shapes.filter(s => this.sel.has(s.id));
  }

  selChanged() {
    for (const id of [...this.sel]) if (!this.st.shapes.some(s => s.id === id)) this.sel.delete(id);
    if (!this.sel.size) this.bool = 'new';
    this.app.ui.render();
    this.app.overlayDirty();
  }

  setTool(id) {
    if (this.poly && id !== this.tool) this.poly = null;
    this.tool = id;
    this.app.ui.render();
    this.app.ui.hint(this.hint());
    this.app.overlayDirty();
  }

  hint() {
    const step = this.app.step;
    if (step === 1) return 'Wybierz ścianę po prawej albo wgraj swoje zdjęcie. Kółko/gładzik: przesuwanie, Cmd + kółko: zoom.';
    if (step === 2) return 'Przeciągnij rogi albo środek obrazu projektora. Tak ustawiasz, gdzie na zdjęciu pada światło.';
    if (step === 3) return 'Przeciągnij 4 kolorowe krzyżyki na rogi prostokątnego obiektu i wpisz jego wymiary. Strzałki: precyzyjnie.';
    if (step === 5) return 'Strzałki: ruch, Spacja albo ↑: skok, ↓: zeskok z półki, Shift: chwyt (tryb gumowy). R: od nowa.';
    if (this.poly) return this.tool === 'quad' ? `Narożnik ${this.poly.pts.length + 1} z 4.` : 'Enter albo klik w pierwszy punkt: zamknij. Backspace: cofnij punkt. Esc: anuluj.';
    const t = TOOLS.find(q => q.id === this.tool);
    return t ? t.hint : '';
  }

  modeFor(e) {
    if (e && e.altKey) return 'sub';
    if (e && e.shiftKey) return 'add';
    return this.bool;
  }

  nearestVertex(pane, mx, my, px, exclude) {
    let best = null, bd = px;
    for (const s of this.st.shapes) {
      if (s.id === exclude) continue;
      for (const poly of s.geom) for (const r of poly) for (const p of r) {
        const q = this.wToS(pane, p[0], p[1]);
        if (!q) continue;
        const d = Math.hypot(q[0] - mx, q[1] - my);
        if (d < bd) { bd = d; best = { w: [p[0], p[1]], s: q }; }
      }
    }
    return best;
  }

  snapW(pane, mx, my, exclude) {
    this.snapHit = null;
    let w = this.toW(pane, mx, my);
    if (!w) return null;
    if (this.snapPts) {
      const v = this.nearestVertex(pane, mx, my, 9, exclude);
      if (v) { this.snapHit = v.w; return v.w; }
    }
    if (this.snapGrid && pane.id === 'editor') w = [Math.round(w[0] * 2) / 2, Math.round(w[1] * 2) / 2];
    return w;
  }

  snapPane(pane, mx, my) {
    const w = this.snapW(pane, mx, my);
    if (!w) return null;
    if (pane.id === 'editor') return w;
    if (this.snapHit) return this.space.wToP(w[0], w[1]);
    return this.views.toSpace(pane, mx, my);
  }

  pickShape(pane, mx, my) {
    const w = this.toW(pane, mx, my);
    if (!w) return null;
    const tol = this.tolW(pane, mx, my, 6);
    const shapes = this.st.shapes;
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (P.pointIn(s.geom, w[0], w[1])) return s;
    }
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i];
      if (P.edgeDist(s.geom, w[0], w[1]) < tol) return s;
    }
    return null;
  }

  pickVertex(pane, mx, my) {
    const ids = this.sel.size ? this.sel : this.hover && this.hover.sid ? new Set([this.hover.sid]) : new Set();
    let best = null, bd = 9;
    for (const s of this.st.shapes) {
      if (!ids.has(s.id)) continue;
      s.geom.forEach((poly, pi) => poly.forEach((r, ri) => r.forEach((p, vi) => {
        const q = this.wToS(pane, p[0], p[1]);
        if (!q) return;
        const d = Math.hypot(q[0] - mx, q[1] - my);
        if (d < bd) { bd = d; best = { sid: s.id, pi, ri, vi }; }
      })));
    }
    return best;
  }

  pickItem(pane, mx, my) {
    let best = null, bd = 14;
    for (const it of this.st.items) {
      const q = this.wToS(pane, it.x, it.y + (it.type === 'goal' ? 4 : it.type === 'spawn' ? 3.5 : 0));
      if (!q) continue;
      const d = Math.hypot(q[0] - mx, q[1] - my);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  down(e) {
    if (e.button === 0 && e.target !== this.app.stage && e.target !== this.canvas && e.target !== this.app.glCanvas) return;
    const [mx, my] = this.local(e);
    const pane = this.views.paneAt(mx, my);
    if (!pane) return;
    try { this.app.stage.setPointerCapture(e.pointerId); } catch (err) { }
    if (e.button === 1 || e.button === 2 || this.spaceDown) {
      this.drag = { kind: 'pan', pane, last: [mx, my] };
      return;
    }
    const step = this.app.step;
    if (step === 2 && pane.id === 'room' && this.downProjector(pane, mx, my)) return;
    if (step === 3 && pane.id === 'room' && this.downCalib(pane, mx, my)) return;
    if (step === 4 && this.downTool(pane, mx, my, e)) return;
    this.drag = { kind: 'pan', pane, last: [mx, my] };
  }

  move(e) {
    const [mx, my] = this.local(e);
    const d = this.drag;
    const pane = d ? d.pane : this.views.paneAt(mx, my);
    this.mouse = pane ? { mx, my, pane, alt: e.altKey, shift: e.shiftKey } : null;
    if (d) {
      if (d.kind === 'pan') {
        this.views.pan(d.pane, mx - d.last[0], my - d.last[1]);
        d.last = [mx, my];
        this.app.viewChanged();
      } else this.dragMove(d, mx, my, e);
    } else if (pane) this.updateHover(pane, mx, my);
    this.app.overlayDirty();
    this.app.ui.coords(pane ? this.toW(pane, mx, my) : null);
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const [mx, my] = this.local(e);
    this.dragEnd(d, mx, my, e);
    this.app.overlayDirty();
  }

  dbl(e) {
    if (this.app.step !== 4) return;
    const [mx, my] = this.local(e);
    const pane = this.views.paneAt(mx, my);
    if (!pane) return;
    if (this.poly && this.tool === 'poly') { this.finishPoly(); return; }
    if (this.tool === 'vertex') this.insertVertex(pane, mx, my);
    else if (this.tool === 'select') {
      const s = this.pickShape(pane, mx, my);
      if (s) { this.sel = new Set([s.id]); this.setTool('vertex'); }
    }
  }

  wheel(e) {
    e.preventDefault();
    const [mx, my] = this.local(e);
    const pane = this.views.paneAt(mx, my);
    if (!pane) return;
    if (e.ctrlKey || e.metaKey) this.views.zoomAt(pane, mx, my, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0022)));
    else this.views.pan(pane, -e.deltaX, -e.deltaY);
    this.app.viewChanged();
    this.move(e);
  }

  updateHover(pane, mx, my) {
    if (this.app.step !== 4) { this.hover = null; return; }
    const s = this.tool === 'select' || this.tool === 'vertex' ? this.pickShape(pane, mx, my) : null;
    this.hover = s ? { sid: s.id } : null;
    if (['rect', 'ellipse', 'poly', 'quad', 'line'].includes(this.tool)) this.snapW(pane, mx, my);
    else this.snapHit = null;
  }

  downProjector(pane, mx, my) {
    const q = this.st.projQuad;
    let idx = -1, best = 16;
    q.forEach((p, i) => {
      const s = this.views.toScreen(pane, p[0], p[1]);
      const d = Math.hypot(s[0] - mx, s[1] - my);
      if (d < best) { best = d; idx = i; }
    });
    const photo = this.views.toSpace(pane, mx, my);
    if (idx < 0 && !P.pointInRing(q, photo[0], photo[1])) return false;
    const keep = this.st.settings.keepMap && this.space.ok;
    const calibP = keep ? this.st.calibJ.map(j => this.space.jToP(j[0], j[1])) : null;
    this.app.scene.begin();
    this.drag = { kind: 'proj', pane, idx, start: photo, orig: clone(q), calibP };
    return true;
  }

  downCalib(pane, mx, my) {
    const cj = this.st.calibJ;
    let idx = -1, best = 18;
    cj.forEach((j, i) => {
      const s = this.jToS(pane, j[0], j[1]);
      if (!s) return;
      const d = Math.hypot(s[0] - mx, s[1] - my);
      if (d < best) { best = d; idx = i; }
    });
    const photo = this.views.toSpace(pane, mx, my);
    const jm = this.space.pToJ(photo[0], photo[1]);
    if (!jm) return false;
    if (idx < 0 && !P.pointInRing(cj, jm[0], jm[1])) return false;
    this.calSel = idx;
    this.app.scene.begin();
    this.drag = { kind: 'calib', pane, idx, start: jm, orig: clone(cj) };
    return true;
  }

  downTool(pane, mx, my, e) {
    const w = this.toW(pane, mx, my);
    if (!w) return true;
    const t = this.tool;
    if (t === 'select') return this.downSelect(pane, mx, my, e);
    if (t === 'vertex') return this.downVertex(pane, mx, my, e);
    if (t === 'items') return this.downItems(pane, mx, my, w, e);
    if (t === 'bucket') { this.doBucket(w, e); return true; }
    if (t === 'poly' || t === 'quad') { this.clickPoly(pane, mx, my); return true; }
    if (t === 'rect' || t === 'ellipse' || t === 'line') {
      const a = t === 'line' ? this.snapW(pane, mx, my) : this.snapPane(pane, mx, my);
      if (!a) return true;
      this.drag = { kind: t, pane, a, b: a, sa: [mx, my], sb: [mx, my] };
      return true;
    }
    if (t === 'brush' || t === 'eraser') {
      this.drag = { kind: 'paint', erase: t === 'eraser', pane, pts: [w] };
      return true;
    }
    return false;
  }

  downSelect(pane, mx, my, e) {
    const s = this.pickShape(pane, mx, my);
    if (!s) {
      if (!e.shiftKey) this.sel.clear();
      this.drag = { kind: 'marquee', pane, a: [mx, my], b: [mx, my], add: e.shiftKey };
      this.selChanged();
      return true;
    }
    if (e.shiftKey) {
      if (this.sel.has(s.id)) this.sel.delete(s.id);
      else this.sel.add(s.id);
      this.selChanged();
      if (!this.sel.has(s.id)) return true;
    } else if (!this.sel.has(s.id)) {
      this.sel = new Set([s.id]);
      this.selChanged();
    }
    const w0 = this.toW(pane, mx, my);
    const orig = new Map();
    for (const q of this.selected()) orig.set(q.id, { geom: q.geom, quad: q.quad });
    if (e.altKey) {
      const copies = [];
      this.app.scene.commit('shapes', st => {
        for (const q of st.shapes.filter(x => this.sel.has(x.id))) {
          const c = clone(q);
          c.id = newId('s');
          c.name = q.name ? q.name + ' kopia' : '';
          copies.push(c);
        }
        st.shapes.push(...copies);
      });
      this.sel = new Set(copies.map(c => c.id));
      orig.clear();
      for (const c of copies) orig.set(c.id, { geom: c.geom, quad: c.quad });
      this.selChanged();
    }
    this.app.scene.begin();
    this.drag = { kind: 'move', pane, w0, orig, moved: false };
    return true;
  }

  downVertex(pane, mx, my, e) {
    const v = this.pickVertex(pane, mx, my);
    if (v) {
      const s = this.st.shapes.find(q => q.id === v.sid);
      const ring = s.geom[v.pi][v.ri];
      if (e.altKey) {
        if (ring.length > 3) {
          this.app.scene.commit('shapes', st => {
            const t = st.shapes.find(q => q.id === v.sid);
            t.geom[v.pi][v.ri].splice(v.vi, 1);
            t.geom = P.normalize(t.geom);
            t.quad = null;
          });
        }
        return true;
      }
      const p0 = ring[v.vi];
      let qi = -1;
      if (s.quad) s.quad.forEach((q, i) => { if (Math.hypot(q[0] - p0[0], q[1] - p0[1]) < 1e-3) qi = i; });
      this.sel = new Set([v.sid]);
      this.app.scene.begin();
      this.drag = { kind: 'vertex', pane, v, qi };
      return true;
    }
    const s = this.pickShape(pane, mx, my);
    if (s) { this.sel = new Set([s.id]); this.selChanged(); return true; }
    this.sel.clear();
    this.selChanged();
    this.drag = { kind: 'pan', pane, last: [mx, my] };
    return true;
  }

  insertVertex(pane, mx, my) {
    const w = this.toW(pane, mx, my);
    if (!w) return;
    const tol = this.tolW(pane, mx, my, 8);
    let best = null, bd = tol;
    for (const s of this.selected()) {
      s.geom.forEach((poly, pi) => poly.forEach((r, ri) => {
        for (let i = 0; i < r.length; i++) {
          const a = r[i], b = r[(i + 1) % r.length];
          const d = P.segDist(w[0], w[1], a[0], a[1], b[0], b[1]);
          if (d < bd) { bd = d; best = { sid: s.id, pi, ri, i }; }
        }
      }));
    }
    if (!best) return;
    this.app.scene.commit('shapes', st => {
      const s = st.shapes.find(q => q.id === best.sid);
      s.geom[best.pi][best.ri].splice(best.i + 1, 0, [w[0], w[1]]);
    });
  }

  downItems(pane, mx, my, w, e) {
    const near = this.pickItem(pane, mx, my);
    if (near && e.altKey) {
      this.app.scene.commit('items', st => { st.items = st.items.filter(i => i.id !== near.id); });
      return true;
    }
    if (near) {
      this.app.scene.begin();
      this.drag = { kind: 'item', pane, id: near.id };
      return true;
    }
    const type = this.itemType;
    const id = newId('i');
    this.app.scene.commit('items', st => {
      if (type !== 'coin') st.items = st.items.filter(i => i.type !== type);
      st.items.push({ id, type, x: w[0], y: w[1] });
    });
    this.app.scene.begin();
    this.drag = { kind: 'item', pane, id };
    return true;
  }

  doBucket(w, e) {
    const solids = [];
    for (const s of this.st.shapes) if (s.type !== 'mask') solids.push(...s.geom);
    const g = P.bucket(w[0], w[1], solids, this.space.area, e.shiftKey);
    if (!g) { this.app.ui.toast('Kliknij w pustą lukę między kształtami, w obszarze światła.', 2200); return; }
    this.commitGeom(g, e.altKey ? 'sub' : this.bool === 'new' || e.shiftKey ? 'new' : this.bool);
  }

  clickPoly(pane, mx, my) {
    const w = this.snapW(pane, mx, my);
    if (!w) return;
    if (!this.poly) {
      this.poly = { pane, pts: [w] };
    } else {
      const first = this.wToS(pane, this.poly.pts[0][0], this.poly.pts[0][1]);
      if (this.tool === 'poly' && this.poly.pts.length >= 3 && first && Math.hypot(first[0] - mx, first[1] - my) < 10) { this.finishPoly(); return; }
      const last = this.poly.pts[this.poly.pts.length - 1];
      if (Math.hypot(last[0] - w[0], last[1] - w[1]) > 1e-6) this.poly.pts.push(w);
      if (this.tool === 'quad' && this.poly.pts.length === 4) { this.finishPoly(); return; }
    }
    this.app.ui.hint(this.hint());
  }

  finishPoly() {
    const p = this.poly;
    this.poly = null;
    this.app.ui.hint(this.hint());
    if (!p) return;
    const pts = p.pts.filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 1e-6);
    if (pts.length < 3) return;
    const g = P.fromRing(pts);
    if (this.tool === 'quad' && pts.length === 4) this.commitGeom(g, this.mouse && this.mouse.alt ? 'sub' : this.bool, { quad: orderQuad(pts) });
    else this.commitGeom(g, this.mouse && this.mouse.alt ? 'sub' : this.mouse && this.mouse.shift ? 'add' : this.bool);
  }

  dragMove(d, mx, my, e) {
    const sc = this.app.scene;
    if (d.kind === 'proj') {
      const p = this.views.toSpace(d.pane, mx, my);
      const q = clone(d.orig);
      if (d.idx >= 0) q[d.idx] = p;
      else for (const c of q) { c[0] += p[0] - d.start[0]; c[1] += p[1] - d.start[1]; }
      if (!convex(q)) return;
      sc.live('proj', st => {
        st.projQuad = q;
        if (d.calibP && d.calibP.every(Boolean)) {
          const HPJ = H.inv(H.solve(jCorners(st), q));
          if (HPJ) st.calibJ = d.calibP.map(c => H.apply(HPJ, c[0], c[1]));
        }
      });
    } else if (d.kind === 'calib') {
      const photo = this.views.toSpace(d.pane, mx, my);
      const j = this.space.pToJ(photo[0], photo[1]);
      if (!j) return;
      const q = clone(d.orig);
      if (d.idx >= 0) q[d.idx] = j;
      else for (const c of q) { c[0] += j[0] - d.start[0]; c[1] += j[1] - d.start[1]; }
      if (!convex(q)) return;
      sc.live('calib', st => { st.calibJ = q; st.calibrated = true; });
    } else if (d.kind === 'move') {
      const w = this.toW(d.pane, mx, my);
      if (!w) return;
      let dx = w[0] - d.w0[0], dy = w[1] - d.w0[1];
      if (this.snapGrid && d.pane.id === 'editor') { dx = Math.round(dx * 2) / 2; dy = Math.round(dy * 2) / 2; }
      d.moved = true;
      sc.live('shapes', st => {
        for (const s of st.shapes) {
          const o = d.orig.get(s.id);
          if (!o) continue;
          s.geom = P.translate(o.geom, dx, dy);
          if (o.quad) s.quad = o.quad.map(p => [p[0] + dx, p[1] + dy]);
        }
      });
    } else if (d.kind === 'vertex') {
      const w = this.snapW(d.pane, mx, my, d.v.sid);
      if (!w) return;
      sc.live('shapes', st => {
        const s = st.shapes.find(q => q.id === d.v.sid);
        if (!s) return;
        s.geom[d.v.pi][d.v.ri][d.v.vi] = w;
        if (s.quad && d.qi >= 0) s.quad[d.qi] = w;
      });
    } else if (d.kind === 'item') {
      const w = this.toW(d.pane, mx, my);
      if (!w) return;
      sc.live('items', st => {
        const it = st.items.find(i => i.id === d.id);
        if (it) { it.x = w[0]; it.y = w[1]; }
      });
    } else if (d.kind === 'rect' || d.kind === 'ellipse') {
      const b = this.snapPane(d.pane, mx, my);
      if (b) { d.b = b; d.sb = [mx, my]; }
    } else if (d.kind === 'line') {
      const b = this.snapW(d.pane, mx, my);
      if (b) { d.b = b; d.sb = [mx, my]; }
    } else if (d.kind === 'paint') {
      const w = this.toW(d.pane, mx, my);
      if (!w) return;
      const last = d.pts[d.pts.length - 1];
      if (Math.hypot(w[0] - last[0], w[1] - last[1]) > this.brush * 0.3) d.pts.push(w);
    } else if (d.kind === 'marquee') {
      d.b = [mx, my];
    }
  }

  dragEnd(d, mx, my, e) {
    const sc = this.app.scene;
    if (d.kind === 'proj') sc.end('proj');
    else if (d.kind === 'calib') sc.end('calib');
    else if (d.kind === 'move') sc.end('shapes');
    else if (d.kind === 'item') sc.end('items');
    else if (d.kind === 'vertex') {
      sc.live('shapes', st => {
        const s = st.shapes.find(q => q.id === d.v.sid);
        if (s) {
          const g = P.normalize(s.geom);
          if (g.length) s.geom = g;
        }
      });
      sc.end('shapes');
    } else if (d.kind === 'rect' || d.kind === 'ellipse') {
      if (Math.hypot(d.sb[0] - d.sa[0], d.sb[1] - d.sa[1]) < 4) return;
      const ring = (d.kind === 'rect' ? rectRing(d.a, d.b) : ellipseRing(d.a, d.b)).map(p => this.paneToW(d.pane, p));
      if (ring.some(p => !p)) return;
      const quad = d.kind === 'rect' ? orderQuad(ring) : null;
      this.commitGeom(P.fromRing(ring), this.modeFor(e), quad ? { quad } : {});
    } else if (d.kind === 'line') {
      if (Math.hypot(d.sb[0] - d.sa[0], d.sb[1] - d.sa[1]) < 3) return;
      this.commitGeom(P.stroke([d.a, d.b], this.brush), this.modeFor(e));
    } else if (d.kind === 'paint') {
      const g = P.stroke(d.pts, this.brush);
      if (d.erase) this.commitGeom(g, 'sub', { erase: true });
      else this.paint(g, e);
    } else if (d.kind === 'marquee') {
      const x0 = Math.min(d.a[0], d.b[0]), x1 = Math.max(d.a[0], d.b[0]), y0 = Math.min(d.a[1], d.b[1]), y1 = Math.max(d.a[1], d.b[1]);
      if (x1 - x0 < 3 && y1 - y0 < 3) return;
      for (const s of this.st.shapes) {
        let hit = false;
        for (const poly of s.geom) for (const r of poly) for (const p of r) {
          const q = this.wToS(d.pane, p[0], p[1]);
          if (q && q[0] >= x0 && q[0] <= x1 && q[1] >= y0 && q[1] <= y1) { hit = true; break; }
        }
        if (hit) this.sel.add(s.id);
      }
      this.selChanged();
    }
  }

  paint(g, e) {
    const mode = this.modeFor(e);
    const sel = this.selected();
    if (mode === 'new' && sel.length === 1 && overlaps(sel[0].geom, P.offset(g, 0.05))) this.commitGeom(g, 'add');
    else this.commitGeom(g, mode);
  }

  commitGeom(g, mode, extra = {}) {
    if (!g || !g.length) return;
    let created = null, missed = false;
    this.app.scene.commit('shapes', st => {
      const selected = st.shapes.filter(s => this.sel.has(s.id));
      if (mode === 'sub') {
        const targets = selected.length ? selected : st.shapes.filter(s => overlaps(s.geom, g));
        missed = !targets.length;
        for (const s of targets) s.geom = P.diff(s.geom, g);
        st.shapes = st.shapes.filter(s => s.geom.length);
        return;
      }
      if (mode === 'int' && selected.length) {
        for (const s of selected) s.geom = P.inter(s.geom, g);
        st.shapes = st.shapes.filter(s => s.geom.length);
        return;
      }
      if (mode === 'add' && selected.length) {
        const s = selected[selected.length - 1];
        s.geom = P.union(s.geom, g);
        if (s.quad && !extra.quad) s.quad = null;
        return;
      }
      const s = makeShape(this.type, g, extra);
      s.name = this.autoName(st, this.type);
      st.shapes.push(s);
      created = s.id;
    });
    if (created) this.sel = new Set([created]);
    if (missed && !extra.erase) this.app.ui.toast('Nie było z czego wyciąć. Narysuj jeszcze raz, teraz powstanie nowy kształt.', 3000);
    this.selChanged();
  }

  autoName(st, type) {
    const n = st.shapes.filter(s => s.type === type).length + 1;
    return `${TYPES[type].label} ${n}`;
  }

  setType(type) {
    this.type = type;
    if (this.sel.size) {
      this.app.scene.commit('shapes', st => {
        for (const s of st.shapes) {
          if (!this.sel.has(s.id) || s.type === type) continue;
          const auto = s.name && s.name.startsWith(TYPES[s.type].label);
          s.type = type;
          s.props = { ...defaultProps(type) };
          if (auto) s.name = this.autoName(st, type);
        }
      });
    }
    this.app.ui.render();
  }

  op(name) {
    const sel = this.selected();
    if (!sel.length) return;
    const ids = new Set(sel.map(s => s.id));
    this.app.scene.commit('shapes', st => {
      const list = st.shapes.filter(s => ids.has(s.id));
      const first = list[0];
      if (name === 'union' || name === 'diff' || name === 'inter') {
        if (list.length < 2) return;
        const rest = list.slice(1).flatMap(s => s.geom);
        first.geom = name === 'union' ? P.union(first.geom, rest) : name === 'diff' ? P.diff(first.geom, rest) : P.inter(first.geom, rest);
        first.quad = null;
        st.shapes = st.shapes.filter(s => s === first || !ids.has(s.id));
        st.shapes = st.shapes.filter(s => s.geom.length);
        return;
      }
      for (const s of list) {
        const b = P.bbox(s.geom);
        if (name === 'grow') s.geom = P.offset(s.geom, 1, false);
        else if (name === 'shrink') s.geom = P.offset(s.geom, -1, false);
        else if (name === 'round') s.geom = P.offset(P.offset(s.geom, -0.9), 0.9);
        else if (name === 'simplify') s.geom = P.simplify(s.geom, 0.3);
        else if (name === 'mirrorX') { s.geom = P.mirror(s.geom, 'x', b.cx); if (s.quad) s.quad = orderQuad(s.quad.map(p => [2 * b.cx - p[0], p[1]])); }
        else if (name === 'mirrorY') { s.geom = P.mirror(s.geom, 'y', b.cy); if (s.quad) s.quad = orderQuad(s.quad.map(p => [p[0], 2 * b.cy - p[1]])); }
        if (name === 'grow' || name === 'shrink' || name === 'round' || name === 'simplify') s.quad = null;
      }
      st.shapes = st.shapes.filter(s => s.geom.length);
      if (name === 'front') st.shapes = [...st.shapes.filter(s => !ids.has(s.id)), ...st.shapes.filter(s => ids.has(s.id))];
      if (name === 'back') st.shapes = [...st.shapes.filter(s => ids.has(s.id)), ...st.shapes.filter(s => !ids.has(s.id))];
    });
    if (name === 'union' || name === 'diff' || name === 'inter') this.sel = new Set([sel[0].id]);
    this.selChanged();
  }

  duplicate() {
    const copies = [];
    this.app.scene.commit('shapes', st => {
      for (const s of st.shapes.filter(q => this.sel.has(q.id))) {
        const c = clone(s);
        c.id = newId('s');
        c.geom = P.translate(c.geom, 3, -3);
        if (c.quad) c.quad = c.quad.map(p => [p[0] + 3, p[1] - 3]);
        c.name = s.name ? s.name + ' kopia' : '';
        copies.push(c);
      }
      st.shapes.push(...copies);
    });
    if (copies.length) this.sel = new Set(copies.map(c => c.id));
    this.selChanged();
  }

  remove() {
    if (!this.sel.size) return;
    this.app.scene.commit('shapes', st => { st.shapes = st.shapes.filter(s => !this.sel.has(s.id)); });
    this.sel.clear();
    this.selChanged();
  }

  nudge(dx, dy) {
    if (!this.sel.size) return;
    this.app.scene.commit('shapes', st => {
      for (const s of st.shapes) {
        if (!this.sel.has(s.id)) continue;
        s.geom = P.translate(s.geom, dx, dy);
        if (s.quad) s.quad = s.quad.map(p => [p[0] + dx, p[1] + dy]);
      }
    });
  }

  nudgeCalib(dx, dy) {
    const i = this.calSel;
    this.app.scene.commit('calib', st => {
      const q = clone(st.calibJ);
      if (i >= 0) { q[i][0] += dx; q[i][1] += dy; }
      else for (const c of q) { c[0] += dx; c[1] += dy; }
      if (convex(q)) { st.calibJ = q; st.calibrated = true; }
    });
  }

  key(e) {
    const step = this.app.step;
    const k = e.key;
    const mod = e.metaKey || e.ctrlKey;
    if (k === ' ') { this.spaceDown = e.type === 'keydown'; return true; }
    if (e.type !== 'keydown') return false;
    if (step === 3 && k.startsWith('Arrow')) {
      const s = e.shiftKey ? 10 : 1;
      this.nudgeCalib(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0);
      return true;
    }
    if (step === 3 && k === 'Tab') { this.calSel = (this.calSel + 1) % 4; this.app.overlayDirty(); return true; }
    if (step !== 4) return false;
    if (this.poly) {
      if (k === 'Enter') { this.finishPoly(); return true; }
      if (k === 'Escape') { this.poly = null; this.app.ui.hint(this.hint()); this.app.overlayDirty(); return true; }
      if (k === 'Backspace') { this.poly.pts.pop(); if (!this.poly.pts.length) this.poly = null; this.app.overlayDirty(); return true; }
    }
    if (mod && k.toLowerCase() === 'd') { this.duplicate(); return true; }
    if (mod && k.toLowerCase() === 'a') { this.sel = new Set(this.st.shapes.map(s => s.id)); this.selChanged(); return true; }
    if (mod) return false;
    if (k === 'Escape') { this.sel.clear(); this.selChanged(); return true; }
    if (k === 'Delete' || k === 'Backspace') { this.remove(); return true; }
    if (k === '[') { this.brush = Math.max(0.3, +(this.brush / 1.25).toFixed(2)); this.app.ui.render(); this.app.overlayDirty(); return true; }
    if (k === ']') { this.brush = Math.min(8, +(this.brush * 1.25).toFixed(2)); this.app.ui.render(); this.app.overlayDirty(); return true; }
    if (k.startsWith('Arrow') && this.sel.size) {
      const s = e.shiftKey ? 5 : 0.5;
      this.nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? s : k === 'ArrowDown' ? -s : 0);
      return true;
    }
    const types = Object.keys(TYPES);
    if (/^[1-9]$/.test(k)) { this.setType(types[+k - 1]); return true; }
    const t = TOOLS.find(q => q.key === k.toLowerCase());
    if (t) { this.setTool(t.id); return true; }
    return false;
  }

  draw() {
    const ctx = this.ctx, v = this.views;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, v.h);
    for (const pane of [v.room, v.editor]) {
      if (!pane.on) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(pane.x, pane.y, pane.w, pane.h);
      ctx.clip();
      this.drawPane(pane);
      ctx.restore();
    }
    if (v.room.on && v.inset.on && this.app.step >= 2 && this.st.settings.inset) this.drawInset();
  }

  path(pane, ring, closed) {
    const ctx = this.ctx;
    let on = false, n = 0;
    for (const p of ring) {
      const s = this.wToS(pane, p[0], p[1]);
      if (!s) { on = false; continue; }
      if (!on) { ctx.moveTo(s[0], s[1]); on = true; } else ctx.lineTo(s[0], s[1]);
      n++;
    }
    if (closed && n === ring.length && n > 2) ctx.closePath();
  }

  shapePath(pane, geom) {
    for (const poly of geom) for (const r of poly) this.path(pane, r, true);
  }

  label(x, y, text, color = 'rgba(230,236,255,0.9)', bg = 'rgba(7,8,12,0.72)') {
    const ctx = this.ctx;
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 20, 6);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 6, y + 10.5);
    return w;
  }

  drawPane(pane) {
    const ctx = this.ctx, step = this.app.step;
    const t = pane.id === 'room' ? 'POKÓJ · podgląd z projektora' : 'ŚCIANA · wyprostowana, w cm';
    let y = pane.y + 12;
    if (step === 5) {
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
      const x0 = pane.x + 12, x1 = x0 + ctx.measureText(t).width + 12;
      if (x1 > this.w / 2 - 150 && x0 < this.w / 2 + 150) y += 36;
    }
    if (this.w >= 560) this.label(pane.x + 12, y, t);
    if (!this.space.ok && pane.id === 'editor') {
      this.label(pane.x + pane.w / 2 - 150, pane.y + pane.h / 2 - 10, 'Krzyżyki kalibracji są ułożone krzywo, popraw je w kroku 3', '#ffd23d');
      return;
    }
    if (step === 2 && pane.id === 'room') this.drawProjector(pane);
    if (step === 3) this.drawCalib(pane);
    if (step === 4) this.drawEdit(pane);
  }

  drawProjector(pane) {
    const ctx = this.ctx, q = this.st.projQuad;
    const s = q.map(p => this.views.toScreen(pane, p[0], p[1]));
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    s.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of s) {
      ctx.fillStyle = 'rgba(7,8,12,0.8)';
      ctx.beginPath(); ctx.arc(p[0], p[1], 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    }
    this.label(s[0][0] + 12, s[0][1] + 10, 'Obraz projektora');
  }

  drawCalib(pane) {
    const ctx = this.ctx, st = this.st;
    if (pane.id === 'room') {
      st.calibJ.forEach((j, i) => {
        const s = this.jToS(pane, j[0], j[1]);
        if (!s) return;
        ctx.strokeStyle = CAL_COLORS[i];
        ctx.lineWidth = this.calSel === i ? 3 : 1.5;
        ctx.beginPath(); ctx.arc(s[0], s[1], 15, 0, Math.PI * 2); ctx.stroke();
        this.label(s[0] + 14, s[1] + 12, ['lewy górny', 'prawy górny', 'prawy dolny', 'lewy dolny'][i], CAL_COLORS[i]);
      });
    } else {
      const { w, h } = st.calibCm;
      const c = [[0, h], [w, h], [w, 0], [0, 0]].map(p => this.wToS(pane, p[0], p[1]));
      if (c.some(p => !p)) return;
      ctx.strokeStyle = 'rgba(255,240,190,0.95)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      c.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      ctx.stroke();
      c.forEach((p, i) => { ctx.fillStyle = CAL_COLORS[i]; ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fill(); });
      this.label((c[0][0] + c[1][0]) / 2 - 22, c[0][1] - 28, `${+w.toFixed(1)} cm`, '#fff0be');
      this.label(c[0][0] - 64, (c[0][1] + c[3][1]) / 2 - 10, `${+h.toFixed(1)} cm`, '#fff0be');
    }
  }

  drawEdit(pane) {
    const ctx = this.ctx, st = this.st, pal = this.pal;
    if (pane.id === 'editor') {
      ctx.strokeStyle = 'rgba(160,175,210,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      this.shapePath(pane, this.space.area);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const s of st.shapes) {
      if (s.type !== 'mask') continue;
      ctx.beginPath();
      this.shapePath(pane, s.geom);
      ctx.fillStyle = this.hatch();
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(200,210,235,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (this.hover && !this.sel.has(this.hover.sid) && !this.drag) {
      const s = st.shapes.find(q => q.id === this.hover.sid);
      if (s) {
        ctx.beginPath();
        this.shapePath(pane, s.geom);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    for (const s of this.selected()) {
      ctx.beginPath();
      this.shapePath(pane, s.geom);
      ctx.strokeStyle = pal[s.type] || '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 0.75;
      ctx.stroke();
      if (this.tool === 'vertex' || this.sel.size === 1) {
        const big = this.tool === 'vertex';
        for (const poly of s.geom) for (const r of poly) for (const p of r) {
          const q = this.wToS(pane, p[0], p[1]);
          if (!q) continue;
          const k = big ? 4 : 2;
          ctx.fillStyle = big ? '#0b0d12' : '#fff';
          ctx.fillRect(q[0] - k, q[1] - k, k * 2, k * 2);
          if (big) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.strokeRect(q[0] - k, q[1] - k, k * 2, k * 2); }
        }
      }
      if (s.quad && (s.type === 'screen' || s.type === 'lucky')) {
        const q0 = this.wToS(pane, s.quad[0][0], s.quad[0][1]);
        if (q0) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(q0[0], q0[1], 3, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    if (pane.id === 'editor' || this.tool === 'items') this.drawItems(pane);
    this.drawPreview(pane);
    if (this.snapHit && this.mouse) {
      const q = this.wToS(pane, this.snapHit[0], this.snapHit[1]);
      if (q) { ctx.strokeStyle = '#ffd23d'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q[0], q[1], 6, 0, Math.PI * 2); ctx.stroke(); }
    }
  }

  drawItems(pane) {
    const ctx = this.ctx, pal = this.pal;
    const active = this.tool === 'items';
    for (const it of this.st.items) {
      const q = this.wToS(pane, it.x, it.y);
      if (!q) continue;
      if (!active && it.type === 'coin') continue;
      const col = it.type === 'coin' ? pal.coin : it.type === 'goal' ? pal.goal : '#ffffff';
      ctx.strokeStyle = col;
      ctx.lineWidth = active ? 1.5 : 1;
      ctx.globalAlpha = active ? 1 : 0.6;
      ctx.beginPath();
      ctx.arc(q[0], q[1], active ? 5 : 3.5, 0, Math.PI * 2);
      ctx.stroke();
      if (it.type !== 'coin') this.label(q[0] + 8, q[1] - 24, ITEM_TYPES[it.type], col);
      ctx.globalAlpha = 1;
    }
  }

  drawPreview(pane) {
    const ctx = this.ctx, d = this.drag, pal = this.pal;
    const col = pal[this.type] || '#fff';
    const sub = (this.mouse && this.mouse.alt) || this.bool === 'sub' || (d && d.erase);
    const strokeCol = sub ? '#ffffff' : col;
    const fill = () => {
      ctx.fillStyle = sub ? 'rgba(255,255,255,0.08)' : alpha(col, 0.14);
      ctx.fill('evenodd');
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(sub ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (d && (d.kind === 'rect' || d.kind === 'ellipse')) {
      const ring = (d.kind === 'rect' ? rectRing(d.a, d.b) : ellipseRing(d.a, d.b)).map(p => this.paneToW(d.pane, p));
      if (ring.every(Boolean)) { ctx.beginPath(); this.path(pane, ring, true); fill(); }
    } else if (d && d.kind === 'line') {
      this.strokePreview(pane, [d.a, d.b], strokeCol);
    } else if (d && d.kind === 'paint') {
      this.strokePreview(pane, d.pts, strokeCol);
    } else if (d && d.kind === 'marquee' && pane === d.pane) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.rect(Math.min(d.a[0], d.b[0]), Math.min(d.a[1], d.b[1]), Math.abs(d.b[0] - d.a[0]), Math.abs(d.b[1] - d.a[1]));
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.poly) {
      const pts = this.poly.pts.slice();
      const m = this.mouse && this.toW(this.mouse.pane, this.mouse.mx, this.mouse.my);
      if (m) pts.push(this.snapHit || m);
      ctx.beginPath();
      this.path(pane, pts, false);
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      this.poly.pts.forEach((p, i) => {
        const q = this.wToS(pane, p[0], p[1]);
        if (!q) return;
        ctx.fillStyle = i === 0 ? strokeCol : '#0b0d12';
        ctx.strokeStyle = strokeCol;
        ctx.beginPath(); ctx.arc(q[0], q[1], i === 0 ? 5 : 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    }
    if (!d && this.mouse && this.mouse.pane === pane && ['brush', 'eraser', 'line'].includes(this.tool)) {
      const r = this.brush / this.tolW(pane, this.mouse.mx, this.mouse.my, 1);
      ctx.strokeStyle = this.tool === 'eraser' ? '#ffffff' : col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(this.mouse.mx, this.mouse.my, Math.max(2, r), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  strokePreview(pane, pts, col) {
    const ctx = this.ctx;
    const a = pts[0] && this.wToS(pane, pts[0][0], pts[0][1]);
    if (!a) return;
    const mx = a[0], my = a[1];
    const per = this.tolW(pane, mx, my, 1);
    ctx.beginPath();
    this.path(pane, pts, false);
    if (pts.length === 1) ctx.lineTo(mx + 0.1, my);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, (this.brush * 2) / per);
    ctx.strokeStyle = alpha(col, 0.33);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  hatch() {
    if (this._hatch) return this._hatch;
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(210,220,245,0.35)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.stroke();
    this._hatch = this.ctx.createPattern(c, 'repeat');
    return this._hatch;
  }

  drawInset() {
    const ctx = this.ctx, i = this.views.inset, st = this.st;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(i.x - 0.5, i.y - 0.5, i.w + 1, i.h + 1);
    this.label(i.x, i.y - 24, i.w < 230 ? `HDMI · ${st.proj.jw}×${st.proj.jh}` : `HDMI → projektor · ${st.proj.jw}×${st.proj.jh}`);
  }
}
