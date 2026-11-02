// Beam: app wiring. Scene, spaces, views, renderer, projector window, room for phones, game, editor tools and UI,
// on-demand rendering, keys, walls and steps.

import * as H from './math/homography.js';
import { Scene, blankState, clone, newId } from './scene.js';
import { Space } from './space.js';
import { Views } from './views.js';
import { Renderer } from './render/renderer.js';
import { rgb } from './render/neon.js';
import { Projector } from './projector.js';
import { Room } from './room.js';
import { Game } from './game/game.js';
import { Input, GAME_KEYS } from './game/input.js';
import { initRapier } from './game/physics.js';
import { Tools } from './editor/tools.js';
import { UI } from './editor/ui.js';
import { Walls, demoState, liveState, liveQuad, presetQuad, loadImage } from './walls.js';

const LAST = 'beam.v1.last';
const LAYOUTS = { 1: 'room', 2: 'room', 3: 'split', 4: 'split', 5: 'room' };

class App {
  constructor() {
    this.stage = document.getElementById('stage');
    this.glCanvas = document.getElementById('gl');
    this.overlay = document.getElementById('overlay');
    this.step = 1;
    this.ready = false;
    this.live = false;
    this.testPattern = false;
    this.time = 1.7;
    this.last = 0;
    this.raf = 0;
    this.rafGuard = 0;
    this.tick = 0;
    this.glDirty = true;
    this.projDirty = true;
    this.paneDirty = false;
    this.ovDirty = true;
    this.staticTimer = 0;
    this.wallToken = 0;
    this.playSig = '';
    this.levelSig = '';
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
    this.room = new Room(this);
    this.projector = new Projector(this);
    this.ui = new UI(this);
    this.tools = new Tools(this);
    this.game = new Game(this);
    this.scene.on((kind, live) => this.onScene(kind, live));
    new ResizeObserver(() => this.resize()).observe(this.stage);
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => this.onKey(e));
    window.addEventListener('blur', () => this.input.clear());
    window.addEventListener('pagehide', () => { this.scene.flush(); this.projector.release(); });
    document.addEventListener('visibilitychange', () => this.requestFrame());
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
    this.room.resume();
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
    this.frame();
  }

  onScene(kind, live) {
    const st = this.scene.state;
    if (kind === 'all' || kind === 'proj' || kind === 'calib') {
      this.space.update(st);
      this.renderer.setSpace(this.space, st);
      this.room.layoutChanged();
      const aspect = st.proj.jw / st.proj.jh;
      if (aspect !== this.views.projAspect) { this.views.projAspect = aspect; this.views.arrange(); }
      if (kind !== 'calib') {
        this.projector.layout();
        if (this.live && (this.photoSize[0] !== st.proj.jw || this.photoSize[1] !== st.proj.jh)) {
          this.photoSize = [st.proj.jw, st.proj.jh];
          this.fitViews(false);
        }
      }
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
      if (this.step === 5) {
        if (kind === 'settings' ? this.playSignature() !== this.playSig : this.levelSignature() !== this.levelSig) this.restart();
        else if (kind !== 'settings') this.game.reload();
      }
      this.ui.render();
      this.room.sceneChanged();
      if (kind === 'settings') this.room.stateChanged();
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

  levelSignature() {
    const st = this.scene.state;
    return JSON.stringify([st.wallId, st.proj.jw, st.proj.jh, st.projQuad, st.calibJ, st.calibCm]);
  }

  maybeRoom() {
    if (this.live && this.step >= 4 && this.room.state === 'off') this.room.start();
  }

  onRoom() {
    this.ui.renderRoom();
    this.invalidate();
  }

  onPads(kind, p) {
    const g = this.game, col = rgb(p.color);
    if (g.running) {
      if (kind === 'join') g.addPlayer({ kind: 'pad', id: p.cid, name: p.name, color: col });
      else if (kind === 'leave') g.removePlayer(p.cid);
      else g.updatePlayer(p.cid, p.name, col);
    }
    if (kind === 'join') this.ui.toast(`${p.name} dołącza z telefonu.`, 2200);
    else if (kind === 'leave') this.ui.toast(`${p.name} wychodzi.`, 2200);
    this.ui.renderRoom();
    this.invalidate();
  }

  async selectWall(id) {
    const wall = this.walls.get(id);
    if (!wall) return;
    const token = ++this.wallToken;
    this.scene.flush();
    const live = wall.kind === 'live';
    let img = null;
    if (!live) {
      try { img = await this.walls.image(wall); } catch (e) { this.ui.toast('Nie udało się wczytać tego zdjęcia.', 3000); }
    }
    if (token !== this.wallToken) return;
    const st = Scene.load(id) || (live ? liveState(wall, this.projector.native) : wall.demo ? demoState(wall) : blankState(wall));
    this.live = live;
    this.photoSize = live ? [st.proj.jw, st.proj.jh] : img ? [img.naturalWidth, img.naturalHeight] : wall.size || [1600, 1000];
    this.renderer.setPhoto(img);
    this.renderer.setDirect(live);
    this.tools.sel.clear();
    this.tools.poly = null;
    this.tools.drag = null;
    this.ready = true;
    this.scene.replace(st);
    this.syncResolution();
    this.fitViews(true);
    this.saveLast();
    this.maybeRoom();
    this.room.stateChanged();
  }

  async newLiveWall() {
    const n = this.walls.list.filter(w => w.kind === 'live').length;
    const wall = this.walls.createLive(n ? `Prawdziwa ściana ${n + 1}` : 'Prawdziwa ściana');
    await this.selectWall(wall.id);
    this.setStep(2);
    this.ui.toast('Teraz okno projektora: otwórz je i przenieś na ekran projektora.', 3600);
  }

  renameWall(id, name) {
    this.walls.rename(id, name);
    this.ui.render();
  }

  loadDemo() {
    const wall = this.walls.get(this.scene.state.wallId);
    if (!wall || !wall.demo) return;
    this.tools.sel.clear();
    this.scene.replace(demoState(wall), true);
    this.fitViews(false);
    if (this.step === 5) this.restart();
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

  copyShapes(id) {
    const wall = this.walls.get(id);
    if (!wall) return;
    const src = Scene.load(id) || (wall.demo ? demoState(wall) : null);
    if (!src || !src.shapes.length) { this.ui.toast('Na tamtej ścianie nie ma jeszcze kształtów.', 2600); return; }
    const shapes = src.shapes.map(s => ({ ...clone(s), id: newId('s') }));
    const items = (src.items || []).map(i => ({ ...clone(i), id: newId('i') }));
    const cm = this.scene.state.calibCm;
    const same = Math.abs(src.calibCm.w - cm.w) < 0.05 && Math.abs(src.calibCm.h - cm.h) < 0.05;
    this.tools.sel = new Set(shapes.map(s => s.id));
    this.scene.commit('all', st => {
      st.shapes.push(...shapes);
      for (const it of items) {
        if (it.type !== 'coin') st.items = st.items.filter(i => i.type !== it.type);
        st.items.push(it);
      }
    });
    this.ui.toast(`Skopiowane kształty: ${shapes.length}. ${same ? 'Trafią w rzeczy, jeśli kalibracja była na tym samym przedmiocie.' : `Tamta kalibracja miała ${+src.calibCm.w.toFixed(1)} × ${+src.calibCm.h.toFixed(1)} cm, więc kształty mogą nie trafić.`} Cmd+Z cofa.`, 5200);
  }

  setStep(n) {
    if (n === this.step) return;
    this.step = n;
    this.tools.poly = null;
    this.tools.drag = null;
    this.input.clear();
    this.ui.hideToast();
    this.projector.message(null);
    if (n === 5) this.restart();
    else if (this.game.running) { this.game.stop(); this.buildStatic(); }
    this.views.setLayout(this.layoutFor[n]);
    this.fitViews(false);
    this.ui.hud();
    this.ui.render();
    this.saveLast();
    this.maybeRoom();
    this.room.stateChanged();
    this.invalidate();
  }

  restart() {
    this.ui.hideToast();
    if (this.step !== 5) { this.setStep(5); return; }
    if (!this.space.ok) { this.ui.toast('Kalibracja jest krzywa. Popraw krzyżyki w kroku 3.', 3200); return; }
    this.projector.message(null);
    this.buildStatic();
    this.game.start();
    this.playSig = this.playSignature();
    this.levelSig = this.levelSignature();
    this.input.clear();
    this.last = 0;
    this.ui.hud();
    this.room.stateChanged();
    this.requestFrame();
  }

  onGame(type, data) {
    this.ui.gameEvent(type, data);
  }

  onProjector(on) {
    if (!on && this.raf && this.raf.w !== window) {
      clearTimeout(this.rafGuard);
      this.raf = 0;
    }
    if (on) { this.syncResolution(); this.maybeRoom(); }
    this.ui.hudSig = null;
    this.ui.hud();
    this.ui.render();
    this.invalidate();
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
    this.applyResolution(jw, jh, false);
  }

  syncResolution() {
    const n = this.projector.native, st = this.scene.state;
    if (!this.live || !n || st.proj.auto === false) return;
    if (n[0] === st.proj.jw && n[1] === st.proj.jh) return;
    this.applyResolution(n[0], n[1], true);
  }

  applyResolution(jw, jh, auto) {
    const live = this.live;
    const fn = st => {
      const kx = jw / st.proj.jw, ky = jh / st.proj.jh;
      st.calibJ = st.calibJ.map(p => [p[0] * kx, p[1] * ky]);
      st.proj = live ? { jw, jh, auto } : { jw, jh };
      if (live) st.projQuad = liveQuad(jw, jh);
    };
    if (auto) this.scene.apply('proj', fn);
    else this.scene.commit('proj', fn);
    if (live) this.fitViews(true);
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

  insetOn() {
    return this.scene.state.settings.inset && this.step >= 2 && !this.live;
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
    this.projDirty = true;
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
    if (this.raf) return;
    const w = this.projector.frameWindow() || window;
    try {
      this.raf = { w, id: w.requestAnimationFrame(() => this.frame()) };
    } catch (e) {
      this.raf = { w: window, id: requestAnimationFrame(() => this.frame()) };
    }
    if (this.raf.w !== window) this.rafGuard = setTimeout(() => this.kick(), 250);
  }

  kick() {
    const r = this.raf;
    if (!r || r.w === window) return;
    try { r.w.cancelAnimationFrame(r.id); } catch (e) { }
    this.raf = { w: window, id: requestAnimationFrame(() => this.frame()) };
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
      inset: this.insetOn(),
      work: this.live && this.step >= 2 && this.step <= 4 ? s.work || 0 : 0,
      qr: this.room.wallQr(),
      marks: this.room.marksOn() ? this.room.markJ() : null,
    };
  }

  frame() {
    if (this.raf) {
      const r = this.raf;
      this.raf = 0;
      clearTimeout(this.rafGuard);
      try { r.w.cancelAnimationFrame(r.id); } catch (e) { }
    }
    if (!this.ready) return;
    const now = performance.now();
    const playing = this.step === 5 && this.game.running;
    if (playing) {
      const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 1 / 60;
      this.last = now;
      this.game.update(dt, this.input);
      this.time += dt;
      this.glDirty = true;
      this.projDirty = true;
    } else {
      this.last = 0;
    }
    const pr = this.projector, o = this.renderOpts();
    let prepared = false;
    const prep = () => {
      if (prepared) return;
      prepared = true;
      this.renderer.prepare(o);
    };
    const projOn = pr.visible();
    if (projOn && this.projDirty) {
      this.projDirty = false;
      prep();
      pr.render(o);
    }
    const show = document.visibilityState !== 'hidden';
    const skip = playing && projOn && this.tick++ % 3 !== 0;
    if (show && this.glDirty && !skip) {
      this.glDirty = false;
      this.paneDirty = false;
      prep();
      this.renderer.renderMain(this.views, o);
    } else if (show && this.paneDirty && !this.glDirty) {
      this.paneDirty = false;
      this.renderer.drawPanes(this.views, o);
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
