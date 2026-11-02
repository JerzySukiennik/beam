// Beam: the three spaces (photo px, projector px, wall cm) and the homographies between them.

import * as H from './math/homography.js';
import * as P from './math/poly.js';

export class Space {
  constructor() {
    this.ok = false;
    this.area = [];
    this.box = { x0: 0, y0: 0, x1: 100, y1: 100, w: 100, h: 100 };
  }

  update(state) {
    const { jw, jh } = state.proj;
    const J = [[0, 0], [jw, 0], [jw, jh], [0, jh]];
    const { w, h } = state.calibCm;
    const Wc = [[0, h], [w, h], [w, 0], [0, 0]];
    this.jw = jw; this.jh = jh;
    this.HJP = H.solve(J, state.projQuad);
    this.HPJ = H.inv(this.HJP);
    this.HWJ = H.solve(Wc, state.calibJ);
    this.HJW = H.inv(this.HWJ);
    this.HWP = H.mul(this.HJP, this.HWJ);
    this.HPW = H.inv(this.HWP);
    this.ok = !!(this.HJP && this.HPJ && this.HWJ && this.HJW && this.HWP && this.HPW);
    if (!this.ok) return false;
    const jc = centroid(state.calibJ);
    const pq = centroid(state.projQuad);
    this.sJP = H.signAt(this.HJP, jw / 2, jh / 2);
    this.sPJ = H.signAt(this.HPJ, pq[0], pq[1]);
    this.sWJ = H.signAt(this.HWJ, w / 2, h / 2);
    this.sJW = H.signAt(this.HJW, jc[0], jc[1]);
    this.sWP = H.signAt(this.HWP, w / 2, h / 2);
    const pc = H.apply(this.HWP, w / 2, h / 2);
    this.sPW = H.signAt(this.HPW, pc[0], pc[1]);
    let jpoly = H.clipHalfPlane(J, this.HJW, this.sJW, 1e-7);
    const wpoly = jpoly.map(p => H.apply(this.HJW, p[0], p[1])).filter(p => isFinite(p[0]) && isFinite(p[1]));
    const R = Math.max(w, h, 60) * 6 + 300;
    const clampBox = P.rect(w / 2 - R, h / 2 - R, w / 2 + R, h / 2 + R);
    this.area = wpoly.length > 2 ? P.inter(P.normalize([[wpoly]]), clampBox) : [];
    if (!this.area.length) this.area = P.rect(0, 0, w, h);
    this.box = P.bbox(this.area);
    this.cm = { w, h };
    return true;
  }

  jToW(x, y) { return H.applySafe(this.HJW, this.sJW, x, y); }
  wToJ(x, y) { return H.applySafe(this.HWJ, this.sWJ, x, y); }
  pToW(x, y) { return H.applySafe(this.HPW, this.sPW, x, y); }
  wToP(x, y) { return H.applySafe(this.HWP, this.sWP, x, y); }
  pToJ(x, y) { return H.applySafe(this.HPJ, this.sPJ, x, y); }
  jToP(x, y) { return H.applySafe(this.HJP, this.sJP, x, y); }

  inArea(x, y) { return P.pointIn(this.area, x, y); }

  pxPerCm() {
    const c = [this.cm.w / 2, this.cm.h / 2];
    const a = this.wToJ(c[0], c[1]), b = this.wToJ(c[0] + 1, c[1]);
    if (!a || !b) return 4;
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
}

export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}
