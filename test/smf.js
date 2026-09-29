// ---- tiny SMF writer, so the tests need no binary fixtures
const vlq = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
export const track = (events) => {
  const body = [];
  for (const [delta, ...bytes] of events) body.push(...vlq(delta), ...bytes);
  body.push(0, 0xff, 0x2f, 0);
  return [...'MTrk'].map((c) => c.charCodeAt(0)).concat(u32(body.length), body);
};
export const smf = (format, division, tracks) => new Uint8Array(
  [...'MThd'].map((c) => c.charCodeAt(0)).concat(u32(6), u16(format), u16(tracks.length), u16(division), ...tracks),
);
export const name = (s) => [0xff, 0x03, s.length, ...[...s].map((c) => c.charCodeAt(0))];
export const tempo = (us) => [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
