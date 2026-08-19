import type { DrumType, InstrumentName } from "./instruments.ts";
import type { ScaleName } from "./theory.ts";

export type StyleId = "lofi" | "cinematic" | "pop" | "ambient";

/** 16ステップぶんのベロシティ配列（0 = 無音, 1 = 最大）でパーカッションパターンを表す */
export type DrumPattern = Partial<Record<DrumType, number[]>>;

export interface StyleDef {
  id: StyleId;
  label: string;
  emoji: string;
  description: string;
  scale: ScaleName;
  tempoMin: number;
  tempoMax: number;
  /** 1つのコードを何小節持続させるか */
  barsPerChord: number;
  /** ループするコード進行（スケール度数 0=I/i ... 6=vii, 複数パターンから抽選） */
  progressions: number[][];
  /** メロディのリズムを刻む1小節あたりの分割数 */
  grid: 8 | 16;
  /** 裏拍をどれだけ後ろに送るか（0=なし〜0.6程度） */
  swing: number;
  /** トニックからのメロディ音域（スケールステップ） */
  melodyRegister: [number, number];
  melodyInstrument: InstrumentName;
  chordInstrument: InstrumentName;
  bassInstrument: InstrumentName;
  /** 強拍/弱拍でメロディの音符が始まる確率 */
  strongBeatDensity: number;
  weakBeatDensity: number;
  /** 音符の長さの候補（グリッドステップ数、重み付けのため重複可） */
  noteLengthChoices: number[];
  /** 実際に鳴らす長さの割合（残りは休符的な余白） */
  legato: number;
  /** コード・ベースを鳴らす基準スケールステップ（トニックから） */
  /** トライアド(3)かセブンス(4)か */
  chordSize: 3 | 4;
  chordOctave: number;
  bassOctave: number;
  /** 16ステップのベースのリズム（ベロシティ, 0=無音）。未指定ならコードごとに1音を伸ばす */
  bassRhythm?: number[];
  /** bassRhythm の中で、ルートではなく5度を鳴らすステップ番号 */
  bassFifthSteps?: number[];
  reverbWet: number;
  drumPattern: DrumPattern;
  drumFillPattern?: DrumPattern;
  titleAdjectives: string[];
  titleNouns: string[];
}

const z16 = () => new Array(16).fill(0);

export const STYLES: Record<StyleId, StyleDef> = {
  lofi: {
    id: "lofi",
    label: "Lo-fi Chill",
    emoji: "☕",
    description: "雨音の似合う、けだるく揺れるローファイ・ビート",
    scale: "dorian",
    tempoMin: 72,
    tempoMax: 84,
    barsPerChord: 1,
    progressions: [
      [1, 4, 0, 5], // ii - V - I - vi
      [5, 1, 4, 0], // vi - ii - V - I
      [0, 5, 1, 4],
    ],
    grid: 8,
    swing: 0.55,
    melodyRegister: [2, 9],
    melodyInstrument: "epiano",
    chordInstrument: "epiano",
    bassInstrument: "bass",
    strongBeatDensity: 0.62,
    weakBeatDensity: 0.4,
    noteLengthChoices: [1, 1, 2, 2, 2, 3, 4],
    legato: 0.85,
    chordSize: 4,
    chordOctave: 0,
    bassOctave: -7,
    bassRhythm: Object.assign(z16(), { 0: 0.85, 6: 0.4, 10: 0.7 }),
    bassFifthSteps: [6],
    reverbWet: 0.22,
    drumPattern: {
      kick: Object.assign(z16(), { 0: 0.9, 3: 0.35, 10: 0.65 }),
      snare: Object.assign(z16(), { 4: 0.75, 12: 0.8 }),
      hihat: Object.assign(z16(), {
        0: 0.35, 2: 0.22, 4: 0.32, 6: 0.22, 8: 0.35, 10: 0.22, 12: 0.32, 14: 0.24,
      }),
      shaker: Object.assign(z16(), { 6: 0.15, 14: 0.15 }),
    },
    titleAdjectives: ["雨上がりの", "深夜の", "午前3時の", "煙草と", "湯気の立つ", "レコード越しの"],
    titleNouns: ["ブルー", "ノスタルジア", "屋上", "モノローグ", "喫茶店", "子守唄"],
  },

  cinematic: {
    id: "cinematic",
    label: "Epic Cinematic",
    emoji: "🎬",
    description: "壮大に盛り上がる、映画のクライマックスのようなオーケストラ風",
    scale: "minor",
    tempoMin: 96,
    tempoMax: 120,
    barsPerChord: 2,
    progressions: [
      [0, 5, 2, 6], // i - VI - III - VII
      [0, 3, 5, 6],
      [5, 6, 0, 0],
    ],
    grid: 16,
    swing: 0,
    melodyRegister: [0, 12],
    melodyInstrument: "brass",
    chordInstrument: "pad",
    bassInstrument: "bass",
    strongBeatDensity: 0.55,
    weakBeatDensity: 0.22,
    noteLengthChoices: [2, 4, 4, 6, 8],
    legato: 0.92,
    chordSize: 4,
    chordOctave: -7,
    bassOctave: -14,
    reverbWet: 0.4,
    drumPattern: {
      kick: Object.assign(z16(), { 0: 1, 8: 0.9 }),
      tom: Object.assign(z16(), { 6: 0.5, 10: 0.4, 14: 0.6 }),
      snare: Object.assign(z16(), { 12: 0.6 }),
    },
    drumFillPattern: {
      kick: Object.assign(z16(), { 0: 1, 4: 0.7, 8: 1, 12: 0.7 }),
      tom: Object.assign(z16(), { 2: 0.5, 6: 0.6, 10: 0.7, 14: 0.9 }),
      snare: Object.assign(z16(), { 8: 0.5, 12: 0.7, 14: 0.8 }),
    },
    titleAdjectives: ["最後の", "黎明の", "星々への", "運命の", "紅蓮の", "不滅の"],
    titleNouns: ["序曲", "決戦", "地平線", "叙事詩", "覚醒", "凱旋"],
  },

  pop: {
    id: "pop",
    label: "Pop Upbeat",
    emoji: "✨",
    description: "四つ打ちで駆け抜ける、明るくキャッチーなポップ・チューン",
    scale: "major",
    tempoMin: 118,
    tempoMax: 128,
    barsPerChord: 1,
    progressions: [
      [0, 4, 5, 3], // I - V - vi - IV
      [5, 3, 0, 4],
      [0, 5, 3, 4],
    ],
    grid: 16,
    swing: 0,
    melodyRegister: [3, 10],
    melodyInstrument: "pluck",
    chordInstrument: "piano",
    bassInstrument: "bass",
    strongBeatDensity: 0.7,
    weakBeatDensity: 0.42,
    noteLengthChoices: [1, 1, 2, 2, 3],
    legato: 0.75,
    chordSize: 3,
    chordOctave: 0,
    bassOctave: -7,
    bassRhythm: Object.assign(z16(), { 0: 0.9, 4: 0.75, 8: 0.9, 12: 0.75 }),
    bassFifthSteps: [],
    reverbWet: 0.14,
    drumPattern: {
      kick: Object.assign(z16(), { 0: 1, 4: 0.85, 8: 1, 12: 0.85 }),
      clap: Object.assign(z16(), { 4: 0.9, 12: 0.9 }),
      hihat: Object.assign(z16(), {
        0: 0.4, 1: 0.22, 2: 0.4, 3: 0.22, 4: 0.4, 5: 0.22, 6: 0.4, 7: 0.22,
        8: 0.4, 9: 0.22, 10: 0.4, 11: 0.22, 12: 0.4, 13: 0.22, 14: 0.4, 15: 0.22,
      }),
      openhat: Object.assign(z16(), { 14: 0.4 }),
    },
    drumFillPattern: {
      kick: Object.assign(z16(), { 0: 1, 4: 0.85, 8: 1, 10: 0.6, 12: 0.85 }),
      clap: Object.assign(z16(), { 4: 0.9, 12: 0.9 }),
      hihat: Object.assign(z16(), {
        0: 0.4, 2: 0.3, 4: 0.4, 6: 0.3, 8: 0.4, 9: 0.3, 10: 0.4, 11: 0.35, 12: 0.4, 13: 0.4, 14: 0.5, 15: 0.5,
      }),
      tom: Object.assign(z16(), { 13: 0.5, 15: 0.6 }),
    },
    titleAdjectives: ["夏色の", "君との", "きらめく", "全速力の", "はじけるような", "虹色の"],
    titleNouns: ["サイダー", "パレード", "アンコール", "スニーカー", "リフレイン", "花火"],
  },

  ambient: {
    id: "ambient",
    label: "Ambient Piano",
    emoji: "🌙",
    description: "余白を大切に、静かに漂うアンビエント・ピアノ",
    scale: "lydian",
    tempoMin: 58,
    tempoMax: 68,
    barsPerChord: 2,
    progressions: [
      [0, 4, 5, 3],
      [3, 0, 5, 4],
    ],
    grid: 8,
    swing: 0.15,
    melodyRegister: [4, 11],
    melodyInstrument: "piano",
    chordInstrument: "pad",
    bassInstrument: "pad",
    strongBeatDensity: 0.32,
    weakBeatDensity: 0.16,
    noteLengthChoices: [2, 3, 4, 4, 6],
    legato: 0.7,
    chordSize: 4,
    chordOctave: -3,
    bassOctave: -10,
    reverbWet: 0.55,
    drumPattern: {
      shaker: Object.assign(z16(), { 4: 0.12, 12: 0.12 }),
    },
    titleAdjectives: ["水面の", "静寂の", "遠い記憶の", "雪解けの", "透明な", "夜明け前の"],
    titleNouns: ["余韻", "光", "呼吸", "航路", "祈り", "余白"],
  },
};

export const STYLE_LIST: StyleDef[] = Object.values(STYLES);
