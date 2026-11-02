// Beam: the real projector. A window on the HDMI screen with its own WebGL context that renders the same scene at
// projector resolution. It is placed on the second screen through the Window Management API, goes fullscreen on a
// click, can flip the image, and hands the mouse and keys on the wall back to the editor.

const PREFS = 'beam.v1.projector';

function otherScreen(sd) {
  const cur = sd.currentScreen;
  return sd.screens.find(s => s !== cur && !s.isInternal) || sd.screens.find(s => s !== cur) || null;
}

export class Projector {
  constructor(app) {
    this.app = app;
    this.win = null;
    this.doc = null;
    this.attached = false;
    this.pipe = null;
    this.ov = null;
    this.ctx = null;
    this.wrap = null;
    this.hudEl = null;
    this.msgEl = null;
    this.k = 1;
    this.dpr = 1;
    this.native = null;
    this.single = false;
    this.perm = 'unsupported';
    this.screens = null;
    this.noFull = false;
    this.ac = null;
    this.msgTimer = 0;
    this.permWatch = false;
    this.pane = { id: 'proj', yUp: false, x: 0, y: 0, w: 1, h: 1, cx: 0, cy: 0, z: 1, fitZ: 1, on: false };
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PREFS) || '{}') || {}; } catch (e) { p = {}; }
    this.flipX = !!p.flipX;
    this.flipY = !!p.flipY;
    setInterval(() => { if (this.attached && (!this.win || this.win.closed)) this.detach(); }, 1000);
    try { window.screen.addEventListener('change', () => this.checkScreens()); } catch (e) { }
    this.checkScreens();
  }

  get isOpen() { return !!(this.win && !this.win.closed); }

  async checkScreens() {
    if ('isExtended' in window.screen) this.single = !window.screen.isExtended;
    if ('getScreenDetails' in window && navigator.permissions) {
      try {
        const st = await navigator.permissions.query({ name: 'window-management' });
        this.perm = st.state;
        if (!this.permWatch) {
          this.permWatch = true;
          st.addEventListener('change', () => this.checkScreens());
        }
        if (st.state === 'granted' && !this.screens) this.screens = await window.getScreenDetails();
      } catch (e) {
        this.perm = 'unsupported';
      }
    }
    if (this.app.ready) this.app.ui.render();
  }

  async allow() {
    try {
      this.screens = await window.getScreenDetails();
      this.perm = 'granted';
    } catch (e) {
      this.perm = 'denied';
    }
    if ('isExtended' in window.screen) this.single = !window.screen.isExtended;
    this.app.ui.render();
  }

  open() {
    if (this.isOpen) {
      this.focus();
      this.place();
      return;
    }
    const t = this.screens ? otherScreen(this.screens) : null;
    const f = t
      ? `popup,fullscreen,left=${t.availLeft},top=${t.availTop},width=${t.availWidth},height=${t.availHeight}`
      : `popup,width=960,height=540,left=${Math.round(window.screenX + 70)},top=${Math.round(window.screenY + 70)}`;
    const w = window.open('projector.html', 'beam-projector', f);
    if (!w) {
      this.app.ui.toast('Przeglądarka zablokowała okno projektora. Zezwól na wyskakujące okna dla tej strony i kliknij jeszcze raz.', 5000);
      return;
    }
    this.win = w;
    this.app.ui.render();
  }

  canPlace() { return !!(this.screens && otherScreen(this.screens)); }

  place() {
    const t = this.screens ? otherScreen(this.screens) : null;
    const w = this.win;
    if (!t || !w || w.closed) return false;
    try {
      w.moveTo(t.availLeft, t.availTop);
      w.resizeTo(t.availWidth, t.availHeight);
    } catch (e) {
      return false;
    }
    return true;
  }

  focus() {
    try { if (this.win) this.win.focus(); } catch (e) { }
  }

  close() {
    const w = this.win;
    this.detach();
    try { if (w && !w.closed) w.close(); } catch (e) { }
    this.win = null;
    this.app.ui.render();
  }

  attach(win) {
    this.release();
    this.win = win;
    const doc = this.doc = win.document;
    const fresh = id => {
      const c = doc.createElement('canvas');
      c.id = id;
      doc.getElementById(id).replaceWith(c);
      return c;
    };
    const canvas = fresh('gl');
    this.ov = fresh('ov');
    this.ctx = this.ov.getContext('2d');
    this.wrap = doc.getElementById('wrap');
    this.hudEl = doc.getElementById('hud');
    this.msgEl = doc.getElementById('msg');
    const r = this.app.renderer;
    const gl = r.makeGL(canvas, 1);
    gl.setSize(r.jw, r.jh, false);
    this.pipe = r.makePipe(gl);
    const ac = this.ac = new AbortController();
    const o = { signal: ac.signal };
    const ov = this.ov;
    ov.addEventListener('pointerdown', e => this.pointer(e, 'down'), o);
    ov.addEventListener('pointermove', e => this.pointer(e, 'move'), o);
    ov.addEventListener('pointerup', e => this.pointer(e, 'up'), o);
    ov.addEventListener('pointercancel', e => this.pointer(e, 'up'), o);
    ov.addEventListener('pointerleave', () => this.app.tools.leave(), o);
    ov.addEventListener('dblclick', e => this.pointer(e, 'dbl'), o);
    ov.addEventListener('wheel', e => e.preventDefault(), { signal: ac.signal, passive: false });
    ov.addEventListener('contextmenu', e => e.preventDefault(), o);
    win.addEventListener('keydown', e => this.key(e), o);
    win.addEventListener('keyup', e => this.key(e), o);
    win.addEventListener('blur', () => this.app.input.clear(), o);
    win.addEventListener('resize', () => this.layout(), o);
    win.addEventListener('pagehide', () => { if (this.win === win) this.detach(); }, o);
    for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) doc.addEventListener(ev, () => this.onFullscreen(), o);
    doc.addEventListener('visibilitychange', () => this.app.requestFrame(), o);
    this.attached = true;
    this.noFull = false;
    this.applyFlip();
    this.layout();
    this.hint();
    if (this.isFull()) this.measure();
    this.app.onProjector(true);
  }

  detach() {
    const was = this.attached;
    this.release();
    if (this.win && this.win.closed) this.win = null;
    if (was) this.app.onProjector(false);
  }

  release() {
    if (this.ac) this.ac.abort();
    this.ac = null;
    if (this.pipe) {
      try { this.pipe.bloom.dispose(); } catch (e) { }
      try { this.pipe.composer.dispose(); } catch (e) { }
      try { this.pipe.gl.dispose(); } catch (e) { }
    }
    this.pipe = null;
    this.attached = false;
    this.pane.on = false;
    this.ctx = null;
    this.ov = null;
    clearTimeout(this.msgTimer);
  }

  visible() {
    return this.attached && !!this.win && !this.win.closed && this.doc.visibilityState !== 'hidden';
  }

  frameWindow() {
    return this.visible() ? this.win : null;
  }

  pointer(e, kind) {
    if (kind === 'down' && e.button === 0 && !this.isFull() && !this.noFull) {
      this.fullscreen();
      return;
    }
    if (!this.app.live) return;
    const t = this.app.tools;
    if (kind === 'down') t.down(e);
    else if (kind === 'move') t.move(e);
    else if (kind === 'up') t.up(e);
    else t.dbl(e);
  }

  key(e) {
    if (e.type === 'keydown' && e.code === 'KeyF' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      this.fullscreen();
      return;
    }
    this.app.onKey(e);
  }

  isFull() {
    const d = this.doc;
    return !!(d && (d.fullscreenElement || d.webkitFullscreenElement));
  }

  fullscreen() {
    const d = this.doc;
    if (!d) return;
    const el = d.documentElement;
    try {
      if (this.isFull()) {
        (d.exitFullscreen || d.webkitExitFullscreen).call(d);
        return;
      }
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) { this.noFull = true; this.hint(); return; }
      const p = req.call(el);
      if (p && p.catch) p.catch(() => { this.noFull = true; this.hint(); });
    } catch (e) {
      this.noFull = true;
      this.hint();
    }
  }

  onFullscreen() {
    this.layout();
    this.hint();
    if (this.isFull()) this.measure();
    this.app.ui.render();
  }

  measure() {
    const w = this.win, dpr = w.devicePixelRatio || 1;
    let jw = Math.round(w.screen.width * dpr), jh = Math.round(w.screen.height * dpr);
    if (jw > 1920) {
      jh = Math.round((jh * 1920) / jw);
      jw = 1920;
    }
    if (jw < 320 || jh < 200) return;
    this.native = [jw, jh];
    this.app.syncResolution();
  }

  layout() {
    if (!this.attached) return;
    const w = this.win;
    const W = Math.max(1, w.innerWidth), Hh = Math.max(1, w.innerHeight);
    this.dpr = w.devicePixelRatio || 1;
    this.k = Math.max(1, W / 1280);
    this.ov.width = Math.round(W * this.dpr);
    this.ov.height = Math.round(Hh * this.dpr);
    const { jw, jh } = this.app.renderer;
    const z = Math.min(W / jw, Hh / jh) / this.k;
    Object.assign(this.pane, { x: 0, y: 0, w: W / this.k, h: Hh / this.k, cx: jw / 2, cy: jh / 2, z, fitZ: z, on: true });
    this.app.projDirty = true;
    this.app.overlayDirty();
  }

  local(e) {
    return [e.clientX / this.k, e.clientY / this.k];
  }

  render(o) {
    const r = this.app.renderer, gl = this.pipe.gl, c = gl.domElement;
    if (c.width !== r.jw || c.height !== r.jh) gl.setSize(r.jw, r.jh, false);
    r.renderJ(this.pipe, o, null);
  }

  overlay() {
    if (!this.attached) return null;
    const ctx = this.ctx, a = this.app;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.ov.width, this.ov.height);
    const s = this.dpr * this.k;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const cursor = a.live && a.step >= 2 ? 'none' : 'default';
    if (this.ov.style.cursor !== cursor) this.ov.style.cursor = cursor;
    return ctx;
  }

  setFlip(x, y) {
    this.flipX = !!x;
    this.flipY = !!y;
    try { localStorage.setItem(PREFS, JSON.stringify({ flipX: this.flipX, flipY: this.flipY })); } catch (e) { }
    this.applyFlip();
    this.app.ui.render();
  }

  applyFlip() {
    if (!this.wrap) return;
    this.wrap.style.transform = this.flipX || this.flipY ? `scale(${this.flipX ? -1 : 1}, ${this.flipY ? -1 : 1})` : '';
  }

  hint() {
    this.message(null);
  }

  message(title, sub = '', ms = 0) {
    const m = this.msgEl;
    if (!m || !this.attached) return;
    clearTimeout(this.msgTimer);
    if (!title && !this.isFull() && !this.noFull) {
      title = 'Kliknij tutaj';
      sub = 'Włączy się pełny ekran projektora. F przełącza, Esc wychodzi.';
    }
    if (!title) { m.classList.remove('on'); return; }
    const b = this.doc.createElement('b');
    b.textContent = title;
    const s = this.doc.createElement('span');
    s.textContent = sub;
    m.replaceChildren(b, s);
    m.classList.add('on');
    if (ms) this.msgTimer = setTimeout(() => this.message(null), ms);
  }

  hud(parts) {
    const el = this.hudEl;
    if (!el || !this.attached) return;
    if (!parts) { el.classList.remove('on'); return; }
    el.replaceChildren(...parts.map(p => {
      const s = this.doc.createElement('span');
      if (p.cls) s.className = p.cls;
      s.textContent = p.text;
      return s;
    }));
    el.classList.add('on');
  }
}
