// Beam: rubbery character (Human Fall Flat feel). An active ragdoll held up by a hip spring, legs and arms on joint motors,
// hands that grab walls and other players (pull a friend up a shelf or drag them along). Ragdolls bump into each other.

import RAPIER from '@dimforge/rapier2d-compat';
import { groups, GROUP_WORLD, RAG_BITS } from './physics.js';
import { drawSkeleton, hsv, Look } from './figure.js';

const IDLE = { left: false, right: false, jump: false, jumpPressed: false, down: false, grab: false };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function closest(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1e-9)));
  return [a[0] + dx * t, a[1] + dy * t];
}

export class Ragdoll {
  constructor(game, idx, color, look) {
    this.game = game;
    this.idx = idx;
    this.color = color;
    this.look = new Look(look);
    this.kind = 'rubbery';
    this.parts = null;
    this.joints = [];
    this.grabs = [null, null];
    this.face = 1;
    this.phase = 0;
    this.dead = 0;
    this.inv = 0;
    this.jumpT = 0;
    this.buffer = 0;
    this.drop = 0;
    this.bounceT = 0;
    this.grounded = false;
    this.inWater = false;
    this.power = { big: 0, feather: 0, star: 0 };
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.own = 0x0002 << idx;
    this.gen = 0;
    this.mated = false;
    this.stun = 0;
    this.lastHit = null;
    this.score = 0; this.coins = 0; this.done = false; this.place = 0; this.doneAt = 0;
  }

  get t() { return this.game.phys.t; }
  get scale() { return this.power.big > 0 ? 1.4 : 1; }
  get alive() { return this.dead <= 0 && !this.done && !!this.parts; }
  get solid() { return this.dead <= 0 && !this.done && this.inv <= 0 && !!this.parts; }
  get feet() { return this.parts ? Math.min(this.bottom(this.parts.shinL), this.bottom(this.parts.shinR)) : this.y; }

  standable() { return false; }

  spawn(x, feet) {
    this.power = { big: 0, feather: 0, star: 0 };
    this.dead = 0;
    this.inv = 1.2;
    this.stun = 0;
    this.lastHit = null;
    this.build(x, feet);
  }

  build(x, fy) {
    this.destroy();
    const ph = this.game.phys, w = ph.world;
    const s = ph.t.s * this.scale * 1.12;
    this.gen++;
    this.mated = this.inv <= 0;
    const grp = groups(this.own, GROUP_WORLD | (this.mated ? RAG_BITS & ~this.own : 0));
    const D = this.D = {
      s,
      torsoR: 0.78 * s, torsoH: 0.75 * s,
      thighR: 0.4 * s, thighH: 0.72 * s,
      shinR: 0.36 * s, shinH: 0.72 * s,
      armR: 0.28 * s, armH: 0.95 * s,
      headR: 0.92 * s,
    };
    D.leg = D.shinR + 2 * D.shinH + 2 * D.thighH;
    D.hip = fy + D.leg;
    D.H = D.leg + 2 * D.torsoH + 1.8 * D.headR;
    const mk = (px, py, desc, density = 1) => {
      const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py).setLinearDamping(0.3).setAngularDamping(1.2).setCcdEnabled(true));
      const c = w.createCollider(desc.setDensity(density).setFriction(0.85).setRestitution(0).setCollisionGroups(grp), b);
      return { b, c, r: desc.shape.radius ?? 0, hh: desc.shape.halfHeight ?? 0 };
    };
    const kneeY = fy + D.shinR + 2 * D.shinH;
    const torsoY = D.hip + D.torsoH;
    const neckY = torsoY + D.torsoH;
    const shY = torsoY + D.torsoH * 0.85;
    const p = {};
    p.torso = mk(x, torsoY, RAPIER.ColliderDesc.capsule(D.torsoH, D.torsoR), 1.3);
    p.head = mk(x, neckY + D.headR * 0.9, RAPIER.ColliderDesc.ball(D.headR), 0.8);
    for (const k of ['L', 'R']) {
      p['thigh' + k] = mk(x, D.hip - D.thighH, RAPIER.ColliderDesc.capsule(D.thighH, D.thighR));
      p['shin' + k] = mk(x, kneeY - D.shinH, RAPIER.ColliderDesc.capsule(D.shinH, D.shinR));
      p['arm' + k] = mk(x, shY - D.armH, RAPIER.ColliderDesc.capsule(D.armH, D.armR), 0.7);
    }
    this.parts = p;
    this.list = Object.values(p);
    this.mass = this.list.reduce((m, q) => m + q.b.mass(), 0);
    const J = (a, b, la, lb, k, c, lim) => {
      const j = w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: la }, { x: 0, y: lb }), a.b, b.b, true);
      j.setContactsEnabled(false);
      j.configureMotorModel(RAPIER.MotorModel.AccelerationBased);
      if (lim) j.setLimits(-lim, lim);
      j.k = k; j.c = c;
      this.joints.push(j);
      return j;
    };
    this.j = {
      neck: J(p.torso, p.head, D.torsoH, -D.headR * 0.9, 380, 26, 0.7),
      hipL: J(p.torso, p.thighL, -D.torsoH, D.thighH, 780, 34, 1.9),
      hipR: J(p.torso, p.thighR, -D.torsoH, D.thighH, 780, 34, 1.9),
      kneeL: J(p.thighL, p.shinL, -D.thighH, D.shinH, 620, 30, 2.3),
      kneeR: J(p.thighR, p.shinR, -D.thighH, D.shinH, 620, 30, 2.3),
      shL: J(p.torso, p.armL, D.torsoH * 0.85, D.armH, 160, 16, 0),
      shR: J(p.torso, p.armR, D.torsoH * 0.85, D.armH, 160, 16, 0),
    };
    this.sync();
  }

  mate() {
    this.mated = true;
    const grp = groups(this.own, GROUP_WORLD | (RAG_BITS & ~this.own));
    for (const q of this.list) q.c.setCollisionGroups(grp);
  }

  bottom(q) {
    const t = q.b.translation(), a = q.b.rotation();
    return t.y - (Math.abs(Math.cos(a)) * q.hh + q.r);
  }

  end(q, sign) {
    const t = q.b.translation(), a = q.b.rotation();
    const l = q.hh + q.r * 0.55;
    return [t.x - Math.sin(a) * l * sign, t.y + Math.cos(a) * l * sign];
  }

  sync() {
    const tor = this.parts.torso.b;
    const tt = tor.translation(), tv = tor.linvel();
    this.x = tt.x; this.y = tt.y; this.vx = tv.x; this.vy = tv.y;
    for (const q of this.list) {
      const t = q.b.translation(), v = q.b.linvel();
      this.game.phys.parts.set(q.b.handle, { x: t.x, bottom: this.bottom(q), vy: v.y, drop: this.drop > 0 });
    }
  }

  destroy() {
    const ph = this.game.phys;
    this.release(0); this.release(1);
    if (this.parts && ph.world) {
      for (const q of this.list) { ph.parts.delete(q.b.handle); ph.world.removeRigidBody(q.b); }
    }
    this.parts = null;
    this.list = [];
    this.joints = [];
  }

  die(by = null) {
    if (this.dead > 0 || this.inv > 0 || !this.parts || this.done) return false;
    this.game.fxBurst(this.x, this.y, this.color, 46);
    this.destroy();
    this.dead = 0.9;
    this.game.died(this, by);
    return true;
  }

  toGoal() {
    this.destroy();
    this.done = true;
  }

  knock(vx, vy, stun, by) {
    if (!this.solid) return;
    for (const q of this.list) {
      const v = q.b.linvel();
      q.b.setLinvel({ x: v.x + vx, y: Math.max(v.y, vy) }, true);
    }
    this.stun = Math.max(this.stun, stun);
    if (by) this.lastHit = { by, t: this.game.time };
  }

  bounceOff() {
    this.kick(this.t.jumpV * 0.6);
    this.jumpT = 0.3;
  }

  footPoint() {
    const L = this.parts.shinL, R = this.parts.shinR;
    const bl = this.bottom(L), br = this.bottom(R);
    const q = bl < br ? L : R;
    return { x: q.b.translation().x, y: Math.min(bl, br), vy: q.b.linvel().y };
  }

  headTop() {
    const h = this.parts.head.b, t = h.translation();
    return { x: t.x, y: t.y + this.D.headR, r: this.D.headR, vy: h.linvel().y };
  }

  grow(on) {
    if (!this.parts) return;
    const fx = this.x, fy = this.feet;
    this.power.big = on ? 15 : 0;
    this.build(fx, fy + 0.2);
  }

  release(i) {
    const g = this.grabs[i];
    if (!g) return;
    const w = this.game.phys.world;
    if (w) {
      try { w.removeImpulseJoint(g.joint, true); } catch (e) { }
      if (g.anchor) { try { w.removeRigidBody(g.anchor); } catch (e) { } }
    }
    this.grabs[i] = null;
  }

  tryGrab(i, arm) {
    if (this.grabs[i]) return;
    const g = this.game, ph = g.phys, D = this.D;
    const hand = this.end(arm, -1);
    const reach = D.armR + 0.55 * D.s;
    let best = null;
    const n = ph.nearest(hand[0], hand[1]);
    if (n && n.d <= reach && !(n.info && n.info.kind === 'bounds')) best = { d: n.d, x: n.x, y: n.y };
    for (const o of g.players) {
      if (o === this || o.kind !== 'rubbery' || !o.solid || !this.solid) continue;
      for (const q of o.list) {
        const c = closest(hand[0], hand[1], o.end(q, 1), o.end(q, -1));
        const d = Math.hypot(c[0] - hand[0], c[1] - hand[1]) - q.r;
        if (d <= reach && (!best || d < best.d)) best = { d, x: c[0], y: c[1], other: o, part: q };
      }
    }
    if (!best) return;
    const handLocal = { x: 0, y: -(D.armH + D.armR * 0.55) };
    if (best.other) {
      const t = best.part.b.translation(), a = best.part.b.rotation();
      const lx = best.x - t.x, ly = best.y - t.y;
      const loc = { x: Math.cos(a) * lx + Math.sin(a) * ly, y: -Math.sin(a) * lx + Math.cos(a) * ly };
      const joint = ph.world.createImpulseJoint(RAPIER.JointData.revolute(loc, handLocal), best.part.b, arm.b, true);
      joint.setContactsEnabled(false);
      this.grabs[i] = { joint, other: best.other, gen: best.other.gen, part: best.part, loc, x: best.x, y: best.y };
      best.other.lastHit = { by: this, t: g.time };
    } else {
      const anchor = ph.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(best.x, best.y));
      const joint = ph.world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0 }, handLocal), anchor, arm.b, true);
      this.grabs[i] = { anchor, joint, x: best.x, y: best.y };
    }
    g.fxGrab(best.x, best.y, this.color);
  }

  motor(j, target) { j.configureMotorPosition(target, j.k, j.c); }

  update(dt, inp) {
    const g = this.game, ph = g.phys, t = this.t;
    if (this.done) return;
    if (this.dead > 0) {
      this.dead -= dt;
      if (this.dead <= 0) g.respawn(this);
      return;
    }
    if (!this.parts) return;
    if (this.power.big > 0 && (this.power.big -= dt) <= 0) this.grow(false);
    if (this.power.feather > 0) this.power.feather -= dt;
    if (this.power.star > 0) this.power.star -= dt;
    this.inv = Math.max(0, this.inv - dt);
    if (!this.mated && this.inv <= 0) this.mate();
    const limp = this.stun > 0;
    if (limp) { this.stun -= dt; inp = IDLE; }
    this.jumpT = Math.max(0, this.jumpT - dt);
    this.drop = inp.down ? 0.2 : Math.max(0, this.drop - dt);
    this.bounceT = Math.max(0, this.bounceT - dt);
    for (let i = 0; i < 2; i++) {
      const gr = this.grabs[i];
      if (!gr || !gr.other) continue;
      if (gr.other.gen !== gr.gen || !gr.other.solid) { this.release(i); continue; }
      const pt = gr.part.b.translation(), a = gr.part.b.rotation();
      gr.x = pt.x + Math.cos(a) * gr.loc.x - Math.sin(a) * gr.loc.y;
      gr.y = pt.y + Math.sin(a) * gr.loc.x + Math.cos(a) * gr.loc.y;
    }
    const D = this.D, p = this.parts, tor = p.torso.b;
    const tt = tor.translation(), tv = tor.linvel();
    const ang = wrap(tor.rotation()), av = tor.angvel();
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir) this.face = dir;
    const f = this.face;
    const hipP = [tt.x + Math.sin(ang) * D.torsoH, tt.y - Math.cos(ang) * D.torsoH];
    const ray = ph.rayDown(hipP[0], hipP[1], D.leg * 1.3, { x: hipP[0], feet: hipP[1], vy: 0, drop: this.drop });
    const water = g.inWater(tt.x, tt.y);
    if (water !== this.inWater) { g.splash(tt.x, tv.y, tt.y); this.inWater = water; }
    const grabbing = !!(this.grabs[0] || this.grabs[1]);
    this.grounded = !!ray && ray.d < D.leg * 1.12 && this.jumpT <= 0;
    this.buffer = inp.jumpPressed ? 0.12 : this.buffer - dt;
    const star = this.power.star > 0;
    const run = t.run * 0.85 * (water ? 0.6 : 1) * (star ? 1.3 : 1);
    const m = this.mass;
    if (limp) {
    } else if (this.grounded && !grabbing) {
      const err = D.leg * 0.93 - ray.d;
      const F = Math.max(0, Math.min(3.2 * m * t.g, m * (t.g + 900 * err - 55 * tv.y)));
      tor.applyImpulse({ x: 0, y: F * dt }, true);
      if (ray.info && ray.info.type === 'ice') tor.applyImpulse({ x: m * (dir * run - tv.x) * 0.6 * dt, y: 0 }, true);
      else tor.applyImpulse({ x: m * (dir * run - tv.x) * 9 * dt, y: 0 }, true);
      if (ray.info && ray.info.type === 'bounce' && this.bounceT <= 0 && tv.y < 20) {
        this.kick(t.jumpV * (ray.info.shape.props.power || 1.6) * 0.92);
        this.bounceT = 0.35;
        g.fxBounce(this, ray.info);
      }
    } else if (!grabbing) {
      tor.applyImpulse({ x: m * (dir * run - tv.x) * 2.2 * dt, y: 0 }, true);
    } else {
      tor.applyImpulse({ x: m * dir * t.g * 0.18 * dt, y: 0 }, true);
    }
    if (water) {
      for (const q of this.list) {
        const v = q.b.linvel();
        q.b.applyImpulse({ x: -v.x * q.b.mass() * 2.2 * dt, y: q.b.mass() * (t.g * 1.12 - v.y * 2.2) * dt }, true);
      }
    }
    if (this.power.feather > 0 && inp.jump && tv.y < 0) tor.applyImpulse({ x: 0, y: m * t.g * 0.65 * dt }, true);
    if (this.buffer > 0) {
      if (water) {
        const surface = !g.inWater(tt.x, tt.y + D.torsoH * 2.2);
        this.kick(surface ? t.jumpV * 0.85 : Math.max(tv.y, t.swimV));
        this.buffer = 0;
        if (surface) { this.jumpT = 0.3; g.fxJump(this); } else g.fxSwim(this);
      }
      else if (grabbing) {
        this.release(0); this.release(1);
        this.kick(t.jumpV * 0.85);
        this.buffer = 0; this.jumpT = 0.25;
        g.fxJump(this);
      } else if (this.grounded) {
        this.kick(t.jumpV * 0.95);
        this.buffer = 0; this.jumpT = 0.3;
        g.fxJump(this);
      } else if (this.power.feather > 0 && !this.usedAir) {
        this.kick(t.jumpV * 0.8);
        this.usedAir = true; this.buffer = 0; this.jumpT = 0.3;
        g.fxFeather(this);
      }
    }
    if (this.grounded) this.usedAir = false;
    const upK = limp ? 4 : grabbing ? 30 : this.grounded ? 360 : 140, upC = limp ? 1 : grabbing ? 6 : this.grounded ? 30 : 14;
    const lean = this.grounded ? -f * 0.14 * Math.min(1, Math.abs(tv.x) / run) : 0;
    const I = tor.principalInertia() * 3.2;
    tor.applyTorqueImpulse(I * (upK * wrap(lean - ang) - upC * av) * dt, true);
    const amp = Math.min(1, Math.abs(tv.x) / (run * 0.5));
    if (this.grounded) this.phase += (dt * Math.min(Math.abs(tv.x), run)) / (5.5 * D.s) * Math.PI;
    const J = this.j;
    const stance = 0.17 * (1 - amp);
    if (this.grounded) {
      const sw = Math.sin(this.phase) * 0.85 * amp;
      this.motor(J.hipL, f * (sw + stance));
      this.motor(J.hipR, -f * (sw + stance));
      this.motor(J.kneeL, -f * (0.15 + Math.max(0, Math.sin(this.phase + 1.4)) * 0.9 * amp));
      this.motor(J.kneeR, -f * (0.15 + Math.max(0, Math.sin(this.phase + 1.4 + Math.PI)) * 0.9 * amp));
    } else if (water) {
      const k = Math.sin(this.game.time * 9) * 0.6;
      this.motor(J.hipL, f * k); this.motor(J.hipR, -f * k);
      this.motor(J.kneeL, -f * 0.5); this.motor(J.kneeR, -f * 0.5);
    } else {
      this.motor(J.hipL, f * 0.6); this.motor(J.hipR, f * 0.25);
      this.motor(J.kneeL, -f * 1.1); this.motor(J.kneeR, -f * 0.7);
    }
    this.motor(J.neck, 0);
    if (inp.grab) {
      this.motor(J.shL, f * 2.75);
      this.motor(J.shR, f * 2.45);
      this.tryGrab(0, p.armL);
      this.tryGrab(1, p.armR);
    } else {
      if (grabbing) { this.release(0); this.release(1); }
      if (this.grounded) {
        const sw = Math.sin(this.phase) * 0.6 * amp + stance * 1.4;
        this.motor(J.shL, -f * sw); this.motor(J.shR, f * sw);
      } else {
        const fl = Math.sin(this.game.time * 13) * 0.5;
        this.motor(J.shL, f * (1.9 + fl)); this.motor(J.shR, f * (1.6 - fl));
      }
    }
    if (!star) {
      for (const q of this.list) {
        const qt = q.b.translation();
        if (g.lavaAt(qt.x, qt.y)) { g.fxLava(this); this.die(); return; }
      }
    }
    const head = p.head.b.translation(), hv = p.head.b.linvel();
    if (hv.y > 12) {
      const id = g.luckyAbove(head.x, head.y + D.headR + 0.35);
      if (id) {
        g.hitLucky(id, this);
        for (const q of this.list) { const v = q.b.linvel(); q.b.setLinvel({ x: v.x, y: Math.min(v.y, -10) }, true); }
      }
    }
    if (tt.y < g.space.box.y0 - 30) { this.die(); return; }
    this.sync();
  }

  kick(vy) {
    for (const q of this.list) {
      const v = q.b.linvel();
      q.b.setLinvel({ x: v.x, y: vy }, true);
    }
  }

  hitbox() {
    const D = this.D;
    return { x: this.x, y: this.y, r: D ? D.torsoR + D.torsoH + 0.6 * D.s : 2 };
  }

  pushers() {
    if (!this.parts || this.dead > 0) return [];
    const out = [];
    for (const k of ['shinL', 'shinR', 'torso', 'head']) {
      const q = this.parts[k];
      const t = q.b.translation();
      out.push({ x: t.x, y: t.y, r: Math.max(q.r, q.hh * 0.6) * 1.2, feet: this.feet });
    }
    return out;
  }

  draw(L, time, faces) {
    if (!this.parts || this.dead > 0 || this.done) return;
    if (this.inv > 0 && Math.floor(time * 18) % 2 === 0) return;
    const D = this.D, p = this.parts;
    const col = this.power.star > 0 ? hsv((time * 1.4 + this.idx * 0.25) % 1) : this.stun > 0 ? this.color.map(v => v * 0.55) : this.color;
    const ends = q => [this.end(q, 1), this.end(q, -1)];
    const [neck, hip] = ends(p.torso);
    const h = p.head.b.translation();
    const ux = neck[0] - hip[0], uy = neck[1] - hip[1], ul = Math.hypot(ux, uy) || 1;
    drawSkeleton(L, {
      H: D.H, hr: D.headR * 0.92, w: 0.36 * D.s, g: 0.55 * D.s, face: this.face, col,
      accent: this.power.feather > 0 ? [1, 1, 1] : null,
      hip, neck, head: [h.x, h.y], up: [ux / ul, uy / ul], ha: p.head.b.rotation(),
      legs: [ends(p.thighL), ends(p.shinL), ends(p.thighR), ends(p.shinR)],
      arms: [ends(p.armL), ends(p.armR)],
      vx: this.vx, vy: this.vy, grounded: this.grounded, time,
    }, this.look, faces ? (x, y, r, a) => faces.place(this.src.id, x, y, r, a) : null);
    for (const gr of this.grabs) if (gr) L.dot(gr.x, gr.y, 0.25 * D.s, [1, 1, 1], 0.9 * D.s, 0);
  }
}
