#!/usr/bin/env node
// Command-line front end, meant for scripts and AI agents: every command writes
// a WAV file and prints a JSON summary (duration, peak, RMS, the parameters
// used) on stdout, so the result can be checked without listening to it.
// Errors print {"error": "..."} on stderr and exit with status 1.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { parseArgs } from 'node:util';
import {
  renderSfx, normalizeSfx, SFX_PRESETS, SFX_DEFAULTS, WAVE,
  generateSong, renderSong, MOODS, STEPS_PER_BAR,
  parseMidi, renderMidi, INSTRUMENTS, REALISTIC_INSTRUMENTS, instrumentNames, resolveInstrument, encodeWav,
} from '../src/index.js';

const HELP = `chiptune: 8-bit sound effects, music and MIDI remixes as WAV files.

Usage:
  chiptune list [presets|moods|instruments|params]
  chiptune sfx <preset | JSON params> [--param key=value ...] [-o out.wav]
  chiptune music [--mood happy] [--seed 1] [--bars 8] [--loops 1]
                 [--mix lead=1 --mix bass=1 --mix drums=1] [-o out.wav]
  chiptune midi <file.mid|file.smf> --info
  chiptune midi <file.mid|file.smf> [--track N=instrument|mute] [--volume N=0..1]
                 [--transpose N=semitones] [--speed 1] [-o out.wav]

Common options:
  -o, --out FILE   output path (default: derived from the command)
  --rate HZ        sample rate (default 44100)
  -h, --help       this text

Every command prints a JSON summary on stdout. Tracks are numbered from 1, as
"chiptune midi FILE --info" lists them. See AGENTS.md for parameter ranges.`;

const WAVE_NAMES = Object.fromEntries(Object.entries(WAVE).map(([k, v]) => [k.toLowerCase(), v]));

class UsageError extends Error {}

function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      rate: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      param: { type: 'string', multiple: true },
      mood: { type: 'string' },
      seed: { type: 'string' },
      bars: { type: 'string' },
      loops: { type: 'string' },
      mix: { type: 'string', multiple: true },
      info: { type: 'boolean' },
      track: { type: 'string', multiple: true },
      volume: { type: 'string', multiple: true },
      transpose: { type: 'string', multiple: true },
      speed: { type: 'string' },
    },
  });
  const [cmd, ...args] = positionals;
  if (o.help || !cmd) return { help: HELP };
  const rate = o.rate === undefined ? 44100 : num(o.rate, '--rate');
  if (!(rate >= 8000 && rate <= 192000)) throw new UsageError('--rate must be between 8000 and 192000');

  switch (cmd) {
    case 'list': return list(args[0]);
    case 'sfx': return sfx(args[0], o, rate);
    case 'music': return music(o, rate);
    case 'midi': return midi(args[0], o, rate);
    default: throw new UsageError(`unknown command "${cmd}" (expected list, sfx, music or midi)`);
  }
}

function num(v, what) {
  const n = Number(v);
  if (v === '' || !Number.isFinite(n)) throw new UsageError(`${what} expects a number, got "${v}"`);
  return n;
}

/** "key=value" pairs (repeated flags or comma lists) -> [[key, value], ...] */
function pairs(list, what) {
  return (list || []).flatMap((s) => s.split(',')).filter(Boolean).map((s) => {
    const i = s.indexOf('=');
    if (i <= 0) throw new UsageError(`${what} expects key=value, got "${s}"`);
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  });
}

function list(what = 'all') {
  const all = {
    presets: SFX_PRESETS,
    moods: MOODS,
    instruments: [...instrumentNames(), 'drums'],
    params: { defaults: SFX_DEFAULTS, waves: WAVE_NAMES },
  };
  if (what === 'all') return all;
  if (!(what in all)) throw new UsageError(`list expects presets, moods, instruments or params, got "${what}"`);
  return { [what]: all[what] };
}

function sfx(spec, o, rate) {
  if (!spec) throw new UsageError('sfx needs a preset name or a JSON params object');
  let params;
  let name;
  if (spec.trim().startsWith('{')) {
    try { params = JSON.parse(spec); } catch (e) { throw new UsageError(`invalid JSON params: ${e.message}`); }
    name = 'sfx';
  } else {
    if (!SFX_PRESETS[spec]) throw new UsageError(`unknown preset "${spec}" (see: chiptune list presets)`);
    params = { ...SFX_PRESETS[spec] };
    name = spec;
  }
  for (const [k, v] of pairs(o.param, '--param')) {
    if (!(k in SFX_DEFAULTS)) throw new UsageError(`unknown param "${k}" (see: chiptune list params)`);
    params[k] = k === 'wave' && v.toLowerCase() in WAVE_NAMES ? WAVE_NAMES[v.toLowerCase()] : num(v, `--param ${k}`);
  }
  const samples = renderSfx(params, { sampleRate: rate });
  return write(o.out || `${name}.wav`, samples, rate, { params: normalizeSfx(params) });
}

function music(o, rate) {
  const mood = o.mood || 'happy';
  if (!MOODS[mood]) throw new UsageError(`unknown mood "${mood}" (see: chiptune list moods)`);
  const seed = o.seed === undefined ? 1 : num(o.seed, '--seed');
  const bars = o.bars === undefined ? 8 : num(o.bars, '--bars');
  const loops = o.loops === undefined ? 1 : num(o.loops, '--loops');
  if (!(Number.isInteger(loops) && loops >= 1 && loops <= 16)) throw new UsageError('--loops must be an integer from 1 to 16');
  const mix = {};
  for (const [k, v] of pairs(o.mix, '--mix')) {
    if (!['lead', 'bass', 'drums'].includes(k)) throw new UsageError(`--mix part must be lead, bass or drums, got "${k}"`);
    mix[k] = num(v, `--mix ${k}`);
  }
  let song;
  try { song = generateSong({ seed, mood, bars }); } catch (e) { throw new UsageError(e.message); }
  const loop = renderSong(song, Object.keys(mix).length ? { sampleRate: rate, mix } : { sampleRate: rate });
  const samples = new Float32Array(loop.length * loops);
  for (let i = 0; i < loops; i++) samples.set(loop, i * loop.length);
  const loopSeconds = loop.length / rate;
  return write(o.out || `music-${mood}-${song.seed}.wav`, samples, rate, {
    mood, seed: song.seed, bars: song.bars, bpm: song.bpm, loops, loopSeconds: Math.round(loopSeconds * 10000) / 10000,
    mix: { lead: 1, bass: 1, drums: 1, ...mix },
    notes: { lead: song.lead.length, bass: song.bass.length, steps: song.bars * STEPS_PER_BAR },
  });
}

function midi(file, o, rate) {
  if (!file) throw new UsageError('midi needs a file (.mid or .smf)');
  let data;
  try { data = readFileSync(file); } catch (e) { throw new UsageError(`cannot read ${file}: ${e.code || e.message}`); }
  let m;
  try { m = parseMidi(data); } catch (e) { throw new UsageError(e.message); }
  const describe = (t, i, s = {}) => ({
    track: i + 1, name: t.name, channel: t.channel + 1, program: t.program, notes: t.notes.length,
    instrument: s.instrument || t.instrument, volume: s.volume ?? 1, mute: !!s.mute, transpose: s.transpose ?? 0,
  });
  if (o.info) {
    return { file, duration: m.duration, instruments: [...instrumentNames(), 'drums'], tracks: m.tracks.map((t, i) => describe(t, i)) };
  }

  const settings = m.tracks.map(() => ({}));
  const at = (k, flag) => {
    const i = Number(k) - 1;
    if (!Number.isInteger(i) || !settings[i]) throw new UsageError(`${flag}: no track ${k} (this file has ${settings.length}; see --info)`);
    return settings[i];
  };
  for (const [k, v] of pairs(o.track, '--track')) {
    if (v === 'mute') at(k, '--track').mute = true;
    else if (v === 'drums' || resolveInstrument(v)) at(k, '--track').instrument = v;
    else throw new UsageError(`--track ${k}: unknown instrument "${v}" (see: chiptune list instruments)`);
  }
  for (const [k, v] of pairs(o.volume, '--volume')) at(k, '--volume').volume = num(v, `--volume ${k}`);
  for (const [k, v] of pairs(o.transpose, '--transpose')) at(k, '--transpose').transpose = num(v, `--transpose ${k}`);
  const speed = o.speed === undefined ? 1 : num(o.speed, '--speed');
  if (!(speed >= 0.25 && speed <= 4)) throw new UsageError('--speed must be between 0.25 and 4');

  const samples = renderMidi(m, { sampleRate: rate, tracks: settings, speed });
  const out = o.out || `${basename(file, extname(file))}-remix.wav`;
  return write(out, samples, rate, { source: file, speed, tracks: m.tracks.map((t, i) => describe(t, i, settings[i])) });
}

function write(file, samples, rate, extra) {
  writeFileSync(file, encodeWav(samples, rate));
  let peak = 0, sum = 0;
  for (const s of samples) { const a = Math.abs(s); if (a > peak) peak = a; sum += s * s; }
  const round = (v) => Math.round(v * 10000) / 10000;
  return {
    file, seconds: round(samples.length / rate), sampleRate: rate, samples: samples.length,
    peak: round(peak), rms: round(samples.length ? Math.sqrt(sum / samples.length) : 0), silent: peak === 0,
    ...extra,
  };
}

try {
  const result = main(process.argv.slice(2));
  if (result.help) process.stdout.write(result.help + '\n');
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (e) {
  const known = e instanceof UsageError || e.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || e.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE';
  process.stderr.write(JSON.stringify({ error: e.message }) + '\n');
  if (!known) process.stderr.write(e.stack + '\n');
  process.exitCode = 1;
}
