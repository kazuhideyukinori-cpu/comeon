export interface RallyCandidate {
  start: number; // ラリー開始（推定）
  end: number; // ラリー終了＝得点が入った瞬間の推定タイムスタンプ
}

export interface ScanResult {
  duration: number;
  hasAudio: boolean;
  candidates: RallyCandidate[];
}

const MOTION_W = 32;
const MOTION_H = 18;
const SAMPLE_STEP = 0.3; // seconds between analysis samples
const PLAYBACK_RATE = 4; // 実時間の何倍速で読み進めるか

// ラリー間の「間」とみなす最低の低活動継続時間。卓球のプレー中の一瞬の静止より
// 長く、得点後の球拾い・サーブ準備の間より短くなるよう調整。
const BREAK_MIN_LEN = 1.1;
// これより短いラリー候補はノイズとして無視
const RALLY_MIN_LEN = 0.5;
// ヒステリシス方式の閾値（下位/上位何%を「低活動」「高活動」とみなすか）。
// 卓球の動き・打球音は瞬間的なスパイクになりやすく単一閾値だとノイズに弱いため、
// 「一度は高活動を検知するまでラリー開始とみなさない／低活動が続くまで終了とみなさない」
// という2段階の閾値で連続性を保つ。
const LOW_ACTIVITY_PERCENTILE = 0.35;
const HIGH_ACTIVITY_PERCENTILE = 0.6;
// ヒステリシス方式で1件も見つからなかった場合のフォールバック（活動量のピークを
// 一定間隔で拾う）のパラメータ
const FALLBACK_MIN_GAP = 2.0;
const FALLBACK_MAX_POINTS = 80;

function normalize(arr: number[]): number[] {
  const max = Math.max(...arr, 1e-9);
  const min = Math.min(...arr);
  const range = max - min || 1;
  return arr.map((v) => (v - min) / range);
}

function smooth(arr: number[], radius = 1): number[] {
  return arr.map((_, i) => {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = i + k;
      if (idx >= 0 && idx < arr.length) {
        sum += arr[idx];
        count++;
      }
    }
    return sum / count;
  });
}

interface Curves {
  motion: number[];
  audio: number[] | null;
}

interface VideoFrameCallbackMetadata {
  mediaTime: number;
}
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, metadata: VideoFrameCallbackMetadata) => void) => number;
};

/**
 * <video> のネイティブ（ハードウェア）デコードと Web Audio API を使い、動画ファイル
 * 全体をメモリに読み込むことなく、動き（フレーム差分）と音声エネルギーを1回の
 * 再生パスで抽出する。
 *
 * 以前は ffmpeg.wasm でファイル全体をメモリに複製してソフトウェアデコードしていたが、
 * 大きい動画（iPhoneのHEVC/Dolby Visionなど数百MB〜）だとその時点でSafari等のタブが
 * クラッシュ・フリーズしていた。ブラウザ内蔵の再生パイプラインは通常ハードウェア
 * デコードでファイル全体を保持せずにストリーミング処理できるため、これを回避する。
 */
async function scanVideo(url: string, onProgress: (label: string, frac: number) => void): Promise<{ duration: number; curves: Curves }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video") as RVFCVideo;
    video.src = url;
    video.muted = false; // ミュートにすると Web Audio 側にも音声データが流れなくなるブラウザがあるため false のままにする
    video.playsInline = true;
    video.preload = "auto";
    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "0";
    video.style.width = "2px";
    video.style.height = "2px";
    document.body.appendChild(video);

    const canvas = document.createElement("canvas");
    canvas.width = MOTION_W;
    canvas.height = MOTION_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;

    const motion: number[] = [];
    const audio: number[] = [];
    let prevFrame: Uint8ClampedArray | null = null;
    let nextSampleTime = 0;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let timeArray: Float32Array<ArrayBuffer> | null = null;
    let hasAudioTrack = false;
    let settled = false;

    function cleanup() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.remove();
      if (audioCtx) audioCtx.close().catch(() => {});
    }

    function fail(err: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    function succeed() {
      if (settled) return;
      settled = true;
      const duration = video.duration;
      cleanup();
      resolve({ duration, curves: { motion, audio: hasAudioTrack ? audio : null } });
    }

    function sampleAt() {
      ctx.drawImage(video, 0, 0, MOTION_W, MOTION_H);
      const frame = ctx.getImageData(0, 0, MOTION_W, MOTION_H).data;
      if (prevFrame) {
        let diff = 0;
        for (let p = 0; p < frame.length; p += 4) {
          diff += Math.abs(frame[p] - prevFrame[p]) + Math.abs(frame[p + 1] - prevFrame[p + 1]) + Math.abs(frame[p + 2] - prevFrame[p + 2]);
        }
        motion.push(diff);
      } else {
        motion.push(0);
      }
      prevFrame = new Uint8ClampedArray(frame);

      if (analyser && timeArray) {
        analyser.getFloatTimeDomainData(timeArray);
        let sum = 0;
        for (let i = 0; i < timeArray.length; i++) sum += timeArray[i] * timeArray[i];
        audio.push(Math.sqrt(sum / timeArray.length));
      } else {
        audio.push(0);
      }
    }

    video.addEventListener("error", () =>
      fail(new Error("動画を読み込めませんでした。このブラウザ／端末では非対応の形式の可能性があります。"))
    );

    video.addEventListener(
      "loadedmetadata",
      () => {
        try {
          const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          audioCtx = new AudioContextCtor();
          const source = audioCtx.createMediaElementSource(video);
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 1024;
          timeArray = new Float32Array(analyser.fftSize);
          source.connect(analyser);
          // audioCtx.destination には繋がない＝再生音は出ないが解析データは取得できる
          hasAudioTrack = true;
        } catch {
          hasAudioTrack = false;
        }
        try {
          video.playbackRate = PLAYBACK_RATE;
        } catch {
          // 倍速再生に対応していない場合は等倍のまま続行
        }
        video.play().catch(fail);
      },
      { once: true }
    );

    video.addEventListener("ended", succeed, { once: true });

    function onFrame(_now: number, metadata: VideoFrameCallbackMetadata) {
      if (settled) return;
      const t = metadata.mediaTime;
      if (t >= nextSampleTime) {
        sampleAt();
        nextSampleTime += SAMPLE_STEP;
        const dur = video.duration;
        onProgress("動画を解析中（動き・音声を検出）…", dur ? Math.min(0.95, t / dur) : 0);
      }
      if (!video.ended && video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(onFrame);
      }
    }

    function onFrameFallback() {
      if (settled) return;
      const t = video.currentTime;
      if (t >= nextSampleTime) {
        sampleAt();
        nextSampleTime += SAMPLE_STEP;
        const dur = video.duration;
        onProgress("動画を解析中（動き・音声を検出）…", dur ? Math.min(0.95, t / dur) : 0);
      }
      if (!video.ended) {
        requestAnimationFrame(onFrameFallback);
      }
    }

    if (video.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(onFrame);
    } else {
      requestAnimationFrame(onFrameFallback);
    }
  });
}

interface Range {
  start: number;
  end: number;
}

/**
 * 活動量のピーク（動き・音が最も強い瞬間）を一定間隔で拾うフォールバック。
 * ヒステリシス方式で1件もラリーが検出できなかった場合に使う。閾値に依存せず
 * 「相対的に活動が強い瞬間」を拾うだけなので、信号に何らかの変化がある限り
 * 候補が0件になることはない。
 */
function pickActivityPeaks(activity: number[], duration: number, sampleTime: (i: number) => number): RallyCandidate[] {
  const indexed = activity.map((score, i) => ({ score, t: sampleTime(i) }));
  indexed.sort((a, b) => b.score - a.score);

  const picked: number[] = [];
  for (const cand of indexed) {
    if (picked.length >= FALLBACK_MAX_POINTS) break;
    if (picked.some((t) => Math.abs(t - cand.t) < FALLBACK_MIN_GAP)) continue;
    picked.push(cand.t);
  }
  picked.sort((a, b) => a - b);
  return picked.map((t) => ({ start: Math.max(0, t - 1), end: Math.min(duration, t + 0.3) }));
}

function detectRalliesFromCurves(curves: Curves, duration: number): RallyCandidate[] {
  const motion = smooth(normalize(curves.motion), 2);
  const audioNorm = curves.audio ? smooth(normalize(curves.audio), 2) : null;
  const len = audioNorm ? Math.min(motion.length, audioNorm.length) : motion.length;
  if (len === 0) return [];

  const activity: number[] = [];
  for (let i = 0; i < len; i++) {
    activity.push(audioNorm ? 0.55 * motion[i] + 0.45 * audioNorm[i] : motion[i]);
  }
  const sampleTime = (i: number) => Math.min(duration, i * SAMPLE_STEP);

  const sorted = [...activity].sort((a, b) => a - b);
  const lowThreshold = sorted[Math.floor(sorted.length * LOW_ACTIVITY_PERCENTILE)] ?? 0;
  const highThreshold = sorted[Math.floor(sorted.length * HIGH_ACTIVITY_PERCENTILE)] ?? lowThreshold;

  // ヒステリシス方式：一度「高活動」を検知したらラリー中とみなし、その後
  // 「低活動」が BREAK_MIN_LEN 続くまではラリーが継続しているとみなす。
  // 単一閾値だと瞬間的な動き・打球音のスパイクの合間（実際にはラリー継続中）を
  // 誤って「間」と判定し、ラリーがぶつ切りになって短すぎるとして全滅する問題があった。
  const rallies: Range[] = [];
  let active = false;
  let rallyStart = 0;
  let quietStart: number | null = null;

  for (let i = 0; i < len; i++) {
    const t = sampleTime(i);
    const v = activity[i];
    if (!active) {
      if (v >= highThreshold) {
        active = true;
        rallyStart = t;
        quietStart = null;
      }
    } else if (v <= lowThreshold) {
      if (quietStart === null) quietStart = t;
      if (t - quietStart >= BREAK_MIN_LEN) {
        rallies.push({ start: rallyStart, end: quietStart });
        active = false;
        quietStart = null;
      }
    } else {
      quietStart = null;
    }
  }
  if (active) {
    rallies.push({ start: rallyStart, end: duration });
  }

  const result = rallies.filter((r) => r.end - r.start >= RALLY_MIN_LEN);
  if (result.length > 0) return result;

  // ヒステリシス方式でも1件も見つからない場合（信号が弱い/ノイジーな映像など）は
  // ピーク検出にフォールバックし、候補が0件のまま「全部手動」になる事態を避ける。
  return pickActivityPeaks(activity, duration, sampleTime);
}

/**
 * 動画ファイルを解析し、動画の長さ・音声の有無・ラリー区切り（得点候補）を返す。
 * ffmpeg は使わず、ブラウザのネイティブ再生機能のみで完結する。
 */
export async function analyzeVideoFile(file: File, onProgress: (label: string, frac: number) => void): Promise<ScanResult> {
  const url = URL.createObjectURL(file);
  try {
    onProgress("動画を読み込み中…", 0.02);
    const { duration, curves } = await scanVideo(url, onProgress);

    if (!duration || !Number.isFinite(duration)) {
      throw new Error("動画の長さを取得できませんでした");
    }

    onProgress("ラリーの区切りを推定中…", 0.96);
    const candidates = duration <= RALLY_MIN_LEN ? [] : detectRalliesFromCurves(curves, duration);

    return { duration, hasAudio: curves.audio !== null, candidates };
  } finally {
    URL.revokeObjectURL(url);
  }
}
