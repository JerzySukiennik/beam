// Beam: phone-side transport. WebRTC first, the RTDB relay after 6 s or when the link dies (unless relay is off, then
// a failed attempt just closes, which is how a phone on the relay tries to climb back to a direct link).

import { createPeer } from './rtc.js';
import { createRelayClient } from './relay.js';
import { encode, assembler } from './wire.js';
import { roomExists, sendOffer, watchAnswer, watchIce, pushIce, clearPeerSignals, armPeerCleanup } from './signaling.js';

const FALLBACK_MS = 6000;

export async function connectRtcClient({ code, cid, onOpen, onMsg, onClose, relay = true }) {
  code = String(code || '').toUpperCase();
  if (!(await roomExists(code))) throw new Error('room-not-found');
  await armPeerCleanup(code, cid);

  let mode = 'connecting';
  let closed = false;
  let peer = null;
  let relayed = null;
  let timer = 0;
  const outbox = [];
  const stops = [];
  const asm = assembler(onMsg);

  const stopSignaling = () => { while (stops.length) { try { const f = stops.pop(); if (f) f(); } catch (e) { } } };

  function rawSend(text) {
    if (mode === 'rtc' && peer && peer.isOpen()) return peer.sendEvent(text);
    if (mode === 'relay' && relayed) return relayed.sendText(text);
    return false;
  }

  function open(next) {
    if (closed) return;
    mode = next;
    while (outbox.length) rawSend(outbox.shift());
    onOpen(next);
  }

  async function toRelay(reason) {
    if (closed || mode === 'relay' || mode === 'dead') return;
    if (timer) { clearTimeout(timer); timer = 0; }
    stopSignaling();
    if (peer) { peer.close(); peer = null; }
    clearPeerSignals(code, cid);
    if (!relay) {
      mode = 'dead';
      onClose(reason || 'rtc-failed');
      return;
    }
    try {
      relayed = await createRelayClient(code, cid, { onText: asm });
      open('relay');
    } catch (e) {
      mode = 'dead';
      onClose(reason || 'relay-failed');
    }
  }

  peer = createPeer({
    initiator: true,
    onIce: c => pushIce(code, cid, 'c', c),
    onOpen: () => {
      if (closed || mode === 'relay') return;
      if (timer) { clearTimeout(timer); timer = 0; }
      stopSignaling();
      clearPeerSignals(code, cid);
      open('rtc');
    },
    onEvent: asm,
    onInput: asm,
    onClose: () => {
      if (closed) return;
      if (mode === 'rtc' || mode === 'connecting') toRelay('rtc-lost');
    },
  });

  const offer = await peer.makeOffer();
  stops.push(await watchAnswer(code, cid, a => { if (peer) peer.acceptAnswer(a); }));
  stops.push(await watchIce(code, cid, 'd', c => { if (peer) peer.addIce(c); }));
  await sendOffer(code, cid, offer);
  timer = setTimeout(() => toRelay('timeout'), FALLBACK_MS);

  return {
    send(msg) {
      if (closed || !msg) return false;
      for (const t of encode(msg)) {
        if (mode === 'connecting') outbox.push(t); else rawSend(t);
      }
      return true;
    },
    stream(msg) {
      if (closed || !msg) return false;
      const t = JSON.stringify(msg);
      if (mode === 'rtc' && peer) return peer.sendInput(t);
      if (mode === 'relay' && relayed) return relayed.streamText(t);
      return false;
    },
    mode() { return mode; },
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      stopSignaling();
      if (peer) peer.close();
      if (relayed) relayed.close();
      clearPeerSignals(code, cid);
    },
  };
}
