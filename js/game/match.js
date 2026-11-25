// Beam: one round on the wall. Razem (everyone has to reach the flag), Wyścig (places in order of arrival, the round
// closes 20 s after the winner), Bitwa (points for knocking others out, first to the target wins) and Zbieranie (most
// coins when the clock runs out). Counts down from 3 except in Razem, then ranks everyone at the end.

export const PLAYS = { coop: 'Razem', race: 'Wyścig', battle: 'Bitwa', collect: 'Zbieranie' };
export const PLAY_HINTS = {
  coop: 'Wszyscy muszą dojść do mety. Można stawać sobie na głowach.',
  race: 'Kto pierwszy na mecie. Skok na głowę ogłusza na chwilę.',
  battle: 'Punkt za każdego, kogo strącisz: skok na głowę, lawa, przepaść.',
  collect: 'Najwięcej monet przed końcem czasu. Skok na głowę wytrąca monety.',
};
export const BATTLE_TO = [3, 5, 10];
export const COLLECT_TIME = [60, 90, 120];
const RACE_TAIL = 20;

export function fmtTime(t, tenths = false) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60), s = t - m * 60;
  if (!tenths) return `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1).replace('.', ',')}`;
}

export class Match {
  constructor(game, s) {
    this.g = game;
    this.play = PLAYS[s.play] ? s.play : 'coop';
    this.to = BATTLE_TO.includes(+s.battleTo) ? +s.battleTo : 5;
    this.length = COLLECT_TIME.includes(+s.collectTime) ? +s.collectTime : 90;
    this.count = this.play === 'coop' || this.free ? 0 : 3;
    this.phase = this.count > 0 ? 'count' : 'play';
    this.shown = 0;
    this.clock = 0;
    this.places = 0;
    this.endAt = 0;
    this.results = null;
  }

  get goalOn() { return this.play === 'coop' || this.play === 'race'; }
  get free() { return this.goalOn && !this.g.goal; }
  get frozen() { return this.phase === 'count'; }
  get over() { return this.phase === 'done'; }
  get left() { return Math.max(0, this.length - this.clock); }

  tick(dt) {
    const g = this.g;
    if (this.phase === 'count') {
      this.count -= dt;
      const n = Math.ceil(this.count);
      if (n > 0 && n !== this.shown) {
        this.shown = n;
        g.app.onGame('count', { n, play: this.play });
      }
      if (this.count <= 0) {
        this.phase = 'play';
        g.app.onGame('start', { play: this.play });
      }
      return;
    }
    if (this.phase !== 'play') return;
    this.clock += dt;
    if (this.play === 'collect' && this.clock >= this.length) this.finish();
    else if (this.play === 'race' && this.endAt && this.clock >= this.endAt) this.finish();
  }

  reach(p) {
    const g = this.g;
    if (this.phase !== 'play' || p.done || !this.goalOn) return;
    p.toGoal();
    p.place = ++this.places;
    p.doneAt = this.clock;
    const waiting = g.players.filter(q => !q.done).length;
    g.app.onGame('goal', { name: p.name, place: p.place, time: p.doneAt, play: this.play, many: g.players.length > 1, waiting });
    if (!waiting) this.finish();
    else if (this.play === 'race' && p.place === 1) this.endAt = this.clock + RACE_TAIL;
  }

  check() {
    const ps = this.g.players;
    if (this.phase === 'play' && this.goalOn && ps.length && ps.every(p => p.done)) this.finish();
  }

  died(p, by) {
    if (this.phase !== 'play' || this.play !== 'battle' || !by || by === p || !this.g.players.includes(by)) return;
    by.score++;
    this.g.app.onGame('point', { name: by.name, victim: p.name, score: by.score, to: this.to });
    if (by.score >= this.to) this.finish();
  }

  finish() {
    if (this.phase === 'done') return;
    const g = this.g;
    this.phase = 'done';
    this.results = this.rank();
    g.fireT = 3.4;
    g.fireAcc = 0.3;
    g.app.onGame('done', g.hud());
  }

  key(r) {
    return this.play === 'race' ? r.place || 0 : this.play === 'battle' ? r.score : this.play === 'collect' ? r.coins : 0;
  }

  rank() {
    const rows = this.g.players.map(p => ({
      id: p.src.id, name: p.name, hex: p.src.hex, place: p.place, score: p.score, coins: p.coins, done: p.done, time: p.done ? p.doneAt : null, rank: 0,
    }));
    if (this.play === 'race') rows.sort((a, b) => (a.place || 99) - (b.place || 99));
    else if (this.play === 'battle') rows.sort((a, b) => b.score - a.score);
    else if (this.play === 'collect') rows.sort((a, b) => b.coins - a.coins);
    let prev = null, rank = 0;
    rows.forEach((r, i) => {
      const k = this.key(r);
      if (i === 0 || k !== prev) rank = i + 1;
      prev = k;
      r.rank = this.play === 'race' && !r.place ? 0 : this.play === 'coop' ? (r.done ? 1 : 0) : rank;
    });
    return rows;
  }

  winners() {
    if (!this.results || this.play === 'coop') return [];
    const top = this.results.filter(r => r.rank === 1);
    if (this.play === 'battle' && top.length && !top[0].score) return [];
    if (this.play === 'collect' && top.length && !top[0].coins) return [];
    return top;
  }
}
