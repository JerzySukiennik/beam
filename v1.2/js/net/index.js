// Beam: room transport. A same-browser channel is ready at once, the online room (WebRTC + RTDB) joins in the background.

import { netMode } from './protocol.js';

export async function createHost(handlers) {
  const local = await import('./local.js');
  if (netMode() === 'local') {
    const h = await local.createLocalHost(handlers);
    setTimeout(() => handlers.onOnline && handlers.onOnline(h.code), 0);
    return h;
  }
  const via = new Map();
  const wrap = tag => ({
    onConnect: cid => { via.set(cid, tag); handlers.onConnect(cid); },
    onLeave: (cid, r) => { if (via.get(cid) === tag) { via.delete(cid); handlers.onLeave(cid, r); } },
    onMsg: (cid, m) => { via.set(cid, tag); handlers.onMsg(cid, m); },
    onStream: (cid, m) => handlers.onStream(cid, m),
  });
  const loc = await local.createLocalHost({ ...wrap('local'), code: handlers.code });
  const pick = cid => (via.get(cid) === 'rtc' && api.rtc ? api.rtc : loc);
  const api = {
    code: loc.code,
    kind: 'local',
    rtc: null,
    send: (cid, msg) => pick(cid).send(cid, msg),
    broadcast: msg => { loc.broadcast(msg); if (api.rtc) api.rtc.broadcast(msg); },
    mode: cid => (via.get(cid) === 'rtc' && api.rtc ? api.rtc.mode(cid) : 'local'),
    kick: cid => pick(cid).kick(cid),
    close: async () => { await loc.close(); if (api.rtc) await api.rtc.close(); },
  };
  (async () => {
    try {
      api.rtc = await (await import('./host.js')).createRtcHost({ ...wrap('rtc'), preferred: loc.code, key: handlers.key });
      api.code = api.rtc.code;
      api.kind = 'dual';
      if (handlers.onOnline) handlers.onOnline(api.code);
    } catch (e) {
      console.warn('[beam] online room unavailable', e);
      if (handlers.onOnline) handlers.onOnline(null);
    }
  })();
  return api;
}

export async function connectClient(opts) {
  if (netMode() === 'local') return (await import('./local.js')).connectLocalClient(opts);
  return (await import('./client.js')).connectRtcClient(opts);
}
