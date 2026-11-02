// Beam: Rapier world built from the mapped wall (cm, y up): solid outlines, one-way shelf tops and the edge of the light.
// The static part rebuilds in place, so an edit from a phone mid-game does not respawn anyone.

import RAPIER from '@dimforge/rapier2d-compat';
import * as P from '../math/poly.js';
import { SOLID_TYPES } from '../scene.js';

export const GROUP_WORLD = 0x0001;
export const GROUP_ACTOR = 0x8000;
export const groups = (member, filter) => (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;
export const QUERY_WORLD = groups(0xffff, GROUP_WORLD);

let ready = null;
export function initRapier() {
  if (!ready) ready = RAPIER.init();
  return ready;
}

export function tuning(charSize) {
  const s = charSize / 8;
  const jumpH = 34 * s, apex = 0.36;
  return {
    s,
    g: (2 * jumpH) / (apex * apex),
    jumpV: (2 * jumpH) / apex,
    swimV: 78 * s,
    run: 50 * s,
  };
}

export class Physics {
  constructor() {
    this.world = null;
    this.info = new Map();
    this.parts = new Map();
    this.kcc = null;
    const C = () => RAPIER.SolverFlags.COMPUTE_IMPULSE, E = () => RAPIER.SolverFlags.EMPTY;
    this.hooks = {
      filterContactPair: (c1, c2, b1, b2) => {
        const i1 = this.info.get(c1), i2 = this.info.get(c2);
        const plat = i1 && i1.kind === 'platform' ? i1 : i2 && i2.kind === 'platform' ? i2 : null;
        if (!plat) return C();
        const st = this.parts.get(plat === i1 ? b2 : b1);
        if (!st) return C();
        if (st.drop || st.vy > 8) return E();
        return st.bottom >= this.surfaceY(plat, st.x) - 0.45 ? C() : E();
      },
      filterIntersectionPair: () => true,
    };
  }

  build(state, space) {
    this.destroy();
    const t = tuning(state.settings.charSize);
    this.t = t;
    const world = new RAPIER.World({ x: 0, y: -t.g });
    world.timestep = 1 / 120;
    try { world.lengthUnit = 8 * t.s; } catch (e) { }
    this.world = world;
    this.statics(state, space);
    const k = world.createCharacterController(0.06 * t.s);
    k.setUp({ x: 0, y: 1 });
    k.setSlideEnabled(true);
    k.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    k.setMinSlopeSlideAngle((58 * Math.PI) / 180);
    k.enableAutostep(2.5 * t.s, 0.5 * t.s, false);
    k.enableSnapToGround(1.4 * t.s);
    k.setApplyImpulsesToDynamicBodies(false);
    this.kcc = k;
    world.step();
  }

  rebuild(state, space) {
    if (!this.world) return;
    this.world.removeRigidBody(this.fixed);
    this.info.clear();
    this.statics(state, space);
  }

  statics(state, space) {
    this.fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const sh of state.shapes) {
      if (!sh.geom.length) continue;
      if (SOLID_TYPES.has(sh.type) || (sh.type === 'screen' && sh.props.solid)) {
        for (const poly of sh.geom) for (const ring of poly) this.addLine([...ring, ring[0]], { kind: 'solid', type: sh.type, id: sh.id, shape: sh });
      } else if (sh.type === 'platform') {
        for (const ch of P.facingChains(sh.geom, 1, 0.35)) {
          const pts = P.closedPts(ch);
          let x0 = Infinity, x1 = -Infinity;
          for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
          this.addLine(pts, { kind: 'platform', type: 'platform', id: sh.id, shape: sh, chain: pts, x0, x1 }, true);
        }
      }
    }
    const floor = state.settings.floor;
    for (const poly of space.area) {
      const ring = poly[0];
      const list = floor ? [{ pts: ring, closed: true }] : P.chainsWhere([[ring]], (nx, ny) => ny > -0.5);
      for (const c of list) this.addLine(P.closedPts(c), { kind: 'bounds', type: 'bounds' });
    }
  }

  addLine(pts, info, oneWay = false) {
    if (pts.length < 2) return null;
    const v = new Float32Array(pts.length * 2);
    pts.forEach((p, i) => { v[i * 2] = p[0]; v[i * 2 + 1] = p[1]; });
    const desc = RAPIER.ColliderDesc.polyline(v)
      .setFriction(info.type === 'ice' ? 0.03 : 0.9)
      .setCollisionGroups(groups(GROUP_WORLD, 0xffff));
    if (oneWay) desc.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    const c = this.world.createCollider(desc, this.fixed);
    this.info.set(c.handle, info);
    return c;
  }

  surfaceY(plat, x) {
    const y = P.chainYAt(plat.chain, Math.max(plat.x0, Math.min(plat.x1, x)));
    return y === null ? -Infinity : y;
  }

  actor(x, y, desc) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y));
    const col = this.world.createCollider(desc.setCollisionGroups(groups(GROUP_ACTOR, 0)), body);
    return { body, col };
  }

  remove(body) {
    if (this.world && body) this.world.removeRigidBody(body);
  }

  pred(ent) {
    return col => {
      const inf = this.info.get(col.handle);
      if (!inf) return false;
      if (inf.kind !== 'platform') return true;
      if (ent.drop > 0 || ent.vy > 1e-3) return false;
      return ent.feet >= this.surfaceY(inf, ent.x) - 0.3;
    };
  }

  move(ent, dx, dy) {
    const k = this.kcc;
    k.computeColliderMovement(ent.col, { x: dx, y: dy }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, QUERY_WORLD, this.pred(ent));
    const m = k.computedMovement();
    const hits = [];
    for (let i = 0, n = k.numComputedCollisions(); i < n; i++) {
      const c = k.computedCollision(i);
      if (!c || !c.collider) continue;
      hits.push({ info: this.info.get(c.collider.handle), nx: c.normal1.x, ny: c.normal1.y });
    }
    return { dx: m.x, dy: m.y, grounded: k.computedGrounded(), hits };
  }

  rayDown(x, y, maxD, ent) {
    const hit = this.world.castRay(new RAPIER.Ray({ x, y }, { x: 0, y: -1 }), maxD, true, undefined, QUERY_WORLD, undefined, undefined, this.pred(ent));
    if (!hit) return null;
    return { d: hit.timeOfImpact ?? hit.toi, info: this.info.get(hit.collider.handle) };
  }

  nearest(x, y) {
    const pr = this.world.projectPoint({ x, y }, true, undefined, QUERY_WORLD);
    if (!pr) return null;
    return { x: pr.point.x, y: pr.point.y, d: Math.hypot(pr.point.x - x, pr.point.y - y), inside: pr.isInside, info: this.info.get(pr.collider.handle) };
  }

  step() {
    this.world.step(undefined, this.hooks);
  }

  destroy() {
    if (this.kcc && this.world) this.world.removeCharacterController(this.kcc);
    if (this.world) this.world.free();
    this.world = null;
    this.kcc = null;
    this.info.clear();
    this.parts.clear();
  }
}
