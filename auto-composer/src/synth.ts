// Web Audio API によるシンセサイザー本体。
// AudioContext（ライブ再生）と OfflineAudioContext（WAV書き出し）の両方で
// まったく同じコードが動くよう、すべて汎用の AnyAudioContext を受け取る。
// サンプル音源は一切使わず、オシレーター/ノイズ/フィルターのみで音を生成する。

import type { DrumType, InstrumentName } from "./instruments.ts";
import { midiToFreq } from "./theory.ts";

export type AnyAudioContext = AudioContext | OfflineAudioContext;
type SourceNode = OscillatorNode | AudioBufferSourceNode;

export interface SoundBus {
  input: GainNode;
}

export interface Engine {
  ctx: AnyAudioContext;
  master: GainNode;
  noiseBuffer: AudioBuffer;
  buses: Record<InstrumentName, GainNode>;
  drumBus: GainNode;
  /** 生成された全ソースノード。stop() で一括停止するために保持する */
  sources: SourceNode[];
}

function makeSoftLimiter(ctx: AnyAudioContext): WaveShaperNode {
  const shaper = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
  }
  shaper.curve = curve;
  shaper.oversample = "2x";
  return shaper;
}

function createNoiseBuffer(ctx: AnyAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function createReverbImpulse(ctx: AnyAudioContext, duration: number, decay: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

const INSTRUMENTS: InstrumentName[] = ["piano", "epiano", "pad", "bass", "pluck", "brass"];

export function createEngine(ctx: AnyAudioContext, destination: AudioNode, reverbWet: number): Engine {
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const limiter = makeSoftLimiter(ctx);
  master.connect(limiter);
  limiter.connect(destination);

  const convolver = ctx.createConvolver();
  convolver.buffer = createReverbImpulse(ctx, 2.6, 2.5);
  const wet = ctx.createGain();
  wet.gain.value = reverbWet;
  convolver.connect(wet);
  wet.connect(master);

  const buses = {} as Record<InstrumentName, GainNode>;
  for (const name of INSTRUMENTS) {
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(master);
    bus.connect(convolver);
    buses[name] = bus;
  }

  const drumBus = ctx.createGain();
  drumBus.gain.value = 1;
  drumBus.connect(master);
  drumBus.connect(convolver);

  return {
    ctx,
    master,
    noiseBuffer: createNoiseBuffer(ctx, 2),
    buses,
    drumBus,
    sources: [],
  };
}

/** master に接続したまま全ての発音中ソースを即座に停止する（Stopボタン用） */
export function stopEngine(engine: Engine): void {
  const now = engine.ctx.currentTime;
  for (const src of engine.sources) {
    try {
      src.stop(now);
    } catch {
      // すでに停止済み/開始前のノードは無視
    }
  }
  engine.sources.length = 0;
}

function track(engine: Engine, src: SourceNode): void {
  engine.sources.push(src);
}

/** ADSR風のゲインエンベロープをスケジュールする。releaseの開始時刻を返す */
function envelope(
  gain: AudioParam,
  t0: number,
  peak: number,
  attack: number,
  decay: number,
  sustainRatio: number,
  release: number,
  hold: number,
): number {
  const sustain = Math.max(0.0001, peak * sustainRatio);
  gain.cancelScheduledValues(t0);
  gain.setValueAtTime(0.0001, t0);
  gain.linearRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
  gain.linearRampToValueAtTime(sustain, t0 + attack + decay);
  const releaseStart = Math.max(t0 + attack + decay, t0 + hold);
  gain.setValueAtTime(sustain, releaseStart);
  gain.exponentialRampToValueAtTime(0.0001, releaseStart + release);
  return releaseStart + release;
}

function bus(engine: Engine, name: InstrumentName): GainNode {
  return engine.buses[name];
}

// ---- メロディ/ハーモニー楽器 ----

function playPiano(engine: Engine, t0: number, dur: number, midi: number, vel: number): void {
  const { ctx } = engine;
  const freq = midiToFreq(midi);
  const out = ctx.createGain();
  out.connect(bus(engine, "piano"));
  const end = envelope(out.gain, t0, vel, 0.004, 0.35, 0.28, 0.55, dur);

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = Math.min(9000, freq * 5 + 900);
  filt.Q.value = 0.5;
  filt.connect(out);

  const o1 = ctx.createOscillator();
  o1.type = "triangle";
  o1.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = "sine";
  o2.frequency.value = freq * 2.003;
  const g2 = ctx.createGain();
  g2.gain.value = 0.22;
  o1.connect(filt);
  o2.connect(g2);
  g2.connect(filt);
  o1.start(t0);
  o2.start(t0);
  o1.stop(end + 0.05);
  o2.stop(end + 0.05);
  track(engine, o1);
  track(engine, o2);
}

function playEPiano(engine: Engine, t0: number, dur: number, midi: number, vel: number): void {
  const { ctx } = engine;
  const freq = midiToFreq(midi);
  const out = ctx.createGain();
  out.connect(bus(engine, "epiano"));
  const end = envelope(out.gain, t0, vel * 0.9, 0.006, 0.5, 0.22, 0.7, dur);

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = Math.min(6000, freq * 3.2 + 500);
  filt.Q.value = 0.9;
  filt.connect(out);

  const o1 = ctx.createOscillator();
  o1.type = "sine";
  o1.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = "sine";
  o2.frequency.value = freq * 4.01; // FMっぽい倍音でエレピらしい鈴鳴りを付与
  const g2 = ctx.createGain();
  g2.gain.value = 0.15;
  envelope(g2.gain, t0, 0.15, 0.003, 0.15, 0, 0.08, 0);
  o1.connect(filt);
  o2.connect(g2);
  g2.connect(filt);
  o1.start(t0);
  o2.start(t0);
  o1.stop(end + 0.05);
  o2.stop(end + 0.05);
  track(engine, o1);
  track(engine, o2);
}

function playPad(engine: Engine, t0: number, dur: number, midi: number, vel: number): void {
  const { ctx } = engine;
  const freq = midiToFreq(midi);
  const out = ctx.createGain();
  out.connect(bus(engine, "pad"));
  const attack = Math.min(1.1, dur * 0.35 + 0.15);
  const end = envelope(out.gain, t0, vel * 0.55, attack, 0.6, 0.75, 1.4, dur);

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 1800;
  filt.Q.value = 0.3;
  filt.frequency.setValueAtTime(600, t0);
  filt.frequency.linearRampToValueAtTime(1800, t0 + attack + 0.3);
  filt.connect(out);

  const detunes = [-7, 0, 7, 12];
  for (const cents of detunes) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = cents;
    o.connect(filt);
    o.start(t0);
    o.stop(end + 0.1);
    track(engine, o);
  }
}

function playBass(engine: Engine, t0: number, dur: number, midi: number, vel: number): void {
  const { ctx } = engine;
  const freq = midiToFreq(midi) / 2;
  const out = ctx.createGain();
  out.connect(bus(engine, "bass"));
  const end = envelope(out.gain, t0, vel, 0.006, 0.12, 0.55, 0.25, dur);

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 500;
  filt.Q.value = 0.6;
  filt.connect(out);

  const o1 = ctx.createOscillator();
  o1.type = "triangle";
  o1.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = "sine";
  o2.frequency.value = freq;
  const g2 = ctx.createGain();
  g2.gain.value = 0.7;
  o1.connect(filt);
  o2.connect(g2);
  g2.connect(filt);
  o1.start(t0);
  o2.start(t0);
  o1.stop(end + 0.05);
  o2.stop(end + 0.05);
  track(engine, o1);
  track(engine, o2);
}

function playPluck(engine: Engine, t0: number, dur: number, midi: number, vel: number): void {
  const { ctx } = engine;
  const freq = midiToFreq(midi);
  const out = ctx.createGain();
  out.connect(bus(engine, "pluck"));
  const end = envelope(out.gain, t0, vel, 0.002, 0.18, 0.05, 0.12, Math.min(dur, 0.2));

  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(freq * 8 + 1500, t0);
  filt.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.5), t0 + 0.2);
  filt.Q.value = 1.2;
  filt.connect(out);

  const o = ctx.createOscillator();
  o.type = "sawtooth";
  o.frequency.value = freq;
  o.connect(filt);
  o.start(t0);
  o.stop(end + 0.05);
  track(engine, o);
}

function playBrass(engine: Engine, t0: number, dur: number, midi: number, vel: number): void {
  const { ctx } = engine;
  const freq = midiToFreq(midi);
  const out = ctx.createGain();
  out.connect(bus(engine, "brass"));
  const end = envelope(out.gain, t0, vel * 0.8, 0.05, 0.15, 0.7, 0.3, dur);

  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = freq * 2.2;
  filt.Q.value = 0.9;
  filt.connect(out);

  for (const [type, detune, gain] of [
    ["sawtooth", 0, 0.6],
    ["sawtooth", 6, 0.4],
    ["square", -6, 0.25],
  ] as const) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g);
    g.connect(filt);
    o.start(t0);
    o.stop(end + 0.05);
    track(engine, o);
  }
}

export function triggerNote(
  engine: Engine,
  instrument: InstrumentName,
  t0: number,
  dur: number,
  midi: number,
  velocity: number,
): void {
  const vel = Math.min(1, Math.max(0, velocity));
  switch (instrument) {
    case "piano":
      return playPiano(engine, t0, dur, midi, vel);
    case "epiano":
      return playEPiano(engine, t0, dur, midi, vel);
    case "pad":
      return playPad(engine, t0, dur, midi, vel);
    case "bass":
      return playBass(engine, t0, dur, midi, vel);
    case "pluck":
      return playPluck(engine, t0, dur, midi, vel);
    case "brass":
      return playBrass(engine, t0, dur, midi, vel);
  }
}

// ---- ドラム/パーカッション ----

function noiseSource(engine: Engine): AudioBufferSourceNode {
  const src = engine.ctx.createBufferSource();
  src.buffer = engine.noiseBuffer;
  src.loop = false;
  return src;
}

function playKick(engine: Engine, t0: number, vel: number): void {
  const { ctx } = engine;
  const out = ctx.createGain();
  out.connect(engine.drumBus);
  envelope(out.gain, t0, vel, 0.001, 0.28, 0, 0.02, 0);

  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(160, t0);
  o.frequency.exponentialRampToValueAtTime(46, t0 + 0.14);
  o.connect(out);
  o.start(t0);
  o.stop(t0 + 0.32);
  track(engine, o);

  const click = noiseSource(engine);
  const clickFilt = ctx.createBiquadFilter();
  clickFilt.type = "bandpass";
  clickFilt.frequency.value = 1200;
  const clickGain = ctx.createGain();
  envelope(clickGain.gain, t0, vel * 0.35, 0.001, 0.01, 0, 0.02, 0);
  click.connect(clickFilt);
  clickFilt.connect(clickGain);
  clickGain.connect(engine.drumBus);
  click.start(t0);
  click.stop(t0 + 0.03);
  track(engine, click);
}

function playSnare(engine: Engine, t0: number, vel: number): void {
  const { ctx } = engine;
  const noise = noiseSource(engine);
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = 1700;
  filt.Q.value = 0.7;
  const ng = ctx.createGain();
  envelope(ng.gain, t0, vel, 0.001, 0.16, 0, 0.03, 0);
  noise.connect(filt);
  filt.connect(ng);
  ng.connect(engine.drumBus);
  noise.start(t0);
  noise.stop(t0 + 0.22);
  track(engine, noise);

  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.value = 190;
  const og = ctx.createGain();
  envelope(og.gain, t0, vel * 0.5, 0.001, 0.08, 0, 0.02, 0);
  o.connect(og);
  og.connect(engine.drumBus);
  o.start(t0);
  o.stop(t0 + 0.12);
  track(engine, o);
}

function playHat(engine: Engine, t0: number, vel: number, open: boolean): void {
  const { ctx } = engine;
  const noise = noiseSource(engine);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7500;
  const g = ctx.createGain();
  const decay = open ? 0.32 : 0.055;
  envelope(g.gain, t0, vel * 0.6, 0.001, decay, 0, 0.02, 0);
  noise.connect(hp);
  hp.connect(g);
  g.connect(engine.drumBus);
  noise.start(t0);
  noise.stop(t0 + decay + 0.05);
  track(engine, noise);
}

function playClap(engine: Engine, t0: number, vel: number): void {
  const { ctx } = engine;
  for (const offset of [0, 0.012, 0.024]) {
    const noise = noiseSource(engine);
    const filt = ctx.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = 1500;
    const g = ctx.createGain();
    envelope(g.gain, t0 + offset, vel * 0.7, 0.001, 0.08, 0, 0.05, 0);
    noise.connect(filt);
    filt.connect(g);
    g.connect(engine.drumBus);
    noise.start(t0 + offset);
    noise.stop(t0 + offset + 0.14);
    track(engine, noise);
  }
}

function playTom(engine: Engine, t0: number, vel: number): void {
  const { ctx } = engine;
  const out = ctx.createGain();
  out.connect(engine.drumBus);
  envelope(out.gain, t0, vel, 0.002, 0.24, 0, 0.05, 0);
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(180, t0);
  o.frequency.exponentialRampToValueAtTime(85, t0 + 0.22);
  o.connect(out);
  o.start(t0);
  o.stop(t0 + 0.32);
  track(engine, o);
}

function playShaker(engine: Engine, t0: number, vel: number): void {
  const { ctx } = engine;
  const noise = noiseSource(engine);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 6500;
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  envelope(g.gain, t0, vel * 0.4, 0.001, 0.06, 0, 0.02, 0);
  noise.connect(bp);
  bp.connect(g);
  g.connect(engine.drumBus);
  noise.start(t0);
  noise.stop(t0 + 0.1);
  track(engine, noise);
}

export function triggerDrum(engine: Engine, type: DrumType, t0: number, velocity: number): void {
  const vel = Math.min(1, Math.max(0, velocity));
  switch (type) {
    case "kick":
      return playKick(engine, t0, vel);
    case "snare":
      return playSnare(engine, t0, vel);
    case "hihat":
      return playHat(engine, t0, vel, false);
    case "openhat":
      return playHat(engine, t0, vel, true);
    case "clap":
      return playClap(engine, t0, vel);
    case "tom":
      return playTom(engine, t0, vel);
    case "shaker":
      return playShaker(engine, t0, vel);
  }
}
