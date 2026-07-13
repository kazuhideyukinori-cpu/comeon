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
// 活動量の下位何%を「低活動」とみなすか
const LOW_ACTIVITY_PERCENTILE = 0.35;

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

function detectRalliesFromCurves(curves: Curves, duration: number): RallyCandidate[] {
  const motion = smooth(normalize(curves.motion));
  const audioNorm = curves.audio ? normalize(smooth(curves.audio)) : null;
  const len = audioNorm ? Math.min(motion.length, audioNorm.length) : motion.length;
  if (len === 0) return [];

  const activity: number[] = [];
  for (let i = 0; i < len; i++) {
    activity.push(audioNorm ? 0.55 * motion[i] + 0.45 * audioNorm[i] : motion[i]);
  }
  const sampleTime = (i: number) => Math.min(duration, i * SAMPLE_STEP);

  const sorted = [...activity].sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * LOW_ACTIVITY_PERCENTILE)] ?? 0;

  interface Range {
    start: number;
    end: number;
  }

  // 低活動が一定時間以上続く区間＝「間（ま）」＝ラリー同士の境界
  const breaks: Range[] = [];
  let runStart: number | null = null;
  for (let i = 0; i < len; i++) {
    const below = activity[i] <= threshold;
    if (below && runStart === null) runStart = i;
    if ((!below || i === len - 1) && runStart !== null) {
      const runEnd = below ? i : i - 1;
      const start = sampleTime(runStart);
      const end = sampleTime(runEnd + 1);
      if (end - start >= BREAK_MIN_LEN) breaks.push({ start, end });
      runStart = null;
    }
  }

  // 「間」の補集合＝ラリー区間
  const rallies: Range[] = [];
  let cursor = 0;
  for (const b of breaks) {
    if (b.start > cursor) rallies.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < duration) rallies.push({ start: cursor, end: duration });

  return rallies.filter((r) => r.end - r.start >= RALLY_MIN_LEN).map((r) => ({ start: r.start, end: r.end }));
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
