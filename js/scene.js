// Beam: scene state, undo/redo history and local persistence.

import * as P from './math/poly.js';

export const TYPES = {
  solid: { label: 'Kolizja', hint: 'Ludzik na tym stoi i się odbija' },
  platform: { label: 'Półka', hint: 'Wskakujesz od dołu, stoisz na górze, strzałka w dół zeskakuje' },
  water: { label: 'Woda', hint: 'Pływanie, fale, wolniejsze spadanie' },
  lava: { label: 'Lawa', hint: 'Dotkniesz, wracasz na start' },
  ice: { label: 'Lód', hint: 'Ślisko, trudno wyhamować' },
  bounce: { label: 'Trampolina', hint: 'Wybija wysoko w górę' },
  lucky: { label: 'Lucky block', hint: 'Uderz od spodu, coś wypadnie' },
  screen: { label: 'Ekran', hint: 'Obraz albo efekt dopasowany do kształtu' },
  mask: { label: 'Maska', hint: 'Czarne, projektor tu nie świeci (np. telewizor, twarze)' },
};

export const SOLID_TYPES = new Set(['solid', 'ice', 'bounce', 'lucky']);

export function defaultSettings() {
  return {
    palette: 'cyber',
    theme: 'wiosna',
    decor: true,
    mode: 'precise',
    floor: true,
    ambient: 0.36,
    gain: 1.15,
    grid: true,
    calibGrid: true,
    keepMap: true,
    inset: true,
    charSize: 8,
    players: 1,
    work: 0.2,
  };
}

export function blankState(wall) {
  return {
    v: 1,
    wallId: wall?.id || 'custom',
    proj: { jw: 1280, jh: 720 },
    projQuad: wall?.projQuad ? clone(wall.projQuad) : [[60, 40], [1140, 40], [1140, 700], [60, 700]],
    calibJ: [[440, 190], [840, 190], [840, 530], [440, 530]],
    calibCm: { w: 100, h: 70 },
    calibrated: false,
    shapes: [],
    items: [],
    settings: defaultSettings(),
  };
}

let seq = 0;
export function newId(prefix = 's') {
  seq = (seq + 1) % 1e6;
  return prefix + Date.now().toString(36).slice(-5) + seq.toString(36);
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function makeShape(type, geom, extra = {}) {
  return {
    id: newId('s'),
    type,
    geom,
    quad: extra.quad || null,
    name: extra.name || '',
    props: { ...defaultProps(type), ...(extra.props || {}) },
  };
}

export function defaultProps(type) {
  switch (type) {
    case 'screen': return { effect: 'plazma', solid: false, image: null };
    case 'lucky': return { item: 'losowo', hits: 1 };
    case 'bounce': return { power: 1.6 };
    case 'water': return { waves: 1 };
    default: return {};
  }
}

export class Scene {
  constructor() {
    this.state = blankState(null);
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.pending = null;
    this.saveTimer = 0;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  emit(kind, save = true) {
    for (const fn of this.listeners) fn(kind);
    if (save) this.scheduleSave();
  }

  snap() { return JSON.stringify(this.state); }

  commit(kind, fn) {
    const before = this.snap();
    fn(this.state);
    if (this.snap() === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit(kind);
  }

  apply(kind, fn) {
    fn(this.state);
    this.emit(kind);
  }

  begin() { if (!this.pending) this.pending = this.snap(); }

  live(kind, fn) {
    fn(this.state);
    for (const l of this.listeners) l(kind, true);
  }

  end(kind) {
    if (this.pending && this.pending !== this.snap()) {
      this.undoStack.push(this.pending);
      this.redoStack.length = 0;
    }
    this.pending = null;
    this.emit(kind);
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snap());
    this.state = JSON.parse(this.undoStack.pop());
    this.emit('all');
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snap());
    this.state = JSON.parse(this.redoStack.pop());
    this.emit('all');
    return true;
  }

  replace(state, keepHistory = false) {
    if (keepHistory) { this.undoStack.push(this.snap()); this.redoStack.length = 0; }
    else { this.undoStack.length = 0; this.redoStack.length = 0; }
    this.state = state;
    this.pending = null;
    this.emit('all', keepHistory);
  }

  shape(id) { return this.state.shapes.find(s => s.id === id); }

  key(wallId) { return 'beam.v1.scene.' + (wallId || this.state.wallId); }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 400);
  }

  flush() {
    if (this.saveTimer) this.save();
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    try { localStorage.setItem(this.key(), this.snap()); } catch (e) { }
  }

  static load(wallId) {
    try {
      const raw = localStorage.getItem('beam.v1.scene.' + wallId);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1 || !Array.isArray(s.shapes)) return null;
      s.settings = { ...defaultSettings(), ...(s.settings || {}) };
      return s;
    } catch (e) {
      return null;
    }
  }
}

export function solidsOf(state, extraTest) {
  const out = [];
  for (const s of state.shapes) {
    const solid = SOLID_TYPES.has(s.type) || (s.type === 'screen' && s.props.solid);
    if (solid || (extraTest && extraTest(s))) out.push(...s.geom);
  }
  return out;
}

export function shapeBox(s) {
  return P.bbox(s.geom);
}
