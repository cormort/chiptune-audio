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
  /** 2nd harmonic (the octave) level, 0..1. Default 0 (off). */
  h2?: number;
  /** 3rd harmonic (octave + fifth) level, 0..1. Default 0 (off). */
  h3?: number;
  /** 4th harmonic (two octaves) level, 0..1. Default 0 (off). */
  h4?: number;
  /** 5th harmonic (two octaves + major third) level, 0..1. Default 0 (off). */
  h5?: number;
  /** Extra detuned copies for width: 0 off, 1 one above, 2 above and below. */
  unison?: number;
  /** Detune between those copies, in cents, 0..50. Default 10. */
  detune?: number;
  /** One-pole lowpass on this voice, in Hz; 0 disables it. Default 0. */
  cutoff?: number;
  /** Noise burst mixed into the attack (hammer, breath, pick), 0..1. Default 0. */
  chiff?: number;
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
  | 'powerup' | 'select' | 'gameover' | 'win'
  | 'shoot' | 'blip' | 'click' | 'hurt' | 'pickup' | 'heal' | 'levelup' | 'door'
  | 'step' | 'bounce' | 'alarm' | 'teleport' | 'charge' | 'error' | 'splash';

export declare const SFX_DEFAULTS: Required<SfxParams>;
export declare const SFX_PRESETS: Record<SfxName, SfxParams>;

/** The timbre params (h2..h5, unison, detune, cutoff, chiff). */
export type TimbreParams = Pick<SfxParams, 'h2' | 'h3' | 'h4' | 'h5' | 'unison' | 'detune' | 'cutoff' | 'chiff'>;

/** Every chip param, plus the timbre params only when they are set: a sparse
 *  object keeps the single-oscillator render loop at full speed. */
export type NormalizedSfx = Required<Omit<SfxParams, keyof TimbreParams>> & TimbreParams;

/** Coerce arbitrary input into a complete, finite, in-range parameter set. */
export declare function normalizeSfx(params?: SfxParams): NormalizedSfx;

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

export type Mood =
  | 'happy' | 'calm' | 'tense' | 'sad'
  | 'heroic' | 'playful' | 'dreamy' | 'mysterious' | 'spooky' | 'boss' | 'groovy';

export interface MoodSpec {
  scale: 'major' | 'minor' | 'pentatonic' | 'dorian' | 'phrygian' | 'lydian' | 'harmonicMinor' | 'blues';
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

export interface PartMix {
  /** Square lead level, 0..1. Default 1. */
  lead?: number;
  /** Triangle bass level, 0..1. Default 1. */
  bass?: number;
  /** Drum level, 0..1. Default 1. */
  drums?: number;
}

export interface SongRenderOpts extends RenderOpts {
  /** Per-part levels. Normalisation still follows the unity mix. */
  mix?: PartMix;
}

/** Render a song to a seamlessly loopable mono Float32Array. */
export declare function renderSong(song: Song, opts?: SongRenderOpts): Float32Array;

export type InstrumentName =
  | 'square' | 'pulse25' | 'pulse12' | 'triangle' | 'saw' | 'organ'
  | 'flute' | 'strings' | 'brass' | 'piano' | 'pluck' | 'bell';

export type RealisticInstrumentName =
  | 'piano' | 'epiano' | 'organ' | 'strings' | 'flute' | 'brass'
  | 'guitar' | 'bell' | 'bass' | 'harp' | 'choir' | 'marimba';

/** Any instrument in either bank: a bare chip name, or `real:<name>` (and
 *  `chip:<name>`) to pick the bank explicitly. */
export type AnyInstrumentName =
  | InstrumentName | RealisticInstrumentName
  | `real:${RealisticInstrumentName}` | `chip:${InstrumentName}`;

export type InstrumentBank = 'chip' | 'real';

export interface Instrument {
  /** Sustain while held (key down / MIDI note length). */
  hold: boolean;
  /** Fade in seconds on release; null lets the note ring out. */
  release: number | null;
  /** SFX params without `freq`. */
  params: SfxParams;
  /** Realistic bank only: lowpass cutoff as a multiple of the note frequency. */
  tone?: number;
}

export declare const INSTRUMENTS: Record<InstrumentName, Instrument>;
/** The same twelve slots voiced as acoustic instruments (additive harmonics,
 *  detuned copies, an attack transient and a per-voice lowpass). */
export declare const REALISTIC_INSTRUMENTS: Record<RealisticInstrumentName, Instrument>;
export declare const INSTRUMENT_BANKS: {
  chip: Record<InstrumentName, Instrument>;
  real: Record<RealisticInstrumentName, Instrument>;
};
/** Chinese labels for every slot, per bank. */
export declare const INSTRUMENT_LABELS: {
  chip: Record<InstrumentName, string>;
  real: Record<RealisticInstrumentName, string>;
};
/** Sustain rendered for a keyboard note whose length is not known yet. */
export declare const HOLD_SECONDS: number;
/** MIDI note number to Hz (A4 = 69 = 440 Hz). */
export declare function noteFreq(note: number): number;
/** Look up an instrument in either bank; null when the name is unknown. */
export declare function resolveInstrument(
  name: string,
  bank?: InstrumentBank,
): { name: string; bank: InstrumentBank; spec: Instrument } | null;
/** Every selectable name, `real:` ones included. */
export declare function instrumentNames(): string[];
/** SFX params for one note on an instrument. */
export declare function instrumentNote(
  name: AnyInstrumentName,
  note: number,
  opts?: { seconds?: number; vel?: number; bank?: InstrumentBank },
): SfxParams;
/** Fade on key release, or null when the note rings out on its own. */
export declare function instrumentRelease(name: AnyInstrumentName, bank?: InstrumentBank): number | null;

export interface MidiNote {
  /** Start, in seconds. */
  time: number;
  /** Length, in seconds. */
  dur: number;
  /** MIDI note number. */
  note: number;
  /** Velocity, 0..1. */
  vel: number;
}

export interface MidiTrack {
  name: string;
  /** 0-based; 9 is GM percussion. */
  channel: number;
  program: number;
  /** Suggested voice. */
  instrument: InstrumentName | 'drums';
  notes: MidiNote[];
}

export interface Midi {
  /** Seconds, to the end of the last note. */
  duration: number;
  tracks: MidiTrack[];
}

export interface MidiTrackSettings {
  instrument?: AnyInstrumentName | 'drums';
  /** 0..1. Default 1. */
  volume?: number;
  mute?: boolean;
  /** Semitones. Default 0. */
  transpose?: number;
}

export interface MidiRenderOpts extends RenderOpts {
  /** Per-track overrides, indexed like `midi.tracks`. */
  tracks?: MidiTrackSettings[];
  /** Tempo multiplier, 0.25..4. Default 1. */
  speed?: number;
}

export declare const MAX_MIDI_SECONDS: number;
/** Parse a Standard MIDI File; throws on malformed input. */
export declare function parseMidi(data: ArrayBuffer | ArrayBufferView): Midi;
/** Render a parsed MIDI file with chip voices to mono PCM. */
export declare function renderMidi(midi: Midi, opts?: MidiRenderOpts): Float32Array;

export interface NoteHandle {
  source: AudioBufferSourceNode;
  /** Fade out over `fade` seconds (default 0.08) and stop. Idempotent. */
  release(fade?: number): void;
}

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

export interface MixLevels extends PartMix {
  /** Sound-effect bus level, 0..1. Default 1. */
  sfx?: number;
  /** Music bus level, 0..1. Default 1. */
  music?: number;
}

export declare class ChiptuneAudio {
  constructor(options?: ChiptuneAudioOptions);

  readonly ctx: AudioContext | null;
  readonly music: AudioBufferSourceNode | null;
  readonly sfxCache: Map<string, AudioBuffer>;
  volume: number;
  muted: boolean;
  /** Current mixer levels (use setMix to change them). */
  readonly mix: Readonly<Required<MixLevels>>;

  /** The rate buffers are rendered at; the live context rate once created. */
  readonly sampleRate: number;

  /** Play a preset name or a custom params object. */
  playSfx(name: SfxName | SfxParams, opts?: SfxPlayOptions): AudioBufferSourceNode | null;

  /** Render and cache a song without playing it (call from a loading screen). */
  preloadMusic(options?: SongOptions | Song): AudioBuffer | null;

  /** Play a loop; `options` is generateSong options or an existing song. */
  playMusic(options?: SongOptions | Song): AudioBufferSourceNode | null;

  /** Play a held note; release() it on key up. */
  playNote(params: SfxParams, opts?: SfxPlayOptions): NoteHandle | null;

  /** Render and play a parsed MIDI file on the music bus (replaces any song). */
  playMidi(midi: Midi, opts?: Omit<MidiRenderOpts, 'sampleRate'> & { loop?: boolean; offset?: number }): AudioBufferSourceNode | null;

  /** Seconds into the playing music (wraps for loops); 0 when stopped. */
  readonly musicTime: number;

  stopMusic(): void;
  stopAllSfx(): void;
  resume(): Promise<void>;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  /** Set mixer levels; `sfx`/`music` apply instantly, part levels re-render
   *  the playing loop and resume it in place. Returns the new levels. */
  setMix(levels: MixLevels): Required<MixLevels>;
  /** Adjust the opt-in master filter. Returns false when none is configured. */
  setFilter(freq: number): boolean;
  /** Release the AudioContext and every buffer. */
  dispose(): Promise<void>;
}
