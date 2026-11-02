// Beam: the room. Phones join from a QR code as gamepads and wall editors (WebRTC, with an RTDB relay as fallback).
// The editor stays the only source of truth: it feeds their buttons to the game, applies their edits and streams the
// wall back to them. It also owns the QR card and the four photo markers drawn into the projector image.

import { createHost } from './net/index.js';
import { PROTO, MAX_PADS, BTN, PAD_COLORS, padUrl } from './net/protocol.js';
import { TYPES, makeShape, defaultProps } from './scene.js';
import * as H from './math/homography.js';
import * as P from './math/poly.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';
const PREFS = 'beam.v1.room';
const SESSION = 'beam.v1.room.session';
const IDLE = { left: false, right: false, jump: false, jumpPressed: false, down: false, grab: false };
const MARKS = [[0.18, 0.2], [0.82, 0.2], [0.82, 0.8], [0.18, 0.8]];
const CORNERS = { tl: [0.16, 0.2], tr: [0.84, 0.2], bl: [0.16, 0.8], br: [0.84, 0.8] };

const round2 = v => Math.round(v * 100) / 100;

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
}

function cleanGeom(g) {
  if (!Array.isArray(g) || !g.length || g.length > 24) return null;
  let n = 0;
  const out = [];
  for (const poly of g) {
    if (!Array.isArray(poly) || !poly.length || poly.length > 24) return null;
    const rings = [];
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 3) return null;
      const r = [];
      for (const p of ring) {
        if (!Array.isArray(p) || !isFinite(p[0]) || !isFinite(p[1]) || Math.abs(p[0]) > 1e4 || Math.abs(p[1]) > 1e4) return null;
        r.push([+p[0], +p[1]]);
        if (++n > 4000) return null;
      }
      rings.push(r);
    }
    out.push(rings);
  }
  return out;
}

export class Room {
  constructor(app) {
    this.app = app;
    this.host = null;
    this.code = null;
    this.state = 'off';
    this.pads = new Map();
    this.seq = 0;
    this.qr = null;
    this.marks = new Map();
    this.rev = 0;
    this.sceneTimer = 0;
    this.rosterTimer = 0;
    this.boxCache = null;
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (e) { p = {}; }
    this.onWall = p.onWall !== false;
    this.corner = CORNERS[p.corner] ? p.corner : 'tr';
    setInterval(() => this.tick(), 1000);
  }

  get open() { return !!this.host; }

  savePrefs() {
    try { localStorage.setItem(PREFS, JSON.stringify({ onWall: this.onWall, corner: this.corner })); } catch (e) { }
  }

  async start() {
    if (this.host || this.state === 'opening') return;
    this.state = 'opening';
    this.app.onRoom();
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION) || 'null'); } catch (e) { saved = null; }
    this.key = (saved && saved.k) || Math.random().toString(36).slice(2, 14);
    try {
      this.host = await createHost({
        code: saved && saved.code,
        key: this.key,
        onConnect: cid => this.connect(cid),
        onLeave: cid => this.leave(cid),
        onMsg: (cid, m) => this.msg(cid, m),
        onStream: (cid, m) => this.input(cid, m),
        onOnline: code => this.online(code),
      });
      this.code = this.host.code;
    } catch (e) {
      this.host = null;
      this.state = 'error';
      this.app.onRoom();
    }
  }

  resume() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(SESSION) || 'null'); } catch (e) { saved = null; }
    if (saved && saved.code) this.start();
  }

  async retry() {
    if (this.host) await this.stop();
    await this.start();
  }

  async stop() {
    const h = this.host;
    this.host = null;
    this.state = 'off';
    this.code = null;
    this.qr = null;
    const gone = this.roster();
    this.pads.clear();
    this.marks.clear();
    try { sessionStorage.removeItem(SESSION); } catch (e) { }
    for (const p of gone) this.app.onPads('leave', p);
    if (h) { try { await h.close(); } catch (e) { } }
    this.app.onRoom();
  }

  async online(code) {
    if (!this.host) return;
    if (code) {
      this.code = code;
      this.state = 'online';
      try { sessionStorage.setItem(SESSION, JSON.stringify({ code, k: this.key })); } catch (e) { }
      await this.makeQr();
    } else {
      this.state = 'offline';
    }
    this.app.onRoom();
  }

  url() { return this.code ? padUrl(this.code) : ''; }

  async makeQr() {
    const url = this.url();
    let make = null;
    try { make = (await import(QR_LIB)).default; } catch (e) { make = null; }
    if (!make) { this.qr = { url, card: null, img: null }; return; }
    const q = make(0, 'M');
    q.addData(url);
    q.make();
    const n = q.getModuleCount();
    const m = 10, quiet = 2, cap = 5;
    const card = document.createElement('canvas');
    card.width = (n + quiet * 2) * m;
    card.height = (n + quiet * 2 + cap) * m;
    const c = card.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, card.width, card.height);
    c.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) c.fillRect((k + quiet) * m, (r + quiet) * m, m, m);
    c.font = `800 ${Math.round(m * 3.4)}px system-ui, -apple-system, Helvetica, Arial, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(this.code.split('').join(' '), card.width / 2, (n + quiet * 2 + cap / 2 - 0.6) * m);
    const s = 6;
    const panel = document.createElement('canvas');
    panel.width = panel.height = (n + 2) * s;
    const pc = panel.getContext('2d');
    pc.fillStyle = '#fff';
    pc.fillRect(0, 0, panel.width, panel.height);
    pc.fillStyle = '#000';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) pc.fillRect((k + 1) * s, (r + 1) * s, s, s);
    this.qr = { url, card, img: panel.toDataURL('image/png') };
    this.boxCache = null;
    this.app.renderer.setQr(card);
  }

  setWall(on) {
    this.onWall = !!on;
    this.savePrefs();
    this.app.invalidate();
  }

  setCorner(c) {
    if (!CORNERS[c]) return;
    this.corner = c;
    this.boxCache = null;
    this.savePrefs();
    this.app.invalidate();
  }

  layoutChanged() {
    this.boxCache = null;
  }

  wallQr() {
    const a = this.app;
    if (this.state !== 'online' || !this.onWall || !this.qr || !this.qr.card || a.step < 4) return null;
    if (this.boxCache == null) this.boxCache = this.qrBox() || false;
    return this.boxCache || null;
  }

  qrBox() {
    const sp = this.app.space;
    if (!sp.ok) return null;
    const { jw, jh } = sp, card = this.qr.card, asp = card.height / card.width;
    const b = sp.box, m = Math.min(jw, jh) * 0.03;
    const [fx, fy] = CORNERS[this.corner];
    let S = Math.max(12, Math.min(30, Math.min(b.w, b.h) * 0.24));
    for (let i = 0; i < 40; i++) {
      const k = (i % 10) / 10;
      const c = sp.jToW(jw * (fx + (0.5 - fx) * k), jh * (fy + (0.5 - fy) * k));
      if (c) {
        const box = { x0: c[0] - S / 2, x1: c[0] + S / 2, y0: c[1] - (S * asp) / 2, y1: c[1] + (S * asp) / 2 };
        const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]].map(p => sp.wToJ(p[0], p[1]));
        if (pts.every(p => p && p[0] > m && p[0] < jw - m && p[1] > m && p[1] < jh - m)) return box;
      }
      if (i % 10 === 9) S *= 0.8;
    }
    return null;
  }

  markJ() {
    const sp = this.app.space;
    return MARKS.map(([u, v]) => [u * sp.jw, v * sp.jh]);
  }

  marksOn() { return this.marks.size > 0 && this.app.space.ok; }

  mark(cid, on) {
    if (on) this.marks.set(cid, Date.now() + 180000); else this.marks.delete(cid);
    this.app.invalidate();
  }

  tick() {
    const now = Date.now();
    let changed = false;
    for (const [cid, t] of this.marks) if (t < now || !this.pads.has(cid)) { this.marks.delete(cid); changed = true; }
    if (changed) this.app.invalidate();
  }

  roster() {
    return [...this.pads.values()].filter(p => p.ready).sort((a, b) => a.order - b.order);
  }

  info() {
    const a = this.app, st = a.scene.state;
    return { mode: st.settings.mode, step: a.step, playing: a.step === 5 && a.game.running, wall: a.walls.get(st.wallId)?.name || '', live: a.live };
  }

  connect(cid) {
    const p = this.pads.get(cid);
    if (p) p.conn = this.host.mode(cid);
  }

  leave(cid) {
    const p = this.pads.get(cid);
    this.marks.delete(cid);
    if (!p) return;
    this.pads.delete(cid);
    if (p.ready) this.app.onPads('leave', p);
    this.sendRoster();
  }

  kick(cid) {
    if (!this.host) return;
    this.host.send(cid, { t: 'kicked' });
    setTimeout(() => { if (this.host) this.host.kick(cid); this.leave(cid); }, 250);
  }

  send(cid, msg) { if (this.host) this.host.send(cid, msg); }

  msg(cid, m) {
    if (!m || typeof m.t !== 'string' || !this.host) return;
    if (m.t === 'hello') { this.hello(cid, m); return; }
    const p = this.pads.get(cid);
    if (!p || !p.ready) { this.send(cid, { t: 'who' }); return; }
    p.conn = this.host.mode(cid);
    switch (m.t) {
      case 'me': {
        const name = cleanName(m.name);
        if (name) p.name = name;
        if (m.color) p.color = this.freeColor(m.color, cid);
        this.send(cid, { t: 'me', name: p.name, color: p.color });
        this.app.onPads('update', p);
        this.sendRoster();
        break;
      }
      case 'tab':
        p.tab = m.tab === 'edit' ? 'edit' : 'pad';
        if (p.tab === 'edit') this.send(cid, this.sceneMsg());
        else this.mark(cid, false);
        this.sendRoster();
        break;
      case 'op': this.op(p, m.op); break;
      case 'marks': this.mark(cid, !!m.on); break;
      case 'photo': this.sendPhoto(cid); break;
      case 'ping': this.send(cid, { t: 'pong', at: m.at }); break;
    }
  }

  hello(cid, m) {
    if (m.v !== PROTO) { this.send(cid, { t: 'old', v: PROTO }); return; }
    let p = this.pads.get(cid);
    const fresh = !p || !p.ready;
    if (fresh && this.roster().length >= MAX_PADS) {
      this.send(cid, { t: 'full' });
      setTimeout(() => { if (this.host) this.host.kick(cid); }, 400);
      return;
    }
    if (!p) {
      p = { cid, order: ++this.seq, b: 0, jn: 0, used: 0, inAt: 0, tab: 'pad', ready: false };
      this.pads.set(cid, p);
    }
    p.name = cleanName(m.name) || `Gracz ${p.order}`;
    p.color = this.freeColor(m.color, cid);
    p.conn = this.host.mode(cid);
    p.tab = m.tab === 'edit' ? 'edit' : 'pad';
    if (typeof m.j === 'number') p.jn = p.used = m.j | 0;
    p.ready = true;
    this.send(cid, { t: 'welcome', cid, code: this.code, name: p.name, color: p.color, colors: PAD_COLORS, ...this.info() });
    if (p.tab === 'edit') this.send(cid, this.sceneMsg());
    this.app.onPads(fresh ? 'join' : 'update', p);
    this.sendRoster();
  }

  freeColor(want, cid) {
    const used = new Set(this.roster().filter(p => p.cid !== cid).map(p => p.color));
    if (PAD_COLORS.includes(want) && !used.has(want)) return want;
    return PAD_COLORS.find(c => !used.has(c)) || (PAD_COLORS.includes(want) ? want : PAD_COLORS[0]);
  }

  sendRoster() {
    if (this.rosterTimer) return;
    this.rosterTimer = setTimeout(() => {
      this.rosterTimer = 0;
      if (!this.host) return;
      const pads = this.roster().map(p => ({ cid: p.cid, name: p.name, color: p.color, tab: p.tab }));
      const msg = { t: 'roster', pads, ...this.info() };
      for (const p of this.roster()) this.send(p.cid, msg);
      this.app.onRoom();
    }, 60);
  }

  stateChanged() {
    this.sendRoster();
  }

  input(cid, m) {
    const p = this.pads.get(cid);
    if (!p || !m) return;
    p.b = m.b | 0;
    p.jn = m.j | 0;
    p.inAt = performance.now();
  }

  control(cid) {
    const p = this.pads.get(cid);
    if (!p || performance.now() - p.inAt > 1500) return IDLE;
    const b = p.b;
    return {
      left: !!(b & BTN.left),
      right: !!(b & BTN.right),
      jump: !!(b & BTN.jump),
      jumpPressed: p.jn !== p.used,
      down: !!(b & BTN.down),
      grab: !!(b & BTN.grab),
    };
  }

  consume() {
    for (const p of this.pads.values()) p.used = p.jn;
  }

  editors() {
    return this.roster().filter(p => p.tab === 'edit');
  }

  sceneChanged() {
    if (!this.host || this.sceneTimer || !this.editors().length) return;
    this.sceneTimer = setTimeout(() => {
      this.sceneTimer = 0;
      const ed = this.editors();
      if (!ed.length || !this.host) return;
      const msg = this.sceneMsg();
      for (const p of ed) this.send(p.cid, msg);
    }, 160);
  }

  sceneMsg() {
    const a = this.app, st = a.scene.state, sp = a.space, pal = a.renderer.pal;
    const g = geom => geom.map(poly => poly.map(r => r.map(p => [round2(p[0]), round2(p[1])])));
    return {
      t: 'scene',
      rev: ++this.rev,
      wall: { id: st.wallId, name: a.walls.get(st.wallId)?.name || '', live: a.live, photo: !a.live && !!a.renderer.photo },
      pm: this.photoM(),
      ok: sp.ok,
      cm: st.calibCm,
      calibJ: st.calibJ,
      J: [st.proj.jw, st.proj.jh],
      area: sp.ok ? g(sp.area) : [],
      box: sp.box,
      shapes: st.shapes.map(s => ({ id: s.id, type: s.type, geom: g(s.geom) })),
      items: (st.items || []).map(i => ({ id: i.id, type: i.type, x: round2(i.x), y: round2(i.y) })),
      colors: Object.fromEntries(Object.keys(TYPES).map(k => [k, pal[k] || pal.solid])),
      labels: Object.fromEntries(Object.entries(TYPES).map(([k, d]) => [k, d.label])),
      marks: this.markJ(),
      undo: a.scene.undoStack.length,
      redo: a.scene.redoStack.length,
    };
  }

  photoImg() {
    const a = this.app, tex = a.renderer.photo;
    const img = !a.live && tex && tex.image;
    if (!img) return null;
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) return null;
    const k = Math.min(1, 1280 / Math.max(w0, h0));
    return { img, k, w: Math.max(1, Math.round(w0 * k)), h: Math.max(1, Math.round(h0 * k)) };
  }

  photoM() {
    const ph = this.photoImg(), sp = this.app.space;
    if (!ph || !sp.ok) return null;
    return H.mul([ph.w / (ph.img.naturalWidth || ph.img.width), 0, 0, 0, ph.h / (ph.img.naturalHeight || ph.img.height), 0, 0, 0, 1], sp.HWP);
  }

  sendPhoto(cid) {
    const ph = this.photoImg();
    if (!ph) { this.send(cid, { t: 'photo', src: null }); return; }
    const c = document.createElement('canvas');
    c.width = ph.w;
    c.height = ph.h;
    c.getContext('2d').drawImage(ph.img, 0, 0, c.width, c.height);
    this.send(cid, { t: 'photo', src: c.toDataURL('image/jpeg', 0.78), w: c.width, h: c.height, wall: this.app.scene.state.wallId });
  }

  op(p, o) {
    const a = this.app;
    if (!o || typeof o.k !== 'string') return;
    const ids = new Set(Array.isArray(o.ids) ? o.ids.filter(x => typeof x === 'string').slice(0, 400) : []);
    const num = v => (typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e4 ? v : null);
    switch (o.k) {
      case 'add': {
        if (!TYPES[o.type]) return;
        const raw = cleanGeom(o.geom);
        if (!raw) return;
        const geom = P.normalize(raw);
        if (!geom.length || Math.abs(P.area(geom)) < 0.5) return;
        const s = makeShape(o.type, geom);
        a.scene.commit('shapes', st => { st.shapes.push(s); });
        this.send(p.cid, { t: 'added', id: s.id, ref: o.ref || null });
        break;
      }
      case 'move': {
        const dx = num(o.dx), dy = num(o.dy);
        if (dx === null || dy === null || !ids.size) return;
        a.scene.commit('shapes', st => {
          for (const s of st.shapes) {
            if (!ids.has(s.id)) continue;
            s.geom = P.translate(s.geom, dx, dy);
            if (s.quad) s.quad = s.quad.map(q => [q[0] + dx, q[1] + dy]);
          }
          for (const it of st.items || []) if (ids.has(it.id)) { it.x += dx; it.y += dy; }
        });
        break;
      }
      case 'del':
        if (!ids.size) return;
        a.scene.commit('shapes', st => {
          st.shapes = st.shapes.filter(s => !ids.has(s.id));
          st.items = (st.items || []).filter(i => !ids.has(i.id));
        });
        break;
      case 'type':
        if (!TYPES[o.type] || !ids.size) return;
        a.scene.commit('shapes', st => {
          for (const s of st.shapes) if (ids.has(s.id) && s.type !== o.type) { s.type = o.type; s.props = defaultProps(o.type); }
        });
        break;
      case 'undo': a.scene.undo(); break;
      case 'redo': a.scene.redo(); break;
    }
  }
}
