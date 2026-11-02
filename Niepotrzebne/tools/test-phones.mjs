// Beam: headless test of phones in a room. Join, buttons move the character, wall editor ops, the photo marker match on a
// live wall, kick and reconnect after the editor reloads. Usage: node test-phones.mjs [outDir], NET=rtc for real
// Firebase + WebRTC (plus a second phone forced onto the RTDB relay), URL=... for another server.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire('/Users/jurek/openclaw/node_modules/');
const { chromium } = require('playwright-core');

const out = process.argv[2] || new URL('../zrzuty/test-phones', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const base = process.env.URL || 'http://localhost:8981/';
const NET = process.env.NET || 'local';
const hostQ = NET === 'local' ? '?net=local' : '';
const padQ = code => `pad.html?r=${code}${NET === 'local' ? '&net=local' : ''}`;
const log = (...a) => console.log(...a);
const fails = [];
const check = (ok, what, extra = '') => { log(ok ? 'PASS' : 'FAIL', what, extra); if (!ok) fails.push(what); };

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 780 }, deviceScaleFactor: 1 });
const logs = [];
const hook = (p, tag) => {
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${tag} ${m.type()}] ${m.text()}`); });
  p.on('pageerror', e => logs.push(`[${tag} pageerror] ${e.message}`));
};

const host = await ctx.newPage();
hook(host, 'host');
await host.goto(base + hostQ);
await host.waitForFunction(() => document.getElementById('loading')?.classList.contains('off') && window.beam?.ready, null, { timeout: 60000 });
await host.evaluate(async () => {
  const w = beam.walls.list.find(x => x.demo);
  await beam.selectWall(w.id);
  beam.loadDemo();
  beam.setStep(5);
  beam.room.start();
});
await host.waitForFunction(() => beam.room.state === 'online' && beam.room.qr, null, { timeout: 30000 });
const code = await host.evaluate(() => beam.room.code);
log('room', code, 'url', await host.evaluate(() => beam.room.url()));
await host.waitForTimeout(400);
await host.screenshot({ path: `${out}/01-host-room.png` });

async function phone(tag, name, init) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 844, height: 390 });
  if (init) await p.addInitScript(init);
  hook(p, tag);
  await p.goto(base + padQ(code));
  await p.fill('#name', name);
  await p.click('#go');
  await p.waitForSelector('#app.on', { timeout: 30000 });
  return p;
}

const t0 = Date.now();
const pad1 = await phone('pad1', 'Rakieta');
log('pad1 joined in', Date.now() - t0, 'ms, conn', await pad1.evaluate(() => beamPad.S.conn));
await host.waitForTimeout(300);
const st = await host.evaluate(() => ({
  roster: beam.room.roster().map(p => [p.name, p.color, p.conn]),
  players: beam.game.players.map(p => [p.name, p.src.kind]),
}));
log('host sees', JSON.stringify(st));
check(st.roster.length === 1 && st.players.some(p => p[1] === 'pad' && p[0] === 'Rakieta'), 'phone joins as a player');

const padX = () => host.evaluate(() => { const p = beam.game.players.find(q => q.src.kind === 'pad'); const b = p.hitbox(); return [b.x, b.y]; });
async function hold(page, sel, ms) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}
await host.waitForTimeout(600);
const a0 = await padX();
await hold(pad1, '.pb.r', 900);
const a1 = await padX();
await hold(pad1, '.pb.l', 500);
const a2 = await padX();
log('x', a0[0].toFixed(1), '->', a1[0].toFixed(1), '->', a2[0].toFixed(1));
check(a1[0] - a0[0] > 3 && a2[0] < a1[0], 'right and left buttons move the character');
const y0 = (await padX())[1];
const jb = await pad1.locator('.pb.jump').boundingBox();
await pad1.mouse.move(jb.x + jb.width / 2, jb.y + jb.height / 2);
await pad1.mouse.down();
let ymax = y0;
for (let i = 0; i < 6; i++) { await host.waitForTimeout(60); ymax = Math.max(ymax, (await padX())[1]); }
await pad1.mouse.up();
log('jump y', y0.toFixed(1), 'peak', ymax.toFixed(1));
check(ymax - y0 > 2, 'jump button jumps');
await pad1.screenshot({ path: `${out}/02-pad.png` });

await pad1.click('#tabs [data-tab=edit]');
await pad1.waitForFunction(() => beamPad.editor.sc && beamPad.editor.view === 'photo', null, { timeout: 8000 }).catch(() => {});
const ed = await pad1.evaluate(() => ({ view: beamPad.editor.view, shapes: beamPad.editor.sc?.shapes.length, M: !!beamPad.editor.M }));
log('editor', JSON.stringify(ed));
check(ed.view === 'photo' && ed.M, 'editor shows the wall photo from the computer');
await pad1.waitForTimeout(300);
await pad1.screenshot({ path: `${out}/03-editor-photo.png` });

const count = () => host.evaluate(() => beam.scene.state.shapes.length);
const toPage = (page, x, y) => page.evaluate(([x, y]) => { const r = beamPad.editor.cv.getBoundingClientRect(), q = beamPad.editor.toS(x, y); return [q[0] + r.left, q[1] + r.top]; }, [x, y]);
const grabPoint = (page, id, b) => page.evaluate(([id, b]) => {
  const e = beamPad.editor, r = e.cv.getBoundingClientRect();
  for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) {
    const q = e.toS(b[0] + (b[2] - b[0]) * i / 10, b[1] + (b[3] - b[1]) * j / 10);
    if (e.hit(q[0], q[1]) === id) return [q[0] + r.left, q[1] + r.top];
  }
  return null;
}, [id, b]);
const n0 = await count();
await pad1.click('[data-tool=rect]');
await pad1.mouse.move(330, 150);
await pad1.mouse.down();
await pad1.mouse.move(380, 190, { steps: 4 });
await pad1.mouse.move(430, 230, { steps: 4 });
await pad1.mouse.up();
await host.waitForTimeout(500);
const n1 = await count();
check(n1 === n0 + 1, 'rectangle from the phone lands on the computer', `${n0} -> ${n1}`);
const added = await host.evaluate(() => { const s = beam.scene.state.shapes.at(-1); return { id: s.id, type: s.type, box: (() => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of s.geom[0][0]) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1].map(v => +v.toFixed(1)); })() }; });
log('added', JSON.stringify(added), 'phone selection', await pad1.evaluate(() => [...beamPad.editor.sel]));

await pad1.click('#etype');
await pad1.click('.sheetwrap .type:has-text("Lawa")');
await host.waitForTimeout(400);
check(await host.evaluate(id => beam.scene.shape(id)?.type, added.id) === 'lava', 'type change from the phone');

await pad1.click('[data-tool=select]');
const c = await grabPoint(pad1, added.id, added.box);
await pad1.mouse.move(c[0], c[1]);
await pad1.mouse.down();
await pad1.mouse.move(c[0] + 30, c[1], { steps: 4 });
await pad1.mouse.move(c[0] + 60, c[1], { steps: 4 });
await pad1.mouse.up();
await host.waitForTimeout(400);
const moved = await host.evaluate(id => { const s = beam.scene.shape(id); return Math.min(...s.geom[0][0].map(p => p[0])); }, added.id);
log('moved x0', added.box[0], '->', moved.toFixed(1));
check(moved - added.box[0] > 1, 'drag moves the shape');

await pad1.click('#edel');
await host.waitForTimeout(400);
check(!(await host.evaluate(id => !!beam.scene.shape(id), added.id)), 'delete from the phone');
await pad1.click('#eundo');
await host.waitForTimeout(400);
check(await host.evaluate(id => !!beam.scene.shape(id), added.id), 'undo from the phone');

await pad1.click('[data-tool=poly]');
for (const [x, y] of [[520, 140], [600, 150], [610, 230], [530, 240]]) { await pad1.mouse.click(x, y); await pad1.waitForTimeout(80); }
await pad1.mouse.click(520, 140);
await host.waitForTimeout(500);
const n2 = await count();
check(n2 === n1 + 1, 'polygon from the phone', `${n1} -> ${n2}`);
await pad1.waitForTimeout(250);
await pad1.screenshot({ path: `${out}/04-editor-drawn.png` });
await host.screenshot({ path: `${out}/05-host-after-phone-edits.png` });
await pad1.click('#tabs [data-tab=pad]');

let pad2 = null;
if (NET === 'rtc') {
  const fake = () => {
    window.RTCPeerConnection = class {
      constructor() { this.connectionState = 'new'; this.iceConnectionState = 'new'; this.signalingState = 'stable'; this.localDescription = null; }
      createDataChannel(label) { return { label, readyState: 'connecting', send() { }, close() { } }; }
      async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
      async setLocalDescription(d) { this.localDescription = d; this.signalingState = 'have-local-offer'; }
      async setRemoteDescription() { }
      async addIceCandidate() { }
      close() { }
    };
  };
  const t1 = Date.now();
  pad2 = await phone('pad2', 'Przekaźnik', fake);
  log('pad2 joined in', Date.now() - t1, 'ms, conn', await pad2.evaluate(() => beamPad.S.conn));
  check(await pad2.evaluate(() => beamPad.S.conn) === 'relay', 'phone without WebRTC falls back to the relay');
  await host.waitForTimeout(600);
  const r0 = await host.evaluate(() => { const p = beam.game.players.find(q => q.name === 'Przekaźnik'); return p && p.hitbox().x; });
  await hold(pad2, '.pb.r', 1200);
  const r1 = await host.evaluate(() => { const p = beam.game.players.find(q => q.name === 'Przekaźnik'); return p && p.hitbox().x; });
  log('relay x', r0 && r0.toFixed(1), '->', r1 && r1.toFixed(1));
  check(r1 - r0 > 3, 'relay buttons move the character');
  check(await pad1.evaluate(() => beamPad.S.conn) === 'rtc', 'first phone is on direct WebRTC');
}

await host.evaluate(async () => {
  await beam.newLiveWall();
  beam.setStep(4);
  beam.setLayout('room');
});
await host.waitForTimeout(800);
await pad1.click('#tabs [data-tab=edit]');
await pad1.waitForFunction(() => beamPad.editor.sc && beamPad.editor.sc.wall.live, null, { timeout: 8000 });
const qrOn = await host.evaluate(() => !!beam.room.wallQr());
check(qrOn, 'QR card is on the live wall');
await host.evaluate(() => { for (const s of ['#stagebar', '#hud', '#toast', '#overlay']) document.querySelector(s).style.visibility = 'hidden'; });
await host.waitForTimeout(300);
await host.screenshot({ path: `${out}/06-host-live-qr.png` });
await pad1.click('#eshot');
await host.waitForFunction(() => beam.room.marksOn(), null, { timeout: 5000 });
await host.waitForTimeout(400);
const clip = await host.evaluate(() => {
  const r = beam.stage.getBoundingClientRect(), v = beam.views, st = beam.scene.state;
  const a = v.toScreen(v.room, 0, 0), b = v.toScreen(v.room, st.proj.jw, st.proj.jh);
  return { x: Math.round(r.left + a[0]), y: Math.round(r.top + a[1]), width: Math.round(b[0] - a[0]), height: Math.round(b[1] - a[1]), marks: beam.room.markJ().map(p => v.toScreen(v.room, p[0], p[1]).map((q, i) => q + (i ? r.top : r.left))), calib: st.calibJ.map(p => v.toScreen(v.room, p[0], p[1]).map((q, i) => q + (i ? r.top : r.left))), cm: st.calibCm };
});
const shot = await host.screenshot({ clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height } });
writeFileSync(`${out}/07-wall-with-markers.png`, shot);
const fcP = pad1.waitForEvent('filechooser');
await pad1.click('.sheetwrap .btn.primary');
const fc = await fcP;
await fc.setFiles({ name: 'sciana.png', mimeType: 'image/png', buffer: shot });
await pad1.waitForSelector('#markv.on', { timeout: 8000 });
await pad1.waitForTimeout(300);
const picked = await pad1.evaluate(() => ({ pts: beamPad.editor.picker.pts, w: beamPad.editor.picker.photo.width, h: beamPad.editor.picker.photo.height, text: document.querySelector('#mtext').textContent }));
const k = picked.w / clip.width;
const errs = clip.marks.map((m, i) => Math.hypot((m[0] - clip.x) * k - picked.pts[i][0], (m[1] - clip.y) * k - picked.pts[i][1]));
log('markers found', picked.text, 'error px', errs.map(e => e.toFixed(1)).join(' '));
check(errs.every(e => e < 4), 'all four projector markers detected in the photo');
await pad1.screenshot({ path: `${out}/08-marker-picker.png` });
await pad1.click('#mok');
await pad1.waitForFunction(() => beamPad.editor.view === 'photo' && beamPad.editor.M, null, { timeout: 5000 }).catch(() => {});
check(!(await host.evaluate(() => beam.room.marksOn())), 'markers turn off after the photo');
const cmc = [[0, clip.cm.h], [clip.cm.w, clip.cm.h], [clip.cm.w, 0], [0, 0]];
const mapErr = await pad1.evaluate(([cm, calib, cx, cy, kk]) => cm.map((p, i) => {
  const H = beamPad.editor.M, w = H[6] * p[0] + H[7] * p[1] + H[8];
  const x = (H[0] * p[0] + H[1] * p[1] + H[2]) / w, y = (H[3] * p[0] + H[4] * p[1] + H[5]) / w;
  return Math.hypot(x - (calib[i][0] - cx) * kk, y - (calib[i][1] - cy) * kk);
}), [cmc, clip.calib, clip.x, clip.y, k]);
log('photo match error at calibration corners px', mapErr.map(e => e.toFixed(2)).join(' '));
check(mapErr.every(e => e < 3), 'photo matches the wall through the markers');
const nL = await count();
await pad1.click('[data-tool=rect]');
const pA = await toPage(pad1, 10, 10), pB = await toPage(pad1, 18, 25);
await pad1.mouse.move(pA[0], pA[1]);
await pad1.mouse.down();
await pad1.mouse.move((pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, { steps: 3 });
await pad1.mouse.move(pB[0], pB[1], { steps: 3 });
await pad1.mouse.up();
await host.waitForTimeout(500);
const liveBox = await host.evaluate(() => { const s = beam.scene.state.shapes.at(-1); const xs = s.geom[0][0].map(p => p[0]), ys = s.geom[0][0].map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(v => +v.toFixed(1)); });
log('rect drawn on the photo, cm', JSON.stringify(liveBox));
check((await count()) === nL + 1 && Math.abs(liveBox[0] - 10) < 0.6 && Math.abs(liveBox[3] - 25) < 0.6, 'rectangle on the photo lands in the right cm');
await host.evaluate(() => { for (const s of ['#stagebar', '#hud', '#toast', '#overlay']) document.querySelector(s).style.visibility = ''; });
await pad1.waitForTimeout(250);
await pad1.screenshot({ path: `${out}/09-editor-live-photo.png` });
await pad1.click('#tabs [data-tab=pad]');

const cid = await pad1.evaluate(() => beamPad.S.cid);
await host.evaluate(c => beam.room.kick(c), cid);
await pad1.waitForSelector('#wait.on', { timeout: 6000 });
check((await pad1.textContent('#waitTitle')) === 'Rozłączono', 'kick shows the disconnected screen');
await pad1.click('#waitBtns .btn.primary');
await pad1.waitForSelector('#app.on', { timeout: 20000 });
check(await host.evaluate(() => beam.room.roster().some(p => p.name === 'Rakieta')), 'rejoin after kick');

await host.reload();
await host.waitForFunction(() => document.getElementById('loading')?.classList.contains('off') && window.beam?.ready, null, { timeout: 60000 });
await host.waitForFunction(c => beam.room.state === 'online' && beam.room.code === c, code, { timeout: 30000 }).catch(() => {});
log('after reload code', await host.evaluate(() => [beam.room.state, beam.room.code]));
const back = await host.waitForFunction(() => beam.room.roster().some(p => p.name === 'Rakieta'), null, { timeout: 40000 }).then(() => true).catch(() => false);
check(back, 'phone reconnects by itself after the editor reloads');
log('pad1 after reload', await pad1.evaluate(() => [beamPad.S.conn, beamPad.S.welcomed, document.querySelector('#banner').textContent]));
if (NET === 'rtc') {
  const up = await pad1.waitForFunction(() => beamPad.S.conn === 'rtc' && beamPad.S.welcomed, null, { timeout: 30000 }).then(() => true).catch(() => false);
  check(up, 'phone climbs back from the relay to direct WebRTC');
  await host.evaluate(() => beam.setStep(5));
  await host.waitForTimeout(700);
  const before = await host.evaluate(() => { const p = beam.game.players.find(q => q.name === 'Rakieta'); return p ? p.hitbox().x : null; });
  await hold(pad1, '.pb.r', 900);
  const after = await host.evaluate(() => { const p = beam.game.players.find(q => q.name === 'Rakieta'); return p ? p.hitbox().x : null; });
  log('after upgrade x', before, '->', after, 'host conn', await host.evaluate(() => beam.room.roster().map(p => p.conn)));
  check(after - before > 3, 'buttons work after the upgrade');
}

await host.evaluate(() => beam.room.stop());
await host.waitForTimeout(600);
if (pad2) await pad2.close();
await pad1.close();
await host.close();
await browser.close();
log('---- console');
for (const l of logs) log(l);
log(fails.length ? `FAILED ${fails.length}: ${fails.join(' | ')}` : 'ALL PASSED');
log('room code', code);
