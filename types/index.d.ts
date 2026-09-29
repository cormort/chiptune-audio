// Type definitions for chiptune-audio.
// Written by hand to match src/; there is no build step and no generated output.

export declare const SAMPLE_RATE: 44100;
export declare const MAX_SFX_SECONDS: number;
export declare const MAX_BARS: number;
export declare const STEPS_PER_BAR: 16;

export declare const WAVE: {
  readonly SQUARE: 0;
  readonly SAW: 1;
  readonly TRIANGLE: 2;
  readonly NOISE: 3;
};
export type Wave = 0 | 1 | 2 | 3;

export interface SfxParams {
  /** Waveform. Default `WAVE.SQUARE`. */
  wave?: Wave;
  /** Base frequency in Hz, 0..20000. Default 440. */
  freq?: number;
  /** Pitch sweep in octaves per second, -64..64. Default 0. */
  slide?: number;
  /** Square pulse width, 0.05..0.95. Default 0.5. */
  duty?: number;
  /** Duty change per second, -256..256. Default 0. */
  dutySweep?: number;
  /** Vibrato depth as a fraction of frequency, 0..1. Default 0. */
  vibDepth?: number;
  /** Vibrato rate in Hz, 0..4000. Default 0. */
  vibRate?: number;
  /** Frequency multiplier applied at `arpTime`, 0.01..64. Default 1. */
  arpMult?: number;
  /** Arpeggio switch time in seconds; 0 disables it. Default 0. */
  arpTime?: number;
  /** Bit-crush depth in bits, 0..16; 0 disables it. Default 0. */
  bits?: number;
  /** Attack in seconds. Default 0.005. */
  attack?: number;
  /** Sustain in seconds. Default 0.1. */
  sustain?: number;
  /** Decay in seconds. Default 0.1. */
  decay?: number;
  /** Output level, 0..1. Default 0.5. */
  vol?: number;
  /** Noise PRNG seed, so successive noise hits can differ. Default 1. */
  seed?: number;
}

export type SfxName =
  | 'coin' | 'jump' | 'laser' | 'hit' | 'explosion'
  | 'powerup' | 'select' | 'gameover' | 'win';

export declare const SFX_DEFAULTS: Required<SfxParams>;
export declare const SFX_PRESETS: Record<SfxName, SfxParams>;

/** Coerce arbitrary input into a complete, finite, in-range parameter set. */
export declare function normalizeSfx(params?: SfxParams): Required<SfxParams>;

export interface RenderOpts {
  /** Defaults to 44100. The engine passes the AudioContext rate. */
  sampleRate?: number;
}

/** Render one sound to a fresh mono Float32Array (44100 Hz by default). */
export declare function renderSfx(params?: SfxParams, opts?: RenderOpts): Float32Array;

/** Additively mix a sound into `out` at `offset`. Returns samples written. */
export declare function renderSfxInto(
  out: Float32Array,
  offset: number,
  params?: SfxParams,
  sampleRate?: number,
): number;

export type Mood = 'happy' | 'calm' | 'tense' | 'sad';

export interface MoodSpec {
  scale: 'major' | 'minor' | 'pentatonic';
  bpm: number;
  duty: number;
  density: number;
  root: number;
}

export declare const MOODS: Record<Mood, MoodSpec>;

export interface SongNote {
  /** Step index (16 steps per bar). */
  step: number;
  /** Length in steps. */
  len: number;
  /** MIDI note number. */
  note: number;
}

export interface Song {
  seed: number;
  mood: Mood;
  bars: number;
  bpm: number;
  duty: number;
  lead: SongNote[];
  bass: SongNote[];
}

export interface SongOptions {
  seed?: number;
  mood?: Mood;
  /** 1..128. Default 8. */
  bars?: number;
}

/** Deterministic composition: the same options always produce the same song. */
export declare function generateSong(options?: SongOptions): Song;

/** Render a song to a seamlessly loopable mono Float32Array. */
export declare function renderSong(song: Song, opts?: RenderOpts): Float32Array;

/** Seeded PRNG; the same seed always yields the same sequence. */
export declare function mulberry32(seed: number): () => number;

export interface SfxPlayOptions {
  /** Stereo position, -1 (left) .. 1 (right). Default 0. */
  pan?: number;
  /** Playback rate; >1 is higher and shorter. Default 1. */
  rate?: number;
  /** Per-playback gain multiplier. Default 1. */
  gain?: number;
}

export interface ChiptuneAudioOptions {
  /** Master volume, 0..1. Default 0.6. */
  volume?: number;
  /** Force an AudioContext sample rate. Defaults to the device rate. */
  sampleRate?: number;
  /** Opt-in master output filter (tames naive-oscillator aliasing). */
  filter?: { type?: BiquadFilterType; freq?: number; q?: number } | null;
}

export declare class ChiptuneAudio {
  constructor(options?: ChiptuneAudioOptions);

  readonly ctx: AudioContext | null;
  readonly music: AudioBufferSourceNode | null;
  readonly sfxCache: Map<string, AudioBuffer>;
  volume: number;
  muted: boolean;

  /** The rate buffers are rendered at; the live context rate once created. */
  readonly sampleRate: number;

  /** Play a preset name or a custom params object. */
  playSfx(name: SfxName | SfxParams, opts?: SfxPlayOptions): AudioBufferSourceNode | null;

  /** Render and cache a song without playing it (call from a loading screen). */
  preloadMusic(options?: SongOptions | Song): AudioBuffer | null;

  /** Play a loop; `options` is generateSong options or an existing song. */
  playMusic(options?: SongOptions | Song): AudioBufferSourceNode | null;

  stopMusic(): void;
  stopAllSfx(): void;
  resume(): Promise<void>;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  /** Adjust the opt-in master filter. Returns false when none is configured. */
  setFilter(freq: number): boolean;
  /** Release the AudioContext and every buffer. */
  dispose(): Promise<void>;
}
