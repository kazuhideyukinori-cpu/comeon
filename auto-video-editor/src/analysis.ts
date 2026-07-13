import type { FFmpeg } from "@ffmpeg/ffmpeg";

export interface Segment {
  start: number;
  end: number;
  score: number;
  isClimax: boolean;
  caption: string;
}

const MOTION_W = 32;
const MOTION_H = 18;
const SAMPLE_STEP = 0.4; // seconds between analysis samples
const SEGMENT_LEN = 2.2; // seconds per highlight segment (pre speed-ramp)
const MIN_GAP = 1.4; // seconds min distance between picked peak centers
const MAX_SEGMENTS = 6;
const TARGET_MAX_DURATION = 22; // seconds, cap on final edited output length
const AUDIO_SR = 8000;

const CAPTIONS = ["HERE WE GO", "LOCKED IN", "NICE MOVE", "KEEP PUSHING", "ALL IN"];
const CLIMAX_CAPTION = "BEST MOMENT";

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
      for (let s = start; s < end; s += 2) {
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

export async function analyzeVideo(
  ff: FFmpeg,
  inputName: string,
  duration: number,
  onProgress: (label: string, frac: number) => void
): Promise<Segment[]> {
  // very short clip: just use the whole thing as one climax segment
  if (duration <= SEGMENT_LEN + 0.5) {
    return [{ start: 0, end: duration, score: 1, isClimax: true, caption: CLIMAX_CAPTION }];
  }

  onProgress("動画を解析中（動きを検出）…", 0.05);
  const motionRaw = await computeMotionCurve(ff, inputName);

  onProgress("音声を解析中…", 0.55);
  const audioRaw = await computeAudioCurve(ff, inputName);

  onProgress("見せ場を選定中…", 0.85);

  const motion = smooth(normalize(motionRaw));
  const audioNorm = audioRaw ? normalize(audioRaw) : null;
  const len = audioNorm ? Math.min(motion.length, audioNorm.length) : motion.length;
  const combined: number[] = [];
  for (let i = 0; i < len; i++) {
    combined.push(audioNorm ? 0.6 * motion[i] + 0.4 * audioNorm[i] : motion[i]);
  }

  // greedy peak picking with minimum spacing
  const indexed = combined.map((score, i) => ({ score, t: i * SAMPLE_STEP }));
  indexed.sort((a, b) => b.score - a.score);

  const pickedTimes: number[] = [];
  for (const cand of indexed) {
    if (pickedTimes.length >= MAX_SEGMENTS) break;
    if (cand.t < SEGMENT_LEN / 2 || cand.t > duration - SEGMENT_LEN / 2) continue;
    if (pickedTimes.some((t) => Math.abs(t - cand.t) < MIN_GAP)) continue;
    pickedTimes.push(cand.t);
  }

  if (pickedTimes.length === 0) {
    pickedTimes.push(duration / 2);
  }

  let segments: Segment[] = pickedTimes.map((t) => {
    const start = Math.max(0, t - SEGMENT_LEN / 2);
    const end = Math.min(duration, start + SEGMENT_LEN);
    const idx = Math.round(t / SAMPLE_STEP);
    const score = combined[Math.min(idx, combined.length - 1)] ?? 0;
    return { start, end, score, isClimax: false, caption: "" };
  });

  // enforce total duration budget, dropping lowest-score segments first
  segments.sort((a, b) => b.score - a.score);
  let total = 0;
  const kept: Segment[] = [];
  for (const seg of segments) {
    const len = seg.end - seg.start;
    if (kept.length > 0 && total + len > TARGET_MAX_DURATION) continue;
    kept.push(seg);
    total += len;
  }
  segments = kept;

  // mark climax = highest scoring segment
  segments.sort((a, b) => b.score - a.score);
  segments[0].isClimax = true;
  segments[0].caption = CLIMAX_CAPTION;
  segments.slice(1).forEach((seg, i) => {
    seg.caption = CAPTIONS[i % CAPTIONS.length];
  });

  // final order: chronological, climax moved to the end for a "big finish"
  const climax = segments.find((s) => s.isClimax)!;
  const rest = segments.filter((s) => !s.isClimax).sort((a, b) => a.start - b.start);
  return [...rest, climax];
}
