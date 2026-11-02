// Beam: polygon geometry in wall space (cm, y up). Multi = [[outer, ...holes], ...], rings = [[x, y], ...].

const C = globalThis.ClipperLib;
const S = 100;

const toPath = r => r.map(p => ({ X: Math.round(p[0] * S), Y: Math.round(p[1] * S) }));
const fromPath = p => p.map(q => [q.X / S, q.Y / S]);

export function ringArea(r) {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const p = r[i], q = r[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function area(multi) {
  let a = 0;
  for (const poly of multi) for (const r of poly) a += ringArea(r);
  return a;
}

function toPaths(multi) {
  const out = [];
  for (const poly of multi) for (const ring of poly) if (ring.length > 2) out.push(toPath(ring));
  return out;
}

function fromTree(tree) {
  return C.JS.PolyTreeToExPolygons(tree).map(e => [fromPath(e.outer), ...e.holes.map(fromPath)]);
}

function prune(multi, minArea = 0.25) {
  const out = [];
  for (const poly of multi) {
    if (!poly[0] || poly[0].length < 3 || Math.abs(ringArea(poly[0])) < minArea) continue;
    out.push([poly[0], ...poly.slice(1).filter(h => h.length > 2 && Math.abs(ringArea(h)) > minArea * 0.2)]);
  }
  return out;
}

const OPS = () => ({
  union: C.ClipType.ctUnion,
  difference: C.ClipType.ctDifference,
  intersection: C.ClipType.ctIntersection,
  xor: C.ClipType.ctXor,
});

export function bool(a, b, op) {
  const c = new C.Clipper();
  const pa = toPaths(a), pb = toPaths(b || []);
  if (!pa.length && op !== 'union') return [];
  if (pa.length) c.AddPaths(pa, C.PolyType.ptSubject, true);
  if (pb.length) c.AddPaths(pb, C.PolyType.ptClip, true);
  const tree = new C.PolyTree();
  c.Execute(OPS()[op], tree, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
  return prune(fromTree(tree));
}

export const union = (a, b = []) => bool(a, b, 'union');
export const diff = (a, b) => bool(a, b, 'difference');
export const inter = (a, b) => bool(a, b, 'intersection');
export const normalize = a => bool(a, [], 'union');

export function offset(multi, d, round = true) {
  const co = new C.ClipperOffset(2, 0.04 * S);
  co.AddPaths(toPaths(multi), round ? C.JoinType.jtRound : C.JoinType.jtMiter, C.EndType.etClosedPolygon);
  const tree = new C.PolyTree();
  co.Execute(tree, d * S);
  return prune(fromTree(tree));
}

export function stroke(pts, r) {
  const co = new C.ClipperOffset(2, 0.03 * S);
  let p = pts;
  if (p.length === 1) p = [p[0], [p[0][0] + 0.03, p[0][1]]];
  co.AddPath(toPath(p), C.JoinType.jtRound, C.EndType.etOpenRound);
  const tree = new C.PolyTree();
  co.Execute(tree, r * S);
  return prune(fromTree(tree));
}

export function rect(x0, y0, x1, y1) {
  const a = Math.min(x0, x1), b = Math.max(x0, x1), c = Math.min(y0, y1), d = Math.max(y0, y1);
  return [[[[a, c], [b, c], [b, d], [a, d]]]];
}

export function ellipse(cx, cy, rx, ry, n = 0) {
  const seg = n || Math.max(20, Math.min(96, Math.round((Math.abs(rx) + Math.abs(ry)) * 1.6)));
  const r = [];
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    r.push([cx + Math.cos(t) * Math.abs(rx), cy + Math.sin(t) * Math.abs(ry)]);
  }
  return [[r]];
}

export function fromRing(pts) {
  return normalize([[pts.map(p => [p[0], p[1]])]]);
}

export function orientCCW(ring) {
  return ringArea(ring) < 0 ? ring.slice().reverse() : ring;
}

export function bbox(multi) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of multi) for (const ring of poly) for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

export function pointInRing(r, x, y) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointIn(multi, x, y) {
  for (const poly of multi) {
    if (!pointInRing(poly[0], x, y)) continue;
    let hole = false;
    for (let k = 1; k < poly.length; k++) if (pointInRing(poly[k], x, y)) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

export function polyContaining(multi, x, y) {
  for (const poly of multi) if (pointIn([poly], x, y)) return poly;
  return null;
}

export function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function edgeDist(multi, x, y) {
  let d = Infinity;
  for (const poly of multi) for (const r of poly) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    d = Math.min(d, segDist(x, y, a[0], a[1], b[0], b[1]));
  }
  return d;
}

export function map(multi, fn) {
  return multi.map(poly => poly.map(r => r.map(p => fn(p[0], p[1]))));
}

export function translate(multi, dx, dy) {
  return map(multi, (x, y) => [x + dx, y + dy]);
}

function dpRun(pts, a, b, tol, keep) {
  let md = -1, mi = -1;
  for (let i = a + 1; i < b; i++) {
    const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
    if (d > md) { md = d; mi = i; }
  }
  if (md > tol) {
    keep[mi] = 1;
    dpRun(pts, a, mi, tol, keep);
    dpRun(pts, mi, b, tol, keep);
  }
}

export function simplifyRing(r, tol) {
  const n = r.length;
  if (n <= 4) return r;
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  const pts = [...r, r[0]];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[far] = keep[pts.length - 1] = 1;
  dpRun(pts, 0, far, tol, keep);
  dpRun(pts, far, pts.length - 1, tol, keep);
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(r[i]);
  return out.length >= 3 ? out : r;
}

export function simplify(multi, tol = 0.15) {
  return normalize(multi.map(poly => poly.map(r => simplifyRing(r, tol)).filter(r => r.length > 2)).filter(p => p.length));
}

export function facingChains(multi, dir = 1, minDot = 0.55) {
  return chainsWhere(multi, (nx, ny) => ny * dir >= minDot);
}

export function chainsWhere(multi, pred) {
  const chains = [];
  for (const poly of multi) for (const ring of poly) {
    const n = ring.length;
    if (n < 3) continue;
    const ok = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      ok[i] = L > 1e-6 && pred(dy / L, -dx / L);
    }
    const start = ok.indexOf(false);
    if (start < 0) {
      chains.push({ pts: ring.slice(), closed: true });
      continue;
    }
    let cur = null;
    for (let k = 1; k <= n; k++) {
      const i = (start + k) % n;
      if (ok[i]) {
        if (!cur) cur = [ring[i]];
        cur.push(ring[(i + 1) % n]);
      } else if (cur) {
        chains.push({ pts: cur, closed: false });
        cur = null;
      }
    }
    if (cur) chains.push({ pts: cur, closed: false });
  }
  return chains;
}

export function resample(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function rayHit(multi, x, y, dirX) {
  let best = Infinity, hitPoly = null;
  for (const poly of multi) for (const r of poly) for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length];
    if ((a[1] > y) === (b[1] > y)) continue;
    const t = (y - a[1]) / (b[1] - a[1]);
    const hx = a[0] + (b[0] - a[0]) * t;
    const d = (hx - x) * dirX;
    if (d > 0 && d < best) { best = d; hitPoly = poly; }
  }
  return hitPoly ? { dist: best, poly: hitPoly } : null;
}

export function bucket(x, y, solids, areaMulti, lake) {
  if (pointIn(solids, x, y) || !pointIn(areaMulti, x, y)) return null;
  const below = rect(-1e4, -1e4, 1e4, y);
  let region = null;
  if (!lake) {
    const L = rayHit(solids, x, y, -1), R = rayHit(solids, x, y, 1);
    if (L && R) {
      const b = bbox([L.poly, R.poly]);
      region = inter(rect(b.x0, b.y0, b.x1, Math.min(y, b.y1)), areaMulti);
    }
  }
  if (!region) region = inter(areaMulti, below);
  region = diff(region, solids);
  const hit = polyContaining(region, x, y);
  if (hit) return [hit];
  let best = null, bd = Infinity;
  for (const poly of region) {
    const d = edgeDist([poly], x, y);
    if (d < bd) { bd = d; best = poly; }
  }
  return best && bd < 2 ? [best] : null;
}

export function mirror(multi, axis, c) {
  const m = map(multi, (x, y) => (axis === 'x' ? [2 * c - x, y] : [x, 2 * c - y]));
  return normalize(m);
}

export function rotate(multi, ang, cx, cy) {
  const co = Math.cos(ang), si = Math.sin(ang);
  return map(multi, (x, y) => [cx + (x - cx) * co - (y - cy) * si, cy + (x - cx) * si + (y - cy) * co]);
}

export function scale(multi, sx, sy, cx, cy) {
  return map(multi, (x, y) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
}

export function chainYAt(pts, x) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    if (x < x0 || x > x1) continue;
    const t = x1 - x0 < 1e-9 ? 0 : (x - a[0]) / (b[0] - a[0]);
    const y = a[1] + (b[1] - a[1]) * t;
    if (best === null || y > best) best = y;
  }
  return best;
}

export function closedPts(chain) {
  return chain.closed ? [...chain.pts, chain.pts[0]] : chain.pts;
}
