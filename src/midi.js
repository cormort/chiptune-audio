import { renderSfxInto, SAMPLE_RATE, WAVE } from './sfx.js';
import { INSTRUMENTS, instrumentNote } from './instruments.js';

/** Longest MIDI render, in seconds. Later notes are dropped: a 5-minute mono
 *  buffer at 48 kHz is already ~58 MB. */
export const MAX_MIDI_SECONDS = 300;

/** Ring-out added after the last note so decays are not cut off. */
const TAIL_SECONDS = 1.5;

const DRUM_CHANNEL = 9; // GM channel 10

/** Parse a Standard MIDI File (format 0 or 1).
 *  Returns { duration, tracks } where every track is one (MTrk, channel) pair
 *  that has notes: { name, channel, program, instrument, notes }, and each note
 *  is { time, dur, note, vel } in seconds (vel 0..1). `instrument` is a
 *  suggested INSTRUMENTS key, or 'drums' for channel 10.
 *  Throws an Error for anything that is not a well-formed MIDI file. */
export function parseMidi(data) {
  const bytes = data instanceof Uint8Array ? data
    : data instanceof ArrayBuffer ? new Uint8Array(data)
    : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : null;
  if (!bytes) throw new TypeError('parseMidi expects an ArrayBuffer or Uint8Array');

  let pos = 0;
  const fail = (why) => { throw new Error(`Invalid MIDI file: ${why}`); };
  const need = (n) => { if (pos + n > bytes.length) fail('unexpected end of data'); };
  const u8 = () => { need(1); return bytes[pos++]; };
  const u16 = () => { need(2); const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; };
  const u32 = () => { need(4); const v = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0; pos += 4; return v; };
  const tag = () => { need(4); const t = String.fromCharCode(...bytes.subarray(pos, pos + 4)); pos += 4; return t; };
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    return fail('variable-length number longer than 4 bytes');
  };

  if (tag() !== 'MThd') fail('missing MThd header');
  const headerLen = u32();
  if (headerLen < 6) fail('header too short');
  const format = u16();
  const trackCount = u16();
  const division = u16();
  pos += headerLen - 6;
  if (format > 2) fail(`unsupported format ${format}`);
  if (division === 0) fail('zero time division');

  // Ticks are converted to seconds after every tempo change is known (in format
  // 1 they live in the first track but apply to all of them).
  const tempos = [];      // { tick, usPerBeat }
  const raw = [];         // { trk, ch, tick, endTick, note, vel }
  const names = [];
  const programs = new Map(); // `${trk}:${ch}` -> first program seen

  let parsedTracks = 0;
  for (let trk = 0; trk < trackCount && pos < bytes.length; trk++) {
    const id = tag();
    const len = u32();
    const end = pos + len;
    if (end > bytes.length) fail('track runs past the end of the file');
    if (id !== 'MTrk') { pos = end; continue; } // unknown chunks are skipped per spec
    parsedTracks++;

    let tick = 0;
    let status = 0;
    const open = new Map(); // `${ch}:${note}` -> [{ tick, vel }] (FIFO)
    while (pos < end) {
      tick += vlq();
      let b = u8();
      if (b & 0x80) status = b;
      else if (!status) fail('data byte without a status byte');
      else pos--; // running status: b was the first data byte

      if (status === 0xff) {
        const type = u8();
        const mlen = vlq();
        need(mlen);
        if (type === 0x51 && mlen === 3) {
          tempos.push({ tick, usPerBeat: (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2] });
        } else if (type === 0x03 && names[trk] === undefined) {
          names[trk] = new TextDecoder().decode(bytes.subarray(pos, pos + mlen)).trim();
        }
        pos += mlen;
        status = 0; // meta and sysex cancel running status
        if (type === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const slen = vlq();
        need(slen);
        pos += slen;
        status = 0;
        continue;
      }
      if (status >= 0xf0) fail(`unexpected system message 0x${status.toString(16)}`);

      const kind = status & 0xf0;
      const ch = status & 0x0f;
      const d1 = u8();
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : u8();
      if (kind === 0x90 && d2 > 0) {
        const k = `${ch}:${d1}`;
        if (!open.has(k)) open.set(k, []);
        open.get(k).push({ tick, vel: d2 });
      } else if (kind === 0x80 || kind === 0x90) {
        const q = open.get(`${ch}:${d1}`);
        const on = q && q.shift();
        if (on) raw.push({ trk, ch, tick: on.tick, endTick: tick, note: d1, vel: on.vel });
      } else if (kind === 0xc0) {
        const k = `${trk}:${ch}`;
        if (!programs.has(k)) programs.set(k, d1);
      }
    }
    // Notes never switched off end with their track.
    for (const [k, q] of open) {
      const [ch, note] = k.split(':').map(Number);
      for (const on of q) raw.push({ trk, ch, tick: on.tick, endTick: tick, note, vel: on.vel });
    }
    pos = end;
  }

  // Some files declare more tracks than they hold, so only none at all is an error.
  if (trackCount > 0 && parsedTracks === 0) fail('no track data');

  const toSeconds = tickConverter(division, tempos);
  const byPart = new Map();
  let duration = 0;
  for (const r of raw) {
    const time = toSeconds(r.tick);
    const dur = Math.max(0, toSeconds(r.endTick) - time);
    const key = `${r.trk}:${r.ch}`;
    if (!byPart.has(key)) byPart.set(key, { trk: r.trk, ch: r.ch, notes: [] });
    byPart.get(key).notes.push({ time, dur, note: r.note, vel: r.vel / 127 });
    if (time + dur > duration) duration = time + dur;
  }

  const parts = [...byPart.values()].sort((a, b) => a.trk - b.trk || a.ch - b.ch);
  let melodic = 0;
  const tracks = parts.map(({ trk, ch, notes }) => {
    notes.sort((a, b) => a.time - b.time || a.note - b.note);
    const program = programs.get(`${trk}:${ch}`) ?? 0;
    const name = names[trk] || `Track ${trk + 1}`;
    return { name, channel: ch, program, instrument: suggestInstrument(ch, program, notes, melodic++), notes };
  });
  return { duration, tracks };
}

/** Tick -> seconds with a piecewise tempo map (default 120 BPM). SMPTE
 *  divisions (high bit set) are a fixed number of ticks per second. */
function tickConverter(division, tempos) {
  if (division & 0x8000) {
    const fps = 256 - (division >> 8); // two's-complement negative frame rate
    const perSecond = (fps === 29 ? 29.97 : fps) * (division & 0xff);
    return (tick) => tick / perSecond;
  }
  const map = [];
  let lastTick = 0, lastSec = 0, us = 500000;
  for (const t of tempos.sort((a, b) => a.tick - b.tick)) {
    lastSec += ((t.tick - lastTick) * us) / (division * 1e6);
    lastTick = t.tick;
    us = t.usPerBeat || us;
    map.push({ tick: lastTick, sec: lastSec, us });
  }
  return (tick) => {
    let seg = { tick: 0, sec: 0, us: 500000 };
    for (const m of map) { if (m.tick > tick) break; seg = m; }
    return seg.sec + ((tick - seg.tick) * seg.us) / (division * 1e6);
  };
}

/** Default voice for a part: channel 10 is drums, GM bass programs or a low
 *  part get the triangle, the rest rotate through the pulse/saw leads. */
function suggestInstrument(ch, program, notes, index) {
  if (ch === DRUM_CHANNEL) return 'drums';
  if (program >= 32 && program <= 39) return 'triangle';
  let sum = 0;
  for (const n of notes) sum += n.note;
  if (notes.length && sum / notes.length < 48) return 'triangle';
  if (program >= 40 && program <= 51) return 'strings';
  if (program >= 56 && program <= 63) return 'brass';
  if (program >= 72 && program <= 79) return 'flute';
  if (program <= 7) return 'piano';
  return ['pulse25', 'square', 'pulse12', 'saw'][index % 4];
}

// GM percussion, collapsed onto a few chip drums.
function drumParams(note, vel, seed) {
  if (note === 35 || note === 36) {
    return { wave: WAVE.TRIANGLE, freq: 150, slide: -6, sustain: 0.02, decay: 0.1, vol: 0.55 * vel };
  }
  if (note === 37 || note === 38 || note === 39 || note === 40) {
    return { wave: WAVE.NOISE, freq: 9000, sustain: 0.02, decay: 0.1, vol: 0.28 * vel, bits: 4, seed };
  }
  if ([41, 43, 45, 47, 48, 50].includes(note)) {
    return { wave: WAVE.TRIANGLE, freq: 70 + (note - 41) * 12, slide: -3, sustain: 0.03, decay: 0.15, vol: 0.45 * vel };
  }
  if ([49, 52, 55, 57].includes(note)) {
    return { wave: WAVE.NOISE, freq: 16000, sustain: 0.05, decay: 0.6, vol: 0.12 * vel, seed };
  }
  if (note === 46 || note === 51 || note === 53 || note === 59) {
    return { wave: WAVE.NOISE, freq: 20000, sustain: 0.03, decay: 0.2, vol: 0.09 * vel, seed };
  }
  return { wave: WAVE.NOISE, freq: 20000, sustain: 0.005, decay: 0.03, vol: 0.08 * vel, seed };
}

/** Render a parseMidi() result with chip voices, to a mono Float32Array.
 *  opts.tracks[i] overrides track i: { instrument, volume (0..1), mute,
 *  transpose (semitones) }. opts.speed scales tempo (0.25..4, default 1).
 *  The result is scaled down to a 0.9 peak instead of clipping. */
export function renderMidi(midi, opts = {}) {
  if (!midi || !Array.isArray(midi.tracks)) throw new TypeError('renderMidi expects the result of parseMidi()');
  const sampleRate = opts.sampleRate > 0 ? opts.sampleRate : SAMPLE_RATE;
  const speedIn = Number(opts.speed);
  const speed = Number.isFinite(speedIn) ? Math.min(4, Math.max(0.25, speedIn)) : 1;
  const settings = Array.isArray(opts.tracks) ? opts.tracks : [];

  const end = Math.min(MAX_MIDI_SECONDS, (Number(midi.duration) || 0) / speed + TAIL_SECONDS);
  const out = new Float32Array(Math.ceil(end * sampleRate));
  const limit = MAX_MIDI_SECONDS;

  midi.tracks.forEach((track, i) => {
    const s = settings[i] || {};
    if (s.mute) return;
    const volume = Number.isFinite(s.volume) ? Math.min(1, Math.max(0, s.volume)) : 1;
    if (volume === 0) return;
    const instrument = s.instrument || track.instrument;
    if (instrument !== 'drums' && !INSTRUMENTS[instrument]) throw new Error(`Unknown instrument: ${instrument}`);
    const transpose = Number.isFinite(s.transpose) ? Math.round(s.transpose) : 0;

    let hit = 0;
    for (const n of track.notes) {
      const time = n.time / speed;
      if (time >= limit) break;
      const at = Math.round(time * sampleRate);
      const vel = (Number.isFinite(n.vel) ? n.vel : 1) * volume;
      const p = instrument === 'drums'
        ? drumParams(n.note, vel, (0x5eed + i * 7919 + hit++) >>> 0)
        : instrumentNote(instrument, Math.min(127, Math.max(0, n.note + transpose)), { seconds: n.dur / speed, vel });
      renderSfxInto(out, at, p, sampleRate);
    }
  });

  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0.9) {
    const g = 0.9 / peak;
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }
  return out;
}
