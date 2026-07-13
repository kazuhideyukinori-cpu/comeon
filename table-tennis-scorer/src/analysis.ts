import type { FFmpeg } from "@ffmpeg/ffmpeg";

export interface RallyCandidate {
  start: number; // ラリー開始（推定）
  end: number; // ラリー終了＝得点が入った瞬間の推定タイムスタンプ
}

const MOTION_W = 32;
const MOTION_H = 18;
const SAMPLE_STEP = 0.25; // seconds between analysis samples（ポイント境界の精度を優先し短め）
const AUDIO_SR = 8000;

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

async function computeMotionCurve(ff: FFmpeg, inputName: string): Promise<number[]> {
  await ff.exec([
    "-i",
    inputName,
    "-an",
    "-vf",
    `fps=${(1 / SAMPLE_STEP).toFixed(4)},scale=${MOTION_W}:${MOTION_H}`,
    "-pix_fmt",
    "rgba",
    "-f",
    "rawvideo",
    "motion.raw",
  ]);
  const raw = (await ff.readFile("motion.raw")) as Uint8Array;
  await ff.deleteFile("motion.raw");

  const frameSize = MOTION_W * MOTION_H * 4;
  const numFrames = Math.floor(raw.length / frameSize);
  const motion: number[] = [];
  let prev: Uint8Array | null = null;

  for (let f = 0; f < numFrames; f++) {
    const frame = raw.subarray(f * frameSize, (f + 1) * frameSize);
    if (prev) {
      let diff = 0;
      for (let p = 0; p < frame.length; p += 4) {
        diff += Math.abs(frame[p] - prev[p]) + Math.abs(frame[p + 1] - prev[p + 1]) + Math.abs(frame[p + 2] - prev[p + 2]);
      }
      motion.push(diff);
    } else {
      motion.push(0);
    }
    prev = frame;
  }
  return motion;
}

async function computeAudioCurve(ff: FFmpeg, inputName: string): Promise<number[] | null> {
  try {
    await ff.exec(["-i", inputName, "-vn", "-ac", "1", "-ar", `${AUDIO_SR}`, "-f", "s16le", "audio.raw"]);
    const raw = (await ff.readFile("audio.raw")) as Uint8Array;
    await ff.deleteFile("audio.raw");
    if (raw.length < 2) return null;

    const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
    const windowSize = Math.floor(AUDIO_SR * SAMPLE_STEP);
    const steps = Math.max(1, Math.floor(samples.length / windowSize));
    const energy: number[] = [];
    for (let i = 0; i < steps; i++) {
      const start = i * windowSize;
      const end = Math.min(samples.length, start + windowSize);
      let sum = 0;
      let count = 0;
      for (let s = start; s < end; s++) {
        const v = samples[s] / 32768;
        sum += v * v;
        count++;
      }
      energy.push(Math.sqrt(sum / Math.max(1, count)));
    }
    return energy;
  } catch {
    return null;
  }
}

export async function getDuration(ff: FFmpeg, inputName: string): Promise<number> {
  await ff.ffprobe(["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", inputName, "-o", "dur.txt"]);
  const data = (await ff.readFile("dur.txt")) as Uint8Array;
  await ff.deleteFile("dur.txt");
  const text = new TextDecoder().decode(data).trim();
  const duration = parseFloat(text);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/**
 * 動画内の「動き」（フレーム差分）と「音の勢い」から、ラリーが続いている区間と
 * 途切れている区間（＝得点が決まって次のサーブまでの間）を推定する。
 * 戻り値の各要素の `end` を「得点が入った瞬間の候補」としてレビューUIに渡す。
 */
export async function detectRallies(
  ff: FFmpeg,
  inputName: string,
  duration: number,
  onProgress: (label: string, frac: number) => void
): Promise<RallyCandidate[]> {
  if (duration <= RALLY_MIN_LEN) return [];

  onProgress("動画を解析中（動きを検出）…", 0.05);
  const motionRaw = await computeMotionCurve(ff, inputName);

  onProgress("音声を解析中…", 0.55);
  const audioRaw = await computeAudioCurve(ff, inputName);

  onProgress("ラリーの区切りを推定中…", 0.85);

  const motion = smooth(normalize(motionRaw));
  const audioNorm = audioRaw ? normalize(smooth(audioRaw)) : null;
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

  return rallies
    .filter((r) => r.end - r.start >= RALLY_MIN_LEN)
    .map((r) => ({ start: r.start, end: r.end }));
}
