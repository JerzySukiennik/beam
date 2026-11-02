// Beam: Gzowo Labs card shot on the GPU. Room view of the Biurko demo, character frozen mid-jump under the vase lucky block.
import { createRequire } from 'node:module';
const require = createRequire('/Users/jurek/openclaw/node_modules/');
const { chromium } = require('playwright-core');

const outDir = process.argv[2];
const url = process.env.URL || 'https://beam.gzowo.fun/';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('off') && window.beam, null, { timeout: 60000 });
const info = await page.evaluate(() => {
  for (const id of ['top', 'panel', 'status', 'toolbar', 'hint', 'coords', 'toast', 'hud', 'stagebar', 'overlay']) {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  }
  Object.assign(document.getElementById('stage').style, { position: 'fixed', inset: '0', zIndex: '50' });
  const app = window.beam;
  app.scene.commit('settings', s => { s.settings.charSize = +(window.__size || 13); });
  app.setStep(5);
  return { wall: app.scene.state.wallId, step: app.step, players: app.game.players.length };
});
await page.waitForTimeout(1200);
const [cx, cy, z, px, py] = (process.env.VIEW || '935,540,0.86,900,876').split(',').map(Number);
await page.evaluate(([cx, cy, z, px, py]) => {
  const app = window.beam, r = app.views.room;
  Object.assign(r, { cx, cy, z, manual: true });
  app.views.inset.on = false;
  const [x, y] = app.space.pToW(px, py);
  const p = app.game.players[0];
  p.spawn(x, y + 0.2);
  p.inv = 0;
}, [cx, cy, z, px, py]);
await page.waitForTimeout(500);
await page.evaluate(() => { window.beam.game.players[0].inv = 0; });
await page.keyboard.down('Space');
setTimeout(() => page.keyboard.up('Space').catch(() => {}), +(process.env.HOLD || 320));
const freeze = +(process.env.FREEZE || 100);
await page.waitForTimeout(freeze);
await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
await page.waitForTimeout(80);
await page.screenshot({ path: `${outDir}/frame-${freeze}.png` });
console.log(JSON.stringify(info));
console.log(logs.slice(-20).join('\n') || 'no console errors');
await browser.close();
