// Beam: RTCPeerConnection wrapper with a reliable "ev" channel and an unreliable "in" channel for buttons.

import { CH } from './protocol.js';

export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export function createPeer({ initiator, onIce, onOpen, onEvent, onInput, onClose }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const pendingIce = [];
  let evCh = null;
  let inCh = null;
  let remoteSet = false;
  let opened = false;
  let dead = false;

  const fire = (fn, a) => { if (fn) try { fn(a); } catch (e) { console.error(e); } };
  const closeQuietly = o => { try { if (o) o.close(); } catch (e) { } };

  function bind(ch) {
    if (ch.label === CH.EVENT) evCh = ch; else if (ch.label === CH.INPUT) inCh = ch; else return;
    ch.onopen = check;
    ch.onclose = () => { if (!dead && opened) die('channel-closed'); };
    ch.onmessage = e => {
      if (ch.label === CH.INPUT) {
        let msg = null;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (msg) fire(onInput, msg);
      } else {
        fire(onEvent, e.data);
      }
    };
  }

  function check() {
    if (opened || dead) return;
    if (evCh && inCh && evCh.readyState === 'open' && inCh.readyState === 'open') {
      opened = true;
      fire(onOpen);
    }
  }

  function die(reason) {
    if (dead) return;
    dead = true;
    fire(onClose, reason);
  }

  if (initiator) {
    bind(pc.createDataChannel(CH.EVENT, { ordered: true }));
    bind(pc.createDataChannel(CH.INPUT, { ordered: false, maxRetransmits: 0 }));
  } else {
    pc.ondatachannel = e => { bind(e.channel); check(); };
  }

  pc.onicecandidate = e => { if (e.candidate && onIce) fire(onIce, e.candidate.toJSON()); };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    if (s === 'failed' || s === 'closed') die(s);
  };
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') die('ice-failed'); };

  async function flushIce() {
    while (pendingIce.length) {
      try { await pc.addIceCandidate(pendingIce.shift()); } catch (e) { }
    }
  }

  return {
    async makeOffer() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
    },
    async acceptOffer(offer) {
      await pc.setRemoteDescription(offer);
      remoteSet = true;
      await flushIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return { type: pc.localDescription.type, sdp: pc.localDescription.sdp };
    },
    async acceptAnswer(answer) {
      if (pc.signalingState === 'stable') return;
      await pc.setRemoteDescription(answer);
      remoteSet = true;
      await flushIce();
    },
    async addIce(cand) {
      if (!cand) return;
      if (!remoteSet) { pendingIce.push(cand); return; }
      try { await pc.addIceCandidate(cand); } catch (e) { }
    },
    sendEvent(text) {
      if (evCh && evCh.readyState === 'open') { evCh.send(text); return true; }
      return false;
    },
    sendInput(text) {
      if (inCh && inCh.readyState === 'open') { inCh.send(text); return true; }
      return false;
    },
    isOpen() { return opened && !dead; },
    close() {
      dead = true;
      closeQuietly(evCh);
      closeQuietly(inCh);
      closeQuietly(pc);
    },
  };
}
