// Beam: phone page. Joins a room by its code, then works as a gamepad for one character or as a touch editor of the
// wall. Reconnects on its own when the link drops or the computer reloads the editor.

import { connectClient } from '../net/index.js';
import { PROTO, BTN, PAD_COLORS } from '../net/protocol.js';
import { Editor } from './editor.js';
import { h } from './dom.js';

const NAME = 'beam.pad.name', COLOR = 'beam.pad.color', TAB = 'beam.pad.tab';
const KEYS = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'down', KeyS: 'down', ShiftLeft: 'grab', ShiftRight: 'grab', KeyE: 'grab',
};
const NET_TITLE = { rtc: 'Bezpośrednio z komputerem', relay: 'Przez serwer, trochę wolniej', local: 'Ta sama przeglądarka', connecting: 'Łączę...' };

const $ = s => document.querySelector(s);
const now = () => performance.now();
const get = (k, st = localStorage) => { try { return st.getItem(k); } catch (e) { return null; } };
const put = (k, v, st = localStorage) => { try { st.setItem(k, v); } catch (e) { } };
const del = (k, st = localStorage) => { try { st.removeItem(k); } catch (e) { } };
const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);

const S = {
  code: '', cid: '', name: '', color: '', tab: get(TAB) === 'edit' ? 'edit' : 'pad',
  client: null, slot: null, welcomed: false, ever: false, ended: false,
  conn: 'connecting', rtcOk: false, upgrades: 0, upTimer: 0, upgrading: false,
  rtt: 0, lastPong: 0, helloAt: 0, tries: 0, lostAt: 0, retry: 0, lock: null,
  info: { step: 1, playing: false, mode: 'precise', wall: '', live: false }, roster: [],
};
const pad = { touch: new Map(), keys: new Set(), bits: 0, j: 0, sentAt: 0 };

const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { } };

let toastTimer = 0;
function toast(text, ms = 2800) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}

const sheet = {
  el: $('#sheet'),
  dismiss: null,
  open(node, onDismiss) { this.dismiss = onDismiss || null; this.el.replaceChildren(node); this.el.classList.add('on'); },
  close() { this.dismiss = null; this.el.classList.remove('on'); this.el.replaceChildren(); },
};
sheet.el.addEventListener('pointerdown', e => {
  if (e.target !== sheet.el) return;
  const f = sheet.dismiss;
  sheet.close();
  if (f) f();
});

const editor = new Editor({
  root: $('#editv'),
  send: m => { if (S.client && S.welcomed) S.client.send(m); },
  sheet,
  toast,
  buzz,
});

function cidFor(code) {
  const k = 'beam.pad.cid.' + code;
  let c = get(k, sessionStorage);
  if (!c || !/^[a-z0-9]{6,16}$/.test(c)) {
    const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
    c = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => abc[b % 36]).join('');
    put(k, c, sessionStorage);
  }
  return c;
}

function screen(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id);
}

function wait(title, text, btns = [], spin = true) {
  $('#waitTitle').textContent = title;
  $('#waitText').textContent = text || '';
  $('#waitSpin').classList.toggle('off', !spin);
  $('#waitBtns').replaceChildren(...btns.map(([label, fn, primary]) => h('button', { class: 'btn' + (primary ? ' primary' : ''), type: 'button', onclick: fn }, label)));
  screen('wait');
}

function banner(text) {
  const b = $('#banner');
  b.textContent = text || '';
  b.classList.toggle('on', !!text);
}

function swatches(box, cur, pick, taken = new Set()) {
  const draw = () => box.replaceChildren(...PAD_COLORS.map(c => h('button', {
    type: 'button',
    class: 'sw8' + (c === cur() ? ' on' : '') + (taken.has(c) ? ' taken' : ''),
    style: `--c:${c}`,
    'aria-label': taken.has(c) ? 'Kolor zajęty' : 'Kolor',
    onclick: () => { pick(c); draw(); },
  })));
  draw();
}

function initJoin() {
  const q = new URLSearchParams(location.search);
  const code = cleanCode(q.get('r'));
  $('#code').value = code;
  $('#name').value = get(NAME) || '';
  const c = get(COLOR);
  S.color = PAD_COLORS.includes(c) ? c : PAD_COLORS[Math.floor(Math.random() * PAD_COLORS.length)];
  swatches($('#colors'), () => S.color, v => { S.color = v; });
  $('#code').addEventListener('input', e => { e.target.value = cleanCode(e.target.value); });
  $('#joinForm').addEventListener('submit', e => { e.preventDefault(); join(); });
  if (code && get('beam.pad.in.' + code, sessionStorage)) { join(); return; }
  screen('join');
}

function join() {
  const code = cleanCode($('#code').value);
  const err = $('#joinErr');
  if (code.length !== 4) { err.textContent = 'Kod ma 4 litery. Widać go na ekranie komputera i w rogu ściany.'; screen('join'); return; }
  err.textContent = '';
  S.code = code;
  S.cid = cidFor(code);
  S.name = cleanName($('#name').value);
  S.ended = false;
  S.ever = false;
  S.tries = 0;
  S.lostAt = 0;
  if (S.name) put(NAME, S.name);
  put(COLOR, S.color);
  const u = new URL(location.href);
  u.searchParams.set('r', code);
  history.replaceState(null, '', u);
  wake();
  connect();
}

async function connect() {
  clearTimeout(S.retry);
  drop();
  const slot = { c: null, open: false };
  S.slot = slot;
  S.welcomed = false;
  S.conn = 'connecting';
  if (S.ever) { banner('Łączę ponownie...'); net(); } else wait('Łączę...', `Pokój ${S.code}`, [['Wpisz inny kod', () => { stop(); screen('join'); }]]);
  let c;
  try {
    c = await connectClient({
      code: S.code,
      cid: S.cid,
      onOpen: mode => {
        if (S.slot !== slot) return;
        slot.open = true;
        setConn(mode);
        if (slot.c) hello();
      },
      onMsg: m => { if (S.slot === slot) onMsg(m); },
      onClose: r => { if (S.slot === slot) lost(r); },
    });
  } catch (e) {
    if (S.slot === slot) lost(e && e.message === 'room-not-found' ? 'no-room' : 'error');
    return;
  }
  if (S.slot !== slot) { try { c.close(); } catch (e) { } return; }
  slot.c = c;
  S.client = c;
  S.helloAt = now();
  if (slot.open) hello();
}

function setConn(mode) {
  S.conn = mode;
  if (mode === 'rtc') { S.rtcOk = true; S.upgrades = 0; }
  if (mode === 'relay') upgradeSoon();
  net();
}

function upgradeSoon() {
  clearTimeout(S.upTimer);
  if (!S.rtcOk || S.upgrades >= 5) return;
  S.upTimer = setTimeout(upgrade, 2500 + S.upgrades * 7000);
}

async function upgrade() {
  if (S.ended || !S.welcomed || S.conn !== 'relay' || S.upgrading) return;
  S.upgrading = true;
  S.upgrades++;
  const from = S.slot, slot = { c: null, open: false, adopted: false };
  const fail = () => {
    S.upgrading = false;
    if (slot.c) { try { slot.c.close(); } catch (e) { } }
    if (S.slot === from) upgradeSoon();
  };
  const adopt = () => {
    if (slot.adopted) return;
    if (S.slot !== from || S.ended) { fail(); return; }
    slot.adopted = true;
    S.upgrading = false;
    S.slot = slot;
    S.client = slot.c;
    setConn('rtc');
    const old = from && from.c;
    setTimeout(() => { if (old) { try { old.close(); } catch (e) { } } }, 1500);
  };
  try {
    slot.c = await connectClient({
      code: S.code,
      cid: S.cid,
      relay: false,
      onOpen: mode => { slot.open = mode === 'rtc'; if (slot.c && slot.open) adopt(); },
      onMsg: m => { if (S.slot === slot) onMsg(m); },
      onClose: r => { if (S.slot === slot) lost(r); else if (!slot.adopted) fail(); },
    });
  } catch (e) {
    fail();
    return;
  }
  if (slot.open) adopt();
}

function hello() {
  if (S.client) S.client.send({ t: 'hello', v: PROTO, name: S.name, color: S.color, tab: S.tab, j: pad.j });
}

function drop() {
  const c = S.client;
  S.client = null;
  S.slot = null;
  clearTimeout(S.upTimer);
  S.upgrading = false;
  if (c) { try { c.close(); } catch (e) { } }
}

function stop() {
  S.ended = true;
  clearTimeout(S.retry);
  drop();
  banner('');
}

function lost(reason) {
  drop();
  S.welcomed = false;
  S.conn = 'connecting';
  net();
  if (S.ended) return;
  if (reason === 'kicked') { end('kicked'); return; }
  if (!S.ever && reason === 'no-room') { end('no-room'); return; }
  if (!S.lostAt) S.lostAt = Date.now();
  if (Date.now() - S.lostAt > 120000) { end('gone'); return; }
  const delay = Math.min(8000, 700 * Math.pow(1.7, S.tries++));
  if (S.ever) banner(reason === 'no-room' ? 'Komputer zamknął pokój. Czekam, aż wróci...' : 'Połączenie zerwane, łączę ponownie...');
  S.retry = setTimeout(connect, delay);
}

function end(kind) {
  stop();
  del('beam.pad.in.' + S.code, sessionStorage);
  clearInput();
  const again = ['Dołącz jeszcze raz', () => join(), true];
  const other = ['Wpisz inny kod', () => screen('join')];
  if (kind === 'kicked') wait('Rozłączono', 'Komputer rozłączył ten telefon.', [again, other], false);
  else if (kind === 'no-room') wait(`Nie ma pokoju ${S.code}`, 'Sprawdź kod na ekranie komputera albo w rogu ściany.', [['Wpisz kod', () => screen('join'), true]], false);
  else if (kind === 'full') wait('Pokój jest pełny', 'Naraz gra do 8 telefonów. Spróbuj, gdy ktoś wyjdzie.', [again, other], false);
  else if (kind === 'old') wait('Nowa wersja gry', 'Komputer ma nowszą wersję Beam. Odśwież tę stronę.', [['Odśwież', () => location.reload(), true]], false);
  else wait('Pokój zniknął', 'Komputer jest wyłączony albo zamknął pokój.', [again, other], false);
}

function onMsg(m) {
  if (!m || typeof m.t !== 'string') return;
  switch (m.t) {
    case 'welcome':
      S.welcomed = true;
      S.ever = true;
      S.tries = 0;
      S.lostAt = 0;
      S.lastPong = now();
      S.name = m.name;
      S.color = m.color;
      info(m);
      put('beam.pad.in.' + S.code, '1', sessionStorage);
      banner('');
      showApp();
      break;
    case 'roster':
      S.roster = Array.isArray(m.pads) ? m.pads : [];
      info(m);
      status();
      break;
    case 'me':
      S.name = m.name;
      S.color = m.color;
      put(COLOR, m.color);
      if (m.name) put(NAME, m.name);
      me();
      status();
      break;
    case 'scene': editor.scene(m); break;
    case 'photo': editor.hostPhoto(m); break;
    case 'added': editor.added(m); break;
    case 'pong':
      S.lastPong = now();
      if (typeof m.at === 'number') S.rtt = Math.max(1, Math.round(now() - m.at));
      net();
      break;
    case 'who': hello(); break;
    case 'full': end('full'); break;
    case 'old': end('old'); break;
    case 'kicked': end('kicked'); break;
  }
}

function info(m) {
  S.info = { step: m.step | 0, playing: !!m.playing, mode: m.mode === 'rubbery' ? 'rubbery' : 'precise', wall: String(m.wall || ''), live: !!m.live };
  document.body.classList.toggle('rubbery', S.info.mode === 'rubbery');
}

function showApp() {
  screen('app');
  me();
  net();
  status();
  setTab(S.tab, false);
}

function me() {
  document.documentElement.style.setProperty('--pc', S.color || '#19f0ff');
  $('#meName').textContent = S.name || 'Ty';
  $('#room').textContent = S.code;
}

function net() {
  const el = $('#net'), m = S.client && S.welcomed ? S.conn : 'connecting';
  el.className = 'net ' + m;
  el.querySelector('em').textContent = m === 'connecting' ? '...' : S.rtt ? `${S.rtt} ms` : '';
  el.title = NET_TITLE[m] || '';
}

function status() {
  const i = S.info;
  $('#st1').textContent = i.playing ? 'Grasz!' : 'Czekamy na grę';
  $('#st2').textContent = i.playing
    ? `Twój ludzik świeci ${i.live ? 'na ścianie' : 'na ekranie'} w twoim kolorze.`
    : `Komputer jest w kroku ${i.step || 1}. Ludziki ruszają w kroku 5.`;
  $('#roster').replaceChildren(...S.roster.map(p => h('span', { class: 'chip' + (p.cid === S.cid ? ' me' : ''), style: `--c:${p.color}` },
    h('i'), p.name + (p.cid === S.cid ? ' (ty)' : '') + (p.tab === 'edit' ? ', edytuje' : ''))));
}

function setTab(tab, notify = true) {
  S.tab = tab;
  put(TAB, tab);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  $('#padv').classList.toggle('on', tab === 'pad');
  $('#editv').classList.toggle('on', tab === 'edit');
  if (tab === 'edit') { clearInput(); editor.show(); } else editor.hide();
  if (notify && S.client && S.welcomed) S.client.send({ t: 'tab', tab });
}

function meSheet() {
  let color = S.color;
  const taken = new Set(S.roster.filter(p => p.cid !== S.cid).map(p => p.color));
  const input = h('input', { maxlength: 14, value: S.name, autocorrect: 'off', spellcheck: 'false' });
  const box = h('div', { class: 'colors' });
  swatches(box, () => color, v => { color = v; }, taken);
  const save = () => {
    const name = cleanName(input.value) || S.name;
    if (S.client && S.welcomed) S.client.send({ t: 'me', name, color });
    sheet.close();
  };
  sheet.open(h('form', { class: 'sh', onsubmit: e => { e.preventDefault(); save(); } },
    h('h3', {}, 'Twój ludzik'),
    h('label', { class: 'field' }, h('span', {}, 'Imię albo ksywka'), input),
    h('div', { class: 'field' }, h('span', {}, 'Kolor'), box),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Anuluj'),
      h('button', { class: 'btn primary', type: 'submit' }, 'Zapisz'))));
}

function bitsNow() {
  let b = 0;
  for (const n of pad.touch.values()) b |= BTN[n];
  for (const n of pad.keys) b |= BTN[n];
  if (!S.info || S.info.mode !== 'rubbery') b &= ~BTN.grab;
  return b;
}

function update() {
  const b = S.tab === 'pad' ? bitsNow() : 0;
  if (b === pad.bits) return;
  if (b & BTN.jump && !(pad.bits & BTN.jump)) { pad.j = (pad.j + 1) & 0xffff; buzz(12); }
  else if (b & ~pad.bits) buzz(6);
  pad.bits = b;
  for (const el of document.querySelectorAll('#padv .pb')) el.classList.toggle('on', !!(b & BTN[el.dataset.b]));
  stream();
}

function stream() {
  if (!S.client || !S.welcomed) return;
  S.client.stream({ b: pad.bits, j: pad.j });
  pad.sentAt = now();
}

function clearInput() {
  pad.touch.clear();
  pad.keys.clear();
  update();
}

function nearest(zone, x, y) {
  let best = null, bd = Infinity;
  for (const b of zone.querySelectorAll('.pb')) {
    const r = b.getBoundingClientRect();
    if (!r.width) continue;
    const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function bindZone(zone) {
  const set = e => {
    const b = nearest(zone, e.clientX, e.clientY);
    if (b) pad.touch.set(e.pointerId, b.dataset.b);
    update();
  };
  zone.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { zone.setPointerCapture(e.pointerId); } catch (err) { }
    set(e);
  });
  zone.addEventListener('pointermove', e => { if (pad.touch.has(e.pointerId)) set(e); });
  const off = e => { if (pad.touch.delete(e.pointerId)) update(); };
  zone.addEventListener('pointerup', off);
  zone.addEventListener('pointercancel', off);
  zone.addEventListener('lostpointercapture', off);
}

async function wake() {
  try {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || S.lock) return;
    S.lock = await navigator.wakeLock.request('screen');
    S.lock.addEventListener('release', () => { S.lock = null; });
  } catch (e) {
    S.lock = null;
  }
}

bindZone($('#dz'));
bindZone($('#az'));
for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));
$('#me').addEventListener('click', meSheet);
$('#padv').addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('gesturestart', e => e.preventDefault());

window.addEventListener('keydown', e => {
  if (S.tab !== 'pad' || !$('#app').classList.contains('on') || e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  const k = KEYS[e.code];
  if (!k) return;
  e.preventDefault();
  pad.keys.add(k);
  update();
});
window.addEventListener('keyup', e => {
  const k = KEYS[e.code];
  if (k && pad.keys.delete(k)) update();
});
window.addEventListener('blur', clearInput);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') { clearInput(); return; }
  if (!S.ever || S.ended) return;
  wake();
  if (!S.client || now() - S.lastPong > 9000) { S.tries = 0; connect(); } else S.client.send({ t: 'ping', at: now() });
});

setInterval(() => {
  if (!S.client || !S.welcomed) return;
  if (now() - pad.sentAt >= (pad.bits ? 46 : 246)) stream();
}, 50);

setInterval(() => {
  if (!S.client || S.ended) return;
  S.client.send({ t: 'ping', at: now() });
  if (S.welcomed ? now() - S.lastPong > 7000 : now() - S.helloAt > 15000) lost('timeout');
}, 2000);

window.beamPad = { S, pad, editor };
initJoin();
