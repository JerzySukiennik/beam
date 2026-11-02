// Beam: wire protocol shared by the editor (the room host) and the phones.

export const PROTO = 1;
export const GAME = 'beam';
export const CH = { EVENT: 'ev', INPUT: 'in' };
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LEN = 4;
export const MAX_PADS = 8;
export const CHUNK = 12000;
export const BTN = { left: 1, right: 2, jump: 4, down: 8, grab: 16 };
export const PAD_COLORS = ['#ffe14d', '#5dffb0', '#ff7ad9', '#3dd6ff', '#ffa94d', '#b48cff', '#a8ff4d', '#ffffff'];
export const LIVE_ORIGIN = 'https://beam.gzowo.fun/';

export function netMode() {
  const q = new URLSearchParams(location.search);
  return q.get('net') || 'rtc';
}

export function padUrl(code) {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && netMode() !== 'local';
  const u = new URL('pad.html', local ? LIVE_ORIGIN : location.href);
  u.search = '';
  u.searchParams.set('r', code);
  if (netMode() === 'local') u.searchParams.set('net', 'local');
  return u.toString();
}
