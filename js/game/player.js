// Beam: precise platformer character (Mario feel) on Rapier's kinematic character controller, plus the neon figure both modes share.

import RAPIER from '@dimforge/rapier2d-compat';

const COYOTE = 0.1, BUFFER = 0.12;

function approach(v, target, d) {
  return v < target ? Math.min(target, v + d) : Math.max(target, v - d);
}

export function hsv(h, s = 0.85, v = 1) {
  const f = n => {
    const k = (n + h * 6) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

const rot = (l, a) => [l * Math.sin(a), -l * Math.cos(a)];

export function drawFigure(L, o) {
  const H = o.h, col = o.color, f = o.face;
  const sx = 1 + o.squash * 0.6, sy = 1 - o.squash;
  const X = (dx) => o.x + dx * sx;
  const Y = (dy) => o.feet + dy * sy;
  const w = 0.05 * H, g = 0.08 * H;
  const lean = o.lean;
  const hip = [X(lean * 0.25 * H), Y(0.42 * H)];
  const neck = [X(lean * H * 0.9), Y(0.74 * H)];
  const head = [X(lean * H * 1.05), Y(0.865 * H)];
  const hr = 0.13 * H;
  L.seg(hip[0], hip[1], neck[0], neck[1], col, w * 1.15, g, 0, 4);
  const leg = 0.215 * H;
  for (const side of [-1, 1]) {
    const ph = o.swing * side;
    let a1 = f * (ph * 0.6 + o.tuck * 0.65) + side * 0.16;
    let a2 = a1 - f * (Math.max(0, -ph) * 0.9 + o.tuck * 1.3 + 0.08);
    if (o.swim) { a1 = f * (0.3 + Math.sin(o.time * 9 + side) * 0.45); a2 = a1 - f * 0.5; }
    const k = rot(leg, a1), knee = [hip[0] + k[0] * sx, hip[1] + k[1] * sy];
    const s = rot(leg, a2), foot = [knee[0] + s[0] * sx, knee[1] + s[1] * sy];
    L.seg(hip[0], hip[1], knee[0], knee[1], col, w, g, 0, 4);
    L.seg(knee[0], knee[1], foot[0], foot[1], col, w, g, 0, 4);
  }
  const sh = [X(lean * H * 0.85), Y(0.7 * H)];
  const arm = 0.2 * H;
  for (const side of [-1, 1]) {
    let a = f * (-o.swing * side * 0.75) + o.arms * f * (side > 0 ? 2.5 : 2.1) + side * 0.5 * (1 - o.arms);
    if (o.swim) a = f * (1.6 + Math.sin(o.time * 9 + side * 1.5) * 0.9);
    const e = rot(arm, a);
    const el = [sh[0] + e[0] * 0.55, sh[1] + e[1] * 0.55];
    const hand = [sh[0] + e[0], sh[1] + e[1]];
    L.seg(sh[0], sh[1], el[0], el[1], col, w * 0.9, g * 0.9, 0, 4);
    L.seg(el[0], el[1], hand[0], hand[1], col, w * 0.9, g * 0.9, 0, 4);
  }
  L.circle(head[0], head[1], hr, col, w, g, 0, 16, 4);
  const ex = head[0] + f * hr * 0.42, ey = head[1] + hr * 0.12;
  L.dot(ex, ey, 0.028 * H, col, 0.06 * H, 0, 4);
  L.dot(ex - f * hr * 0.42, ey, 0.024 * H, col, 0.05 * H, 0, 4);
  const top = [head[0], head[1] + hr];
  const tip = [top[0] - o.ant[0] * H * 0.12, top[1] + H * 0.13 - Math.abs(o.ant[1]) * H * 0.03];
  L.seg(top[0], top[1], tip[0], tip[1], col, w * 0.7, g * 0.7, 0, 4);
  L.dot(tip[0], tip[1], 0.04 * H, o.accent || col, 0.12 * H, 0, 4);
}

export class Player {
  constructor(game, idx, color) {
    this.game = game;
    this.idx = idx;
    this.color = color;
    this.kind = 'precise';
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.face = 1;
    this.grounded = false; this.ground = null;
    this.coyote = 0; this.buffer = 0; this.jumping = false;
    this.drop = 0; this.inWater = false;
    this.walk = 0; this.squash = 0; this.ant = [0, 0]; this.antV = [0, 0];
    this.dead = 0; this.inv = 0;
    this.power = { big: 0, feather: 0, star: 0 };
    this.airJumps = 0;
    this.body = null; this.col = null;
  }

  get t() { return this.game.phys.t; }
  get scale() { return this.power.big > 0 ? 1.45 : 1; }
  get feet() { return this.y - this.hh - this.r; }
  get height() { return 2 * (this.hh + this.r); }
  get alive() { return this.dead <= 0; }

  makeBody(feet) {
    const ph = this.game.phys, t = this.t, k = this.scale;
    if (this.body) ph.remove(this.body);
    this.r = 1.6 * t.s * k;
    this.hh = 2.0 * t.s * k;
    this.y = feet + this.hh + this.r + 0.05;
    const a = ph.actor(this.x, this.y, RAPIER.ColliderDesc.capsule(this.hh, this.r));
    this.body = a.body;
    this.col = a.col;
  }

  spawn(x, feet) {
    this.x = x;
    this.vx = 0; this.vy = 0;
    this.grounded = false; this.ground = null; this.jumping = false;
    this.power = { big: 0, feather: 0, star: 0 };
    this.dead = 0; this.inv = 1.2; this.squash = 0;
    this.makeBody(feet);
  }

  destroy() {
    if (this.body) this.game.phys.remove(this.body);
    this.body = null;
  }

  die() {
    if (this.dead > 0 || this.inv > 0) return;
    this.game.fxBurst(this.x, this.y, this.color, 40);
    this.destroy();
    this.dead = 0.9;
  }

  grow(on) {
    const feet = this.feet;
    this.power.big = on ? 15 : 0;
    this.makeBody(feet);
  }

  update(dt, inp) {
    const g = this.game, t = this.t;
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
    if (inp.down && this.grounded && this.ground && this.ground.kind === 'platform') this.drop = 0.25;
    const prevVy = this.vy, was = this.grounded, wantDx = this.vx * dt;
    const res = g.phys.move(this, wantDx, this.vy * dt);
    const blocked = Math.abs(res.dx) < Math.abs(wantDx) * 0.5;
    this.x += res.dx;
    this.y += res.dy;
    this.body.setNextKinematicTranslation({ x: this.x, y: this.y });
    this.grounded = res.grounded && this.vy <= 1e-3;
    this.ground = null;
    let bounce = null;
    for (const h of res.hits) {
      if (!h.info) continue;
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
    this.walk += Math.abs(res.dx) * 0.55 / (t.s * this.scale);
    this.squash += (0 - this.squash) * Math.min(1, dt * 12);
    const ax = -this.vx * 0.004 - this.ant[0] * 90, ay = -this.vy * 0.003 - this.ant[1] * 90;
    this.antV[0] = (this.antV[0] + ax * dt) * Math.exp(-6 * dt);
    this.antV[1] = (this.antV[1] + ay * dt) * Math.exp(-6 * dt);
    this.ant[0] += this.antV[0] * dt * 60;
    this.ant[1] += this.antV[1] * dt * 60;
    this.ant[0] = Math.max(-1, Math.min(1, this.ant[0]));
    this.ant[1] = Math.max(-1, Math.min(1, this.ant[1]));
  }

  hitbox() {
    return { x: this.x, y: this.y, r: this.r + this.hh * 0.6 };
  }

  pushers() {
    if (this.dead > 0) return [];
    return [{ x: this.x, y: this.feet + this.r, r: this.r * 1.1, feet: this.feet }, { x: this.x, y: this.y + this.hh * 0.5, r: this.r * 1.05, feet: this.feet }];
  }

  draw(L, time) {
    if (this.dead > 0) return;
    if (this.inv > 0 && Math.floor(time * 18) % 2 === 0) return;
    const t = this.t;
    const speed = Math.min(1, Math.abs(this.vx) / (t.run * 0.6));
    const star = this.power.star > 0;
    drawFigure(L, {
      x: this.x, feet: this.feet, h: this.height * 1.02, face: this.face,
      color: star ? hsv((time * 1.4 + this.idx * 0.25) % 1) : this.color,
      accent: this.power.feather > 0 ? [1, 1, 1] : null,
      squash: this.squash,
      lean: Math.max(-1, Math.min(1, this.vx / t.run)) * 0.07,
      swing: this.grounded ? Math.sin(this.walk) * speed : 0,
      tuck: !this.grounded && !this.inWater ? (this.vy > 0 ? 0.55 : 0.3) : 0,
      arms: !this.grounded && !this.inWater ? (this.vy > 0 ? 0.75 : 0.45) : 0,
      swim: this.inWater && !this.grounded,
      time, ant: this.ant,
    });
  }
}
