// 音楽理論まわりの純粋関数群。
// ピッチはすべて「スケールステップ（スケール内の何番目の音か）」で扱い、
// 実際のMIDIノート番号への変換は scaleStepToOffset / stepToMidi でのみ行う。
// これによりダイアトニックなメロディ・和音生成を整数演算だけで安全に行える。

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export type ScaleName = "major" | "minor" | "dorian" | "lydian";

/** 各スケールの半音オフセット（0=トニック） */
export const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

export const SCALE_LABEL: Record<ScaleName, string> = {
  major: "メジャー",
  minor: "マイナー",
  dorian: "ドリアン",
  lydian: "リディアン",
};

/** MIDIノート番号 → 周波数(Hz) */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** MIDIノート番号 → 表示用の音名（例: "C4"） */
export function midiToNoteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[pc]}${octave}`;
}

/**
 * スケールステップ（整数、負数・スケール外の値もOK）を
 * トニックからの半音オフセットに変換する。
 * 例: major, step=0→0, step=7→12(1オクターブ上), step=-1→-1(長7度下)
 */
export function scaleStepToOffset(scale: number[], step: number): number {
  const len = scale.length;
  const octave = Math.floor(step / len);
  const idx = ((step % len) + len) % len;
  return scale[idx] + octave * 12;
}

/** スケールステップ → 実際のMIDIノート番号 */
export function stepToMidi(tonicMidi: number, scale: number[], step: number): number {
  return tonicMidi + scaleStepToOffset(scale, step);
}

/**
 * 3度堆積によるダイアトニックコードを、ルートからのスケールステップ配列で返す。
 * degree: 0始まりのスケール度数 (0=I/i, 1=ii, ... 6=vii)
 * size: 3=トライアド, 4=セブンス
 */
export function diatonicChordSteps(degree: number, size: 3 | 4): number[] {
  const steps: number[] = [];
  for (let i = 0; i < size; i++) {
    steps.push(degree + i * 2);
  }
  return steps;
}

/** コードトーンのピッチクラス（スケール内の位置, 0..len-1）集合を返す */
export function chordTonePitchClasses(scale: number[], chordSteps: number[]): number[] {
  const len = scale.length;
  const set = new Set<number>();
  for (const s of chordSteps) set.add(((s % len) + len) % len);
  return [...set];
}

/**
 * 与えられたピッチクラス(スケールステップ mod len)のうち、
 * near にもっとも近いスケールステップ（オクターブ違い含む）を返す。
 */
export function nearestStepForPitchClass(pitchClassStep: number, near: number, scaleLen: number): number {
  const k = Math.round((near - pitchClassStep) / scaleLen);
  return pitchClassStep + k * scaleLen;
}

/** 指定した [min, max] のスケールステップ範囲にオクターブ移動で収める */
export function clampStepToRegister(step: number, min: number, max: number, scaleLen: number): number {
  let s = step;
  while (s < min) s += scaleLen;
  while (s > max) s -= scaleLen;
  // 範囲が狭すぎて往復してしまうケースの保険
  if (s < min) s = min;
  if (s > max) s = max;
  return s;
}

const ROMAN_MAJOR = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
const ROMAN_MINOR = ["i", "ii°", "III", "iv", "v", "VI", "VII"];

/** コードのローマ数字表記（表示用） */
export function romanForDegree(scaleName: ScaleName, degree: number): string {
  const table = scaleName === "major" || scaleName === "lydian" ? ROMAN_MAJOR : ROMAN_MINOR;
  return table[((degree % 7) + 7) % 7];
}
