import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { track, smf, name } from './smf.js';

const BIN = fileURLToPath(new URL('../bin/chiptune.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'chiptune-cli-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const run = (...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: r.stdout ? safeJson(r.stdout) : null, err: r.stderr ? safeJson(r.stderr.split('\n')[0]) : null, raw: r.stdout };
};
const safeJson = (s) => { try { return JSON.parse(s); } catch { return s; } };
const wavFrames = (file) => {
  const b = readFileSync(join(dir, file));
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  return b.readUInt32LE(40) / 2;
};

test('cli sfx: preset with overrides writes a WAV and reports it', () => {
  const r = run('sfx', 'coin', '--param', 'freq=500,wave=triangle', '-o', 'c.wav');
  assert.equal(r.code, 0);
  assert.equal(r.out.file, 'c.wav');
  assert.equal(r.out.params.freq, 500);
  assert.equal(r.out.params.wave, 2);
  assert.equal(r.out.silent, false);
  assert.equal(wavFrames('c.wav'), r.out.samples);
});

test('cli sfx: JSON params and --rate', () => {
  const r = run('sfx', '{"freq":300,"decay":0.2}', '--rate', '22050');
  assert.equal(r.code, 0);
  assert.equal(r.out.file, 'sfx.wav');
  assert.equal(r.out.sampleRate, 22050);
});

test('cli music: loops multiply the length and mix is reported', () => {
  const one = run('music', '--mood', 'calm', '--seed', '3', '--bars', '2', '-o', 'a.wav');
  const two = run('music', '--mood', 'calm', '--seed', '3', '--bars', '2', '--loops', '2', '--mix', 'drums=0', '-o', 'b.wav');
  assert.equal(one.code, 0);
  assert.equal(two.out.samples, one.out.samples * 2);
  assert.deepEqual(two.out.mix, { lead: 1, bass: 1, drums: 0 });
  assert.equal(wavFrames('b.wav'), two.out.samples);
});

test('cli midi: --info lists tracks, overrides are applied and echoed', () => {
  writeFileSync(join(dir, 'in.mid'), smf(0, 96, [track([
    [0, ...name('Song')], [0, 0x90, 72, 100], [0, 0x91, 36, 100], [96, 0x80, 72, 0], [0, 0x81, 36, 0],
  ])]));
  const info = run('midi', 'in.mid', '--info');
  assert.equal(info.code, 0);
  assert.deepEqual(info.out.tracks.map((t) => [t.track, t.channel, t.instrument]), [[1, 1, 'piano'], [2, 2, 'triangle']], 'no program change = GM program 0, piano');
  const r = run('midi', 'in.mid', '--track', '1=bell', '--track', '2=mute', '--speed', '2');
  assert.equal(r.code, 0);
  assert.equal(r.out.file, 'in-remix.wav');
  assert.equal(r.out.tracks[0].instrument, 'bell');
  assert.equal(r.out.tracks[1].mute, true);
});

test('cli list and help', () => {
  assert.ok(run('list', 'presets').out.presets.coin);
  assert.ok(run('list').out.instruments.includes('drums'));
  assert.match(run('--help').raw, /Usage:/);
});

test('cli errors exit 1 with a JSON message and write nothing', () => {
  for (const args of [
    ['sfx', 'nope'], ['sfx', '{bad json'], ['sfx', 'coin', '--param', 'volume=1'], ['music', '--mood', 'jazz'],
    ['music', '--bars', '0'], ['midi', 'missing.mid'], ['midi'], ['explode'], ['music', '--bogus'], ['list', 'x'],
    ['sfx', 'coin', '--rate', '10'],
  ]) {
    const r = run(...args);
    assert.equal(r.code, 1, args.join(' '));
    assert.equal(typeof r.err.error, 'string', args.join(' '));
  }
});
