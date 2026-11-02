// Beam: JSON framing with chunking, so a whole wall fits DataChannel and relay message limits.

import { CHUNK } from './protocol.js';

let nextId = 1;

export function encode(msg) {
  const text = JSON.stringify(msg);
  if (text.length <= CHUNK) return [text];
  const id = nextId++;
  const n = Math.ceil(text.length / CHUNK);
  const out = [];
  for (let i = 0; i < n; i++) out.push(JSON.stringify({ t: '~', id, i, n, d: text.slice(i * CHUNK, (i + 1) * CHUNK) }));
  return out;
}

export function assembler(onMsg) {
  const parts = new Map();
  return obj => {
    if (typeof obj === 'string') {
      try { obj = JSON.parse(obj); } catch (e) { return; }
    }
    if (!obj) return;
    if (obj.t !== '~') { onMsg(obj); return; }
    let p = parts.get(obj.id);
    if (!p) { p = { n: obj.n, got: 0, d: new Array(obj.n) }; parts.set(obj.id, p); }
    if (p.d[obj.i] == null) { p.d[obj.i] = obj.d; p.got++; }
    if (p.got === p.n) {
      parts.delete(obj.id);
      let msg = null;
      try { msg = JSON.parse(p.d.join('')); } catch (e) { return; }
      onMsg(msg);
    }
    if (parts.size > 16) parts.delete(parts.keys().next().value);
  };
}
