// Beam: RTDB signaling. The editor claims a 4-letter room (removed when it disconnects, reclaimed after a reload of the same
// tab), phones trade offer, answer and ICE.

import { fb } from './firebase.js';
import { PROTO, GAME, ROOM_ALPHABET, ROOM_CODE_LEN } from './protocol.js';

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  return s;
}

function safe(fn) {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(() => { });
    return r;
  } catch (e) {
    return null;
  }
}

export async function claimRoom(preferred, key) {
  const api = await fb();
  const tries = [];
  const want = String(preferred || '').toUpperCase();
  if (want.length === ROOM_CODE_LEN) tries.push(want);
  while (tries.length < 14) tries.push(makeRoomCode());
  const meta = () => (key ? { at: Date.now(), v: PROTO, game: GAME, k: key } : { at: Date.now(), v: PROTO, game: GAME });
  for (const code of tries) {
    let res = null;
    try {
      res = await api.runTransaction(api.ref(`rooms/${code}/meta`), cur => {
        if (cur && cur.at && Date.now() - cur.at < 6 * 3600e3 && !(key && cur.k === key)) return undefined;
        return meta();
      });
    } catch (e) {
      res = null;
    }
    if (res && res.committed) {
      const roomRef = api.ref(`rooms/${code}`);
      const metaRef = api.ref(`rooms/${code}/meta`);
      let done = false;
      safe(() => api.onDisconnectRemove(roomRef));
      const heal = api.onValue(metaRef, v => {
        if (done || v) return;
        safe(() => api.set(metaRef, meta()));
        safe(() => api.onDisconnectRemove(roomRef));
      });
      const bye = () => { done = true; safe(() => api.remove(roomRef)); };
      window.addEventListener('pagehide', bye);
      return {
        code,
        async release() {
          done = true;
          safe(() => heal());
          window.removeEventListener('pagehide', bye);
          safe(() => api.cancelDisconnect(roomRef));
          safe(() => api.remove(roomRef));
        },
      };
    }
  }
  throw new Error('room-claim-failed');
}

export async function roomExists(code) {
  const api = await fb();
  const meta = await api.get(api.ref(`rooms/${code}/meta`));
  return !!meta && meta.game === GAME;
}

export async function watchPeerSignals(code, { onOffer, onIce }) {
  const api = await fb();
  const stops = [];
  const seen = new Set();
  const lastOffer = new Map();
  stops.push(api.onChildAdded(api.ref(`rooms/${code}/sig`), (val, cid) => {
    if (!cid || seen.has(cid)) return;
    seen.add(cid);
    stops.push(api.onValue(api.ref(`rooms/${code}/sig/${cid}/offer`), v => {
      if (!v || !v.sdp || lastOffer.get(cid) === v.sdp) return;
      lastOffer.set(cid, v.sdp);
      if (onOffer) onOffer(cid, v);
    }));
    stops.push(api.onChildAdded(api.ref(`rooms/${code}/sig/${cid}/ice/c`), c => { if (c && onIce) onIce(cid, c); }));
  }));
  stops.push(api.onChildRemoved(api.ref(`rooms/${code}/sig`), (val, cid) => { seen.delete(cid); lastOffer.delete(cid); }));
  return () => stops.forEach(f => safe(() => f && f()));
}

export async function sendAnswer(code, cid, answer) {
  const api = await fb();
  await api.set(api.ref(`rooms/${code}/sig/${cid}/answer`), { type: answer.type, sdp: answer.sdp });
}

export async function sendOffer(code, cid, offer) {
  const api = await fb();
  await api.set(api.ref(`rooms/${code}/sig/${cid}/offer`), { type: offer.type, sdp: offer.sdp });
}

export async function pushIce(code, cid, side, cand) {
  const api = await fb();
  const c = {};
  for (const k of ['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment']) if (cand[k] != null) c[k] = cand[k];
  safe(() => api.push(api.ref(`rooms/${code}/sig/${cid}/ice/${side}`), c));
}

export async function watchAnswer(code, cid, cb) {
  const api = await fb();
  return api.onValue(api.ref(`rooms/${code}/sig/${cid}/answer`), v => { if (v && v.sdp) cb(v); });
}

export async function watchIce(code, cid, side, cb) {
  const api = await fb();
  return api.onChildAdded(api.ref(`rooms/${code}/sig/${cid}/ice/${side}`), c => { if (c) cb(c); });
}

export async function clearPeerSignals(code, cid) {
  const api = await fb();
  safe(() => api.remove(api.ref(`rooms/${code}/sig/${cid}`)));
}

export async function armPeerCleanup(code, cid) {
  const api = await fb();
  safe(() => api.onDisconnectRemove(api.ref(`rooms/${code}/sig/${cid}`)));
}
