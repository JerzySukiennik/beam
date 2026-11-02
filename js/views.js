// Beam: stage panes (room photo view and rectified wall editor), their pan/zoom and screen <-> space mapping.

export class Views {
  constructor() {
    this.w = 1;
    this.h = 1;
    this.layout = 'split';
    this.projAspect = 16 / 9;
    this.inset = { on: true, x: 0, y: 0, w: 0, h: 0 };
    this.room = { id: 'room', yUp: false, x: 0, y: 0, w: 1, h: 1, cx: 0, cy: 0, z: 1, on: true, manual: false, fit: null, fitZ: 1 };
    this.editor = { id: 'editor', yUp: true, x: 0, y: 0, w: 1, h: 1, cx: 0, cy: 0, z: 1, on: true, manual: false, fit: null, fitZ: 1 };
  }

  resize(w, h) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.arrange();
  }

  setLayout(layout) {
    if (this.layout === layout) return;
    this.layout = layout;
    this.arrange();
  }

  arrange() {
    const { w, h } = this;
    const r = this.room, e = this.editor;
    const gap = 6;
    if (this.layout === 'room') {
      Object.assign(r, { x: 0, y: 0, w, h, on: true });
      e.on = false;
    } else if (this.layout === 'editor') {
      Object.assign(e, { x: 0, y: 0, w, h, on: true });
      r.on = false;
    } else {
      const half = Math.floor((w - gap) / 2);
      Object.assign(r, { x: 0, y: 0, w: half, h, on: true });
      Object.assign(e, { x: half + gap, y: 0, w: w - half - gap, h, on: true });
    }
    const iw = Math.round(Math.min(300, Math.max(150, r.w * 0.24)));
    const ih = Math.round(iw / this.projAspect);
    Object.assign(this.inset, { on: r.w >= 320, x: r.x + r.w - iw - 14, y: r.y + r.h - ih - 14, w: iw, h: ih });
    for (const p of [r, e]) {
      if (!p.on || !p.fit) continue;
      if (!p.manual) this.fit(p, p.fit);
      else p.fitZ = this.fitScale(p, p.fit);
    }
  }

  fitScale(p, box) {
    const m = Math.min(48, Math.min(p.w, p.h) * 0.06);
    const bw = Math.max(1e-6, box.x1 - box.x0), bh = Math.max(1e-6, box.y1 - box.y0);
    return Math.max(1e-6, Math.min((p.w - 2 * m) / bw, (p.h - 2 * m) / bh));
  }

  fit(p, box) {
    p.fit = box;
    p.manual = false;
    p.z = p.fitZ = this.fitScale(p, box);
    p.cx = (box.x0 + box.x1) / 2;
    p.cy = (box.y0 + box.y1) / 2;
  }

  setFit(p, box, force = false) {
    p.fit = box;
    if (force || !p.manual) this.fit(p, box);
    else p.fitZ = this.fitScale(p, box);
  }

  pane(id) { return id === 'room' ? this.room : this.editor; }

  paneAt(mx, my) {
    for (const p of [this.room, this.editor]) {
      if (p.on && mx >= p.x && mx < p.x + p.w && my >= p.y && my < p.y + p.h) return p;
    }
    return null;
  }

  inInset(mx, my) {
    const i = this.inset;
    return this.room.on && i.on && mx >= i.x && mx <= i.x + i.w && my >= i.y && my <= i.y + i.h;
  }

  toSpace(p, mx, my) {
    const ox = p.x + p.w / 2, oy = p.y + p.h / 2;
    const x = p.cx + (mx - ox) / p.z;
    const y = p.yUp ? p.cy - (my - oy) / p.z : p.cy + (my - oy) / p.z;
    return [x, y];
  }

  toScreen(p, x, y) {
    const ox = p.x + p.w / 2, oy = p.y + p.h / 2;
    return [ox + (x - p.cx) * p.z, p.yUp ? oy - (y - p.cy) * p.z : oy + (y - p.cy) * p.z];
  }

  zoomAt(p, mx, my, f) {
    const [x, y] = this.toSpace(p, mx, my);
    const z = Math.min(p.fitZ * 40, Math.max(p.fitZ * 0.25, p.z * f));
    p.z = z;
    const ox = p.x + p.w / 2, oy = p.y + p.h / 2;
    p.cx = x - (mx - ox) / z;
    p.cy = p.yUp ? y + (my - oy) / z : y - (my - oy) / z;
    p.manual = true;
  }

  pan(p, dx, dy) {
    p.cx -= dx / p.z;
    p.cy += p.yUp ? dy / p.z : -dy / p.z;
    p.manual = true;
  }

  fbAffine(p, dpr, hfb) {
    const ox = p.x + p.w / 2, oy = p.y + p.h / 2;
    const a = 1 / (dpr * p.z);
    const b = p.cx - ox / p.z;
    if (p.yUp) return [a, b, a, p.cy - (hfb / dpr - oy) / p.z];
    return [a, b, -a, p.cy + (hfb / dpr - oy) / p.z];
  }
}
