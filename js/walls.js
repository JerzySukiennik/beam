// Beam: wall photos (built-in demos and uploads kept in IndexedDB) and turning demo annotations in photo pixels into a scene.

import * as H from './math/homography.js';
import * as P from './math/poly.js';
import { Space } from './space.js';
import { blankState, makeShape, newId } from './scene.js';

const DB = 'beam', STORE = 'photos', LIST = 'beam.v1.walls';

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}

export function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image ' + url));
    img.src = url;
  });
}

export function defaultQuad(w, h, aspect = 16 / 9) {
  let qw = w * 0.82, qh = qw / aspect;
  if (qh > h * 0.82) { qh = h * 0.82; qw = qh * aspect; }
  const x0 = (w - qw) / 2, y0 = (h - qh) / 2;
  return [[x0, y0], [x0 + qw, y0], [x0 + qw, y0 + qh], [x0, y0 + qh]];
}

export function presetQuad(kind, w, h) {
  const q = defaultQuad(w, h);
  const [tl, tr, br, bl] = q;
  const qw = tr[0] - tl[0], qh = bl[1] - tl[1];
  const k = 0.12;
  if (kind === 'left') return [[tl[0], tl[1] + qh * k], [tr[0], tr[1] - qh * k * 0.4], [br[0], br[1] + qh * k * 0.4], [bl[0], bl[1] - qh * k]];
  if (kind === 'right') return [[tl[0], tl[1] - qh * k * 0.4], [tr[0], tr[1] + qh * k], [br[0], br[1] - qh * k], [bl[0], bl[1] + qh * k * 0.4]];
  if (kind === 'below') return [[tl[0] - qw * k * 0.6, tl[1]], [tr[0] + qw * k * 0.6, tr[1]], [br[0] - qw * k * 0.3, br[1]], [bl[0] + qw * k * 0.3, bl[1]]];
  return q;
}

export class Walls {
  constructor() {
    this.list = [];
    this.byId = new Map();
  }

  async load() {
    const res = await fetch('assets/walls/walls.json');
    const data = await res.json();
    for (const w of data.walls) this.add({ ...w, builtin: true });
    let ups = [];
    try { ups = JSON.parse(localStorage.getItem(LIST) || '[]'); } catch (e) { ups = []; }
    for (const u of ups) this.add({ ...u, builtin: false });
  }

  add(w) {
    if (this.byId.has(w.id)) return;
    this.list.push(w);
    this.byId.set(w.id, w);
  }

  get(id) { return this.byId.get(id); }

  saveList() {
    const ups = this.list.filter(w => !w.builtin).map(({ id, name, size, projQuad }) => ({ id, name, size, projQuad }));
    try { localStorage.setItem(LIST, JSON.stringify(ups)); } catch (e) { }
  }

  async image(wall) {
    if (wall.img) return wall.img;
    let url = wall.src;
    if (!wall.builtin) {
      const blob = await idbDo('readonly', s => s.get(wall.id));
      if (!blob) throw new Error('missing photo');
      url = URL.createObjectURL(blob);
    }
    wall.img = await loadImage(url);
    return wall.img;
  }

  async thumb(wall) {
    if (wall.builtin) return wall.src;
    const img = await this.image(wall);
    return img.src;
  }

  async upload(file) {
    const src = await loadImage(URL.createObjectURL(file));
    const k = Math.min(1, 2000 / Math.max(src.naturalWidth, src.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(src.naturalWidth * k);
    c.height = Math.round(src.naturalHeight * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const id = 'u' + Date.now().toString(36);
    await idbDo('readwrite', s => s.put(blob, id));
    const name = (file.name || '').replace(/\.[^.]+$/, '').slice(0, 22) || 'Moja ściana';
    const wall = { id, name, size: [c.width, c.height], projQuad: defaultQuad(c.width, c.height), builtin: false };
    this.add(wall);
    this.saveList();
    return wall;
  }

  async remove(id) {
    const w = this.byId.get(id);
    if (!w || w.builtin) return;
    this.list = this.list.filter(x => x.id !== id);
    this.byId.delete(id);
    this.saveList();
    try { await idbDo('readwrite', s => s.delete(id)); } catch (e) { }
    try { localStorage.removeItem('beam.v1.scene.' + id); } catch (e) { }
  }
}

function rectCorners(r) {
  const [x0, y0, x1, y1] = r;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

function ringOf(def) {
  if (def.rect) return rectCorners(def.rect);
  if (def.quad) return def.quad;
  if (def.poly) return def.poly;
  if (def.circle) {
    const [cx, cy, r] = def.circle;
    return Array.from({ length: 40 }, (_, i) => [cx + Math.cos((i / 40) * Math.PI * 2) * r, cy + Math.sin((i / 40) * Math.PI * 2) * r]);
  }
  if (def.ellipse) {
    const [cx, cy, rx, ry] = def.ellipse;
    return Array.from({ length: 44 }, (_, i) => [cx + Math.cos((i / 44) * Math.PI * 2) * rx, cy + Math.sin((i / 44) * Math.PI * 2) * ry]);
  }
  if (def.line) return null;
  return null;
}

function geomOf(def, toW) {
  if (def.line) {
    const pts = def.line.map(toW);
    if (pts.some(p => !p)) return null;
    return P.stroke(pts, def.width || 1);
  }
  const ring = ringOf(def);
  if (!ring) return null;
  const w = ring.map(toW);
  if (w.some(p => !p)) return null;
  let g = P.fromRing(w);
  for (const hole of def.holes || []) {
    const hr = ringOf(hole);
    if (!hr) continue;
    const hw = hr.map(toW);
    if (hw.some(p => !p)) continue;
    g = P.diff(g, P.fromRing(hw));
  }
  return g;
}

export function demoState(wall) {
  const st = blankState(wall);
  const d = wall.demo;
  if (!d) return st;
  const J = [[0, 0], [st.proj.jw, 0], [st.proj.jw, st.proj.jh], [0, st.proj.jh]];
  const HPJ = H.inv(H.solve(J, st.projQuad));
  st.calibJ = d.calib.map(p => H.apply(HPJ, p[0], p[1]));
  st.calibCm = { w: d.calibCm[0], h: d.calibCm[1] };
  st.calibrated = true;
  Object.assign(st.settings, d.settings || {});
  const sp = new Space();
  sp.update(st);
  const toW = p => sp.pToW(p[0], p[1]);
  for (const def of d.shapes) {
    const geom = geomOf(def, toW);
    if (!geom || !geom.length) continue;
    let quad = null;
    const qsrc = def.quad || (def.rect && (def.type === 'screen' || def.type === 'lucky') ? rectCorners(def.rect) : null);
    if (qsrc) {
      const q = qsrc.map(toW);
      if (q.every(Boolean)) quad = q;
    }
    st.shapes.push(makeShape(def.type, geom, { name: def.name || '', quad, props: def.props || {} }));
  }
  for (const it of d.items || []) {
    const p = toW([it[1], it[2]]);
    if (p) st.items.push({ id: newId('i'), type: it[0], x: p[0], y: p[1] });
  }
  return st;
}
