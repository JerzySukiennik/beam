// Beam: the neon characters. One skeleton drawer serves both movement modes and every look: six ready-made ones (a tail,
// ribbons, a cape and a jetpack flame move on their own), a figure drawn by finger on a phone (vector strokes, so it glows
// like the rest of the wall) and a selfie on a big head. It draws through a small pen, so the phone previews share it.

export const LOOKS = { ludzik: 'Ludzik', kot: 'Kot', robot: 'Robot', astro: 'Astronauta', ninja: 'Ninja', krol: 'Król' };
export const DEFAULT_LOOK = { k: 'p', id: 'ludzik' };
export const DRAW_MAX = 600;

const GOLD = [1, 0.8, 0.32], FLAME = [1, 0.56, 0.16], WARM = [1, 0.95, 0.8];

export function hsv(h, s = 0.85, v = 1) {
  const f = n => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

const rot = (l, a) => [l * Math.sin(a), -l * Math.cos(a)];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const light = c => [0.5 + c[0] * 0.5, 0.5 + c[1] * 0.5, 0.5 + c[2] * 0.5];
const unit = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

export function cleanLook(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.k === 'p') return LOOKS[c.id] ? { k: 'p', id: c.id } : null;
  if (c.k === 'd') {
    if (!Array.isArray(c.s) || !c.s.length || c.s.length > 60) return null;
    const s = [];
    let n = 0;
    for (const st of c.s) {
      if (!Array.isArray(st) || st.length < 2 || st.length % 2) return null;
      const out = [];
      for (const v of st) {
        if (typeof v !== 'number' || !isFinite(v)) return null;
        out.push(Math.max(-100, Math.min(100, Math.round(v))));
      }
      n += out.length / 2;
      if (n > DRAW_MAX) return null;
      s.push(out);
    }
    return { k: 'd', s };
  }
  if (c.k === 'f') {
    const ok = typeof c.img === 'string' && c.img.length <= 60000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(c.img);
    return ok ? { k: 'f', img: c.img } : null;
  }
  return null;
}

export function lookStyle(d) {
  return !d ? 'ludzik' : d.k === 'p' ? d.id : d.k === 'd' ? 'draw' : 'face';
}

export class Look {
  constructor(data) { this.set(data); }

  set(data) {
    this.data = data || DEFAULT_LOOK;
    this.style = lookStyle(this.data);
    this.chains = {};
    this.last = null;
  }

  tick(time) {
    const dt = this.last === null ? 0 : Math.max(0, Math.min(0.05, time - this.last));
    this.last = time;
    return dt;
  }

  chain(key, n, anchor, dir, len, dt, grav, stiff) {
    let c = this.chains[key];
    if (!c || Math.hypot(c[0][0] - anchor[0], c[0][1] - anchor[1]) > len * n * 3) {
      c = [];
      for (let i = 0; i < n; i++) {
        const x = anchor[0] + dir[0] * len * i, y = anchor[1] + dir[1] * len * i;
        c.push([x, y, x, y]);
      }
      this.chains[key] = c;
    }
    c[0][0] = c[0][2] = anchor[0];
    c[0][1] = c[0][3] = anchor[1];
    if (dt <= 0) return c;
    const keep = Math.exp(-3 * dt), pull = (1 - Math.exp(-stiff * dt)) * 0.35;
    for (let i = 1; i < n; i++) {
      const p = c[i];
      const vx = (p[0] - p[2]) * keep, vy = (p[1] - p[3]) * keep;
      p[2] = p[0];
      p[3] = p[1];
      p[0] += vx + (anchor[0] + dir[0] * len * i - p[0]) * pull;
      p[1] += vy - grav * dt * dt + (anchor[1] + dir[1] * len * i - p[1]) * pull;
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < n; i++) {
        const a = c[i - 1], b = c[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1e-6, f = (d - len) / d;
        if (i === 1) { b[0] -= dx * f; b[1] -= dy * f; }
        else { a[0] += dx * f * 0.5; a[1] += dy * f * 0.5; b[0] -= dx * f * 0.5; b[1] -= dy * f * 0.5; }
      }
    }
    return c;
  }
}

let shared = null;

export function drawSkeleton(L, sk, look, faceAt) {
  look = look || shared || (shared = new Look());
  const style = look.style, dt = look.tick(sk.time);
  const { H, hr, w, g, face: f } = sk;
  const dim = sk.dim ?? 1;
  const col = sk.col;
  const [ux, uy] = sk.up;
  const back = [-f * uy, f * ux];
  const ha = sk.ha || 0;
  const hu = [-Math.sin(ha), Math.cos(ha)], hf = [f * Math.cos(ha), f * Math.sin(ha)];
  const head = sk.head;
  const at = (fx, fy, r = hr, c = head) => [c[0] + (hf[0] * fx + hu[0] * fy) * r, c[1] + (hf[1] * fx + hu[1] * fy) * r];
  const polar = (a, r) => at(Math.sin(a), Math.cos(a), r);
  const S = (a, b, c = col, k = 1) => L.seg(a[0], a[1], b[0], b[1], c, w * k, g * k, 0, 4);
  const D = (p, r, c = col, gk = 2.2) => L.dot(p[0], p[1], r, c, r * gk, 0, 4);
  const line = (pts, c = col, k = 1) => { for (let i = 1; i < pts.length; i++) S(pts[i - 1], pts[i], c, k); };
  const ring = (c0, r, c = col, k = 1, n = 18) => L.circle(c0[0], c0[1], r, c, w * k, g * k, 0, n, 4);
  const eyes = () => { D(at(0.42, 0.12), 0.215 * hr); D(at(0, 0.12), 0.185 * hr); };
  const off = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];

  for (const [a, b] of sk.legs) S(a, b);

  if (style === 'draw') {
    const B = H * 0.34, sx = sk.sx || 1, sy = sk.sy || 1;
    const cx = sk.hip[0] + ux * B * 0.96, cy = sk.hip[1] + uy * B * 0.96;
    const rx = f * uy, ry = -f * ux;
    const P = (u, v) => [cx + (rx * u + ux * v) * B * sx, cy + (ry * u + uy * v) * B * sy];
    for (const st of look.data.s || []) {
      if (st.length === 2) { D(P(st[0] / 100, st[1] / 100), w * 0.75); continue; }
      let a = P(st[0] / 100, st[1] / 100);
      for (let i = 2; i < st.length; i += 2) {
        const b = P(st[i] / 100, st[i + 1] / 100);
        S(a, b, col, 0.8);
        a = b;
      }
    }
    return;
  }

  if (style === 'kot') {
    const base = off(sk.hip, back, w * 1.2);
    const tail = look.chain('tail', 6, base, unit(back[0] * 0.7 + ux * 0.75, back[1] * 0.7 + uy * 0.75), H * 0.065, dt, H * 6, 7);
    line(tail, col, 0.85);
    D(tail[tail.length - 1], w * 0.9, col);
  } else if (style === 'astro') {
    const b0 = off(off(sk.neck, back, w * 2.2), sk.up, -H * 0.05), b1 = off(off(sk.hip, back, w * 2.2), sk.up, H * 0.04);
    const q = [b0, off(b0, back, H * 0.075), off(b1, back, H * 0.075), b1];
    line([...q, q[0]], col, 0.8);
    if (!sk.grounded && sk.vy > 4) {
      const fl = 0.75 + 0.25 * Math.sin(sk.time * 47) * Math.sin(sk.time * 31);
      const nz = [(q[2][0] + q[3][0]) / 2, (q[2][1] + q[3][1]) / 2];
      S(nz, off(nz, sk.up, -H * 0.17 * fl), mul(FLAME, dim), 1.1);
      S(nz, off(nz, sk.up, -H * 0.08 * fl), mul(WARM, dim), 0.5);
    }
  } else if (style === 'krol') {
    const n0 = off(sk.neck, back, w * 1.1);
    const cape = look.chain('cape', 6, n0, unit(back[0] * 0.5 - ux * 0.9, back[1] * 0.5 - uy * 0.9), H * 0.07, dt, H * 14, 3.5);
    const hipBack = off(off(sk.hip, back, w * 1.6), sk.up, -H * 0.06);
    line([...cape, hipBack], mul(col, 0.7), 0.8);
  }

  S(sk.hip, sk.neck, col, 1.15);
  for (const [a, b] of sk.arms) S(a, b, col, 0.9);

  switch (style) {
    case 'kot': {
      ring(head, hr);
      eyes();
      for (const [a, k] of [[0.5, 1], [-0.42, 0.9]]) {
        const tip = polar(a, hr * 1.62 * k);
        S(polar(a - 0.3, hr), tip, col, 0.85);
        S(tip, polar(a + 0.3, hr), col, 0.85);
      }
      D(at(0.98, -0.12), 0.12 * hr);
      break;
    }
    case 'robot': {
      const R = hr * 0.95;
      const c = [at(-1, -1, R), at(1, -1, R), at(1, 1, R), at(-1, 1, R)];
      line([...c, c[0]]);
      S(at(0.15, 0.2), at(0.78, 0.2), light(col), 0.85);
      D(at(-1.08, 0), 0.13 * hr);
      const top = at(0, 0.95), tip = at(0, 1.75);
      S(top, tip, col, 0.6);
      D(tip, 0.28 * hr, sk.accent || (Math.sin(sk.time * 5.5) > 0 ? col : light(col)), 3);
      break;
    }
    case 'astro': {
      ring(head, hr * 1.3, col, 1, 20);
      const arc = [];
      for (let i = 0; i <= 8; i++) arc.push(polar(0.35 + (i / 8) * 1.85, hr * 0.86));
      line(arc, light(col), 0.75);
      break;
    }
    case 'ninja': {
      ring(head, hr);
      S(at(0.2, 0.16), at(0.86, 0.16), col, 0.6);
      S(at(-0.89, 0.45), at(0.89, 0.45), col, 0.95);
      const knot = at(-0.95, 0.45);
      const r1 = look.chain('rb1', 5, knot, unit(-hf[0] + hu[0] * 0.15, -hf[1] + hu[1] * 0.15), H * 0.055, dt, H * 10, 2.2);
      const r2 = look.chain('rb2', 5, knot, unit(-hf[0] - hu[0] * 0.3, -hf[1] - hu[1] * 0.3), H * 0.05, dt, H * 10, 2.6);
      line(r1, col, 0.65);
      line(r2, col, 0.6);
      break;
    }
    case 'krol': {
      ring(head, hr);
      eyes();
      const gold = mul(GOLD, dim);
      const peak = polar(0, hr * 1.82);
      line([polar(-0.62, hr * 0.98), polar(-0.5, hr * 1.7), polar(-0.22, hr * 1.28), peak, polar(0.22, hr * 1.28), polar(0.5, hr * 1.7), polar(0.62, hr * 0.98)], gold, 0.75);
      D(peak, 0.16 * hr, gold);
      break;
    }
    case 'face': {
      const R = H * 0.23;
      const c0 = off(sk.neck, hu, R * 0.9);
      if (faceAt) faceAt(c0[0], c0[1], R * 0.94, ha);
      ring(c0, R, col, 1.1, 24);
      break;
    }
    default: {
      ring(head, hr);
      eyes();
      const top = at(0, 1);
      const ant = look.chain('ant', 2, top, hu, H * 0.13, dt, H * 3, 20);
      S(top, ant[1], col, 0.7);
      D(ant[1], 0.31 * hr, sk.accent || col, 3);
    }
  }
  if (sk.accent && style !== 'ludzik' && style !== 'robot') D(at(0, style === 'face' ? 3.4 : 2.1), 0.22 * hr, sk.accent, 3);
}

export function drawFigure(L, o, look, faceAt) {
  const H = o.h, f = o.face;
  const sx = 1 + o.squash * 0.6, sy = 1 - o.squash;
  const X = dx => o.x + dx * sx;
  const Y = dy => o.feet + dy * sy;
  const lean = o.lean;
  const hip = [X(lean * 0.25 * H), Y(0.42 * H)];
  const neck = [X(lean * H * 0.9), Y(0.74 * H)];
  const head = [X(lean * H * 1.05), Y(0.865 * H)];
  const legs = [], arms = [];
  const leg = 0.215 * H;
  for (const side of [-1, 1]) {
    const ph = o.swing * side;
    let a1 = f * (ph * 0.6 + o.tuck * 0.65) + side * 0.16;
    let a2 = a1 - f * (Math.max(0, -ph) * 0.9 + o.tuck * 1.3 + 0.08);
    if (o.swim) { a1 = f * (0.3 + Math.sin(o.time * 9 + side) * 0.45); a2 = a1 - f * 0.5; }
    const k = rot(leg, a1), knee = [hip[0] + k[0] * sx, hip[1] + k[1] * sy];
    const s = rot(leg, a2), foot = [knee[0] + s[0] * sx, knee[1] + s[1] * sy];
    legs.push([hip, knee], [knee, foot]);
  }
  const sh = [X(lean * H * 0.85), Y(0.7 * H)];
  const arm = 0.2 * H;
  for (const side of [-1, 1]) {
    let a = f * (-o.swing * side * 0.75) + o.arms * f * (side > 0 ? 2.5 : 2.1) + side * 0.5 * (1 - o.arms);
    if (o.swim) a = f * (1.6 + Math.sin(o.time * 9 + side * 1.5) * 0.9);
    if (o.punch && side > 0) a += (f * 1.55 - a) * o.punch;
    const e = rot(arm, a);
    const el = [sh[0] + e[0] * 0.55, sh[1] + e[1] * 0.55];
    const hand = [sh[0] + e[0] * (1 + (o.punch && side > 0 ? o.punch * 0.35 : 0)), sh[1] + e[1]];
    arms.push([sh, el], [el, hand]);
  }
  const up = unit(neck[0] - hip[0], neck[1] - hip[1]);
  drawSkeleton(L, {
    H, hr: 0.13 * H, w: 0.05 * H, g: 0.08 * H, face: f, col: o.color, accent: o.accent || null, dim: o.dim ?? 1,
    hip, neck, head, up, ha: 0, legs, arms, sx, sy,
    vx: o.vx || 0, vy: o.vy || 0, grounded: o.grounded !== false, time: o.time,
  }, look, faceAt);
}

export function canvasPen(ctx, ox, oy, k) {
  const X = x => ox + x * k, Y = y => oy - y * k;
  const css = (c, a = 1) => `rgba(${Math.round(Math.min(1, c[0]) * 255)},${Math.round(Math.min(1, c[1]) * 255)},${Math.round(Math.min(1, c[2]) * 255)},${a})`;
  const stroke = (path, col, w, g) => {
    ctx.shadowColor = css(col);
    ctx.shadowBlur = g * k * 1.3;
    ctx.strokeStyle = css(col);
    ctx.lineWidth = Math.max(1, w * 2 * k);
    path();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = css(light(col), 0.85);
    ctx.lineWidth = Math.max(0.6, w * k * 0.8);
    path();
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return {
    seg(ax, ay, bx, by, col, w, g) {
      stroke(() => { ctx.beginPath(); ctx.moveTo(X(ax), Y(ay)); ctx.lineTo(X(bx) + (ax === bx && ay === by ? 0.01 : 0), Y(by)); }, col, w, g);
    },
    circle(cx, cy, r, col, w, g) {
      stroke(() => { ctx.beginPath(); ctx.arc(X(cx), Y(cy), r * k, 0, Math.PI * 2); }, col, w, g);
    },
    dot(x, y, r, col, g) {
      ctx.shadowColor = css(col);
      ctx.shadowBlur = g * k;
      ctx.fillStyle = css(light(col));
      ctx.beginPath();
      ctx.arc(X(x), Y(y), Math.max(0.8, r * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    },
    poly(pts, closed, col, w, g) {
      for (let i = 1; i < pts.length; i++) this.seg(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], col, w, g);
      if (closed && pts.length > 2) this.seg(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1], col, w, g);
    },
    face(img, x, y, r) {
      if (!img || !img.width) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(X(x), Y(y), r * k, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, X(x) - r * k, Y(y) - r * k, r * k * 2, r * k * 2);
      ctx.restore();
    },
  };
}
