// Beam: rubbery character (Human Fall Flat feel). An active ragdoll held up by a hip spring, legs and arms on joint motors, hands that grab.

import RAPIER from '@dimforge/rapier2d-compat';
import * as P from '../math/poly.js';
import { groups, GROUP_WORLD } from './physics.js';
import { hsv } from './player.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

export class Ragdoll {
  constructor(game, idx, color) {
    this.game = game;
    this.idx = idx;
    this.color = color;
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
  }

  get t() { return this.game.phys.t; }
  get scale() { return this.power.big > 0 ? 1.4 : 1; }
  get alive() { return this.dead <= 0 && !!this.parts; }
  get feet() { return this.parts ? Math.min(this.bottom(this.parts.shinL), this.bottom(this.parts.shinR)) : this.y; }

  spawn(x, feet) {
    this.power = { big: 0, feather: 0, star: 0 };
    this.dead = 0;
    this.inv = 1.2;
    this.build(x, feet);
  }

  build(x, fy) {
    this.destroy();
    const ph = this.game.phys, w = ph.world;
    const s = ph.t.s * this.scale * 1.12;
    const grp = groups(0x0002 << this.idx, GROUP_WORLD);
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

  die() {
    if (this.dead > 0 || this.inv > 0 || !this.parts) return;
    this.game.fxBurst(this.x, this.y, this.color, 46);
    this.destroy();
    this.dead = 0.9;
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
      try { w.removeRigidBody(g.anchor); } catch (e) { }
    }
    this.grabs[i] = null;
  }

  tryGrab(i, arm) {
    if (this.grabs[i]) return;
    const ph = this.game.phys, D = this.D;
    const hand = this.end(arm, -1);
    const n = ph.nearest(hand[0], hand[1]);
    if (!n || n.d > D.armR + 0.55 * D.s || (n.info && n.info.kind === 'bounds')) return;
    const anchor = ph.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(n.x, n.y));
    const joint = ph.world.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0 }, { x: 0, y: -(D.armH + D.armR * 0.55) }), anchor, arm.b, true);
    this.grabs[i] = { anchor, joint, x: n.x, y: n.y };
    this.game.fxGrab(n.x, n.y, this.color);
  }

  motor(j, target) { j.configureMotorPosition(target, j.k, j.c); }

  update(dt, inp) {
    const g = this.game, ph = g.phys, t = this.t;
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
    this.jumpT = Math.max(0, this.jumpT - dt);
    this.drop = inp.down ? 0.2 : Math.max(0, this.drop - dt);
    this.bounceT = Math.max(0, this.bounceT - dt);
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
    if (this.grounded && !grabbing) {
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
    const upK = grabbing ? 30 : this.grounded ? 360 : 140, upC = grabbing ? 6 : this.grounded ? 30 : 14;
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

  draw(L, time) {
    if (!this.parts || this.dead > 0) return;
    if (this.inv > 0 && Math.floor(time * 18) % 2 === 0) return;
    const D = this.D, p = this.parts;
    const col = this.power.star > 0 ? hsv((time * 1.4 + this.idx * 0.25) % 1) : this.color;
    const w = 0.36 * D.s, g = 0.55 * D.s;
    const limb = (q, k = 1) => {
      const a = this.end(q, 1), b = this.end(q, -1);
      L.seg(a[0], a[1], b[0], b[1], col, w * k, g * k, 0, 4);
    };
    limb(p.torso, 1.25);
    limb(p.thighL); limb(p.shinL); limb(p.thighR); limb(p.shinR);
    limb(p.armL, 0.85); limb(p.armR, 0.85);
    const h = p.head.b.translation(), ha = p.head.b.rotation();
    L.circle(h.x, h.y, D.headR * 0.92, col, w, g, 0, 16, 4);
    const fx = Math.cos(ha) * this.face, fy = Math.sin(ha) * this.face;
    L.dot(h.x + fx * D.headR * 0.42 - fy * 0.1, h.y + fy * D.headR * 0.42 + D.headR * 0.1, 0.2 * D.s, col, 0.45 * D.s, 0, 4);
    L.dot(h.x - fy * 0.1, h.y + D.headR * 0.1, 0.17 * D.s, col, 0.4 * D.s, 0, 4);
    const top = [h.x - Math.sin(ha) * D.headR, h.y + Math.cos(ha) * D.headR];
    const tip = [top[0] - Math.sin(ha) * D.headR * 0.95 - this.vx * 0.004, top[1] + Math.cos(ha) * D.headR * 0.95];
    L.seg(top[0], top[1], tip[0], tip[1], col, w * 0.7, g * 0.7, 0, 4);
    L.dot(tip[0], tip[1], 0.3 * D.s, this.power.feather > 0 ? [1, 1, 1] : col, 0.9 * D.s, 0, 4);
    for (const gr of this.grabs) if (gr) L.dot(gr.x, gr.y, 0.25 * D.s, [1, 1, 1], 0.9 * D.s, 0);
  }
}
