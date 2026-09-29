/** Encode mono float samples (-1..1) as a 16-bit PCM WAV file. Samples outside
 *  -1..1 are clamped rather than wrapped. Returns the file bytes. */
export function encodeWav(samples, sampleRate = 44100) {
  if (!(samples instanceof Float32Array) && !Array.isArray(samples)) {
    throw new TypeError('encodeWav expects a Float32Array or an array of numbers');
  }
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 44100;
  const n = samples.length;
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);        // fmt chunk size
  v.setUint16(20, 1, true);         // PCM
  v.setUint16(22, 1, true);         // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);  // byte rate
  v.setUint16(32, 2, true);         // block align
  v.setUint16(34, 16, true);        // bits per sample
  ascii(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Number(samples[i]) || 0;
    const c = s < -1 ? -1 : s > 1 ? 1 : s;
    v.setInt16(44 + i * 2, c < 0 ? c * 0x8000 : c * 0x7fff, true);
  }
  return bytes;
}
