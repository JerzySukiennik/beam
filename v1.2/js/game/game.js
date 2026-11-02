// Beam: play mode. Builds physics from the mapped wall and runs players, coins, lucky drops, water waves, decor and the finish.
// Players come from the keyboard (0 to 2) and from phones in the room, and phones can join or leave mid-game.

import RAPIER from '@dimforge/rapier2d-compat';
import * as P from '../math/poly.js';
import { Physics, tuning } from './physics.js';
import { Player, drawFigure, hsv } from './player.js';
import { Ragdoll } from './ragdoll.js';
import { Decor } from '../render/decor.js';
import { rgb } from '../render/neon.js';

const STEP = 1 / 120;
const DROPS = { moneta: 'coin', grzyb: 'mushroom', pioro: 'feather', gwiazda: 'star' };

const scaleC = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export class Game {
  constructor(app) {
    this.app = app;
    this.phys = new Physics();
    this.decor = new Decor();
    this.running = false;
    this.players = [];
    this.coins = [];
    this.drops = [];
    this.lucky = new Map();
    this.waters = [];
    this.zones = { water: [], lava: [], lucky: [] };
    this.time = 0;
    this.clock = 0;
    this.acc = 0;
    this.got = 0;
    this.bonus = 0;
    this.finished = false;
    this.fireT = 0;
    this.fireAcc = 0;
    this.t = tuning(8);
  }

  get fx() { return this.app.renderer.particles; }
  get pal() { return this.app.renderer.pal; }

  buildStatic(state, space) {
    this.state = state;
    this.space = space;
    if (!this.running) this.t = tuning(state.settings.charSize);
    this.zones = { water: [], lava: [], lucky: [] };
    for (const s of state.shapes) {
      if (this.zones[s.type] && s.geom.length) this.zones[s.type].push({ id: s.id, geom: s.geom, box: P.bbox(s.geom), s });
    }
    this.decor.build(state, space);
    this.buildWater(state);
    const it = state.items || [];
    this.spawnPt = it.find(i => i.type === 'spawn') || null;
    this.goal = it.find(i => i.type === 'goal') || null;
    if (!this.running) this.coins = it.filter(i => i.type === 'coin').map(i => ({ x: i.x, y: i.y, got: false }));
  }

  buildWater(state) {
    this.waters = [];
    for (const s of state.shapes) {
      if (s.type !== 'water') continue;
      for (const ch of P.facingChains(s.geom, 1, 0.35)) {
        const pts = P.resample(P.closedPts(ch), 1.0);
        this.waters.push({ pts, h: new Float32Array(pts.length), v: new Float32Array(pts.length) });
      }
    }
  }

  inZone(list, x, y) {
    for (const z of list) {
      const b = z.box;
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      if (P.pointIn(z.geom, x, y)) return z;
    }
    return null;
  }

  inWater(x, y) { return !!this.inZone(this.zones.water, x, y); }
  lavaAt(x, y) { return !!this.inZone(this.zones.lava, x, y); }
  luckyAbove(x, y) {
    const z = this.inZone(this.zones.lucky, x, y);
    return z ? z.id : null;
  }

  start() {
    const st = this.state;
    this.stop();
    this.phys.build(st, this.space);
    this.t = this.phys.t;
    this.running = true;
    this.time = 0; this.clock = 0; this.acc = 0;
    this.got = 0; this.bonus = 0;
    this.finished = false; this.fireT = 0;
    this.coins = (st.items || []).filter(i => i.type === 'coin').map(i => ({ x: i.x, y: i.y, got: false }));
    for (const src of this.sources()) this.addPlayer(src);
  }

  sources() {
    const st = this.state, pal = this.pal;
    const kb = Math.max(0, Math.min(2, st.settings.players ?? 1));
    const out = [];
    for (let i = 0; i < kb; i++) out.push({ kind: 'key', id: 'k' + i, slot: i, name: kb > 1 ? `P${i + 1}` : 'Klawiatura', color: rgb(pal.players[i]) });
    for (const p of this.app.room.roster()) out.push({ kind: 'pad', id: p.cid, name: p.name, color: rgb(p.color) });
    return out;
  }

  addPlayer(src) {
    if (!this.running || this.players.some(p => p.src.id === src.id)) return null;
    const used = new Set(this.players.map(p => p.idx));
    let idx = 0;
    while (used.has(idx)) idx++;
    const C = this.state.settings.mode === 'rubbery' ? Ragdoll : Player;
    const p = new C(this, idx, src.color);
    p.src = src;
    p.name = src.name;
    this.players.push(p);
    this.respawn(p);
    return p;
  }

  removePlayer(id) {
    const i = this.players.findIndex(p => p.src.id === id);
    if (i < 0) return;
    const p = this.players[i];
    const hb = p.hitbox();
    this.fx.emit(hb.x, hb.y, 26, { color: p.color, speed: 30 * this.t.s, life: 0.6, size: 0.35 * this.t.s, drag: 3 });
    p.destroy();
    this.players.splice(i, 1);
  }

  updatePlayer(id, name, color) {
    const p = this.players.find(q => q.src.id === id);
    if (!p) return;
    p.name = p.src.name = name;
    p.color = p.src.color = color;
  }

  reload() {
    if (!this.running) return;
    this.phys.rebuild(this.state, this.space);
    const old = this.coins;
    const got = (x, y) => old.some(c => c.got && Math.abs(c.x - x) < 0.01 && Math.abs(c.y - y) < 0.01);
    this.coins = (this.state.items || []).filter(i => i.type === 'coin').map(i => ({ x: i.x, y: i.y, got: got(i.x, i.y) }));
  }

  control(p, input, kb) {
    return p.src.kind === 'pad' ? this.app.room.control(p.src.id) : input.player(p.src.slot, kb);
  }

  stop() {
    for (const p of this.players) p.destroy();
    for (const d of this.drops) if (d.body) this.phys.remove(d.body);
    this.players = [];
    this.drops = [];
    this.phys.destroy();
    this.running = false;
    this.lucky.clear();
    for (const z of this.zones.lucky) this.app.renderer.setLucky(z.id, false, 0, 0);
    if (this.state) this.coins = (this.state.items || []).filter(i => i.type === 'coin').map(i => ({ x: i.x, y: i.y, got: false }));
    this.finished = false;
    this.fx.clear();
  }

  spawnPoint() {
    if (this.spawnPt) return [this.spawnPt.x, this.spawnPt.y];
    const b = this.space.box;
    return [b.x0 + Math.min(12, b.w * 0.1), b.y0 + b.h * 0.6];
  }

  respawn(p) {
    const [x, y] = this.spawnPoint();
    const off = p.idx ? (p.idx % 2 ? 1 : -1) * Math.ceil(p.idx / 2) * 2.8 * this.t.s : 0;
    p.spawn(x + off, y + 0.3);
    this.fx.emit(x, y + 4 * this.t.s, 22, { color: p.color, speed: 20 * this.t.s, life: 0.6, size: 0.35 * this.t.s, drag: 3 });
  }

  update(dt, input) {
    if (!this.running) return;
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= STEP && steps < 8) {
      this.acc -= STEP;
      steps++;
      this.time += STEP;
      if (!this.finished) this.clock += STEP;
      const kb = this.players.filter(p => p.src.kind === 'key').length;
      for (const p of this.players) p.update(STEP, this.control(p, input, kb));
      input.consume();
      this.app.room.consume();
      this.updateDrops(STEP);
      this.phys.step();
      this.collect();
    }
    if (steps === 8) this.acc = 0;
    this.updateWater(dt);
    this.decor.update(dt, this.time, this.pushers());
    this.updateLucky(dt);
    if (this.finished) this.fireworks(dt);
    this.fx.update(dt);
  }

  pushers() {
    const out = [];
    for (const p of this.players) out.push(...p.pushers());
    return out;
  }

  collect() {
    const s = this.t.s;
    for (const p of this.players) {
      if (!p.alive) continue;
      const hb = p.hitbox();
      for (const c of this.coins) {
        if (c.got) continue;
        if (Math.hypot(c.x - hb.x, c.y - hb.y) < hb.r + 1.3 * s) {
          c.got = true;
          this.got++;
          this.fxCoin(c.x, c.y);
          this.app.onGame('coin', this.hud());
        }
      }
      for (const d of this.drops) {
        if (d.dead || d.type === 'coin' || d.t < 0.35) continue;
        if (Math.hypot(d.x - hb.x, d.y - hb.y) < hb.r + 1.6 * s) {
          d.dead = true;
          if (d.body) { this.phys.remove(d.body); d.body = null; }
          this.applyPower(p, d.type);
        }
      }
      const g = this.goal;
      if (g && !this.finished && hb.x > g.x - 2.5 * s && hb.x < g.x + 5 * s && hb.y > g.y - 2 * s && hb.y < g.y + 12 * s) this.finish(p);
    }
    this.drops = this.drops.filter(d => !d.dead);
  }

  applyPower(p, type) {
    const c = rgb(type === 'mushroom' ? this.pal.platform : type === 'star' ? this.pal.lucky : this.pal.ice);
    const hb = p.hitbox();
    this.fx.emit(hb.x, hb.y, 36, { color: c, speed: 40 * this.t.s, life: 0.8, size: 0.45 * this.t.s, drag: 2.5, hueJitter: 0.2 });
    if (type === 'mushroom') p.grow(true);
    else if (type === 'feather') { p.power.feather = 12; p.airJumps = 1; }
    else if (type === 'star') p.power.star = 9;
    this.app.onGame('power', { type, player: p.idx, name: p.name, many: this.players.length > 1 });
  }

  finish(p) {
    this.finished = true;
    this.fireT = 3.4;
    this.fireAcc = 0.3;
    this.app.onGame('finish', { ...this.hud(), player: p.idx, name: p.name });
  }

  hud() {
    return {
      coins: this.got + this.bonus,
      left: this.coins.filter(c => !c.got).length,
      total: this.coins.length,
      time: this.clock,
      finished: this.finished,
      players: this.players.map(p => ({ name: p.name, power: { ...p.power } })),
    };
  }

  hitLucky(id, p) {
    let st = this.lucky.get(id);
    if (!st) { st = { used: false, anim: 0 }; this.lucky.set(id, st); }
    st.anim = 1;
    const z = this.zones.lucky.find(q => q.id === id);
    if (!z) return;
    if (st.used) { this.bonk(p); return; }
    st.used = true;
    let type = DROPS[z.s.props.item];
    if (!type) {
      const r = Math.random();
      type = r < 0.42 ? 'coin' : r < 0.62 ? 'mushroom' : r < 0.82 ? 'feather' : 'star';
    }
    this.spawnDrop(type, z.box.cx, z.box.y1, p);
    this.fx.emit(z.box.cx, z.box.y1, 16, { color: rgb(this.pal.lucky), speed: 30 * this.t.s, life: 0.5, size: 0.35 * this.t.s, angle: Math.PI / 2, spread: 2.2, gravity: 80 * this.t.s });
  }

  updateLucky(dt) {
    for (const [id, st] of this.lucky) {
      st.anim = Math.max(0, st.anim - dt * 5);
      const bump = st.anim > 0 ? Math.sin((1 - st.anim) * Math.PI) * 0.8 * this.t.s : 0;
      this.app.renderer.setLucky(id, st.used, st.anim, bump);
    }
  }

  spawnDrop(type, x, y, p) {
    const s = this.t.s;
    const d = { type, x, y, baseY: y, vx: (p && p.face ? p.face : 1) * (type === 'star' ? 26 : 18) * s, vy: 0, t: 0, dead: false, feet: y, drop: 0, r: 1.1 * s, body: null, col: null, owner: p };
    if (type === 'coin') { d.vy = 125 * s; d.y = y + 0.5 * s; }
    this.drops.push(d);
  }

  updateDrops(dt) {
    const s = this.t.s, g = this.t.g, box = this.space.box;
    for (const d of this.drops) {
      if (d.dead) continue;
      d.t += dt;
      if (d.type === 'coin') {
        d.vy -= g * 0.9 * dt;
        d.y += d.vy * dt;
        if (d.t > 0.5) {
          d.dead = true;
          this.bonus++;
          this.fxCoin(d.x, d.y);
          this.app.onGame('coin', this.hud());
        }
        continue;
      }
      if (d.t < 0.35) {
        d.y = d.baseY - d.r + (d.t / 0.35) * d.r * 2.1;
        continue;
      }
      if (d.type === 'feather') {
        d.x += Math.sin(d.t * 2.6) * 14 * s * dt;
        d.y -= 7 * s * dt;
      } else {
        if (!d.body) {
          const a = this.phys.actor(d.x, d.y, RAPIER.ColliderDesc.ball(d.r));
          d.body = a.body;
          d.col = a.col;
        }
        d.vy = Math.max(-250 * s, d.vy - g * dt);
        d.feet = d.y - d.r;
        const res = this.phys.move(d, d.vx * dt, d.vy * dt);
        const blocked = Math.abs(res.dx) < Math.abs(d.vx * dt) * 0.5;
        d.x += res.dx;
        d.y += res.dy;
        d.body.setNextKinematicTranslation({ x: d.x, y: d.y });
        for (const h of res.hits) {
          if (blocked && Math.abs(h.nx) > 0.7 && Math.sign(h.nx) !== Math.sign(d.vx)) d.vx = -d.vx;
          if (h.ny < -0.6 && d.vy > 0) d.vy = 0;
        }
        if (res.grounded && d.vy <= 0) d.vy = d.type === 'star' ? 140 * s : 0;
      }
      if (d.t > 18 || d.y < box.y0 - 20) {
        d.dead = true;
        if (d.body) { this.phys.remove(d.body); d.body = null; }
      }
    }
  }

  updateWater(dt) {
    const h = Math.min(dt, 1 / 30);
    for (const w of this.waters) {
      const n = w.pts.length;
      for (let i = 0; i < n; i++) w.v[i] += (-60 * w.h[i] - 2.4 * w.v[i]) * h;
      for (let i = 0; i < n; i++) {
        const l = i > 0 ? w.h[i - 1] : w.h[i], r = i < n - 1 ? w.h[i + 1] : w.h[i];
        w.v[i] += (l + r - 2 * w.h[i]) * 70 * h;
      }
      for (let i = 0; i < n; i++) w.h[i] = Math.max(-3, Math.min(3, w.h[i] + w.v[i] * h));
      if (Math.random() < h * 2) w.v[Math.floor(Math.random() * n)] += (Math.random() - 0.5) * 5;
    }
  }

  splash(x, vy, y) {
    const s = this.t.s;
    let hit = false;
    for (const w of this.waters) {
      for (let i = 0; i < w.pts.length; i++) {
        const d = Math.abs(w.pts[i][0] - x);
        if (d < 3 * s) { w.v[i] += vy * 0.09 * (1 - d / (3 * s)); hit = true; }
      }
    }
    if (hit && Math.abs(vy) > 30 * s) {
      const wy = y ?? 0;
      this.fx.emit(x, wy, 14, { color: rgb(this.pal.water), speed: Math.min(80, Math.abs(vy) * 0.35) * s, life: 0.55, size: 0.3 * s, angle: Math.PI / 2, spread: 1.6, gravity: 200 * s, drag: 0.5 });
    }
  }

  fireworks(dt) {
    if (this.fireT <= 0) return;
    this.fireT -= dt;
    this.fireAcc += dt;
    const b = this.space.box, pal = this.pal, s = this.t.s;
    const cols = [pal.solid, pal.platform, pal.lucky, pal.goal, pal.water, pal.bounce];
    while (this.fireAcc > 0.24) {
      this.fireAcc -= 0.24;
      const x = b.x0 + b.w * (0.12 + Math.random() * 0.76), y = b.y0 + b.h * (0.45 + Math.random() * 0.45);
      this.fx.emit(x, y, 70, { color: rgb(cols[Math.floor(Math.random() * cols.length)]), speed: 46 * s, life: 1.3, size: 0.55 * s, gravity: 26 * s, drag: 1.3, hueJitter: 0.25 });
    }
  }

  fxCoin(x, y) {
    this.fx.emit(x, y, 18, { color: rgb(this.pal.coin), speed: 28 * this.t.s, life: 0.5, size: 0.35 * this.t.s, angle: Math.PI / 2, spread: 3, drag: 3 });
  }

  fxBurst(x, y, col, n) {
    this.fx.emit(x, y, n, { color: col, speed: 55 * this.t.s, life: 0.9, size: 0.5 * this.t.s, drag: 2, gravity: 60 * this.t.s, hueJitter: 0.15 });
  }

  fxJump(p) {
    this.fx.emit(p.x, p.feet + 0.2, 7, { color: [0.75, 0.82, 1], speed: 20 * this.t.s, life: 0.35, size: 0.3 * this.t.s, angle: Math.PI / 2, spread: 2.6, gravity: 40 * this.t.s, drag: 4 });
  }

  fxLand(p, vy) {
    const n = Math.round(Math.min(14, -vy / (25 * this.t.s)));
    if (n > 1) this.fx.emit(p.x, p.feet + 0.2, n, { color: [0.75, 0.82, 1], speed: 26 * this.t.s, life: 0.4, size: 0.3 * this.t.s, angle: Math.PI / 2, spread: 2.9, gravity: 50 * this.t.s, drag: 4 });
  }

  fxBounce(p, info) {
    const hb = p.hitbox();
    this.fx.emit(hb.x, p.feet, 26, { color: rgb(this.pal.bounce), speed: 45 * this.t.s, life: 0.6, size: 0.4 * this.t.s, angle: Math.PI / 2, spread: 2.4, drag: 2.5 });
  }

  fxSwim(p) {
    const hb = p.hitbox();
    this.fx.emit(hb.x, hb.y, 5, { color: rgb(this.pal.water), speed: 12 * this.t.s, life: 0.7, size: 0.28 * this.t.s, angle: Math.PI / 2, spread: 1.4, gravity: -30 * this.t.s, drag: 2 });
  }

  fxFeather(p) {
    this.fx.emit(p.x, p.feet, 12, { color: [1, 1, 1], speed: 24 * this.t.s, life: 0.5, size: 0.32 * this.t.s, angle: -Math.PI / 2, spread: 2.2, drag: 3 });
  }

  fxLava(p) {
    const hb = p.hitbox();
    this.fx.emit(hb.x, hb.y, 40, { color: rgb(this.pal.lava), speed: 50 * this.t.s, life: 0.8, size: 0.5 * this.t.s, angle: Math.PI / 2, spread: 2.4, gravity: 120 * this.t.s, hueJitter: 0.3 });
  }

  fxGrab(x, y, col) {
    this.fx.emit(x, y, 8, { color: col, speed: 16 * this.t.s, life: 0.3, size: 0.28 * this.t.s, drag: 4 });
  }

  bonk(p) {
    const hb = p.hitbox();
    this.fx.emit(hb.x, hb.y + hb.r, 6, { color: [1, 1, 1], speed: 22 * this.t.s, life: 0.28, size: 0.28 * this.t.s, angle: -Math.PI / 2, spread: 2.4, drag: 4 });
  }

  draw(L, parts, pal, time, F = L) {
    const s = this.t.s;
    const wc = rgb(pal.water);
    for (const w of this.waters) L.poly(w.pts.map((p, i) => [p[0], p[1] + w.h[i]]), false, wc, 0.34, 1.6, 0, 0);
    const sp = this.spawnPoint();
    const pc = rgb(pal.players[0]);
    if (this.spawnPt) {
      L.seg(sp[0] - 2.4 * s, sp[1], sp[0] + 2.4 * s, sp[1], scaleC(pc, 0.5), 0.16 * s, 1.0 * s, 0, 3);
      L.dot(sp[0] - 2.4 * s, sp[1], 0.22 * s, scaleC(pc, 0.6), 0.7 * s, 0);
      L.dot(sp[0] + 2.4 * s, sp[1], 0.22 * s, scaleC(pc, 0.6), 0.7 * s, 0);
    }
    const cc = rgb(pal.coin);
    this.coins.forEach((c, i) => { if (!c.got) this.drawCoin(L, c.x, c.y, 1.1 * s, cc, time, i * 0.7); });
    this.drawGoal(L, pal, time);
    for (const d of this.drops) this.drawDrop(L, d, pal, time);
    this.decor.draw(L, time, pal, this.running ? this.pushers() : []);
    if (this.running) {
      for (const p of this.players) p.draw(F, time);
    } else {
      drawFigure(F, {
        x: sp[0], feet: sp[1], h: 7.3 * s, face: 1, color: scaleC(pc, 0.5), squash: 0, lean: 0, swing: 0, tuck: 0, arms: 0, swim: false, time, ant: [0, 0],
      });
    }
  }

  drawCoin(L, x, y, r, col, time, ph) {
    const s = this.t.s;
    const w = Math.abs(Math.cos(time * 3 + ph));
    const rx = r * (0.18 + 0.82 * w), ry = r;
    let px = x + rx, py = y;
    for (let i = 1; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const nx = x + Math.cos(a) * rx, ny = y + Math.sin(a) * ry;
      L.seg(px, py, nx, ny, col, 0.22 * s, 0.9 * s, 0, 3);
      px = nx; py = ny;
    }
    L.seg(x, y - r * 0.5, x, y + r * 0.5, col, 0.15 * s, 0.6 * s, 0, 3);
  }

  drawGoal(L, pal, time) {
    const g = this.goal;
    if (!g) return;
    const s = this.t.s;
    const c = this.finished ? hsv((time * 0.8) % 1, 0.7) : rgb(pal.goal);
    const top = g.y + 10 * s;
    L.seg(g.x, g.y, g.x, top, c, 0.26 * s, 1.1 * s, 0, 3);
    L.dot(g.x, top + 0.45 * s, 0.42 * s, c, 1.4 * s, 0);
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const u = i / 8;
      pts.push([g.x + u * 4.8 * s, top - 0.3 * s - u * 1.3 * s + Math.sin(time * 4 - u * 4) * 0.4 * s * u]);
    }
    for (let i = 8; i >= 0; i--) {
      const u = i / 8;
      pts.push([g.x + u * 4.8 * s, top - 3.3 * s + u * 1.6 * s + Math.sin(time * 4 - u * 4) * 0.4 * s * u]);
    }
    L.poly(pts, true, c, 0.22 * s, 1.0 * s, 0, 3);
  }

  drawDrop(L, d, pal, time) {
    const s = this.t.s, r = d.r;
    if (d.type === 'coin') { this.drawCoin(L, d.x, d.y, 0.9 * s, rgb(pal.coin), time * 3, 0); return; }
    const w = 0.2 * s, g = 0.85 * s;
    if (d.type === 'mushroom') {
      const c = rgb(pal.platform);
      let px = d.x - r, py = d.y;
      for (let i = 1; i <= 10; i++) {
        const a = Math.PI - (i / 10) * Math.PI;
        const nx = d.x + Math.cos(a) * r, ny = d.y + Math.sin(a) * r * 0.9;
        L.seg(px, py, nx, ny, c, w, g, 0, 3);
        px = nx; py = ny;
      }
      L.seg(d.x - r, d.y, d.x + r, d.y, c, w, g, 0, 3);
      L.poly([[d.x - r * 0.45, d.y], [d.x - r * 0.45, d.y - r * 0.8], [d.x + r * 0.45, d.y - r * 0.8], [d.x + r * 0.45, d.y]], false, [1, 1, 1], w * 0.8, g * 0.8, 0, 3);
      L.dot(d.x - r * 0.4, d.y + r * 0.45, 0.16 * s, [1, 1, 1], 0.4 * s, 0);
      L.dot(d.x + r * 0.35, d.y + r * 0.3, 0.13 * s, [1, 1, 1], 0.4 * s, 0);
    } else if (d.type === 'feather') {
      const c = rgb(pal.ice);
      const a = Math.sin(d.t * 2.6) * 0.5;
      const ax = Math.sin(a), ay = Math.cos(a);
      const L2 = r * 1.4;
      L.seg(d.x - ax * L2, d.y - ay * L2, d.x + ax * L2, d.y + ay * L2, c, w * 0.8, g, 0, 3);
      for (let k = -2; k <= 2; k++) {
        const bx = d.x + ax * k * r * 0.45, by = d.y + ay * k * r * 0.45;
        const l = r * (0.7 - Math.abs(k) * 0.12);
        L.seg(bx, by, bx - ay * l + ax * l * 0.4, by + ax * l + ay * l * 0.4, c, w * 0.55, g * 0.7, 0, 3);
        L.seg(bx, by, bx + ay * l + ax * l * 0.4, by - ax * l + ay * l * 0.4, c, w * 0.55, g * 0.7, 0, 3);
      }
    } else if (d.type === 'star') {
      const c = hsv((time * 1.2) % 1, 0.6);
      const pts = [];
      const rot = time * 3;
      for (let i = 0; i < 10; i++) {
        const a = rot + (i / 10) * Math.PI * 2 + Math.PI / 2;
        const rr = i % 2 ? r * 0.48 : r * 1.15;
        pts.push([d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr]);
      }
      L.poly(pts, true, c, w, g * 1.2, 0, 3);
    }
  }
}
