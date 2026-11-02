// Beam: photo of the real wall on the phone. Loads it upright and small, finds the four colored projector markers and
// lets the player nudge each one with a loupe before the match is saved.

export const MARK_COLORS = ['#19f0ff', '#ff4df2', '#ffd726', '#59ff73'];
const HUES = [186, 303, 49, 129];
const TOL = [24, 28, 16, 26];
const DEFAULT = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]];

export async function loadPhoto(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('photo-decode'));
      i.src = url;
    });
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const k = Math.min(1, max / Math.max(w0, h0));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w0 * k));
    c.height = Math.max(1, Math.round(h0 * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function detectMarks(src) {
  const W = 240, k = W / src.width, Hh = Math.max(1, Math.round(src.height * k));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hh;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, W, Hh);
  const d = g.getImageData(0, 0, W, Hh).data;
  const CELL = 8, gw = Math.ceil(W / CELL), gh = Math.ceil(Hh / CELL);
  const grids = HUES.map(() => new Float32Array(gw * gh));
  const hits = HUES.map(() => []);
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), dd = mx - mn;
      if (mx < 0.45 || dd / mx < 0.38) continue;
      let h = mx === r ? 60 * (((gg - b) / dd) % 6) : mx === gg ? 60 * ((b - r) / dd + 2) : 60 * ((r - gg) / dd + 4);
      if (h < 0) h += 360;
      for (let m = 0; m < 4; m++) {
        let dh = Math.abs(h - HUES[m]);
        if (dh > 180) dh = 360 - dh;
        if (dh > TOL[m]) continue;
        const w = (dd / mx) * mx * (1 - (dh / TOL[m]) * 0.5);
        grids[m][((y / CELL) | 0) * gw + ((x / CELL) | 0)] += w;
        hits[m].push(x, y, w);
      }
    }
  }
  const out = [];
  for (let m = 0; m < 4; m++) {
    let best = 0, bi = -1;
    for (let cy = 0; cy < gh; cy++) {
      for (let cx = 0; cx < gw; cx++) {
        let sum = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            const xx = cx + ox, yy = cy + oy;
            if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) sum += grids[m][yy * gw + xx];
          }
        }
        if (sum > best) { best = sum; bi = cy * gw + cx; }
      }
    }
    if (bi < 0 || best < 3) { out.push(null); continue; }
    const ccx = ((bi % gw) + 0.5) * CELL, ccy = (((bi / gw) | 0) + 0.5) * CELL, R = CELL * 2;
    const P = hits[m];
    let sx = 0, sy = 0, sw = 0;
    for (let i = 0; i < P.length; i += 3) {
      if (Math.abs(P[i] - ccx) <= R && Math.abs(P[i + 1] - ccy) <= R) { sx += P[i] * P[i + 2]; sy += P[i + 1] * P[i + 2]; sw += P[i + 2]; }
    }
    out.push(sw ? [(sx / sw + 0.5) / k, (sy / sw + 0.5) / k] : null);
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < i; j++) {
      if (out[i] && out[j] && Math.hypot(out[i][0] - out[j][0], out[i][1] - out[j][1]) < src.width * 0.03) { out[i] = null; break; }
    }
  }
  return { pts: out.map((p, i) => p || [DEFAULT[i][0] * src.width, DEFAULT[i][1] * src.height]), found: out.map(Boolean), count: out.filter(Boolean).length };
}

export class MarkPicker {
  constructor(root) {
    this.root = root;
    this.cv = root.querySelector('#mc');
    this.ctx = this.cv.getContext('2d');
    this.text = root.querySelector('#mtext');
    this.pts = [];
    this.drag = null;
    this.raf = 0;
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => this.move(e));
    this.cv.addEventListener('pointerup', e => this.up(e));
    this.cv.addEventListener('pointercancel', e => this.up(e));
    root.querySelector('#mok').addEventListener('click', () => this.finish(true));
    root.querySelector('#mcancel').addEventListener('click', () => this.finish(false));
    this.onResize = () => { this.layout(); this.invalidate(); };
  }

  open(photo, found) {
    this.photo = photo;
    this.pts = found.pts.map(p => p.slice());
    const n = found.count;
    this.text.textContent = n === 4
      ? 'Znalazłem 4 kropki. Sprawdź, czy kółka siedzą na kropkach w tych samych kolorach, i popraw palcem.'
      : n
        ? `Znalazłem ${n} z 4 kropek. Przeciągnij resztę kółek na kropki w tych samych kolorach.`
        : 'Przeciągnij każde kółko na kropkę w tym samym kolorze. Lupa pomaga trafić.';
    this.root.classList.add('on');
    window.addEventListener('resize', this.onResize);
    this.layout();
    this.invalidate();
    return new Promise(res => { this.done = res; });
  }

  finish(ok) {
    if (!this.done) return;
    window.removeEventListener('resize', this.onResize);
    this.root.classList.remove('on');
    const res = this.done;
    this.done = null;
    res(ok ? this.pts.map(p => p.slice()) : null);
  }

  layout() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.root.clientWidth, h = this.root.clientHeight;
    this.cw = w;
    this.ch = h;
    this.dpr = dpr;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    const top = 64, bottom = 80;
    const s = Math.min(w / this.photo.width, (h - top - bottom) / this.photo.height);
    this.s = s;
    this.ox = (w - this.photo.width * s) / 2;
    this.oy = top + (h - top - bottom - this.photo.height * s) / 2;
  }

  toS(p) { return [p[0] * this.s + this.ox, p[1] * this.s + this.oy]; }
  fromS(x, y) { return [(x - this.ox) / this.s, (y - this.oy) / this.s]; }

  xy(e) {
    const r = this.cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  down(e) {
    if (this.drag) return;
    const [x, y] = this.xy(e);
    let best = -1, bd = 52;
    this.pts.forEach((p, i) => {
      const q = this.toS(p), d = Math.hypot(q[0] - x, q[1] - y);
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0) return;
    this.cv.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, i: best, x, y };
    this.invalidate();
  }

  move(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const [x, y] = this.xy(e);
    const dx = x - d.x, dy = y - d.y;
    const f = Math.min(1, 0.35 + Math.hypot(dx, dy) / 25);
    const q = this.toS(this.pts[d.i]);
    const t = this.fromS(q[0] + dx * f, q[1] + dy * f);
    d.x = x;
    d.y = y;
    this.pts[d.i] = [Math.max(0, Math.min(this.photo.width, t[0])), Math.max(0, Math.min(this.photo.height, t[1]))];
    this.invalidate();
  }

  up(e) {
    if (!this.drag || this.drag.id !== e.pointerId) return;
    this.drag = null;
    this.invalidate();
  }

  invalidate() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const c = this.ctx, ph = this.photo;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.cw, this.ch);
    c.drawImage(ph, this.ox, this.oy, ph.width * this.s, ph.height * this.s);
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.setLineDash([5, 5]);
    c.beginPath();
    this.pts.forEach((p, i) => { const q = this.toS(p); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
    c.closePath();
    c.stroke();
    c.setLineDash([]);
    this.pts.forEach((p, i) => {
      const q = this.toS(p), col = MARK_COLORS[i], on = this.drag && this.drag.i === i;
      c.lineWidth = on ? 3 : 2.5;
      c.strokeStyle = '#000';
      c.beginPath();
      c.arc(q[0], q[1], 22, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = col;
      c.lineWidth = on ? 2.5 : 2;
      c.beginPath();
      c.arc(q[0], q[1], 22, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(q[0] - 8, q[1]); c.lineTo(q[0] + 8, q[1]);
      c.moveTo(q[0], q[1] - 8); c.lineTo(q[0], q[1] + 8);
      c.stroke();
    });
    if (this.drag) this.loupe(this.pts[this.drag.i], MARK_COLORS[this.drag.i]);
  }

  loupe(p, col) {
    const c = this.ctx, R = 64, z = 4;
    const q = this.toS(p);
    const lx = q[0] < this.cw / 2 ? this.cw - R - 14 : R + 14;
    const ly = 64 + R + 10;
    c.save();
    c.beginPath();
    c.arc(lx, ly, R, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#000';
    c.fillRect(lx - R, ly - R, R * 2, R * 2);
    const k = this.s * z;
    c.imageSmoothingEnabled = false;
    c.drawImage(this.photo, lx - p[0] * k, ly - p[1] * k, this.photo.width * k, this.photo.height * k);
    c.imageSmoothingEnabled = true;
    c.restore();
    c.lineWidth = 2;
    c.strokeStyle = col;
    c.beginPath();
    c.arc(lx, ly, R, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(lx - 12, ly); c.lineTo(lx + 12, ly);
    c.moveTo(lx, ly - 12); c.lineTo(lx, ly + 12);
    c.stroke();
  }
}
