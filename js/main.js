// Beam: app wiring. Scene, spaces, views, renderer, game, editor tools and UI, on-demand rendering, keys, walls and steps.

import * as H from './math/homography.js';
import { Scene, blankState } from './scene.js';
import { Space } from './space.js';
import { Views } from './views.js';
import { Renderer } from './render/renderer.js';
import { Game } from './game/game.js';
import { Input, GAME_KEYS } from './game/input.js';
import { initRapier } from './game/physics.js';
import { Tools } from './editor/tools.js';
import { UI } from './editor/ui.js';
import { Walls, demoState, presetQuad, loadImage } from './walls.js';

const LAST = 'beam.v1.last';
const LAYOUTS = { 1: 'room', 2: 'room', 3: 'split', 4: 'split', 5: 'room' };

class App {
  constructor() {
    this.stage = document.getElementById('stage');
    this.glCanvas = document.getElementById('gl');
    this.overlay = document.getElementById('overlay');
    this.step = 1;
    this.ready = false;
    this.testPattern = false;
    this.time = 1.7;
    this.last = 0;
    this.raf = 0;
    this.glDirty = true;
    this.paneDirty = false;
    this.ovDirty = true;
    this.staticTimer = 0;
    this.wallToken = 0;
    this.playSig = '';
    this.palNow = null;
    this.photoSize = [1600, 1000];
    this.layoutFor = { ...LAYOUTS };
    this.scene = new Scene();
    this.space = new Space();
    this.views = new Views();
    this.walls = new Walls();
    this.input = new Input();
    this.renderer = new Renderer(this.glCanvas);
    this.renderer.onAsync = () => { this.renderer.rebuild(this.scene.state); this.invalidate(); };
    this.ui = new UI(this);
    this.tools = new Tools(this);
    this.game = new Game(this);
    this.scene.on((kind, live) => this.onScene(kind, live));
    new ResizeObserver(() => this.resize()).observe(this.stage);
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => this.onKey(e));
    window.addEventListener('blur', () => this.input.clear());
    window.addEventListener('pagehide', () => this.scene.flush());
  }

  async boot() {
    await Promise.all([initRapier(), this.walls.load()]);
    let last = null;
    try { last = JSON.parse(localStorage.getItem(LAST) || 'null'); } catch (e) { last = null; }
    const id = last && this.walls.get(last.wallId) ? last.wallId : this.walls.get('biurko') ? 'biurko' : this.walls.list[0].id;
    this.step = last && last.step >= 1 && last.step <= 5 ? last.step : 5;
    this.views.setLayout(this.layoutFor[this.step]);
    this.resize();
    await this.selectWall(id);
    document.getElementById('loading').classList.add('off');
    if (!last) this.ui.toast('To gotowe demo. Strzałki: ruch, Spacja: skok. Kroki u góry pokazują, jak się robi mapowanie.', 6000);
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    this.glCanvas.style.width = w + 'px';
    this.glCanvas.style.height = h + 'px';
    this.views.resize(w, h);
    this.renderer.resize(w, h);
    this.tools.resize(w, h);
    this.glDirty = true;
    this.ovDirty = true;
    this.frame(performance.now());
  }

  onScene(kind, live) {
    const st = this.scene.state;
    if (kind === 'all' || kind === 'proj' || kind === 'calib') {
      this.space.update(st);
      this.renderer.setSpace(this.space, st);
      const aspect = st.proj.jw / st.proj.jh;
      if (aspect !== this.views.projAspect) { this.views.projAspect = aspect; this.views.arrange(); }
    }
    if (kind === 'all' || kind === 'shapes' || st.settings.palette !== this.palNow) {
      this.palNow = st.settings.palette;
      this.renderer.rebuild(st);
    }
    if (live) {
      this.scheduleStatic();
    } else {
      for (const id of [...this.tools.sel]) if (!st.shapes.some(s => s.id === id)) this.tools.sel.delete(id);
      this.buildStatic();
      if (this.step === 5 && (kind !== 'settings' || this.playSignature() !== this.playSig)) this.restart();
      this.ui.render();
    }
    this.invalidate();
  }

  scheduleStatic() {
    if (this.staticTimer) return;
    this.staticTimer = setTimeout(() => { this.staticTimer = 0; this.buildStatic(); this.invalidate(); }, 90);
  }

  buildStatic() {
    clearTimeout(this.staticTimer);
    this.staticTimer = 0;
    this.game.buildStatic(this.scene.state, this.space);
  }

  playSignature() {
    const s = this.scene.state.settings;
    return `${s.mode}|${s.players}|${s.charSize}|${s.floor}`;
  }

  async selectWall(id) {
    const wall = this.walls.get(id);
    if (!wall) return;
    const token = ++this.wallToken;
    this.scene.flush();
    let img = null;
    try { img = await this.walls.image(wall); } catch (e) { this.ui.toast('Nie udało się wczytać tego zdjęcia.', 3000); }
    if (token !== this.wallToken) return;
    this.photoSize = img ? [img.naturalWidth, img.naturalHeight] : wall.size || [1600, 1000];
    this.renderer.setPhoto(img);
    const st = Scene.load(id) || (wall.demo ? demoState(wall) : blankState(wall));
    this.tools.sel.clear();
    this.tools.poly = null;
    this.tools.drag = null;
    this.ready = true;
    this.scene.replace(st);
    this.fitViews(true);
    this.saveLast();
  }

  loadDemo() {
    const wall = this.walls.get(this.scene.state.wallId);
    if (!wall || !wall.demo) return;
    this.tools.sel.clear();
    this.scene.replace(demoState(wall), true);
    this.fitViews(false);
    this.ui.toast('Wczytane demo. Cmd+Z wraca do Twojej wersji.', 2600);
  }

  async uploadWall(file) {
    this.ui.toast('Wczytuję zdjęcie...', 0);
    try {
      const wall = await this.walls.upload(file);
      await this.selectWall(wall.id);
      this.setStep(2);
      this.ui.toast('Dodane. Teraz pokaż, gdzie pada światło projektora.', 3000);
    } catch (e) {
      this.ui.toast('Nie udało się wczytać tego pliku. Spróbuj JPG albo PNG.', 3200);
    }
  }

  async removeWall(id) {
    if (this.scene.state.wallId === id) {
      const first = this.walls.list.find(w => w.builtin);
      if (first) await this.selectWall(first.id);
    }
    await this.walls.remove(id);
    this.ui.render();
  }

  setStep(n) {
    if (n === this.step) return;
    this.step = n;
    this.tools.poly = null;
    this.tools.drag = null;
    this.input.clear();
    this.ui.hideToast();
    if (n === 5) this.restart();
    else if (this.game.running) { this.game.stop(); this.buildStatic(); }
    this.views.setLayout(this.layoutFor[n]);
    this.fitViews(false);
    this.ui.hud();
    this.ui.render();
    this.saveLast();
    this.invalidate();
  }

  restart() {
    this.ui.hideToast();
    if (this.step !== 5) { this.setStep(5); return; }
    if (!this.space.ok) { this.ui.toast('Kalibracja jest krzywa. Popraw krzyżyki w kroku 3.', 3200); return; }
    this.buildStatic();
    this.game.start();
    this.playSig = this.playSignature();
    this.input.clear();
    this.last = 0;
    this.ui.hud();
    this.requestFrame();
  }

  onGame(type, data) {
    this.ui.gameEvent(type, data);
  }

  setLayout(layout) {
    this.layoutFor[this.step] = layout;
    this.views.setLayout(layout);
    this.fitViews(false);
    this.ui.renderStagebar();
  }

  fitViews(force) {
    const st = this.scene.state;
    const [pw, ph] = this.photoSize;
    let x0 = 0, y0 = 0, x1 = pw, y1 = ph;
    for (const p of st.projQuad) {
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    this.views.setFit(this.views.room, { x0, y0, x1, y1 }, force);
    this.views.setFit(this.views.editor, this.editorBox(), force);
    this.invalidate();
  }

  editorBox() {
    const { w, h } = this.scene.state.calibCm;
    if (!this.space.ok) return { x0: 0, y0: 0, x1: w, y1: h };
    const b = this.space.box, R = Math.max(w, h, 60) * 2.5;
    const x0 = Math.max(b.x0, w / 2 - R), x1 = Math.min(b.x1, w / 2 + R);
    const y0 = Math.max(b.y0, h / 2 - R), y1 = Math.min(b.y1, h / 2 + R);
    if (x1 - x0 < 1 || y1 - y0 < 1) return { x0: 0, y0: 0, x1: w, y1: h };
    return { x0, y0, x1, y1 };
  }

  fullscreen() {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }

  setResolution(r) {
    const [jw, jh] = r.split('x').map(Number);
    this.scene.commit('proj', st => {
      const kx = jw / st.proj.jw, ky = jh / st.proj.jh;
      st.calibJ = st.calibJ.map(p => [p[0] * kx, p[1] * ky]);
      st.proj = { jw, jh };
    });
  }

  setProjPreset(kind) {
    const st0 = this.scene.state;
    const wall = this.walls.get(st0.wallId);
    const [pw, ph] = this.photoSize;
    const q = kind === 'wall' && wall && wall.projQuad ? wall.projQuad.map(p => [p[0], p[1]]) : presetQuad(kind, pw, ph);
    const keep = st0.settings.keepMap && this.space.ok ? st0.calibJ.map(j => this.space.jToP(j[0], j[1])) : null;
    this.scene.commit('proj', st => {
      st.projQuad = q;
      if (!keep || !keep.every(Boolean)) return;
      const { jw, jh } = st.proj;
      const HPJ = H.inv(H.solve([[0, 0], [jw, 0], [jw, jh], [0, jh]], q));
      if (HPJ) st.calibJ = keep.map(p => H.apply(HPJ, p[0], p[1]));
    });
    this.fitViews(false);
  }

  clearWall() {
    this.tools.sel.clear();
    this.scene.commit('all', st => { st.shapes = []; st.items = []; });
    this.ui.toast('Ściana wyczyszczona. Cmd+Z przywraca.', 2400);
  }

  async screenImage(id, file) {
    try {
      const url = URL.createObjectURL(file);
      const src = await loadImage(url);
      URL.revokeObjectURL(url);
      const k = Math.min(1, 900 / Math.max(src.naturalWidth, src.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(src.naturalWidth * k));
      c.height = Math.max(1, Math.round(src.naturalHeight * k));
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      const data = c.toDataURL('image/jpeg', 0.84);
      this.scene.commit('shapes', st => {
        const s = st.shapes.find(q => q.id === id);
        if (s) s.props.image = data;
      });
    } catch (e) {
      this.ui.toast('Nie udało się wczytać obrazu.', 2600);
    }
  }

  saveLast() {
    try { localStorage.setItem(LAST, JSON.stringify({ wallId: this.scene.state.wallId, step: this.step })); } catch (e) { }
  }

  onKey(e) {
    const down = e.type === 'keydown';
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA' || t.isContentEditable || (t.tagName === 'INPUT' && !['range', 'checkbox', 'button', 'file'].includes(t.type)));
    if (typing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (down && mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) this.scene.redo(); else this.scene.undo(); return; }
      if (k === 'y') { e.preventDefault(); this.scene.redo(); return; }
    }
    if (this.step === 5 && !mod && GAME_KEYS.has(e.code)) {
      e.preventDefault();
      const a = document.activeElement;
      if (a && a !== document.body && a.blur) a.blur();
      this.input.key(e.code, down);
      return;
    }
    if (down && !mod && this.step === 5 && e.code === 'KeyR') { this.restart(); return; }
    if (this.tools.key(e)) { e.preventDefault(); return; }
    if (down && !mod && !e.altKey) {
      if (e.code === 'KeyF') { this.fullscreen(); return; }
      if (e.key === '0') { this.fitViews(true); return; }
    }
  }

  invalidate() {
    this.glDirty = true;
    this.ovDirty = true;
    this.requestFrame();
  }

  viewChanged() {
    this.paneDirty = true;
    this.ovDirty = true;
    this.requestFrame();
  }

  overlayDirty() {
    this.ovDirty = true;
    this.requestFrame();
  }

  requestFrame() {
    if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t));
  }

  renderOpts() {
    const s = this.scene.state.settings, T = this.time;
    return {
      time: T,
      draw: this.game.space ? (L, parts, pal, F) => this.game.draw(L, parts, pal, T, F) : null,
      mode: this.step === 3 ? 2 : this.step === 2 && this.testPattern ? 1 : 0,
      bright: 1,
      calibGrid: s.calibGrid,
      ambient: s.ambient,
      gain: s.gain,
      editorGrid: s.grid,
      inset: s.inset && this.step >= 2,
    };
  }

  frame(now) {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (!this.ready) return;
    const playing = this.step === 5 && this.game.running;
    if (playing) {
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
      this.last = now;
      this.game.update(dt, this.input);
      this.time += dt;
      this.glDirty = true;
    } else {
      this.last = 0;
    }
    if (this.glDirty) {
      this.glDirty = false;
      this.paneDirty = false;
      this.renderer.render(this.views, this.renderOpts());
    } else if (this.paneDirty) {
      this.paneDirty = false;
      this.renderer.drawPanes(this.views, this.renderOpts());
    }
    if (this.ovDirty) {
      this.ovDirty = false;
      this.tools.draw();
    }
    if (playing) {
      this.ui.hud();
      this.requestFrame();
    }
  }
}

function fail(err) {
  const box = document.getElementById('loading');
  box.classList.remove('off');
  box.classList.add('err');
  box.querySelector('p').textContent = 'Beam się nie uruchomił: ' + (err && err.message ? err.message : err);
  console.error(err);
}

try {
  const app = new App();
  window.beam = app;
  app.boot().catch(fail);
} catch (err) {
  fail(err);
}
