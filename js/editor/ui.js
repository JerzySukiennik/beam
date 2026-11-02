// Beam: DOM interface. Step tabs, top bar, tool bar, per-step side panel, stage bar, HUD, toasts and the status line.

import { TYPES } from '../scene.js';
import { PALETTES, EFFECTS } from '../render/neon.js';
import { TOOLS, ITEM_TYPES } from './tools.js';

const STEPS = [
  { n: 1, label: 'Ściana' },
  { n: 2, label: 'Projektor' },
  { n: 3, label: 'Kalibracja' },
  { n: 4, label: 'Mapowanie' },
  { n: 5, label: 'Gra' },
];

const ICONS = {
  select: '<path d="M5 3l11 6.5-4.8 1.4L9 16z" stroke-linejoin="round"/>',
  vertex: '<path d="M4 14L8 4l8 5-5 7z" stroke-linejoin="round" opacity=".55"/><rect x="2.5" y="12.5" width="3" height="3"/><rect x="6.5" y="2.5" width="3" height="3"/><rect x="14.5" y="7.5" width="3" height="3"/><rect x="9.5" y="14.5" width="3" height="3"/>',
  quad: '<path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/><circle cx="10" cy="10" r="1.2" fill="currentColor"/>',
  rect: '<rect x="3.5" y="5" width="13" height="10" rx="1.2"/>',
  ellipse: '<ellipse cx="10" cy="10" rx="7" ry="5.5"/>',
  poly: '<path d="M4 15.5L6.5 4.5l7 3 2.5 8z" stroke-linejoin="round"/>',
  brush: '<path d="M15.6 3.4l1 1-6.8 7.9-2.1-2.1z" stroke-linejoin="round"/><path d="M7.6 10.4c-2.2 0-3.6 1.6-3.6 3.9 0 .9-.5 1.6-1 2 2.7.4 5.6-.6 5.6-3.9" stroke-linejoin="round"/>',
  line: '<path d="M4.5 15.5l11-11" stroke-width="3.4" stroke-linecap="round"/>',
  eraser: '<path d="M8.5 16.5h8M3.8 12.2l7.4-7.4a1.5 1.5 0 0 1 2.1 0l2.9 2.9a1.5 1.5 0 0 1 0 2.1l-5.7 5.7H7.6z" stroke-linejoin="round"/>',
  bucket: '<path d="M3.5 9.5L9 4l6 6-5.5 5.5a1.5 1.5 0 0 1-2.1 0L3.5 11.6a1.5 1.5 0 0 1 0-2.1z" stroke-linejoin="round"/><path d="M16.5 12.5s1.6 1.8 1.6 2.9a1.6 1.6 0 0 1-3.2 0c0-1.1 1.6-2.9 1.6-2.9z"/>',
  items: '<circle cx="10" cy="10" r="6.5"/><path d="M10 6.5v7"/>',
  undo: '<path d="M7 4.5L3.5 8 7 11.5"/><path d="M4 8h7.5a4.5 4.5 0 0 1 0 9H9"/>',
  redo: '<path d="M13 4.5L16.5 8 13 11.5"/><path d="M16 8H8.5a4.5 4.5 0 0 0 0 9H11"/>',
  fit: '<path d="M3 7.5V3h4.5M12.5 3H17v4.5M17 12.5V17h-4.5M7.5 17H3v-4.5"/>',
  full: '<path d="M8 3H3v5M12 3h5v5M17 12v5h-5M3 12v5h5"/>',
};

const icon = name => `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6">${ICONS[name]}</svg>`;

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(3)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

const $ = s => document.querySelector(s);

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.el = {
      steps: $('#steps'), topRight: $('#topRight'), toolbar: $('#toolbar'), panel: $('#panel'),
      hint: $('#hint'), coords: $('#coords'), hud: $('#hud'), toast: $('#toast'), stagebar: $('#stagebar'),
    };
    this.toastTimer = 0;
  }

  get st() { return this.app.scene.state; }
  get tools() { return this.app.tools; }

  set(key, value) {
    this.app.scene.commit('settings', st => { st.settings[key] = value; });
  }

  quiet(fn) {
    this.quietPanel = true;
    try { fn(); } finally { this.quietPanel = false; }
  }

  render() {
    this.renderSteps();
    this.renderTopRight();
    this.renderToolbar();
    this.renderStagebar();
    if (!this.quietPanel) this.renderPanel();
  }

  renderSteps() {
    const app = this.app;
    this.el.steps.replaceChildren(...STEPS.map(s => h('button', {
      class: 'step' + (app.step === s.n ? ' on' : '') + (s.n === 3 && this.st.calibrated ? ' done' : ''),
      onclick: () => app.setStep(s.n),
      title: `Krok ${s.n}: ${s.label}`,
    }, h('b', {}, s.n), h('span', {}, s.label))));
  }

  renderTopRight() {
    const st = this.st, app = this.app;
    const pal = h('select', { class: 'sel', title: 'Paleta neonów', onchange: e => this.set('palette', e.target.value) },
      ...Object.entries(PALETTES).map(([k, p]) => h('option', { value: k, selected: st.settings.palette === k }, p.name)));
    const mode = this.seg([['precise', 'Precyzyjny'], ['rubbery', 'Gumowy']], st.settings.mode, v => this.set('mode', v), 'Ruch ludzika: precyzyjny jak Mario albo gumowy jak Human Fall Flat');
    const demo = app.walls.get(st.wallId)?.demo ? h('button', { class: 'btn ghost', title: 'Wczytaj gotowe mapowanie tej ściany (da się cofnąć)', onclick: () => app.loadDemo() }, 'Demo') : null;
    const undo = h('button', { class: 'icon', title: 'Cofnij (Cmd+Z)', html: icon('undo'), onclick: () => app.scene.undo(), disabled: !app.scene.undoStack.length });
    const redo = h('button', { class: 'icon', title: 'Ponów (Shift+Cmd+Z)', html: icon('redo'), onclick: () => app.scene.redo(), disabled: !app.scene.redoStack.length });
    this.el.topRight.replaceChildren(...[h('label', { class: 'mini' }, 'Paleta', pal), mode, demo, h('span', { class: 'sep' }), undo, redo].filter(Boolean));
  }

  renderToolbar() {
    const on = this.app.step === 4;
    this.el.toolbar.classList.toggle('off', !on);
    if (!on) { this.el.toolbar.replaceChildren(); return; }
    const t = this.tools;
    const groups = [['select', 'vertex'], ['quad', 'rect', 'ellipse', 'poly'], ['brush', 'line', 'eraser', 'bucket'], ['items']];
    const kids = [];
    groups.forEach((g, i) => {
      if (i) kids.push(h('span', { class: 'tsep' }));
      for (const id of g) {
        const d = TOOLS.find(q => q.id === id);
        kids.push(h('button', { class: 'tool' + (t.tool === id ? ' on' : ''), title: `${d.label} (${d.key.toUpperCase()})`, html: icon(id), onclick: () => t.setTool(id) }));
      }
    });
    this.el.toolbar.replaceChildren(...kids);
  }

  renderStagebar() {
    const app = this.app, v = app.views;
    const lay = this.seg([['room', 'Pokój'], ['split', 'Oba'], ['editor', 'Ściana']], v.layout, val => app.setLayout(val), 'Układ widoków');
    const fit = h('button', { class: 'icon', title: 'Dopasuj widok (0)', html: icon('fit'), onclick: () => app.fitViews(true) });
    const full = h('button', { class: 'icon', title: 'Pełny ekran (F)', html: icon('full'), onclick: () => app.fullscreen() });
    this.el.stagebar.replaceChildren(lay, fit, full);
  }

  seg(options, value, onPick, title) {
    return h('div', { class: 'seg', title }, ...options.map(([v, label]) => h('button', { class: value === v ? 'on' : '', onclick: () => onPick(v) }, label)));
  }

  toggle(label, value, onChange, hint) {
    const input = h('input', { type: 'checkbox', checked: !!value, onchange: e => onChange(e.target.checked) });
    return h('label', { class: 'toggle', title: hint || '' }, input, h('span', { class: 'knob' }), h('span', { class: 'tl' }, label));
  }

  slider(label, value, min, max, step, onLive, fmt = v => v, kind = 'settings') {
    const out = h('span', { class: 'val' }, fmt(value));
    let live = false;
    const input = h('input', {
      type: 'range', min, max, step, value,
      oninput: e => {
        const v = +e.target.value;
        if (!live) { this.app.scene.begin(); live = true; }
        out.textContent = fmt(v);
        this.app.scene.live(kind, st => onLive(st, v));
      },
      onchange: () => { live = false; this.quiet(() => this.app.scene.end(kind)); },
    });
    return h('label', { class: 'slider' }, h('span', { class: 'sl' }, label, out), input);
  }

  card(title, ...kids) {
    return h('section', { class: 'card' }, title ? h('h3', {}, title) : null, ...kids);
  }

  renderPanel() {
    const p = this.el.panel;
    const scroll = p.scrollTop;
    const step = this.app.step;
    const kids = step === 1 ? this.panelWall() : step === 2 ? this.panelProj() : step === 3 ? this.panelCalib() : step === 4 ? this.panelMap() : this.panelPlay();
    p.replaceChildren(...kids);
    p.scrollTop = scroll;
    this.hint(this.tools.hint());
  }

  panelWall() {
    const app = this.app, st = this.st;
    const grid = h('div', { class: 'walls' });
    for (const w of app.walls.list) {
      const img = h('img', { alt: '', src: w.builtin ? w.src : null, loading: 'lazy' });
      if (!w.builtin) app.walls.thumb(w).then(src => { img.src = src; }).catch(() => { });
      const card = h('button', { class: 'wall' + (w.id === st.wallId ? ' on' : ''), onclick: () => app.selectWall(w.id) }, img, h('span', {}, w.name));
      if (!w.builtin) card.append(h('i', { class: 'x', title: 'Usuń to zdjęcie', onclick: e => { e.stopPropagation(); app.removeWall(w.id); } }, '×'));
      grid.append(card);
    }
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => { const f = e.target.files[0]; if (f) app.uploadWall(f); e.target.value = ''; } });
    const wall = app.walls.get(st.wallId);
    const credit = wall && wall.credit ? h('p', { class: 'fine' }, 'Zdjęcie: ', h('a', { href: wall.credit.url, target: '_blank', rel: 'noopener' }, wall.credit.author), ` (${wall.credit.license})`) : null;
    return [
      this.card('1. Ściana',
        h('p', {}, 'Wybierz zdjęcie ściany. Beam udaje na nim światło projektora, więc grę zaprojektujesz bez sprzętu.'),
        grid,
        h('button', { class: 'btn wide', onclick: () => file.click() }, 'Wgraj zdjęcie swojej ściany'),
        file,
        h('p', { class: 'fine' }, 'Najlepiej z miejsca, gdzie stanie projektor, na wprost i bez lampy błyskowej.'),
        credit),
      this.card('Pokój',
        this.slider('Światło w pokoju', st.settings.ambient, 0.05, 1, 0.01, (s, v) => { s.settings.ambient = v; }, v => Math.round(v * 100) + '%'),
        h('p', { class: 'fine' }, 'Im ciemniej, tym mocniej świeci neon. Projektor najlepiej wygląda przy zgaszonym świetle.')),
      this.card(null, h('button', { class: 'btn primary wide', onclick: () => app.setStep(2) }, 'Dalej: projektor')),
    ];
  }

  panelProj() {
    const app = this.app, st = this.st;
    const res = h('select', { class: 'sel', onchange: e => app.setResolution(e.target.value) },
      ...['854x480', '1280x720', '1920x1080'].map(r => h('option', { value: r, selected: `${st.proj.jw}x${st.proj.jh}` === r }, r.replace('x', '×'))));
    return [
      this.card('2. Projektor',
        h('p', {}, 'Przeciągnij rogi obrazu tam, gdzie pada światło projektora. W prawdziwym pokoju ten krok robi sam projektor, tu go udajesz.'),
        h('div', { class: 'row wrap' },
          ...[['front', 'Na wprost'], ['left', 'Z lewej'], ['right', 'Z prawej'], ['below', 'Z dołu']].map(([k, l]) => h('button', { class: 'btn small', onclick: () => app.setProjPreset(k) }, l)),
          app.walls.get(st.wallId)?.demo ? h('button', { class: 'btn small', onclick: () => app.setProjPreset('wall') }, 'Jak w demo') : null),
        this.toggle('Mapowanie zostaje na ścianie', st.settings.keepMap, v => this.set('keepMap', v), 'Wyłączone pokazuje, co się dzieje, gdy ktoś trąci projektor: wszystko się rozjeżdża i trzeba skalibrować od nowa.'),
        h('p', { class: 'fine' }, st.settings.keepMap ? 'Przy przesuwaniu Beam od razu kalibruje się od nowa, więc kształty trzymają się przedmiotów.' : 'Tak jak w realu: przesunięty projektor przesuwa cały obraz. Wtedy krok 3 i gotowe.')),
      this.card('Obraz',
        this.slider('Moc projektora', st.settings.gain, 0.3, 2.4, 0.01, (s, v) => { s.settings.gain = v; }, v => Math.round(v * 100) + '%'),
        h('label', { class: 'field' }, h('span', {}, 'Rozdzielczość'), res),
        this.toggle('Obraz testowy', app.testPattern, v => { app.testPattern = v; app.invalidate(); this.renderPanel(); }, 'Siatka, ramka i kolorowe rogi, jak w menu projektora'),
        this.toggle('Podgląd HDMI w rogu', st.settings.inset, v => this.set('inset', v))),
      this.card(null, h('button', { class: 'btn primary wide', onclick: () => app.setStep(3) }, 'Dalej: kalibracja')),
    ];
  }

  panelCalib() {
    const app = this.app, st = this.st;
    const num = (key, label) => h('label', { class: 'field num' }, h('span', {}, label), h('input', {
      type: 'number', min: 1, max: 1000, step: 0.1, value: st.calibCm[key],
      onchange: e => { const v = Math.max(1, Math.min(1000, +e.target.value || 1)); e.target.value = v; this.quiet(() => app.scene.commit('calib', s => { s.calibCm[key] = v; s.calibrated = true; })); },
    }), h('i', {}, 'cm'));
    const presets = [['A4', 21, 29.7], ['A3', 29.7, 42], ['30×40', 30, 40], ['50×70', 50, 70], ['70×100', 70, 100]];
    return [
      this.card('3. Kalibracja',
        h('ol', { class: 'steps' },
          h('li', {}, 'Wybierz na ścianie coś prostokątnego: ramę, plakat, kartkę A4.'),
          h('li', {}, 'Przeciągnij 4 kolorowe krzyżyki na jego rogi. Niebieski to lewy górny, zielony lewy dolny.'),
          h('li', {}, 'Wpisz prawdziwe wymiary w centymetrach.')),
        h('div', { class: 'row' }, num('w', 'Szerokość'), num('h', 'Wysokość')),
        h('div', { class: 'row wrap' }, ...presets.map(([l, w, hh]) => h('button', { class: 'btn small', onclick: () => app.scene.commit('calib', s => { s.calibCm = { w, h: hh }; s.calibrated = true; }) }, l))),
        this.toggle('Siatka 10 cm na ścianie', st.settings.calibGrid, v => this.set('calibGrid', v)),
        h('p', { class: 'fine' }, 'Strzałki przesuwają zaznaczony krzyżyk o 1 piksel projektora, Shift o 10. Tab przełącza krzyżyk.')),
      this.card('Po co to',
        h('p', {}, 'Po kalibracji pion jest pionem, a centymetr w edytorze to centymetr na ścianie. Jak ktoś trąci projektor, wystarczy znowu ustawić krzyżyki na tej samej ramie i wszystko wraca na miejsce.')),
      this.card(null, h('button', { class: 'btn primary wide', onclick: () => app.setStep(4) }, 'Gotowe, mapuj')),
    ];
  }

  typeGrid() {
    const t = this.tools, pal = PALETTES[this.st.settings.palette] || PALETTES.cyber;
    const sel = t.selected();
    const cur = sel.length ? (sel.every(s => s.type === sel[0].type) ? sel[0].type : null) : t.type;
    return h('div', { class: 'types' }, ...Object.entries(TYPES).map(([k, d], i) => h('button', {
      class: 'type' + (cur === k ? ' on' : ''), title: `${d.hint} (${i + 1})`, onclick: () => t.setType(k),
    }, h('i', { class: 'sw' + (k === 'mask' ? ' mask' : ''), style: k === 'mask' ? null : `--c:${pal[k]}` }), h('span', {}, d.label))));
  }

  panelMap() {
    const app = this.app, t = this.tools, st = this.st;
    const sel = t.selected();
    const kids = [];
    kids.push(this.card(sel.length ? (sel.length === 1 ? 'Typ zaznaczonego' : `Typ zaznaczonych (${sel.length})`) : 'Nowy kształt jako', this.typeGrid(),
      h('p', { class: 'fine' }, TYPES[sel[0]?.type || t.type]?.hint || '')));
    const toolDef = TOOLS.find(q => q.id === t.tool);
    const tk = [];
    if (['rect', 'ellipse', 'poly', 'quad', 'brush', 'line', 'bucket'].includes(t.tool)) {
      tk.push(this.seg([['new', 'Nowy'], ['add', 'Dodaj'], ['sub', 'Wytnij'], ['int', 'Wspólne']], t.bool, v => { t.bool = v; this.renderPanel(); }, 'Co robi nowy kształt z zaznaczonym'));
      tk.push(h('p', { class: 'fine' }, 'Shift: dodaj do zaznaczonego. Alt: wytnij z zaznaczonego albo z tego, co pod spodem. Prostokąt i wycięty mniejszy prostokąt to ramka.'));
    }
    if (['brush', 'line', 'eraser'].includes(t.tool)) {
      const out = h('span', { class: 'val' }, t.brush.toFixed(1) + ' cm');
      tk.push(h('label', { class: 'slider' }, h('span', { class: 'sl' }, 'Grubość', out), h('input', {
        type: 'range', min: 0.3, max: 8, step: 0.1, value: t.brush,
        oninput: e => { t.brush = +e.target.value; out.textContent = t.brush.toFixed(1) + ' cm'; app.overlayDirty(); },
      })));
    }
    if (t.tool === 'items') {
      tk.push(this.seg(Object.entries(ITEM_TYPES), t.itemType, v => { t.itemType = v; this.renderPanel(); }, 'Co stawiasz'));
      tk.push(h('p', { class: 'fine' }, 'Start i meta są pojedyncze, monet ile chcesz.'));
    }
    kids.push(this.card(toolDef ? toolDef.label : 'Narzędzie', ...tk, h('p', { class: 'fine' }, toolDef ? toolDef.hint : '')));
    if (sel.length) kids.push(this.selectedCard(sel));
    const pal = PALETTES[st.settings.palette] || PALETTES.cyber;
    const list = h('div', { class: 'list' }, ...st.shapes.slice().reverse().map(s => h('button', {
      class: 'li' + (t.sel.has(s.id) ? ' on' : ''),
      'data-id': s.id,
      onclick: e => { if (e.shiftKey) { t.sel.has(s.id) ? t.sel.delete(s.id) : t.sel.add(s.id); } else t.sel = new Set([s.id]); t.selChanged(); },
    }, h('i', { class: 'dot' + (s.type === 'mask' ? ' mask' : ''), style: s.type === 'mask' ? null : `--c:${pal[s.type]}` }), h('span', {}, s.name || TYPES[s.type].label), h('em', {}, TYPES[s.type].label))));
    kids.push(this.card(`Kształty (${st.shapes.length})`, st.shapes.length ? list : h('p', { class: 'fine' }, 'Pusto. Weź Narożniki (Q) i kliknij 4 rogi ramy na zdjęciu.')));
    kids.push(this.card('Przyciąganie',
      this.toggle('Do punktów innych kształtów', t.snapPts, v => { t.snapPts = v; }),
      this.toggle('Do siatki 0,5 cm (w widoku ściany)', t.snapGrid, v => { t.snapGrid = v; }),
      this.toggle('Siatka w widoku ściany', st.settings.grid, v => this.set('grid', v))));
    kids.push(this.card(null, h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => app.setStep(5) }, 'Graj'),
      h('button', { class: 'btn ghost', title: 'Usuwa wszystkie kształty i przedmioty (Cmd+Z przywraca)', onclick: () => app.clearWall() }, 'Wyczyść ścianę'))));
    return kids;
  }

  selectedCard(sel) {
    const app = this.app, t = this.tools;
    const kids = [];
    if (sel.length === 1) {
      const s = sel[0];
      kids.push(h('label', { class: 'field' }, h('span', {}, 'Nazwa'), h('input', {
        type: 'text', value: s.name || '', maxlength: 40,
        onchange: e => {
          const name = e.target.value.trim();
          this.quiet(() => app.scene.commit('shapes', st => { const q = st.shapes.find(x => x.id === s.id); if (q) q.name = name; }));
          const li = this.el.panel.querySelector(`.li[data-id="${s.id}"] span`);
          if (li) li.textContent = name || TYPES[s.type].label;
        },
      })));
      const prop = (key, value) => app.scene.commit('shapes', st => { const q = st.shapes.find(x => x.id === s.id); if (q) q.props[key] = value; });
      if (s.type === 'screen') {
        kids.push(h('label', { class: 'field' }, h('span', {}, 'Na ekranie'), h('select', { class: 'sel', onchange: e => prop('effect', e.target.value) },
          ...Object.entries(EFFECTS).map(([k, l]) => h('option', { value: k, selected: s.props.effect === k }, l)))));
        if (s.props.effect === 'obraz') {
          const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => { const f = e.target.files[0]; if (f) app.screenImage(s.id, f); } });
          kids.push(h('button', { class: 'btn small', onclick: () => file.click() }, s.props.image ? 'Zmień obraz' : 'Wybierz obraz'), file);
        }
        kids.push(this.toggle('Twardy, można na nim stanąć', s.props.solid, v => prop('solid', v)));
        kids.push(h('p', { class: 'fine' }, s.quad ? 'Obraz jest dopasowany do 4 narożników.' : 'Obraz rozciąga się na prostokąt wokół kształtu. Narzędzie Narożniki dopasuje go do perspektywy.'));
      }
      if (s.type === 'lucky') {
        kids.push(h('label', { class: 'field' }, h('span', {}, 'Co wypada'), h('select', { class: 'sel', onchange: e => prop('item', e.target.value) },
          ...[['losowo', 'Losowo'], ['moneta', 'Moneta'], ['grzyb', 'Grzybek (rośniesz)'], ['pioro', 'Piórko (podwójny skok)'], ['gwiazda', 'Gwiazda (nieśmiertelność)']].map(([k, l]) => h('option', { value: k, selected: s.props.item === k }, l)))));
      }
      if (s.type === 'bounce') {
        kids.push(this.slider('Siła wybicia', s.props.power || 1.6, 1.1, 2.4, 0.05, (st, v) => { const q = st.shapes.find(x => x.id === s.id); if (q) q.props.power = v; }, v => '×' + v.toFixed(2), 'shapes'));
      }
    }
    const b = (label, op, title) => h('button', { class: 'btn small', title: title || '', onclick: () => t.op(op) }, label);
    const many = sel.length > 1;
    kids.push(h('div', { class: 'ops' },
      many ? b('Połącz', 'union', 'Scala zaznaczone w jeden kształt') : null,
      many ? b('Wytnij', 'diff', 'Z najniższego wycina pozostałe') : null,
      many ? b('Wspólne', 'inter', 'Zostawia tylko część wspólną') : null,
      b('+1 cm', 'grow', 'Pogrubia o 1 cm'),
      b('−1 cm', 'shrink', 'Odchudza o 1 cm'),
      b('Zaokrąglij', 'round'),
      b('Uprość', 'simplify', 'Mniej punktów'),
      b('Odbij ↔', 'mirrorX'),
      b('Odbij ↕', 'mirrorY'),
      h('button', { class: 'btn small', title: 'Cmd+D', onclick: () => t.duplicate() }, 'Duplikuj'),
      b('Na wierzch', 'front'),
      b('Na spód', 'back'),
      h('button', { class: 'btn small', title: 'Delete', onclick: () => t.remove() }, 'Usuń')));
    return this.card(sel.length === 1 ? 'Zaznaczony kształt' : `Zaznaczone (${sel.length})`, ...kids);
  }

  panelPlay() {
    const app = this.app, st = this.st;
    this.stats = h('div', { class: 'stats' });
    this.updateStats();
    return [
      this.card('5. Gra',
        h('button', { class: 'btn primary wide big', onclick: () => app.restart() }, 'Od nowa (R)'),
        this.stats),
      this.card('Ruch',
        this.seg([['precise', 'Precyzyjny'], ['rubbery', 'Gumowy']], st.settings.mode, v => this.set('mode', v)),
        h('p', { class: 'fine' }, st.settings.mode === 'rubbery' ? 'Jak Human Fall Flat: chwiejny ludzik na sprężynach. Shift podnosi ręce i łapie krawędzie, puść, żeby skoczyć.' : 'Jak Mario: ostre sterowanie, skok zależy od tego, jak długo trzymasz.')),
      this.card('Gracze',
        this.seg([[1, '1 gracz'], [2, '2 graczy']], st.settings.players, v => this.set('players', v)),
        h('table', { class: 'keys' },
          h('tr', {}, h('th', {}, ''), h('th', {}, 'Ruch'), h('th', {}, 'Skok'), h('th', {}, 'Zeskok'), h('th', {}, 'Chwyt')),
          h('tr', {}, h('td', {}, 'P1'), h('td', {}, '← →'), h('td', {}, st.settings.players > 1 ? '↑' : '↑ / Spacja'), h('td', {}, '↓'), h('td', {}, st.settings.players > 1 ? 'Prawy Shift' : 'Shift')),
          st.settings.players > 1 ? h('tr', {}, h('td', {}, 'P2'), h('td', {}, 'A D'), h('td', {}, 'W'), h('td', {}, 'S'), h('td', {}, 'E')) : null)),
      this.card('Ludzik',
        this.slider('Wielkość', st.settings.charSize, 5, 14, 0.5, (s, v) => { s.settings.charSize = v; }, v => v + ' cm')),
      this.card('Dekoracje',
        this.toggle('Automatyczne dekoracje', st.settings.decor, v => this.set('decor', v)),
        this.seg([['wiosna', 'Wiosna'], ['zima', 'Zima'], ['dzungla', 'Dżungla']], st.settings.theme, v => this.set('theme', v)),
        h('p', { class: 'fine' }, 'Trawa ugina się pod ludzikiem, śnieg sypie, liany się bujają. Rosną same na tym, co zmapujesz.')),
      this.card('Świat',
        this.toggle('Dół światła to podłoga', st.settings.floor, v => this.set('floor', v), 'Wyłączone: spadasz w przepaść i wracasz na start')),
    ];
  }

  updateStats(d) {
    if (!this.stats) return;
    const g = this.app.game;
    const hud = d || g.hud();
    this.stats.replaceChildren(
      h('div', {}, h('b', {}, hud.coins), h('span', {}, 'monet')),
      h('div', {}, h('b', {}, hud.total ? hud.left : '–'), h('span', {}, 'zostało')),
      h('div', {}, h('b', {}, fmtTime(hud.time)), h('span', {}, 'czas')));
  }

  hud() {
    const app = this.app;
    const on = app.step === 5 && app.game.running;
    this.el.hud.classList.toggle('on', on);
    if (!on) return;
    const d = app.game.hud();
    const pw = [];
    d.powers.forEach((p, i) => {
      if (p.big > 0) pw.push(h('i', { class: 'pw big' }, `P${i + 1} duży ${Math.ceil(p.big)}`));
      if (p.feather > 0) pw.push(h('i', { class: 'pw feather' }, `P${i + 1} piórko ${Math.ceil(p.feather)}`));
      if (p.star > 0) pw.push(h('i', { class: 'pw star' }, `P${i + 1} gwiazda ${Math.ceil(p.star)}`));
    });
    const sig = `${d.coins}|${d.left}|${d.time.toFixed(1)}|${pw.map(x => x.textContent).join()}`;
    if (sig === this.hudSig) return;
    this.hudSig = sig;
    this.el.hud.replaceChildren(...[
      h('span', { class: 'coin' }, '● ', d.coins),
      d.total ? h('span', {}, `zostało ${d.left}`) : null,
      h('span', { class: 'time' }, fmtTime(d.time)),
      ...pw].filter(Boolean));
    if (this.stats && Math.random() < 0.2) this.updateStats(d);
  }

  gameEvent(type, data) {
    if (type === 'finish') {
      const parts = [`Czas ${fmtTime(data.time)}`];
      if (data.total) parts.push(`monety ${data.coins}${data.left === 0 ? ', wszystkie!' : ''}`);
      this.toast(h('div', {}, h('b', {}, data.left === 0 && data.total ? 'Perfekcyjnie!' : 'Meta!'), h('span', {}, parts.join(' · ')), h('button', { class: 'btn primary small', onclick: () => this.app.restart() }, 'Jeszcze raz (R)')), 0);
      this.updateStats(data);
    } else if (type === 'power') {
      const names = { mushroom: 'Grzybek: rośniesz', feather: 'Piórko: podwójny skok i szybowanie', star: 'Gwiazda: lawa nie parzy' };
      this.toast(names[data.type] || '', 1800);
    } else if (type === 'coin') {
      this.updateStats(data);
    }
  }

  toast(content, ms = 2000) {
    clearTimeout(this.toastTimer);
    const t = this.el.toast;
    t.replaceChildren(typeof content === 'string' ? h('span', {}, content) : content);
    t.classList.add('on');
    if (ms) this.toastTimer = setTimeout(() => t.classList.remove('on'), ms);
  }

  hideToast() {
    clearTimeout(this.toastTimer);
    this.el.toast.classList.remove('on');
  }

  hint(text) {
    this.el.hint.textContent = text || '';
  }

  coords(w) {
    this.el.coords.textContent = w ? `x ${w[0].toFixed(1)}  y ${w[1].toFixed(1)} cm` : '';
  }
}
