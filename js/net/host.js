// Beam: editor-side transport. Claims the room, accepts WebRTC peers and merges the RTDB relay fallback.

import { createPeer } from './rtc.js';
import { createRelayHost } from './relay.js';
import { encode, assembler } from './wire.js';
import { claimRoom, watchPeerSignals, sendAnswer, pushIce, clearPeerSignals } from './signaling.js';

export async function createRtcHost({ onConnect, onLeave, onMsg, onStream, preferred, key }) {
  const room = await claimRoom(preferred, key);
  const code = room.code;
  const peers = new Map();
  let closed = false;

  function state(cid) {
    let st = peers.get(cid);
    if (!st) {
      st = { cid, mode: null, peer: null, up: false, asm: assembler(m => onMsg(cid, m)) };
      peers.set(cid, st);
    }
    return st;
  }

  function up(st) {
    if (st.up || closed) return;
    st.up = true;
    onConnect(st.cid);
  }

  function drop(cid, reason) {
    const st = peers.get(cid);
    if (!st) return;
    peers.delete(cid);
    if (st.peer) st.peer.close();
    if (relay.has(cid)) relay.drop(cid);
    if (st.up) onLeave(cid, reason);
  }

  const relay = await createRelayHost(code, {
    onPeer: cid => {
      const st = state(cid);
      if (st.peer && st.peer.isOpen()) return;
      st.mode = 'relay';
      up(st);
    },
    onLeave: cid => {
      const st = peers.get(cid);
      if (st && st.mode === 'relay') drop(cid, 'relay-gone');
    },
    onText: (cid, text) => state(cid).asm(text),
    onStreamText: (cid, text) => { try { onStream(cid, JSON.parse(text)); } catch (e) { } },
  });

  const stopSignals = await watchPeerSignals(code, {
    onOffer: async (cid, offer) => {
      if (closed) return;
      const st = state(cid);
      if (st.peer) st.peer.close();
      const peer = createPeer({
        initiator: false,
        onIce: c => pushIce(code, cid, 'd', c),
        onOpen: () => { st.mode = 'rtc'; up(st); clearPeerSignals(code, cid); },
        onEvent: m => st.asm(m),
        onInput: m => onStream(cid, m),
        onClose: () => {
          if (peers.get(cid) !== st) return;
          if (relay.has(cid)) { st.mode = 'relay'; st.peer = null; return; }
          drop(cid, 'rtc-closed');
        },
      });
      st.peer = peer;
      try {
        await sendAnswer(code, cid, await peer.acceptOffer(offer));
      } catch (e) {
        peer.close();
        st.peer = null;
      }
    },
    onIce: (cid, cand) => {
      const st = peers.get(cid);
      if (st && st.peer) st.peer.addIce(cand);
    },
  });

  function send(cid, msg) {
    const st = peers.get(cid);
    if (!st || closed) return false;
    const parts = encode(msg);
    if (st.peer && st.peer.isOpen()) {
      let ok = true;
      for (const t of parts) ok = st.peer.sendEvent(t) && ok;
      if (ok) return true;
    }
    for (const t of parts) relay.sendText(cid, t);
    return true;
  }

  return {
    code,
    kind: 'rtc',
    send,
    broadcast(msg) { peers.forEach(st => { if (st.up) send(st.cid, msg); }); },
    mode(cid) { const st = peers.get(cid); return st ? st.mode : null; },
    kick(cid) { drop(cid, 'kicked'); },
    async close() {
      if (closed) return;
      closed = true;
      if (stopSignals) stopSignals();
      relay.close();
      peers.forEach(st => { if (st.peer) st.peer.close(); });
      peers.clear();
      await room.release();
    },
  };
}
