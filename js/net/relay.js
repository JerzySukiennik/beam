// Beam: RTDB relay for phones whose WebRTC link does not come up. Reliable push queues plus a throttled button stream.

import { fb } from './firebase.js';

function safe(fn) {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(() => { });
    return r;
  } catch (e) {
    return null;
  }
}

function throttle(hz, write) {
  const period = 1000 / hz;
  let last = 0;
  let queued = null;
  let timer = 0;
  const flush = () => {
    timer = 0;
    if (queued == null) return;
    const v = queued;
    queued = null;
    last = Date.now();
    write(v);
  };
  return {
    push(v) {
      queued = v;
      const wait = period - (Date.now() - last);
      if (wait <= 0) { flush(); return; }
      if (!timer) timer = setTimeout(flush, wait);
    },
    stop() { if (timer) clearTimeout(timer); timer = 0; queued = null; },
  };
}

export async function createRelayHost(code, { onPeer, onLeave, onText, onStreamText }) {
  const api = await fb();
  const peers = new Map();
  const base = (cid, k) => api.ref(`rooms/${code}/relay/${cid}${k ? '/' + k : ''}`);

  function attach(cid) {
    if (!cid || peers.has(cid)) return;
    const st = { subs: [] };
    peers.set(cid, st);
    st.subs.push(api.onValue(base(cid, 'in'), v => { if (v && v.s && onStreamText) onStreamText(cid, v.s); }));
    st.subs.push(api.onChildAdded(base(cid, 'ec'), (m, key) => {
      safe(() => api.remove(base(cid, `ec/${key}`)));
      if (m && m.s && onText) onText(cid, m.s);
    }));
    if (onPeer) onPeer(cid);
  }

  function detach(cid) {
    const st = peers.get(cid);
    if (!st) return;
    peers.delete(cid);
    st.subs.forEach(f => safe(() => f && f()));
  }

  const root = api.ref(`rooms/${code}/relay`);
  const stopAdd = api.onChildAdded(root, (val, cid) => attach(cid));
  const stopRem = api.onChildRemoved(root, (val, cid) => {
    if (!peers.has(cid)) return;
    detach(cid);
    if (onLeave) onLeave(cid);
  });

  return {
    has(cid) { return peers.has(cid); },
    sendText(cid, text) {
      if (!peers.has(cid)) return false;
      safe(() => api.push(base(cid, 'ed'), { s: text }));
      return true;
    },
    drop(cid) {
      detach(cid);
      safe(() => api.remove(base(cid)));
    },
    close() {
      safe(() => stopAdd && stopAdd());
      safe(() => stopRem && stopRem());
      Array.from(peers.keys()).forEach(detach);
    },
  };
}

export async function createRelayClient(code, cid, { onText }) {
  const api = await fb();
  const mine = api.ref(`rooms/${code}/relay/${cid}`);
  safe(() => api.onDisconnectRemove(mine));
  await api.set(api.ref(`rooms/${code}/relay/${cid}/on`), true);
  const subs = [];
  subs.push(api.onChildAdded(api.ref(`rooms/${code}/relay/${cid}/ed`), (m, key) => {
    safe(() => api.remove(api.ref(`rooms/${code}/relay/${cid}/ed/${key}`)));
    if (m && m.s && onText) onText(m.s);
  }));
  const stream = throttle(15, text => safe(() => api.set(api.ref(`rooms/${code}/relay/${cid}/in`), { s: text })));
  return {
    sendText(text) { safe(() => api.push(api.ref(`rooms/${code}/relay/${cid}/ec`), { s: text })); return true; },
    streamText(text) { stream.push(text); return true; },
    close() {
      stream.stop();
      subs.forEach(f => safe(() => f && f()));
      safe(() => api.cancelDisconnect(mine));
      safe(() => api.remove(mine));
    },
  };
}
