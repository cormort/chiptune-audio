import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/index.js';

test('encodeWav writes a valid 16-bit mono PCM header and clamps samples', () => {
  const bytes = encodeWav(new Float32Array([0, 1, -1, 2, -2, 0.5]), 22050);
  const v = new DataView(bytes.buffer);
  const ascii = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
  assert.equal(bytes.length, 44 + 6 * 2);
  assert.equal(ascii(0), 'RIFF');
  assert.equal(v.getUint32(4, true), bytes.length - 8);
  assert.equal(ascii(8), 'WAVE');
  assert.equal(ascii(12), 'fmt ');
  assert.equal(v.getUint16(20, true), 1, 'PCM');
  assert.equal(v.getUint16(22, true), 1, 'mono');
  assert.equal(v.getUint32(24, true), 22050);
  assert.equal(v.getUint32(28, true), 44100, 'byte rate');
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(ascii(36), 'data');
  assert.equal(v.getUint32(40, true), 12);
  const pcm = [0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true));
  assert.deepEqual(pcm, [0, 32767, -32768, 32767, -32768, 16383]);
});

test('encodeWav handles empty input and rejects non-arrays', () => {
  assert.equal(encodeWav(new Float32Array(0)).length, 44);
  assert.throws(() => encodeWav('nope'), TypeError);
});
