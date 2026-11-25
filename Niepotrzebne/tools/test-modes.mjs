// Beam: headless test of rounds and looks on the demo wall. Razem, Wyścig, Bitwa and Zbieranie with two keyboard players
// (precise, then rubbery): countdown, riding on heads, stomps, punches, a lava fall credited to the puncher, coin spills,
// respawns and auto coins, ranks. Then three phones with a preset, a finger drawing and a real selfie, the phone board,
// "again" from a phone and a look change mid-game. Usage: node test-modes.mjs [outDir], FACE=photo.jpg, URL=...
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire('/Users/jurek/openclaw/node_modules/');
const { chromium } = require('playwright-core');

const out = process.argv[2] || new URL('../zrzuty/test-modes', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const base = process.env.URL || 'http://localhost:8981/';
const FACE = process.env.FACE || '/Users/jurek/Downloads/Claude/Projects/Avatar/Przygotowane/foto_1600/twarz/front.jpg';
const log = (...a) => console.log(...a);
const fails = [];
const check = (ok, what, extra = '') => { log(ok ? 'PASS' : 'FAIL', what, extra); if (!ok) fails.push(what); };
const r1 = v => (typeof v === 'number' ? +v.toFixed(2) : v);
const brief = o => JSON.stringify(o, (k, v) => r1(v));

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1 });
const logs = [];
const hook = (p, tag) => {
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${tag} ${m.type()}] ${m.text()}`); });
  p.on('pageerror', e => logs.push(`[${tag} pageerror] ${e.message}`));
};

const host = await ctx.newPage();
hook(host, 'host');
await host.goto(base + '?net=local');
await host.waitForFunction(() => document.getElementById('loading')?.classList.contains('off') && window.beam?.ready, null, { timeout: 60000 });
await host.evaluate(async () => {
  const w = beam.walls.list.find(x => x.demo);
  await beam.selectWall(w.id);
  beam.loadDemo();
  beam.setStep(5);
  beam.room.start();
  beam.setLayout('editor');
});
await host.waitForFunction(() => beam.room.state === 'online' && beam.room.qr, null, { timeout: 30000 });
const code = await host.evaluate(() => beam.room.code);
log('room', code);

await host.evaluate(() => {
  window.T = {
    p: i => beam.game.players[i],
    by: name => beam.game.players.find(p => p.name === name),
    ground(x, from = -20) {
      const b = beam.game.space.box;
      const hit = beam.game.phys.rayDown(x, from, from - b.y0 + 1, { x, feet: from, vy: 0, drop: 0 });
      return hit ? from - hit.d : null;
    },
    put(p, x, feet, vx = 0, vy = 0, face = 1) {
      if (typeof p === 'number') p = beam.game.players[p];
      p.spawn(x, feet);
      p.inv = 0;
      p.face = face;
      if (p.kind === 'precise') { p.vx = vx; p.vy = vy; } else { p.mate(); for (const q of p.list) q.b.setLinvel({ x: vx, y: vy }, true); }
      return p;
    },
    head(p) { return p.kind === 'precise' ? p.top : p.headTop().y; },
    clear(f) {
      const things = [...beam.game.coins.map(c => [c.x, c.y]), ...beam.game.drops.map(d => [d.x, d.y])];
      for (let x = 62; x <= 108; x += 3) if (things.every(q => Math.hypot(q[0] - x, q[1] - f - 3) > 8)) return x;
      return 80;
    },
    st(p) {
      if (typeof p === 'number') p = beam.game.players[p];
      if (!p) return null;
      return {
        name: p.name, kind: p.kind, x: p.x, y: p.y, feet: p.feet, head: p.dead > 0 || p.done || !(p.body || p.parts) ? null : T.head(p), vx: p.vx, vy: p.vy,
        grounded: p.grounded, ground: p.ground ? p.ground.kind : null, dead: p.dead, stun: p.stun, score: p.score, coins: p.coins, done: p.done,
        place: p.place, by: p.lastHit && p.lastHit.by ? p.lastHit.by.name : null, look: p.look.data, grab: p.grabs ? p.grabs.map(g => (g ? (g.other ? g.other.name : 'wall') : null)) : null,
      };
    },
    m() {
      const m = beam.game.match;
      return m && { play: m.play, phase: m.phase, clock: m.clock, endAt: m.endAt, to: m.to, length: m.length, results: m.results, winners: m.winners().map(r => r.name) };
    },
    toast() { const t = document.getElementById('toast'); return t.classList.contains('on') ? t.textContent : ''; },
    hud() { return [...document.querySelectorAll('#hud > *')].map(e => e.textContent); },
  };
});

const G = (fn, arg) => host.evaluate(fn, arg);
const st = i => G(i => T.st(typeof i === 'string' ? T.by(i) : i), i);
const M = () => G(() => T.m());
const wait = ms => host.waitForTimeout(ms);
const phase = (ph, timeout = 6000) => host.waitForFunction(ph => beam.game.match && beam.game.match.phase === ph, ph, { timeout }).then(() => true).catch(() => false);
const card = name => `.card:has(> h3:text-is("${name}"))`;
const pick = async (name, label) => { await host.click(`${card(name)} .seg button:text-is("${label}")`); await wait(250); };
async function key(code, ms) { await host.keyboard.down(code); await wait(ms); await host.keyboard.up(code); }
async function shotW(name, x0, y0, x1, y1) {
  const clip = await G(([x0, y0, x1, y1]) => {
    const v = beam.views, e = v.editor, s = beam.stage.getBoundingClientRect();
    e.cx = (x0 + x1) / 2;
    e.cy = (y0 + y1) / 2;
    e.z = Math.min(e.w / (x1 - x0), e.h / (y1 - y0)) * 0.97;
    e.manual = true;
    beam.invalidate();
    const a = v.toScreen(e, x0, y1), b = v.toScreen(e, x1, y0);
    return { x: s.left + a[0], y: s.top + a[1], width: b[0] - a[0], height: b[1] - a[1] };
  }, [x0, y0, x1, y1]);
  await wait(150);
  await host.screenshot({ path: `${out}/${name}.png`, clip });
}
async function stomp(top, bottom, x, floor) {
  await G(([b, x, f]) => T.put(T.by(b), x, f), [bottom, x, floor]);
  await wait(450);
  await G(([t, b]) => { const q = T.by(b); T.put(T.by(t), q.x, T.head(q) + 5, 0, -beam.game.stompV * 1.3); }, [top, bottom]);
  await wait(320);
}

await pick('Klawiatura', '2 graczy');
const ps = await G(() => beam.game.players.map(p => [p.name, p.kind]));
check(ps.length === 2 && ps[0][0] === 'P1' && ps[1][0] === 'P2', 'two keyboard players', brief(ps));
const floor = await G(() => T.ground(80));
const goal = await G(() => ({ x: beam.game.goal.x, y: beam.game.goal.y }));
log('floor', r1(floor), 'goal', brief(goal), 'stompV', await G(() => beam.game.stompV));

log('---- Razem');
await pick('Tryb gry', 'Razem');
let m = await M();
check(m.play === 'coop' && m.phase === 'play', 'Razem starts without a countdown', m.phase);
await G(f => T.put(0, 80, f), floor);
await wait(350);
await G(() => { const a = T.p(0); T.put(1, a.x, T.head(a) + 0.6); });
await wait(600);
let a = await st(0), b = await st(1);
check(b.ground === 'actor' && b.grounded && Math.abs(b.feet - a.head) < 0.5, 'P2 stands on the head of P1', `feet ${r1(b.feet)} head ${r1(a.head)} ground ${b.ground}`);
await key('ArrowRight', 500);
await wait(250);
let a2 = await st(0), b2 = await st(1);
check(a2.x - a.x > 3 && Math.abs((b2.x - b.x) - (a2.x - a.x)) < 2 && b2.ground === 'actor', 'P2 rides along when P1 walks', `P1 ${r1(a2.x - a.x)} P2 ${r1(b2.x - b.x)}`);
await shotW('01-razem-na-glowie', a2.x - 14, floor - 2, a2.x + 14, floor + 20);
await G(() => { const a = T.p(0); T.put(1, a.x, T.head(a) + 5, 0, -beam.game.stompV * 1.3); });
await wait(450);
a = await st(0); b = await st(1);
check(a.stun <= 0 && a.dead <= 0 && b.ground === 'actor', 'no stomp in Razem: a hard landing just stands on the head', `stun ${r1(a.stun)} ground ${b.ground}`);
await G(g => T.put(0, g.x + 1, g.y + 0.1), goal);
await wait(350);
a = await st(0);
const tGoal = await G(() => T.toast());
check(a.done && a.place === 1 && /P1 na mecie/.test(tGoal), 'P1 reaches the flag, the rest is told to wait', tGoal);
await G(g => T.put(1, g.x + 1, g.y + 0.1), goal);
await wait(450);
m = await M();
const tCoop = await G(() => T.toast());
check(m.phase === 'done' && m.results.every(r => r.rank === 1) && !m.winners.length && /Meta!|Perfekcyjnie!/.test(tCoop), 'Razem ends when everyone is at the flag', tCoop);
await wait(500);
await shotW('02-razem-meta', goal.x - 22, goal.y - 4, goal.x + 26, goal.y + 22);
await host.keyboard.press('KeyR');
await wait(300);
m = await M();
a = await st(0);
check(m.phase === 'play' && !a.done, 'R starts the round again', m.phase);

log('---- Wyścig');
await pick('Tryb gry', 'Wyścig');
m = await M();
const tCount = await G(() => T.toast());
check(m.play === 'race' && m.phase === 'count' && /^[123]/.test(tCount), 'Wyścig counts down', tCount);
const hudCount = await G(() => T.hud());
check(hudCount.includes('Wyścig'), 'HUD names the game during the countdown', brief(hudCount));
const fx0 = (await st(0)).x;
await key('ArrowRight', 500);
const fx1 = (await st(0)).x;
check(Math.abs(fx1 - fx0) < 0.05, 'players are frozen during the countdown', `${r1(fx0)} -> ${r1(fx1)}`);
check(await phase('play', 4000), 'countdown ends in play');
check(/Start!/.test(await G(() => T.toast())), 'Start! shows');
await stomp('P2', 'P1', 80, floor);
a = await st('P1');
check(a.stun > 0.25 && a.dead <= 0 && a.by === 'P2', 'stomp in Wyścig stuns, no knockout', `stun ${r1(a.stun)} dead ${r1(a.dead)} by ${a.by}`);
await G(g => T.put(0, g.x + 1, g.y + 0.1), goal);
await wait(350);
m = await M();
a = await st(0);
check(a.place === 1 && m.endAt - m.clock > 19 && m.phase === 'play', 'first at the flag starts the 20 s tail', `place ${a.place} tail ${r1(m.endAt - m.clock)}`);
check((await G(() => T.hud())).includes('1. P1'), 'HUD shows the place');
await G(() => { const m = beam.game.match; m.endAt = m.clock + 0.3; });
await wait(600);
m = await M();
const tRace = await G(() => T.toast());
check(m.phase === 'done' && m.winners.join() === 'P1' && m.results[1].rank === 0 && /Wygrywa: P1/.test(tRace) && /P2: bez mety/.test(tRace), 'Wyścig ends after the tail, P2 without a finish', tRace);
await shotW('03-wyscig-meta', goal.x - 22, goal.y - 4, goal.x + 26, goal.y + 24);

log('---- Bitwa');
await pick('Tryb gry', 'Bitwa');
await host.click(`${card('Tryb gry')} .row .seg button:text-is("3")`);
await wait(250);
m = await M();
check(m.play === 'battle' && m.to === 3 && m.phase === 'count', 'Bitwa to 3 counts down', brief({ to: m.to, phase: m.phase }));
check(await phase('play', 4000), 'Bitwa starts');
check(await G(() => !beam.game.coinsOn && beam.game.canPunch), 'Bitwa hides coins and allows punches');
let hud = await G(() => T.hud());
check(hud.includes('P1 0') && hud.includes('P2 0') && hud.includes('do 3'), 'HUD shows the score per player', brief(hud));
const chipColor = await G(() => getComputedStyle(document.querySelector('#hud .pl')).color);
log('chip color', chipColor);
await stomp('P2', 'P1', 80, floor);
a = await st('P1'); b = await st('P2');
check(a.dead > 0 && b.score === 1 && /P2 zdobywa punkt: 1 z 3/.test(await G(() => T.toast())), 'stomp in Bitwa knocks out and scores', `dead ${r1(a.dead)} score ${b.score}`);
const lavaId = await G(async f => {
  const { makeShape } = await import('/js/scene.js');
  const s = makeShape('lava', [[[[100, f - 1], [112.6, f - 1], [112.6, f + 1.4], [100, f + 1.4]]]]);
  beam.scene.commit('shapes', st => { st.shapes.push(s); });
  return s.id;
}, floor);
await wait(250);
await G(f => { T.put(0, 92, f, 0, 0, 1); T.put(1, 95.6, f, 0, 0, -1); }, floor);
await wait(300);
await key('ShiftRight', 60);
await wait(40);
b = await st('P2');
check(b.by === 'P1' && (b.stun > 0 || b.dead > 0) && (b.vx > 30 || b.dead > 0), 'punch knocks P2 away', `vx ${r1(b.vx)} stun ${r1(b.stun)} by ${b.by}`);
await wait(700);
a = await st('P1'); b = await st('P2');
check(a.score === 1 && b.dead > 0, 'P2 lands in lava and the point goes to the puncher', `P1 ${a.score} P2 dead ${r1(b.dead)}`);
await shotW('04-bitwa-lawa', 84, floor - 3, 116, floor + 16);
await G(id => beam.scene.commit('shapes', st => { st.shapes = st.shapes.filter(s => s.id !== id); }), lavaId);
await stomp('P2', 'P1', 80, floor);
await stomp('P2', 'P1', 70, floor);
m = await M();
const tBattle = await G(() => T.toast());
check(m.phase === 'done' && m.winners.join() === 'P2' && /Wygrywa: P2/.test(tBattle), 'Bitwa ends at 3 points', tBattle);
await wait(300);
await shotW('05-bitwa-koniec', 40, floor - 3, 120, floor + 36);

log('---- Zbieranie');
await pick('Tryb gry', 'Zbieranie');
await host.click(`${card('Tryb gry')} .row .seg button:text-is("1:00")`);
await wait(250);
m = await M();
check(m.play === 'collect' && m.length === 60 && m.phase === 'count', 'Zbieranie for 1:00 counts down', brief({ len: m.length, phase: m.phase }));
check(await phase('play', 4000), 'Zbieranie starts');
const items = await G(() => JSON.stringify(beam.scene.state.items));
await G(() => beam.scene.commit('all', st => { st.items = st.items.filter(i => i.type !== 'coin'); }));
await wait(350);
const auto = await G(() => beam.game.coins.map(c => ({ x: c.x, y: c.y, auto: c.auto, under: T.ground(c.x, c.y) })));
const gaps = auto.map((c, i) => Math.min(...auto.filter((_, j) => j !== i).map(q => Math.hypot(q.x - c.x, q.y - c.y))));
check(auto.length === 8 && auto.every(c => c.auto && c.under != null && Math.abs(c.y - 2.6 - c.under) < 0.3) && Math.min(...gaps) >= 5, 'a wall without coins gets 8 coins spread over surfaces', brief(auto.map(c => [c.x, c.y])));
await shotW('06-zbieranie-auto-monety', -30, -40, 190, 92);
const near = await G(f => beam.game.coins.filter(c => Math.abs(c.y - 2.6 - T.ground(c.x, c.y)) < 0.3).sort((p, q) => Math.abs(p.y - f) - Math.abs(q.y - f)).slice(0, 2).map(c => ({ x: c.x, y: c.y })), floor);
for (const c of near) {
  await G(c => T.put(0, c.x, T.ground(c.x, c.y)), c);
  await wait(250);
}
a = await st(0);
const gotNow = await G(() => beam.game.coins.filter(c => c.got).map(c => ({ back: c.back - beam.game.time })));
check(a.coins === 2 && gotNow.length === 2 && gotNow.every(c => c.back > 4.3 && c.back < 6.05), 'P1 picks up two coins, they come back in 6 s', `coins ${a.coins} back ${brief(gotNow)}`);
const spot = await G(f => T.clear(f), floor);
await G(([x, f]) => T.put(0, x, f), [spot, floor]);
const taken = await G(() => beam.game.coins.filter(c => c.got).map(c => [c.x, c.y]));
await G(() => { for (const c of beam.game.coins) if (c.got) c.back = beam.game.time + 0.25; });
await wait(500);
check(taken.length === 2 && await G(t => t.every(q => beam.game.coins.some(c => c.x === q[0] && c.y === q[1] && !c.got && c.born > 0)), taken), 'taken coins grow back', `at x ${r1(spot)}`);
const before = (await st('P1')).coins;
await stomp('P2', 'P1', spot, floor);
a = await st('P1');
let loose = await G(() => beam.game.drops.filter(d => d.type === 'loose').map(d => ({ x: d.x, y: d.y, owner: d.owner.name })));
check(a.coins === 0 && loose.length === Math.min(3, before) && loose.every(d => d.owner === 'P1') && a.stun > 0, 'stomp spills the coins of P1', `had ${before} loose ${loose.length}`);
await wait(1200);
loose = await G(() => beam.game.drops.filter(d => d.type === 'loose').map(d => ({ x: d.x, y: d.y })));
const p2had = (await st('P2')).coins;
if (loose.length) {
  await G(d => T.put(1, d.x, T.ground(d.x, d.y + 1)), loose[0]);
  await wait(300);
}
b = await st('P2');
check(loose.length > 0 && b.coins > p2had, 'P2 picks up a spilled coin', `loose ${loose.length} P2 ${p2had} -> ${b.coins}`);
hud = await G(() => T.hud());
check(/^\d:\d\d$/.test(hud[0]) && hud.some(t => /^P1 ● \d+$/.test(t)), 'HUD shows the clock and coins', brief(hud));
await G(() => { const m = beam.game.match; m.clock = m.length - 0.4; });
await wait(700);
m = await M();
a = await st('P1'); b = await st('P2');
const expWin = a.coins > b.coins ? 'P1' : b.coins > a.coins ? 'P2' : '';
const tCollect = await G(() => T.toast());
check(m.phase === 'done' && m.winners.join() === expWin && (expWin ? new RegExp(`Wygrywa: ${expWin}`).test(tCollect) : /Koniec rundy|Remis/.test(tCollect)), 'Zbieranie ends with the clock, most coins wins', `${a.coins}:${b.coins} ${tCollect}`);
await G(json => beam.scene.commit('all', st => { st.items = JSON.parse(json); }), items);

log('---- Gumowy');
await pick('Tryb gry', 'Bitwa');
await pick('Ruch', 'Gumowy');
check(await phase('play', 5000), 'rubbery Bitwa starts');
check((await G(() => beam.game.players.map(p => p.kind))).join() === 'rubbery,rubbery', 'players are ragdolls');
await G(f => { T.put(0, 80, f, 0, 0, 1); T.put(1, 87, f, 0, 0, -1); }, floor);
await wait(400);
await host.keyboard.down('KeyA');
let gap = 1e9, passed = false;
for (let i = 0; i < 20; i++) {
  await wait(60);
  const d = await G(() => { const a = T.p(0).parts.torso.b.translation().x, b = T.p(1).parts.torso.b.translation().x; return [b - a]; });
  gap = Math.min(gap, Math.abs(d[0]));
  if (d[0] < 0) passed = true;
}
await host.keyboard.up('KeyA');
check(gap > 1.2 && !passed, 'ragdolls bump into each other instead of passing through', `closest torsos ${r1(gap)}`);
let grabbed = null;
for (const dx of [2.4, 3.0, 3.6]) {
  await G(([f, dx]) => { T.put(0, 80, f, 0, 0, 1); T.put(1, 80 + dx, f, 0, 0, -1); }, [floor, dx]);
  await wait(450);
  await host.keyboard.down('ShiftRight');
  await wait(450);
  grabbed = (await st('P1')).grab;
  if (grabbed && grabbed.includes('P2')) { await shotW('07-gumowy-chwyt', 70, floor - 2, 92, floor + 12); break; }
  await host.keyboard.up('ShiftRight');
}
check(grabbed && grabbed.includes('P2'), 'P1 grabs P2 with a hand', brief(grabbed));
await host.keyboard.up('ShiftRight');
await wait(200);
check((await st('P1')).grab.every(g => g === null), 'letting go releases the grab');
const sc0 = (await st('P1')).score;
await stomp('P1', 'P2', 80, floor);
a = await st('P1'); b = await st('P2');
check(b.dead > 0 && a.score === sc0 + 1, 'ragdoll stomp knocks out and scores', `P2 dead ${r1(b.dead)} P1 ${sc0} -> ${a.score}`);
await pick('Ruch', 'Precyzyjny');

log('---- Wygląd z klawiatury');
await host.selectOption(`${card('Klawiatura')} select >> nth=0`, 'robot');
await wait(300);
const kl = await G(() => [beam.scene.state.settings.looks, T.st(0).look]);
check(kl[0][0] === 'robot' && kl[1].id === 'robot', 'keyboard look changes without a restart', brief(kl));

log('---- Telefony');
await G(() => beam.scene.commit('settings', st => { st.settings.charSize = 12; }));
await pick('Klawiatura', 'Nikt');
await pick('Tryb gry', 'Wyścig');
async function phone(tag, name, how) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 390, height: 844 });
  hook(p, tag);
  await p.goto(base + `pad.html?r=${code}&net=local`);
  await p.fill('#name', name);
  await how(p);
  await p.click('#go');
  await p.waitForSelector('#app.on', { timeout: 30000 });
  await p.setViewportSize({ width: 844, height: 390 });
  return p;
}
const padA = await phone('kot', 'Rakieta', async p => {
  await p.click('#looks .lk:nth-child(2)');
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${out}/08-telefon-wyglad.png` });
});
const padB = await phone('rysunek', 'Pędzel', async p => {
  await p.click('#looks .lk:nth-child(7)');
  await p.waitForSelector('#drawv.on');
  const L = await p.evaluate(() => { const d = beamPad.drawer, r = d.cv.getBoundingClientRect(); return { x: r.left + d.cx, y: r.top + d.cy, u: d.u }; });
  const at = (u, v) => [L.x + (u / 100) * L.u, L.y - (v / 100) * L.u];
  const stroke = async pts => {
    const [x0, y0] = at(...pts[0]);
    await p.mouse.move(x0, y0);
    await p.mouse.down();
    for (const q of pts.slice(1)) { const [x, y] = at(...q); await p.mouse.move(x, y, { steps: 2 }); }
    await p.mouse.up();
  };
  const ring = (cx, cy, r, n = 22) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos((i / n) * 2 * Math.PI) * r, cy + Math.sin((i / n) * 2 * Math.PI) * r]);
  await stroke(ring(0, 50, 36));
  await stroke([[0, 14], [0, -96]]);
  await stroke([[-60, -46], [0, -8], [60, -46]]);
  await stroke([[-16, 82], [-30, 100]]);
  await stroke([[16, 82], [30, 100]]);
  await stroke([[-13, 56]]);
  await stroke([[13, 56]]);
  await stroke([[-14, 36], [0, 30], [14, 36]]);
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${out}/09-telefon-rysunek.png` });
  await p.click('#drawv [data-a=ok]');
  await p.waitForTimeout(200);
  const s = await p.evaluate(() => [beamPad.looks.draw && beamPad.looks.draw.s.length, document.querySelector('#looks .lk.on span').textContent]);
  check(s[0] === 8 && s[1] === 'Rysunek', 'drawing saved and picked on the phone', brief(s));
});
let cropLog = null;
const padC = await phone('selfie', 'Selfik', async p => {
  const fcP = p.waitForEvent('filechooser');
  await p.click('#looks .lk:nth-child(8)');
  const fc = await fcP;
  await fc.setFiles(FACE);
  await p.waitForSelector('#facev.on', { timeout: 8000 });
  await p.waitForTimeout(200);
  const S = () => p.evaluate(() => { const f = beamPad.crop, r = f.cv.getBoundingClientRect(); return { x: r.left + f.cx, y: r.top + f.cy, R: f.R, z: f.z, px: f.px, py: f.py, w: f.src.width, h: f.src.height }; });
  const c0 = await S();
  await p.evaluate(() => {
    const f = beamPad.crop, cv = f.cv, r = cv.getBoundingClientRect(), cx = r.left + f.cx, cy = r.top + f.cy;
    const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 11 }));
    ev('pointerdown', 11, cx - 50, cy);
    ev('pointerdown', 12, cx + 50, cy);
    for (let i = 1; i <= 5; i++) { ev('pointermove', 11, cx - 50 - i * 2, cy); ev('pointermove', 12, cx + 50 + i * 2, cy); }
    ev('pointerup', 11, cx - 60, cy);
    ev('pointerup', 12, cx + 60, cy);
  });
  const c1 = await S();
  const zWant = c1.R / (c1.w * 0.26);
  await p.mouse.move(c1.x, c1.y);
  await p.mouse.wheel(0, -Math.log(zWant / c1.z) / 0.0015);
  await p.waitForTimeout(100);
  const c2 = await S();
  const dy = (c2.py - c2.h * 0.35) * c2.z;
  await p.mouse.move(c2.x, c2.y - 40);
  await p.mouse.down();
  await p.mouse.move(c2.x, c2.y - 40 + dy, { steps: 6 });
  await p.mouse.up();
  await p.waitForTimeout(150);
  const c3 = await S();
  cropLog = { start: c0, pinch: c1.z / c0.z, wheel: c2.z, end: c3 };
  check(c1.z / c0.z > 1.1 && Math.abs(c3.py - c3.h * 0.35) < 4 && Math.abs(c3.z - zWant) / zWant < 0.02, 'pinch, wheel and drag frame the face', brief(cropLog));
  await p.screenshot({ path: `${out}/10-telefon-selfie-kadr.png` });
  await p.click('#facev [data-a=ok]');
  await p.waitForTimeout(250);
  const img = await p.evaluate(() => beamPad.looks.face && beamPad.looks.face.img);
  check(img && img.length < 60000, 'selfie saved as a small JPEG', `${img && img.length} chars`);
  if (img) writeFileSync(`${out}/11-selfie-112.jpg`, Buffer.from(img.split(',')[1], 'base64'));
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${out}/12-telefon-selfie-kafelek.png` });
});
await wait(600);
const pl = await G(() => beam.game.players.map(p => ({ name: p.name, k: p.look.data.k, id: p.look.data.id, cid: p.src.id, face: !!(beam.renderer.faces.get(p.src.id) || {}).ready })));
log('players', brief(pl.map(p => [p.name, p.k, p.id, p.face])));
const byName = Object.fromEntries(pl.map(p => [p.name, p]));
check(byName.Rakieta && byName.Rakieta.k === 'p' && byName.Rakieta.id === 'kot', 'preset look arrives on the wall');
check(byName['Pędzel'] && byName['Pędzel'].k === 'd', 'finger drawing arrives on the wall');
check(byName.Selfik && byName.Selfik.k === 'f' && byName.Selfik.face, 'selfie arrives and its texture is ready');

await host.keyboard.press('KeyR');
await wait(200);
const cA = await padA.evaluate(() => [document.querySelector('#st1').textContent, document.querySelector('#st1').classList.contains('big'), document.querySelector('#st2').textContent]);
check(/^[123]$/.test(cA[0]) && cA[1], 'phone shows the big countdown digit', brief(cA));
await padA.screenshot({ path: `${out}/13-telefon-odliczanie.png` });
check(await phase('play', 4000), 'phones play after the countdown');
await G(f => { T.put(T.by('Rakieta'), 68, f); T.put(T.by('Pędzel'), 80, f, 0, 0, -1); T.put(T.by('Selfik'), 92, f, 0, 0, -1); }, floor);
await wait(700);
await shotW('14-trzy-wyglady', 60, floor - 2, 100, floor + 16);
await host.evaluate(() => { for (const s of ['#stagebar', '#toast', '#overlay']) document.querySelector(s).style.visibility = 'hidden'; });
await shotW('15-selfie-zblizenie', 85, floor - 1, 99, floor + 13);
await host.evaluate(() => { for (const s of ['#stagebar', '#toast', '#overlay']) document.querySelector(s).style.visibility = ''; });
const sA = await padA.evaluate(() => document.querySelector('#st1').textContent);
check(sA === 'Wyścig!', 'phone shows the race status', sA);
await G(g => T.put(T.by('Rakieta'), g.x + 1, g.y + 0.1), goal);
await wait(400);
const pA2 = await padA.evaluate(() => [document.querySelector('#st1').textContent, document.querySelector('#st2').textContent]);
check(pA2[0] === '1. miejsce', 'phone shows its place at the flag', brief(pA2));
await G(() => { const m = beam.game.match; m.endAt = m.clock + 0.3; });
await wait(1400);
const doneA = await padA.evaluate(() => [document.querySelector('#st1').textContent, document.querySelectorAll('#board .brow').length, document.querySelector('#again').classList.contains('on')]);
const doneB = await padB.evaluate(() => [document.querySelector('#st1').textContent, [...document.querySelectorAll('#board .brow')].map(r => r.textContent)]);
check(doneA[0] === 'Wygrywasz!' && doneA[1] === 3 && doneA[2], 'winner phone shows the board and the again button', brief(doneA));
check(doneB[0] === 'Wygrywa: Rakieta' && doneB[1].some(t => /Pędzel \(ty\)bez mety/.test(t)), 'other phone shows the winner and its own row', brief(doneB));
await padB.screenshot({ path: `${out}/16-telefon-wyniki.png` });
await padB.click('#again');
await wait(500);
m = await M();
check(m.phase === 'count' || m.phase === 'play', 'again from a phone starts a new round', m.phase);

await padA.click('#me');
await padA.waitForSelector('.sheetwrap .looks .lk');
await padA.click('.sheetwrap .looks .lk:nth-child(3)');
await padA.click('.sheetwrap button[type=submit]');
await wait(600);
check((await st('Rakieta')).look.id === 'robot', 'look change from the phone sheet reaches the wall', brief((await st('Rakieta')).look));

await host.screenshot({ path: `${out}/17-host.png` });
await host.evaluate(() => beam.room.stop());
await wait(400);
for (const p of [padA, padB, padC]) await p.close();
await host.close();
await browser.close();
log('crop', brief(cropLog));
log('---- console');
for (const l of logs) log(l);
log(fails.length ? `FAILED ${fails.length}: ${fails.join(' | ')}` : 'ALL PASSED');
