// Beam: precise platformer character (Mario feel) on Rapier's kinematic character controller. Players stand on each
// other's heads like on one-way shelves and ride along when the one below moves; landing hard on a head is a stomp.

import RAPIER from '@dimforge/rapier2d-compat';
import { QUERY_PLAYER } from './physics.js';
import { drawFigure, hsv, Look } from './figure.js';

const COYOTE = 0.1, BUFFER = 0.12;
const IDLE = { left: false, right: false, jump: false, jumpPressed: false, down: false, grab: false };

function approach(v, target, d) {
  return v < target ? Math.min(target, v + d) : Math.max(target, v - d);
}

export class Player {
  constructor(game, idx, color, look) {
    this.game = game;
    this.idx = idx;
    this.color = color;
    this.look = new Look(look);
    this.kind = 'precise';
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.face = 1;
    this.grounded = false; this.ground = null;
    this.coyote = 0; this.buffer = 0; this.jumping = false;
    this.drop = 0; this.inWater = false;
    this.walk = 0; this.squash = 0;
    this.dead = 0; this.inv = 0;
    this.power = { big: 0, feather: 0, star: 0 };
    this.airJumps = 0;
    this.body = null; this.col = null;
    this.carrier = null; this.riding = null; this.lastDx = 0; this.lastDy = 0;
    this.stun = 0; this.punchT = 0; this.punchCd = 0; this.grabWas = false;
    this.lastHit = null;
    this.score = 0; this.coins = 0; this.done = false; this.place = 0; this.doneAt = 0;
  }

  get t() { return this.game.phys.t; }
  get scale() { return this.power.big > 0 ? 1.45 : 1; }
  get feet() { return this.y - this.hh - this.r; }
  get top() { return this.y + this.hh + this.r; }
  get height() { return 2 * (this.hh + this.r); }
  get alive() { return this.dead <= 0 && !this.done; }
  get solid() { return this.dead <= 0 && !this.done && this.inv <= 0 && !!this.body; }

  standable(ent) {
    if (ent === this || !this.solid || !ent.solid || this.carrier === ent) return false;
    if (ent.drop > 0 || ent.vy > 1e-3) return false;
    return ent.feet >= this.top - 0.35;
  }

  makeBody(feet) {
    const ph = this.game.phys, t = this.t, k = this.scale;
    if (this.body) ph.remove(this.body);
    this.r = 1.6 * t.s * k;
    this.hh = 2.0 * t.s * k;
    this.y = feet + this.hh + this.r + 0.05;
    const a = ph.actor(this.x, this.y, RAPIER.ColliderDesc.capsule(this.hh, this.r), this);
    this.body = a.body;
    this.col = a.col;
  }

  spawn(x, feet) {
    this.x = x;
    this.vx = 0; this.vy = 0;
    this.grounded = false; this.ground = null; this.jumping = false;
    this.power = { big: 0, feather: 0, star: 0 };
    this.dead = 0; this.inv = 1.2; this.squash = 0;
    this.carrier = null; this.stun = 0; this.punchT = 0; this.lastHit = null;
    this.lastDx = 0; this.lastDy = 0;
    this.makeBody(feet);
  }

  destroy() {
    if (this.body) this.game.phys.remove(this.body);
    this.body = null;
    this.carrier = null;
  }

  die(by = null) {
    if (this.dead > 0 || this.inv > 0 || this.done || !this.body) return false;
    this.game.fxBurst(this.x, this.y, this.color, 40);
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
    this.vx = vx;
    this.vy = Math.max(this.vy, vy);
    this.stun = Math.max(this.stun, stun);
    this.grounded = false;
    this.carrier = null;
    this.squash = 0.3;
    if (by) this.lastHit = { by, t: this.game.time };
  }

  bounceOff() {
    this.vy = this.t.jumpV * 0.62;
    this.grounded = false;
    this.jumping = false;
    this.carrier = null;
    this.squash = -0.2;
  }

  grow(on) {
    const feet = this.feet;
    this.power.big = on ? 15 : 0;
    this.makeBody(feet);
  }

  update(dt, inp) {
    const g = this.game, t = this.t;
    this.lastDx = 0; this.lastDy = 0;
    if (this.done) return;
    if (this.dead > 0) {
      this.dead -= dt;
      if (this.dead <= 0) g.respawn(this);
      return;
    }
    if (this.power.big > 0 && (this.power.big -= dt) <= 0) this.grow(false);
    if (this.power.feather > 0) this.power.feather -= dt;
    if (this.power.star > 0) this.power.star -= dt;
    this.inv = Math.max(0, this.inv - dt);
    this.drop = Math.max(0, this.drop - dt);
    this.punchT = Math.max(0, this.punchT - dt);
    this.punchCd = Math.max(0, this.punchCd - dt);
    const stunned = this.stun > 0;
    if (stunned) { this.stun -= dt; inp = IDLE; }
    if (g.canPunch && inp.grab && !this.grabWas && this.punchCd <= 0) {
      this.punchT = 0.18;
      this.punchCd = 0.42;
      g.punch(this);
    }
    this.grabWas = !!inp.grab;
    const water = g.inWater(this.x, this.y - this.hh * 0.3);
    if (water !== this.inWater) {
      g.splash(this.x, this.vy, this.y);
      if (water && this.vy > t.swimV) this.vy = t.swimV;
      this.inWater = water;
    }
    const star = this.power.star > 0;
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (dir) this.face = dir;
    const ice = this.grounded && this.ground && this.ground.type === 'ice';
    const run = t.run * (water ? 0.62 : 1) * (star ? 1.3 : 1);
    let acc;
    if (this.grounded) acc = ice ? (dir ? 60 : 22) : dir ? (Math.sign(this.vx) === -dir ? 1100 : 620) : 900;
    else acc = dir ? 430 : 150;
    if (stunned) acc *= 0.12;
    this.vx = approach(this.vx, dir * run, acc * t.s * dt);
    this.coyote = this.grounded ? COYOTE : this.coyote - dt;
    this.buffer = inp.jumpPressed ? BUFFER : this.buffer - dt;
    if (this.buffer > 0) {
      if (water) {
        const surface = !g.inWater(this.x, this.y + this.hh + this.r * 0.6);
        this.vy = Math.max(this.vy, surface ? t.jumpV * 0.9 : t.swimV);
        this.buffer = 0;
        if (surface) { this.jumping = true; g.fxJump(this); } else g.fxSwim(this);
      } else if (this.coyote > 0) {
        this.vy = t.jumpV * (this.scale > 1 ? 1.05 : 1);
        this.buffer = 0; this.coyote = 0; this.jumping = true;
        this.squash = -0.22;
        this.carrier = null;
        g.fxJump(this);
      } else if (this.power.feather > 0 && this.airJumps > 0) {
        this.vy = t.jumpV * 0.85;
        this.airJumps--; this.buffer = 0; this.jumping = true;
        g.fxFeather(this);
      }
    }
    if (this.jumping && !inp.jump && this.vy > 0) { this.vy *= 0.45; this.jumping = false; }
    if (this.vy <= 0) this.jumping = false;
    let grav = t.g * (water ? 0.26 : 1);
    if (!water && this.vy < 0) grav *= 1.12;
    if (this.power.feather > 0 && inp.jump && this.vy < 0) grav *= 0.3;
    this.vy -= grav * dt;
    const maxFall = water ? 40 * t.s : this.power.feather > 0 && inp.jump ? 36 * t.s : 330 * t.s;
    if (this.vy < -maxFall) this.vy = -maxFall;
    if (inp.down && this.grounded && this.ground && (this.ground.kind === 'platform' || this.ground.kind === 'actor')) this.drop = 0.25;
    const c = this.carrier && this.carrier.solid && this.vy <= 1e-3 && this.drop <= 0 ? this.carrier : null;
    const cx = c ? Math.max(-3, Math.min(3, c.lastDx)) : 0, cy = c ? Math.max(-3, Math.min(3, c.lastDy)) : 0;
    this.carrier = null;
    const prevVy = this.vy, was = this.grounded, wantDx = this.vx * dt;
    this.riding = c;
    const res = g.phys.move(this, wantDx + cx, c ? cy : this.vy * dt, QUERY_PLAYER);
    this.riding = null;
    const blocked = Math.abs(res.dx - cx) < Math.abs(wantDx) * 0.5;
    this.x += res.dx;
    this.y += res.dy;
    this.lastDx = res.dx;
    this.lastDy = res.dy;
    this.body.setNextKinematicTranslation({ x: this.x, y: this.y });
    this.grounded = res.grounded && this.vy <= 1e-3;
    this.ground = null;
    let bounce = null, stomped = false;
    for (const h of res.hits) {
      if (!h.info) continue;
      if (h.info.kind === 'actor') {
        if (h.ny > 0.55) {
          if (prevVy < -g.stompV && g.stomp(this, h.info.p)) stomped = true;
          else { this.carrier = h.info.p; this.ground = h.info; }
        }
        continue;
      }
      if (h.ny > 0.55) {
        this.ground = h.info;
        if (h.info.type === 'bounce' && prevVy < 1) bounce = h.info;
      } else if (h.ny < -0.55 && this.vy > 0) {
        this.vy = 0; this.jumping = false;
        if (h.info.type === 'lucky') g.hitLucky(h.info.id, this);
        else g.bonk(this);
      } else if (blocked && h.nx < -0.8 && this.vx > 0) this.vx = 0;
      else if (blocked && h.nx > 0.8 && this.vx < 0) this.vx = 0;
    }
    if (c && !this.carrier && !stomped && Math.abs(this.x - c.x) < (this.r + c.r) * 0.55) {
      this.carrier = c;
      this.ground = { kind: 'actor', p: c };
      this.grounded = true;
    }
    if (stomped) {
      this.bounceOff();
      return;
    }
    if (this.grounded) {
      if (!was && prevVy < -70 * t.s) {
        this.squash = Math.min(0.32, (-prevVy / (330 * t.s)) * 0.4);
        g.fxLand(this, prevVy);
      }
      this.vy = 0;
      this.airJumps = this.power.feather > 0 ? 1 : 0;
    }
    if (bounce) {
      this.vy = t.jumpV * (bounce.shape.props.power || 1.6);
      this.grounded = false; this.jumping = false;
      this.squash = 0.3;
      g.fxBounce(this, bounce);
    }
    if (!star && (g.lavaAt(this.x, this.feet + 0.4) || g.lavaAt(this.x, this.y))) { g.fxLava(this); this.die(); return; }
    if (this.y < g.space.box.y0 - 25) { this.die(); return; }
    this.walk += Math.abs(res.dx - cx) * 0.55 / (t.s * this.scale);
    this.squash += (0 - this.squash) * Math.min(1, dt * 12);
  }

  hitbox() {
    return { x: this.x, y: this.y, r: this.r + this.hh * 0.6 };
  }

  pushers() {
    if (this.dead > 0 || this.done) return [];
    return [{ x: this.x, y: this.feet + this.r, r: this.r * 1.1, feet: this.feet }, { x: this.x, y: this.y + this.hh * 0.5, r: this.r * 1.05, feet: this.feet }];
  }

  draw(L, time, faces) {
    if (this.dead > 0 || this.done || !this.body) return;
    if (this.inv > 0 && Math.floor(time * 18) % 2 === 0) return;
    const t = this.t;
    const speed = Math.min(1, Math.abs(this.vx) / (t.run * 0.6));
    const star = this.power.star > 0;
    drawFigure(L, {
      x: this.x, feet: this.feet, h: this.height * 1.02, face: this.face,
      color: star ? hsv((time * 1.4 + this.idx * 0.25) % 1) : this.stun > 0 ? this.color.map(v => v * 0.55) : this.color,
      accent: this.power.feather > 0 ? [1, 1, 1] : null,
      squash: this.squash,
      lean: Math.max(-1, Math.min(1, this.vx / t.run)) * 0.07,
      swing: this.grounded ? Math.sin(this.walk) * speed : 0,
      tuck: !this.grounded && !this.inWater ? (this.vy > 0 ? 0.55 : 0.3) : 0,
      arms: !this.grounded && !this.inWater ? (this.vy > 0 ? 0.75 : 0.45) : 0,
      swim: this.inWater && !this.grounded,
      punch: this.punchT > 0 ? Math.sin((1 - this.punchT / 0.18) * Math.PI) : 0,
      vx: this.vx, vy: this.vy, grounded: this.grounded,
      time,
    }, this.look, faces ? (x, y, r, a) => faces.place(this.src.id, x, y, r, a) : null);
  }
}
