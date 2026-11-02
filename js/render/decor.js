// Beam: automatic decorations grown from mapped shapes: grass that bends away from players, snow caps with icicles and snowfall, hanging jungle vines.

import * as P from '../math/poly.js';
import { rgb } from './neon.js';

const GRASS_HOSTS = new Set(['solid', 'platform']);
const SNOW_HOSTS = new Set(['solid', 'platform', 'ice', 'bounce', 'lucky']);

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export class Decor {
  constructor() {
    this.theme = 'brak';
    this.blades = [];
    this.caps = [];
    this.icicles = [];
    this.flakes = [];
    this.vines = [];
  }

  build(state, space) {
    const st = state.settings;
    this.theme = st.decor ? st.theme : 'brak';
    this.blades = [];
    this.caps = [];
    this.icicles = [];
    this.flakes = [];
    this.vines = [];
    if (this.theme === 'brak' || !space.ok) return;
    const solids = [];
    for (const s of state.shapes) {
      if (SNOW_HOSTS.has(s.type) || (s.type === 'screen' && s.props.solid)) solids.push(...s.geom);
    }
    this.blockers = solids.length ? P.union(solids) : [];
    this.blockBoxes = this.blockers.map(p => P.bbox([p]));
    this.box = space.box;
    const area = space.area;
    const free = (x, y) => P.pointIn(area, x, y) && !this.blocked(x, y);
    const hosts = this.theme === 'wiosna' ? GRASS_HOSTS : this.theme === 'dzungla' ? GRASS_HOSTS : SNOW_HOSTS;
    for (const s of state.shapes) {
      if (!hosts.has(s.type)) continue;
      if (this.theme === 'wiosna') this.growGrass(s, free);
      else if (this.theme === 'zima') this.growSnow(s, free);
      else if (this.theme === 'dzungla') this.growVines(s, free);
    }
    if (this.theme === 'zima') {
      const b = space.box;
      const n = Math.round(Math.max(60, Math.min(220, (b.w * b.h) / 70)));
      for (let i = 0; i < n; i++) {
        this.flakes.push({ x: b.x0 + hash(i * 3.1) * b.w, y: b.y0 + hash(i * 7.7) * b.h, v: 5 + hash(i * 1.3) * 7, ph: hash(i * 9.1) * 6.28, r: 0.12 + hash(i * 4.4) * 0.16 });
      }
    }
  }

  blocked(x, y) {
    for (let i = 0; i < this.blockers.length; i++) {
      const b = this.blockBoxes[i];
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      if (P.pointIn([this.blockers[i]], x, y)) return true;
    }
    return false;
  }

  growGrass(s, free) {
    for (const ch of P.facingChains(s.geom, 1, 0.6)) {
      for (const [x, y] of P.resample(P.closedPts(ch), 0.55)) {
        if (this.blades.length > 2400) return;
        if (!free(x, y + 0.35)) continue;
        const k = x * 3.17 + y * 1.31;
        const flower = hash(k * 1.7) > 0.94;
        this.blades.push({ x, y, h: flower ? 1.9 + hash(k) * 1.1 : 0.6 + hash(k) * 1.5, lean: (hash(k * 2.3) - 0.5) * 0.5, tint: hash(k * 5.9), flower, fc: hash(k * 3.3) > 0.5 ? 1 : 0 });
      }
    }
  }

  growSnow(s, free) {
    for (const ch of P.facingChains(s.geom, 1, 0.5)) {
      let run = [];
      for (const [x, y] of P.resample(P.closedPts(ch), 0.7)) {
        if (free(x, y + 0.4)) run.push([x, y + 0.26 + hash(x * 2.7 + y) * 0.32]);
        else if (run.length) { if (run.length > 1) this.caps.push(run); run = []; }
      }
      if (run.length > 1) this.caps.push(run);
    }
    for (const ch of P.facingChains(s.geom, -1, 0.6)) {
      let acc = 0;
      const pts = P.closedPts(ch);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (let d = 0; d < L; d += 1) {
          acc += 1;
          const x = a[0] + ((b[0] - a[0]) * d) / L, y = a[1] + ((b[1] - a[1]) * d) / L;
          const k = x * 1.93 + y * 0.71;
          if (acc < 3 || hash(k) < 0.45) continue;
          acc = 0;
          if (!free(x, y - 0.5)) continue;
          this.icicles.push({ x, y, len: 0.6 + hash(k * 3.1) * 1.8 });
        }
      }
    }
  }

  growVines(s, free) {
    for (const ch of P.facingChains(s.geom, -1, 0.6)) {
      const pts = P.closedPts(ch);
      let next = 2 + hash(pts[0][0] * 1.7) * 5;
      let walked = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let d = next - walked;
        while (d <= L) {
          const x = a[0] + ((b[0] - a[0]) * d) / L, y = a[1] + ((b[1] - a[1]) * d) / L;
          const k = x * 2.11 + y * 0.37;
          if (free(x, y - 0.6) && this.vines.length < 90) {
            let len = 4 + hash(k) * 12;
            for (let yy = y - 0.6; yy > y - len; yy -= 1) if (!free(x, yy)) { len = y - yy; break; }
            if (len > 2.5) {
              const n = Math.max(3, Math.round(len / 1.1));
              const seg = len / n;
              const p = [], q = [];
              for (let j = 0; j <= n; j++) { p.push([x, y - j * seg]); q.push([x, y - j * seg]); }
              this.vines.push({ p, q, seg, ph: hash(k * 4.1) * 6.28, flower: hash(k * 6.7) > 0.6 });
            }
          }
          d += 6 + hash(k * 1.9) * 9;
        }
        next = walked + d;
        walked += L;
      }
    }
  }

  update(dt, t, pushers) {
    if (this.theme === 'zima') {
      const b = this.box;
      for (const f of this.flakes) {
        f.y -= f.v * dt;
        f.x += Math.sin(t * 0.8 + f.ph) * dt * 2.5;
        if (f.y < b.y0 || this.blocked(f.x, f.y)) {
          f.y = b.y1 + Math.random() * 4;
          f.x = b.x0 + Math.random() * b.w;
        }
      }
    } else if (this.theme === 'dzungla') {
      const h = Math.min(dt, 1 / 30);
      const g = 140 * h * h;
      for (const v of this.vines) {
        const wind = Math.sin(t * 0.9 + v.ph) * 18 * h * h;
        for (let j = 1; j < v.p.length; j++) {
          const p = v.p[j], q = v.q[j];
          const vx = (p[0] - q[0]) * 0.982, vy = (p[1] - q[1]) * 0.982;
          q[0] = p[0]; q[1] = p[1];
          p[0] += vx + wind * (j / v.p.length);
          p[1] += vy - g;
        }
        for (let it = 0; it < 4; it++) {
          for (let j = 1; j < v.p.length; j++) {
            const a = v.p[j - 1], c = v.p[j];
            const dx = c[0] - a[0], dy = c[1] - a[1];
            const d = Math.hypot(dx, dy) || 1e-6;
            const k = (d - v.seg) / d;
            if (j === 1) { c[0] -= dx * k; c[1] -= dy * k; }
            else { a[0] += dx * k * 0.5; a[1] += dy * k * 0.5; c[0] -= dx * k * 0.5; c[1] -= dy * k * 0.5; }
          }
          for (const ps of pushers) {
            for (let j = 1; j < v.p.length; j++) {
              const c = v.p[j];
              const dx = c[0] - ps.x, dy = c[1] - ps.y;
              const d = Math.hypot(dx, dy);
              if (d < ps.r && d > 1e-6) { c[0] = ps.x + (dx / d) * ps.r; c[1] = ps.y + (dy / d) * ps.r; }
            }
          }
        }
      }
    }
  }

  draw(L, t, pal, pushers = []) {
    if (this.theme === 'wiosna') this.drawGrass(L, t, pal, pushers);
    else if (this.theme === 'zima') this.drawSnow(L, pal);
    else if (this.theme === 'dzungla') this.drawVines(L, pal);
  }

  drawGrass(L, t, pal, pushers) {
    const base = rgb(pal.grass);
    const lite = mix(base, [1, 1, 1], 0.35);
    const fl = [rgb(pal.lucky), rgb(pal.platform)];
    for (const b of this.blades) {
      let a = b.lean + Math.sin(t * 1.6 + b.x * 0.35) * 0.12 + Math.sin(t * 0.7 + b.x * 0.11) * 0.08;
      let push = 0;
      for (const ps of pushers) {
        const dx = b.x - ps.x;
        const reach = ps.r + 1.2;
        if (Math.abs(dx) < reach && ps.feet < b.y + b.h + 0.8 && ps.feet > b.y - 2) push += Math.sign(dx || 1) * (1 - Math.abs(dx) / reach) * 1.05;
      }
      a += Math.max(-1.25, Math.min(1.25, push));
      const mx = b.x + Math.sin(a * 0.45) * b.h * 0.55, my = b.y + Math.cos(a * 0.45) * b.h * 0.55;
      const tx = b.x + Math.sin(a) * b.h, ty = b.y + Math.cos(a) * b.h;
      const c = mix(base, lite, b.tint * 0.6);
      L.seg(b.x, b.y, mx, my, c, 0.11, 0.45, 0, 3);
      L.seg(mx, my, tx, ty, c, 0.085, 0.4, 0, 3);
      if (b.flower) L.dot(tx, ty, 0.24, fl[b.fc], 0.9, 0);
    }
  }

  drawSnow(L, pal) {
    const c = rgb(pal.snow);
    for (const run of this.caps) L.poly(run, false, c, 0.5, 1.2, 0, 3);
    for (const ic of this.icicles) L.seg(ic.x, ic.y, ic.x, ic.y - ic.len, c, 0.13, 0.6, 0, 3);
    for (const f of this.flakes) L.dot(f.x, f.y, f.r, c, 0.5, 0);
  }

  drawVines(L, pal) {
    const c = rgb(pal.vine);
    const leaf = mix(c, [1, 1, 1], 0.25);
    const fl = rgb(pal.lucky);
    for (const v of this.vines) {
      L.poly(v.p, false, c, 0.15, 0.65, 0, 3);
      for (let j = 1; j < v.p.length; j++) {
        if (j % 2) continue;
        const a = v.p[j - 1], b = v.p[j];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const d = Math.hypot(dx, dy) || 1;
        const side = (j / 2) % 2 ? 1 : -1;
        const nx = (-dy / d) * side, ny = (dx / d) * side;
        L.seg(b[0], b[1], b[0] + nx * 0.75 - (dx / d) * 0.25, b[1] + ny * 0.75 - (dy / d) * 0.25, leaf, 0.16, 0.5, 0, 3);
      }
      if (v.flower) {
        const e = v.p[v.p.length - 1];
        L.dot(e[0], e[1], 0.3, fl, 1.0, 0);
      }
    }
  }
}
