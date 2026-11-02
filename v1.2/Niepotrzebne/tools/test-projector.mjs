// Beam: headless regression test of the real projector flow (popup window with its own WebGL context, fullscreen,
// calibration and drawing on the wall, play, close). Usage: node test-projector.mjs [outDir], URL=... to test live.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('/Users/jurek/openclaw/node_modules/');
const { chromium } = require('playwright-core');

const out = process.argv[2] || new URL('../zrzuty/test-projector', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const url = process.env.URL || 'http://localhost:8981/';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 780 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
const hook = (p, tag) => {
  p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${tag} ${m.type()}] ${m.text()}`); });
  p.on('pageerror', e => logs.push(`[${tag} pageerror] ${e.message}`));
};
hook(page, 'main');
const log = (...a) => console.log(...a);
await page.goto(url);
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('off') && window.beam?.ready, null, { timeout: 60000 });
await page.evaluate(() => localStorage.clear());

await page.evaluate(() => beam.setStep(1));
await page.getByRole('button', { name: /prawdziwej ścianie|Nowa prawdziwa/ }).click();
await page.waitForTimeout(400);
log('live wall', JSON.stringify(await page.evaluate(() => ({ step: beam.step, live: beam.live, proj: beam.scene.state.proj, calib: beam.scene.state.calibCm, perm: beam.projector.perm, single: beam.projector.single }))));
await page.screenshot({ path: `${out}/01-main-step2.png` });

const popupP = page.waitForEvent('popup');
await page.getByRole('button', { name: /Otwórz okno projektora|Otwórz bez tego/ }).first().click();
const popup = await popupP;
hook(popup, 'proj');
await popup.waitForLoadState();
await page.waitForFunction(() => beam.projector.attached, null, { timeout: 10000 });
await page.waitForTimeout(500);
log('attached', JSON.stringify(await page.evaluate(() => ({ pane: beam.projector.pane, k: beam.projector.k, win: [beam.projector.win.innerWidth, beam.projector.win.innerHeight], full: beam.projector.isFull() }))));
await popup.screenshot({ path: `${out}/02-popup-attached.png` });

await popup.mouse.click(400, 300);
await page.waitForTimeout(700);
log('after click', JSON.stringify(await page.evaluate(() => ({ full: beam.projector.isFull(), noFull: beam.projector.noFull, native: beam.projector.native, proj: beam.scene.state.proj, pane: beam.projector.pane }))));
await page.evaluate(() => { if (!beam.projector.isFull()) { beam.projector.noFull = true; beam.projector.hint(); } });

await page.evaluate(() => { beam.testPattern = true; beam.invalidate(); });
await page.waitForTimeout(300);
await popup.screenshot({ path: `${out}/03-popup-testpattern.png` });
await page.evaluate(() => { beam.testPattern = false; beam.setStep(3); });
await page.waitForTimeout(400);
await popup.screenshot({ path: `${out}/04-popup-calib.png` });

const scr = async (jx, jy) => page.evaluate(([x, y]) => {
  const p = beam.projector, s = beam.views.toScreen(p.pane, x, y);
  return [s[0] * p.k, s[1] * p.k];
}, [jx, jy]);
const c0 = await page.evaluate(() => beam.scene.state.calibJ.map(p => p.slice()));
const a = await scr(c0[0][0], c0[0][1]);
await popup.mouse.move(a[0], a[1]);
await popup.mouse.down();
await popup.mouse.move(a[0] - 40, a[1] - 30, { steps: 6 });
await popup.mouse.up();
await page.waitForTimeout(250);
const c1 = await page.evaluate(() => beam.scene.state.calibJ.map(p => p.slice()));
log('calib drag on wall: corner0', c0[0].map(v => v.toFixed(1)).join(','), '->', c1[0].map(v => v.toFixed(1)).join(','), 'calSel', await page.evaluate(() => beam.tools.calSel));
await popup.keyboard.press('ArrowRight');
await popup.keyboard.press('Shift+ArrowDown');
await page.waitForTimeout(150);
const c2 = await page.evaluate(() => beam.scene.state.calibJ[0].slice());
log('nudge in popup', c2.map(v => v.toFixed(1)).join(','));
await popup.mouse.move(300, 250);
await page.waitForTimeout(200);
await popup.screenshot({ path: `${out}/05-popup-calib-dragged.png` });
await page.screenshot({ path: `${out}/06-main-calib.png` });

await page.evaluate(() => { beam.setStep(4); beam.tools.setTool('rect'); });
await page.waitForTimeout(300);
const n0 = await page.evaluate(() => beam.scene.state.shapes.length);
await popup.mouse.move(250, 420);
await popup.mouse.down();
await popup.mouse.move(560, 470, { steps: 8 });
await popup.mouse.up();
await page.waitForTimeout(300);
const n1 = await page.evaluate(() => ({ n: beam.scene.state.shapes.length, last: beam.scene.state.shapes.at(-1)?.type, box: beam.scene.state.shapes.at(-1) && beam.scene.state.shapes.at(-1).geom[0][0].map(p => p.map(v => +v.toFixed(1))) }));
log('rect on wall: shapes', n0, '->', JSON.stringify(n1));
await popup.mouse.move(400, 300);
await page.waitForTimeout(200);
await popup.screenshot({ path: `${out}/07-popup-map.png` });
await page.screenshot({ path: `${out}/08-main-map.png` });

await page.evaluate(() => beam.copyShapes('biurko'));
await page.waitForTimeout(300);
log('copied', await page.evaluate(() => beam.scene.state.shapes.length));
await page.evaluate(() => { beam.setStep(5); });
await page.waitForTimeout(600);
const x0 = await page.evaluate(() => beam.game.players[0] && beam.game.players[0].x);
await popup.keyboard.down('ArrowRight');
await page.waitForTimeout(700);
await popup.keyboard.up('ArrowRight');
const x1 = await page.evaluate(() => beam.game.players[0] && beam.game.players[0].x);
log('play via popup keys: x', x0 && x0.toFixed(1), '->', x1 && x1.toFixed(1));
const fr = await page.evaluate(() => new Promise(res => {
  let n = 0, m = 0;
  const f = beam.frame.bind(beam), rm = beam.renderer.renderMain.bind(beam.renderer);
  beam.frame = () => { n++; f(); };
  beam.renderer.renderMain = (v, o) => { m++; rm(v, o); };
  setTimeout(() => { beam.frame = f; beam.renderer.renderMain = rm; res({ frames: n, main: m, driver: beam.raf && beam.raf.w === beam.projector.win ? 'popup' : 'main' }); }, 2000);
}));
log('loop 2s', JSON.stringify(fr));
await popup.screenshot({ path: `${out}/09-popup-play.png` });
await page.screenshot({ path: `${out}/10-main-play.png` });

await popup.close();
await page.waitForTimeout(1500);
log('after close', JSON.stringify(await page.evaluate(() => ({ attached: beam.projector.attached, raf: !!beam.raf, driver: beam.raf ? (beam.raf.w === window ? 'main' : 'other') : null }))));
const t0 = await page.evaluate(() => beam.time);
await page.waitForTimeout(500);
const t1 = await page.evaluate(() => beam.time);
log('game clock keeps running on main after close', (t1 - t0).toFixed(2));

await page.evaluate(() => beam.selectWall('biurko'));
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/11-main-biurko.png` });
log(logs.slice(-30).join('\n') || 'no console errors');
await browser.close();
