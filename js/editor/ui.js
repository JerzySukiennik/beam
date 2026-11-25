// Beam: DOM interface. Step tabs, top bar, tool bar, per-step side panel, stage bar, HUD, toasts, the status line,
// the room for phones (QR code, who is connected) and the round: game mode, countdown, scores and results.

import { TYPES } from '../scene.js';
import { PALETTES, EFFECTS } from '../render/neon.js';
import { TOOLS, ITEM_TYPES } from './tools.js';
import { PLAYS, PLAY_HINTS, BATTLE_TO, COLLECT_TIME, fmtTime } from '../game/match.js';
import { LOOKS } from '../game/figure.js';

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
  projector: '<rect x="2.5" y="7" width="10.5" height="7" rx="1.6"/><circle cx="7.6" cy="10.5" r="1.9"/><path d="M13 9.2l4.5-2.4v7.4L13 11.8" stroke-linejoin="round"/>',
  phone: '<rect x="5.5" y="2.5" width="9" height="15" rx="2"/><path d="M8.6 14.6h2.8"/>',
};

const CONN = { rtc: 'bezpośrednio', relay: 'przez serwer', local: 'ta przeglądarka' };

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
    const pr = app.projector;
    const proj = app.live || pr.attached ? h('button', {
      class: 'btn ghost pbtn' + (pr.attached ? ' on' : ''),
      title: pr.attached ? 'Okno projektora jest połączone. Klik: pokaż je.' : 'Otwórz okno projektora na drugim ekranie',
      onclick: () => (pr.attached ? pr.focus() : pr.open()),
    }, h('i', { class: 'pdot' }), 'Projektor') : null;
    const room = app.room;
    const phones = h('button', {
      class: 'btn ghost rbtn' + (room.state === 'online' ? ' on' : ''),
      title: 'Telefony jako pady i edytor ściany: pokaż kod QR',
      onclick: () => this.openModal(),
    }, h('i', { html: icon('phone') }), room.state === 'online' ? `${room.code} · ${room.roster().length}` : 'Telefony');
    this.el.topRight.replaceChildren(...[proj, phones, h('label', { class: 'mini' }, 'Paleta', pal), mode, demo, h('span', { class: 'sep' }), undo, redo].filter(Boolean));
  }

  renderRoom() {
    this.renderTopRight();
    for (const el of this.el.panel.querySelectorAll('.roombox')) el.replaceChildren(...this.roomBody());
    if (this.modal) this.renderModal();
  }

  roomBody() {
    const app = this.app, room = app.room;
    if (room.state === 'off') {
      return [
        h('p', {}, 'Telefony robią za pady (do 8 osób) i za edytor ściany. Wystarczy zeskanować kod aparatem.'),
        h('button', { class: 'btn wide ibtn', onclick: () => room.start() }, h('i', { html: icon('phone') }), 'Otwórz pokój dla telefonów'),
      ];
    }
    if (room.state === 'opening') return [h('p', { class: 'fine' }, 'Otwieram pokój...')];
    if (room.state === 'error' || room.state === 'offline') {
      return [
        h('p', { class: 'warn' }, 'Nie udało się otworzyć pokoju. Sprawdź internet.'),
        h('button', { class: 'btn wide', onclick: () => room.retry() }, 'Spróbuj jeszcze raz'),
      ];
    }
    const pads = room.roster();
    const list = pads.length
      ? h('div', { class: 'pads' }, ...pads.map(p => h('div', { class: 'pad' },
        h('i', { class: 'dot', style: `--c:${p.color}` }),
        h('b', {}, p.name),
        h('em', {}, (p.tab === 'edit' ? 'edytuje · ' : '') + (CONN[p.conn] || 'łączy się')),
        h('button', { class: 'x', title: 'Rozłącz ten telefon', onclick: () => room.kick(p.cid) }, '×'))))
      : h('p', { class: 'fine' }, 'Nikt jeszcze nie dołączył.');
    const corners = [['tl', '↖'], ['tr', '↗'], ['bl', '↙'], ['br', '↘']];
    return [
      h('div', { class: 'qrrow' },
        h('button', { class: 'qr', title: 'Pokaż duży kod', onclick: () => this.openModal() }, room.qr && room.qr.img ? h('img', { src: room.qr.img, alt: 'Kod QR pokoju' }) : null),
        h('div', { class: 'qrinfo' },
          h('span', { class: 'fine' }, 'Kod pokoju'),
          h('b', { class: 'code' }, room.code),
          h('span', { class: 'fine' }, `${pads.length} z 8 telefonów`))),
      this.toggle('Kod QR na ścianie', room.onWall, v => { room.setWall(v); this.renderRoom(); }, 'Biała karta z kodem w rogu obrazu, w krokach 4 i 5'),
      room.onWall ? h('div', { class: 'row' }, h('span', { class: 'fine' }, 'Róg'), this.seg(corners, room.corner, v => { room.setCorner(v); this.renderRoom(); })) : null,
      list,
      h('button', { class: 'btn ghost small', onclick: () => room.stop() }, 'Zamknij pokój'),
    ];
  }

  openModal() {
    const room = this.app.room;
    if (room.state === 'off' || room.state === 'error' || room.state === 'offline') room.retry();
    if (!this.modal) {
      this.modal = h('div', { class: 'modal', onclick: e => { if (e.target === this.modal) this.closeModal(); } });
      this.onModalKey = e => { if (e.key === 'Escape') this.closeModal(); };
      window.addEventListener('keydown', this.onModalKey);
      document.body.append(this.modal);
    }
    this.renderModal();
  }

  closeModal() {
    if (!this.modal) return;
    window.removeEventListener('keydown', this.onModalKey);
    this.modal.remove();
    this.modal = null;
  }

  renderModal() {
    const room = this.app.room;
    const ok = room.state === 'online' && room.qr;
    const body = ok
      ? [
        room.qr.img ? h('img', { class: 'bigqr', src: room.qr.img, alt: 'Kod QR pokoju' }) : null,
        h('b', { class: 'code big' }, room.code),
        h('p', {}, 'Zeskanuj aparatem w telefonie. Albo wejdź na ', h('a', { href: room.url(), target: '_blank', rel: 'noopener' }, room.url().replace(/^https?:\/\//, '').replace(/\?.*$/, '')), ' i wpisz kod.'),
        h('p', { class: 'fine' }, 'Telefon to pad do sterowania ludzikiem albo edytor kształtów na ścianie. Do 8 osób naraz.')]
      : room.state === 'error' || room.state === 'offline'
        ? [h('p', { class: 'warn' }, 'Nie udało się otworzyć pokoju. Sprawdź internet.'), h('button', { class: 'btn', onclick: () => room.retry() }, 'Spróbuj jeszcze raz')]
        : [h('p', {}, 'Otwieram pokój...')];
    this.modal.replaceChildren(h('div', { class: 'sheet' },
      h('button', { class: 'close', title: 'Zamknij (Esc)', onclick: () => this.closeModal() }, '×'),
      h('h3', {}, 'Telefony'),
      ...body));
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

  workSlider() {
    return [
      this.slider('Światło robocze', this.st.settings.work || 0, 0, 0.6, 0.01, (s, v) => { s.settings.work = v; }, v => (v ? Math.round(v * 100) + '%' : 'wyłączone')),
      h('p', { class: 'fine' }, 'Szare światło w krokach 2 do 4, żeby po ciemku widzieć ścianę i rzeczy na niej. W grze znika.'),
    ];
  }

  panelWall() {
    const app = this.app, st = this.st;
    const lives = app.walls.list.filter(w => w.kind === 'live');
    const list = h('div', { class: 'lwalls' }, ...lives.map(w => h('button', { class: 'lw' + (w.id === st.wallId ? ' on' : ''), onclick: () => app.selectWall(w.id) },
      h('i', { class: 'pico', html: icon('projector') }),
      h('span', {}, w.name),
      h('i', { class: 'x', title: 'Usuń tę ścianę razem z mapowaniem', onclick: e => { e.stopPropagation(); app.removeWall(w.id); } }, '×'))));
    const cur = app.walls.get(st.wallId);
    const rename = app.live && cur ? h('label', { class: 'field' }, h('span', {}, 'Nazwa ściany'), h('input', {
      type: 'text', value: cur.name, maxlength: 30,
      onchange: e => app.renameWall(cur.id, e.target.value),
    })) : null;
    const liveCard = this.card('1. Prawdziwa ściana',
      h('p', {}, 'Masz projektor? Podłącz go przez HDMI, a gra pojawi się prosto na ścianie. Kalibrujesz na kartce A4 i mapujesz to, co widzisz.'),
      lives.length ? list : null,
      rename,
      h('button', { class: 'btn wide ibtn', onclick: () => app.newLiveWall() }, h('i', { html: icon('projector') }), lives.length ? 'Nowa prawdziwa ściana' : 'Zacznij na prawdziwej ścianie'));
    const grid = h('div', { class: 'walls' });
    for (const w of app.walls.list) {
      if (w.kind === 'live') continue;
      const img = h('img', { alt: '', src: w.builtin ? w.src : null, loading: 'lazy' });
      if (!w.builtin) app.walls.thumb(w).then(src => { img.src = src; }).catch(() => { });
      const card = h('button', { class: 'wall' + (w.id === st.wallId ? ' on' : ''), onclick: () => app.selectWall(w.id) }, img, h('span', {}, w.name));
      if (!w.builtin) card.append(h('i', { class: 'x', title: 'Usuń to zdjęcie', onclick: e => { e.stopPropagation(); app.removeWall(w.id); } }, '×'));
      grid.append(card);
    }
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: e => { const f = e.target.files[0]; if (f) app.uploadWall(f); e.target.value = ''; } });
    const wall = app.walls.get(st.wallId);
    const credit = wall && wall.credit ? h('p', { class: 'fine' }, 'Zdjęcie: ', h('a', { href: wall.credit.url, target: '_blank', rel: 'noopener' }, wall.credit.author), ` (${wall.credit.license})`) : null;
    const photoCard = this.card('Albo symulacja na zdjęciu',
      h('p', {}, 'Wybierz zdjęcie ściany. Beam udaje na nim światło projektora, więc grę zaprojektujesz bez sprzętu.'),
      grid,
      h('button', { class: 'btn wide', onclick: () => file.click() }, 'Wgraj zdjęcie swojej ściany'),
      file,
      h('p', { class: 'fine' }, 'Najlepiej z miejsca, gdzie stanie projektor, na wprost i bez lampy błyskowej.'),
      credit);
    return [
      liveCard,
      photoCard,
      app.live ? null : this.card('Pokój',
        this.slider('Światło w pokoju', st.settings.ambient, 0.05, 1, 0.01, (s, v) => { s.settings.ambient = v; }, v => Math.round(v * 100) + '%'),
        h('p', { class: 'fine' }, 'Im ciemniej, tym mocniej świeci neon. Projektor najlepiej wygląda przy zgaszonym świetle.')),
      this.card(null, h('button', { class: 'btn primary wide', onclick: () => app.setStep(2) }, 'Dalej: projektor')),
    ];
  }

  panelLive() {
    const app = this.app, st = this.st, pr = app.projector;
    const cur = `${st.proj.jw}x${st.proj.jh}`, nat = pr.native ? pr.native.join('x') : null;
    const sizes = ['854x480', '1280x720', '1920x1080'];
    for (const s of [nat, cur]) if (s && !sizes.includes(s)) sizes.push(s);
    const res = h('select', { class: 'sel', onchange: e => app.setResolution(e.target.value) },
      ...sizes.map(r => h('option', { value: r, selected: cur === r }, r.replace('x', '×') + (r === nat ? ' (ekran projektora)' : ''))));
    const full = pr.isFull();
    const status = pr.attached
      ? (full ? 'Połączony, pełny ekran na projektorze.' : 'Połączony. Kliknij w obraz na ścianie, żeby włączyć pełny ekran.')
      : pr.isOpen ? 'Okno otwarte, łączę...' : 'Okno projektora jest zamknięte.';
    let action;
    if (pr.attached) {
      action = h('div', { class: 'row' },
        pr.canPlace() ? h('button', { class: 'btn', onclick: () => { pr.place(); pr.focus(); } }, 'Przenieś na projektor') : null,
        h('button', { class: 'btn ghost', onclick: () => pr.close() }, 'Zamknij okno'));
    } else if (pr.perm === 'prompt' && !pr.single && !pr.isOpen) {
      action = h('div', { class: 'col' },
        h('button', { class: 'btn primary wide', onclick: () => pr.allow() }, 'Pozwól przenieść okno na projektor'),
        h('button', { class: 'btn ghost wide', onclick: () => pr.open() }, 'Otwórz bez tego, przeciągnę sam'));
    } else {
      action = h('button', { class: 'btn primary wide', onclick: () => pr.open() }, pr.isOpen ? 'Pokaż okno projektora' : 'Otwórz okno projektora');
    }
    const how = pr.perm === 'granted'
      ? 'Okno samo otworzy się na ekranie projektora.'
      : pr.perm === 'prompt'
        ? 'Chrome zapyta o okna na wszystkich ekranach. Zgoda wystarczy raz, potem okno samo trafia na projektor.'
        : 'Ta przeglądarka nie przenosi okien sama: przeciągnij okno na ekran projektora.';
    return [
      this.card('2. Projektor',
        h('ol', { class: 'steps' },
          h('li', {}, 'Podłącz projektor przez HDMI. W Ustawieniach systemowych, w Wyświetlaczach, ustaw go jako rozszerzony ekran, nie lustrzany.'),
          h('li', {}, 'Otwórz okno projektora. ' + how),
          h('li', {}, 'Kliknij w obraz na ścianie: włączy się pełny ekran. Klawisz F przełącza.')),
        h('div', { class: 'pstat' + (pr.attached ? ' on' : '') }, h('i', { class: 'pdot' }), h('span', {}, status)),
        pr.single ? h('p', { class: 'warn' }, 'Widzę tylko jeden ekran. Sprawdź kabel HDMI i czy projektor nie jest ustawiony jako lustrzany.') : null,
        action),
      this.card('Obraz',
        this.toggle('Obraz testowy', app.testPattern, v => { app.testPattern = v; app.invalidate(); this.renderPanel(); }, 'Siatka, ramka i kolorowe rogi: widać, czy obraz łapie całą ścianę'),
        h('label', { class: 'field' }, h('span', {}, 'Rozdzielczość'), res),
        this.toggle('Odbij w poziomie', pr.flipX, v => pr.setFlip(v, pr.flipY), 'Gdy projektor świeci zza ekranu'),
        this.toggle('Odbij w pionie', pr.flipY, v => pr.setFlip(pr.flipX, v), 'Projektor do góry nogami pod sufitem: włącz oba'),
        ...this.workSlider()),
      this.card(null, h('button', { class: 'btn primary wide', onclick: () => app.setStep(3) }, 'Dalej: kalibracja')),
    ];
  }

  panelProj() {
    const app = this.app, st = this.st;
    if (app.live) return this.panelLive();
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
      this.card(null,
        h('button', { class: 'btn primary wide', onclick: () => app.setStep(3) }, 'Dalej: kalibracja'),
        h('p', { class: 'fine' }, 'Masz prawdziwy projektor? W kroku 1 wybierz Prawdziwa ściana.')),
    ];
  }

  panelCalib() {
    const app = this.app, st = this.st;
    const num = (key, label) => h('label', { class: 'field num' }, h('span', {}, label), h('input', {
      type: 'number', min: 1, max: 1000, step: 0.1, value: st.calibCm[key],
      onchange: e => { const v = Math.max(1, Math.min(1000, +e.target.value || 1)); e.target.value = v; this.quiet(() => app.scene.commit('calib', s => { s.calibCm[key] = v; s.calibrated = true; })); },
    }), h('i', {}, 'cm'));
    const presets = app.live
      ? [['A4 pion', 21, 29.7], ['A4 poziom', 29.7, 21], ['A3', 29.7, 42], ['30×40', 30, 40], ['50×70', 50, 70]]
      : [['A4', 21, 29.7], ['A3', 29.7, 42], ['30×40', 30, 40], ['50×70', 50, 70], ['70×100', 70, 100]];
    const steps = app.live
      ? [
        h('li', {}, 'Przyklej na ścianę kartkę A4 albo weź ramę, plakat: coś prostokątnego o znanym wymiarze.'),
        h('li', {}, 'Przeciągnij 4 kolorowe krzyżyki na jej rogi: myszką prosto na ścianie albo tutaj w podglądzie. Niebieski to lewy górny, zielony lewy dolny.'),
        h('li', {}, 'Wpisz prawdziwe wymiary w centymetrach.')]
      : [
        h('li', {}, 'Wybierz na ścianie coś prostokątnego: ramę, plakat, kartkę A4.'),
        h('li', {}, 'Przeciągnij 4 kolorowe krzyżyki na jego rogi. Niebieski to lewy górny, zielony lewy dolny.'),
        h('li', {}, 'Wpisz prawdziwe wymiary w centymetrach.')];
    return [
      this.card('3. Kalibracja',
        h('ol', { class: 'steps' }, ...steps),
        h('div', { class: 'row' }, num('w', 'Szerokość'), num('h', 'Wysokość')),
        h('div', { class: 'row wrap' }, ...presets.map(([l, w, hh]) => h('button', { class: 'btn small', onclick: () => app.scene.commit('calib', s => { s.calibCm = { w, h: hh }; s.calibrated = true; }) }, l))),
        this.toggle('Siatka 10 cm na ścianie', st.settings.calibGrid, v => this.set('calibGrid', v)),
        h('p', { class: 'fine' }, app.live
          ? 'Strzałki przesuwają zaznaczony krzyżyk o 1 piksel projektora, Shift o 10. Tab przełącza krzyżyk. Siatka na ścianie ma kwadraty po 10 cm: zmierz linijką, czy się zgadza.'
          : 'Strzałki przesuwają zaznaczony krzyżyk o 1 piksel projektora, Shift o 10. Tab przełącza krzyżyk.')),
      app.live ? this.card('Na ścianie', ...this.workSlider()) : null,
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
    const others = app.walls.list.filter(w => w.id !== st.wallId);
    const copy = h('select', { class: 'sel', title: 'Kształty są w cm względem prostokąta kalibracji, więc trafiają w rzeczy, jeśli obie ściany kalibrowano na tym samym przedmiocie', onchange: e => { const id = e.target.value; e.target.value = ''; if (id) app.copyShapes(id); } },
      h('option', { value: '' }, 'Skopiuj kształty z innej ściany...'), ...others.map(w => h('option', { value: w.id }, w.name)));
    const empty = app.live ? 'Pusto. Weź Narożniki (Q) i kliknij 4 rogi ramy, myszką prosto na ścianie.' : 'Pusto. Weź Narożniki (Q) i kliknij 4 rogi ramy na zdjęciu.';
    kids.push(this.card(`Kształty (${st.shapes.length})`, st.shapes.length ? list : h('p', { class: 'fine' }, empty), others.length ? copy : null));
    kids.push(this.card('Telefony', h('div', { class: 'roombox' }, ...this.roomBody())));
    if (app.live) kids.push(this.card('Na ścianie', ...this.workSlider()));
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

  setLook(i, id) {
    this.app.scene.commit('settings', st => {
      const l = (st.settings.looks || ['ludzik', 'kot']).slice();
      l[i] = id;
      st.settings.looks = l;
    });
  }

  panelPlay() {
    const app = this.app, st = this.st, s = st.settings;
    const play = PLAYS[s.play] ? s.play : 'coop';
    const act = s.mode === 'rubbery' ? 'Chwyt' : play === 'battle' ? 'Cios' : null;
    this.stats = h('div', { class: 'stats' });
    this.updateStats();
    const opts = play === 'battle'
      ? h('div', { class: 'row' }, h('span', { class: 'fine' }, 'Do ilu punktów'), this.seg(BATTLE_TO.map(n => [n, String(n)]), s.battleTo ?? 5, v => this.set('battleTo', v)))
      : play === 'collect'
        ? h('div', { class: 'row' }, h('span', { class: 'fine' }, 'Czas rundy'), this.seg(COLLECT_TIME.map(n => [n, fmtTime(n)]), s.collectTime ?? 90, v => this.set('collectTime', v)))
        : null;
    const kb = s.players || 0;
    const looks = s.looks || [];
    const lookSel = i => h('label', { class: 'field' }, h('span', {}, kb > 1 ? `Wygląd P${i + 1}` : 'Wygląd'), h('select', { class: 'sel', onchange: e => this.setLook(i, e.target.value) },
      ...Object.entries(LOOKS).map(([k, l]) => h('option', { value: k, selected: (looks[i] || (i ? 'kot' : 'ludzik')) === k }, l))));
    const row = (who, keys) => h('tr', {}, h('td', {}, who), ...keys.slice(0, act ? 4 : 3).map(k => h('td', {}, k)));
    return [
      this.card('5. Gra',
        h('button', { class: 'btn primary wide big', onclick: () => app.restart() }, 'Od nowa (R)'),
        this.stats,
        app.projector.attached ? h('p', { class: 'fine' }, 'Gra leci na projektorze. Klawiatura działa w obu oknach.') : null),
      this.card('Tryb gry',
        this.seg(Object.entries(PLAYS), play, v => this.set('play', v)),
        opts,
        h('p', { class: 'fine' }, PLAY_HINTS[play] + (play !== 'coop' ? ' Runda zaczyna się od odliczania.' : ''))),
      this.card('Ruch',
        this.seg([['precise', 'Precyzyjny'], ['rubbery', 'Gumowy']], s.mode, v => this.set('mode', v)),
        h('p', { class: 'fine' }, s.mode === 'rubbery' ? 'Jak Human Fall Flat: chwiejny ludzik na sprężynach. Chwyt podnosi ręce i łapie krawędzie albo innych graczy, puść, żeby skoczyć.' : 'Jak Mario: ostre sterowanie, skok zależy od tego, jak długo trzymasz.')),
      this.card('Telefony', h('div', { class: 'roombox' }, ...this.roomBody()),
        h('p', { class: 'fine' }, 'Każdy telefon wybiera swój wygląd: gotowy ludzik, rysunek palcem albo selfie na głowie.')),
      this.card('Klawiatura',
        this.seg([[0, 'Nikt'], [1, '1 gracz'], [2, '2 graczy']], kb, v => this.set('players', v)),
        kb > 0 ? h('table', { class: 'keys' },
          h('tr', {}, h('th', {}, ''), h('th', {}, 'Ruch'), h('th', {}, 'Skok'), h('th', {}, 'Zeskok'), act ? h('th', {}, act) : null),
          row('P1', ['← →', kb > 1 ? '↑' : '↑ / Spacja', '↓', kb > 1 ? 'Prawy Shift' : 'Shift']),
          kb > 1 ? row('P2', ['A D', 'W', 'S', 'E']) : null)
          : h('p', { class: 'fine' }, 'Grają tylko telefony.'),
        kb > 0 ? h('div', { class: 'row' }, lookSel(0), kb > 1 ? lookSel(1) : null) : null),
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
    const hud = d || this.app.game.hud();
    const cell = (v, l) => h('div', {}, h('b', {}, v), h('span', {}, l));
    const best = k => hud.players.reduce((m, p) => Math.max(m, p[k]), 0);
    let cells;
    if (hud.play === 'race') cells = [cell(fmtTime(hud.time, true), 'czas'), cell(`${hud.players.filter(p => p.done).length}/${hud.players.length}`, 'na mecie')];
    else if (hud.play === 'battle') cells = [cell(best('score'), 'najwięcej'), cell(hud.target, 'do wygranej'), cell(fmtTime(hud.time), 'czas')];
    else if (hud.play === 'collect') cells = [cell(fmtTime(hud.timeLeft), 'zostało'), cell(best('coins'), 'najwięcej monet')];
    else cells = [cell(hud.coins, 'monet'), cell(hud.total ? hud.left : '–', 'zostało'), cell(fmtTime(hud.time, true), 'czas')];
    this.stats.replaceChildren(...cells);
  }

  hudParts(d) {
    const parts = [];
    const chip = (text, hex) => parts.push({ cls: 'pl', text, color: hex });
    if (d.phase === 'count') parts.push({ cls: 'dim', text: PLAYS[d.play] });
    if (d.play === 'race') {
      parts.push({ cls: 'time', text: fmtTime(d.time, true) });
      for (const p of d.players) if (p.done) chip(`${p.place}. ${p.name}`, p.hex);
    } else if (d.play === 'battle') {
      for (const p of d.players) chip(`${p.name} ${p.score}`, p.hex);
      parts.push({ cls: 'dim', text: `do ${d.target}` });
    } else if (d.play === 'collect') {
      parts.push({ cls: 'time', text: fmtTime(d.timeLeft) });
      for (const p of d.players) chip(`${p.name} ● ${p.coins}`, p.hex);
    } else {
      parts.push({ cls: 'coin', text: `● ${d.coins}` });
      if (d.total) parts.push({ text: `zostało ${d.left}` });
      parts.push({ cls: 'time', text: fmtTime(d.time, true) });
      const done = d.players.filter(p => p.done).length;
      if (d.players.length > 1 && done) parts.push({ text: `na mecie ${done}/${d.players.length}` });
    }
    d.players.forEach(({ name, power: p }) => {
      if (p.big > 0) parts.push({ cls: 'pw big', text: `${name}: grzybek ${Math.ceil(p.big)}` });
      if (p.feather > 0) parts.push({ cls: 'pw feather', text: `${name}: piórko ${Math.ceil(p.feather)}` });
      if (p.star > 0) parts.push({ cls: 'pw star', text: `${name}: gwiazda ${Math.ceil(p.star)}` });
    });
    return parts;
  }

  hud() {
    const app = this.app;
    const on = app.step === 5 && app.game.running;
    this.el.hud.classList.toggle('on', on);
    if (!on) {
      if (this.hudSig !== '') { this.hudSig = ''; app.projector.hud(null); }
      return;
    }
    const d = app.game.hud();
    const now = performance.now();
    if (this.stats && now - (this.statsAt || 0) > 250) { this.statsAt = now; this.updateStats(d); }
    const parts = this.hudParts(d);
    const sig = parts.map(p => p.text + (p.color || '')).join('|');
    if (sig === this.hudSig) return;
    this.hudSig = sig;
    this.el.hud.replaceChildren(...parts.map(p => {
      const el = h(p.cls && p.cls.startsWith('pw') ? 'i' : 'span', { class: p.cls }, p.text);
      if (p.color) el.style.setProperty('--c', p.color);
      return el;
    }));
    app.projector.hud(parts);
  }

  gameEvent(type, data) {
    const pr = this.app.projector;
    switch (type) {
      case 'count':
        pr.message(String(data.n), PLAYS[data.play] || '', 0, 'count');
        this.toast(h('div', {}, h('b', {}, String(data.n)), h('span', {}, PLAYS[data.play] || '')), 1100);
        break;
      case 'start':
        pr.message('Start!', '', 900, 'count');
        this.toast(h('div', {}, h('b', {}, 'Start!')), 900);
        if (data.play === 'battle' && this.app.game.players.length < 2) this.toast('Bitwa potrzebuje co najmniej 2 graczy: dołącz telefonem albo włącz 2 graczy na klawiaturze.', 4200);
        break;
      case 'goal': {
        if (!data.many || !data.waiting) break;
        const title = data.play === 'race' ? `${data.place}. ${data.name}` : `${data.name} na mecie`;
        const sub = data.play === 'race' ? fmtTime(data.time, true) : `jeszcze ${data.waiting} w drodze`;
        pr.message(title, sub, 1500);
        this.toast(`${title} · ${sub}`, 1800);
        break;
      }
      case 'point':
        this.toast(`${data.name} zdobywa punkt: ${data.score} z ${data.to}`, 1600);
        break;
      case 'done':
        this.roundOver(data);
        break;
      case 'power': {
        const names = { mushroom: 'Grzybek: rośniesz', feather: 'Piórko: podwójny skok i szybowanie', star: 'Gwiazda: lawa nie parzy' };
        this.toast((data.many ? `${data.name}. ` : '') + (names[data.type] || ''), 1800);
        break;
      }
      case 'coin':
        this.updateStats(data);
        break;
    }
  }

  roundOver(d) {
    const res = d.results || [], win = d.winners || [];
    let title, sub;
    if (d.play === 'coop' || (d.play === 'race' && res.length === 1)) {
      const all = d.play === 'coop' && d.total && d.left === 0;
      title = all ? 'Perfekcyjnie!' : 'Meta!';
      const parts = [`Czas ${fmtTime(d.play === 'race' ? res[0].time || d.time : d.time, true)}`];
      if (d.total && d.play === 'coop') parts.push(`monety ${d.coins}${all ? ', wszystkie!' : ''}`);
      sub = parts.join(' · ');
    } else {
      title = win.length === 1 ? `Wygrywa: ${win[0]}` : win.length > 1 ? `Remis: ${win.join(', ')}` : 'Koniec rundy';
      const row = r => d.play === 'race'
        ? (r.place ? `${r.place}. ${r.name} ${fmtTime(r.time, true)}` : `${r.name}: bez mety`)
        : d.play === 'battle' ? `${r.name} ${r.score}` : `${r.name} ● ${r.coins}`;
      sub = res.slice(0, 8).map(row).join(' · ');
    }
    this.toast(h('div', {}, h('b', {}, title), h('span', {}, sub), h('button', { class: 'btn primary small', onclick: () => this.app.restart() }, 'Jeszcze raz (R)')), 0);
    this.app.projector.message(title, sub + ' · R albo telefon: jeszcze raz');
    this.updateStats(d);
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
