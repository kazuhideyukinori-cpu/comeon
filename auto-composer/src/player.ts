// ライブ再生とオフラインレンダリング(WAV書き出し用)の橋渡し。
// スコアはすべて事前計算済みのため、Web Audio の各ノードは
// 開始時に一括で未来の時刻へスケジュールするだけでよい（ルックアヘッド不要）。

import type { Score } from "./compose.ts";
import { STYLES } from "./styles.ts";
import { type Engine, createEngine, stopEngine, triggerDrum, triggerNote } from "./synth.ts";
import type { AnyAudioContext } from "./synth.ts";

let liveCtx: AudioContext | null = null;
let liveEngine: Engine | null = null;
let startedAtCtxTime = 0;
let endTimer: number | null = null;

function scheduleScore(engine: Engine, score: Score, t0: number): void {
  for (const n of score.melody.notes) {
    triggerNote(engine, score.melody.instrument, t0 + n.time, n.duration, n.midi, n.velocity);
  }
  for (const n of score.chords.notes) {
    triggerNote(engine, score.chords.instrument, t0 + n.time, n.duration, n.midi, n.velocity);
  }
  for (const n of score.bass.notes) {
    triggerNote(engine, score.bass.instrument, t0 + n.time, n.duration, n.midi, n.velocity);
  }
  for (const d of score.drums) {
    triggerDrum(engine, d.type, t0 + d.time, d.velocity);
  }
}

export function isPlaying(): boolean {
  return liveCtx !== null && liveCtx.state !== "closed";
}

/** 再生開始からの経過秒数。再生していない場合は null */
export function getPlaybackSeconds(): number | null {
  if (!liveCtx) return null;
  return liveCtx.currentTime - startedAtCtxTime;
}

export function stopPlayback(): void {
  if (endTimer !== null) {
    window.clearTimeout(endTimer);
    endTimer = null;
  }
  if (liveEngine) stopEngine(liveEngine);
  liveEngine = null;
  if (liveCtx) {
    const ctx = liveCtx;
    liveCtx = null;
    void ctx.close().catch(() => {});
  }
}

const TAIL_SECONDS = 2.2;

export function playScore(score: Score, onEnd: () => void): void {
  stopPlayback();
  const audioCtx = new AudioContext();
  liveCtx = audioCtx;
  const style = STYLES[score.styleId];
  const engine = createEngine(audioCtx, audioCtx.destination, style.reverbWet);
  liveEngine = engine;
  const t0 = audioCtx.currentTime + 0.08;
  startedAtCtxTime = t0;
  scheduleScore(engine, score, t0);
  endTimer = window.setTimeout(
    () => {
      stopPlayback();
      onEnd();
    },
    (score.totalDuration + TAIL_SECONDS) * 1000,
  );
}

/** WAV書き出し用にスコア全体をオフラインでレンダリングする */
export async function renderScoreOffline(score: Score): Promise<AudioBuffer> {
  const style = STYLES[score.styleId];
  const sampleRate = 44100;
  const length = Math.ceil((score.totalDuration + TAIL_SECONDS) * sampleRate);
  const offlineCtx: AnyAudioContext = new OfflineAudioContext(2, length, sampleRate);
  const engine = createEngine(offlineCtx, offlineCtx.destination, style.reverbWet);
  scheduleScore(engine, score, 0);
  return offlineCtx.startRendering();
}
