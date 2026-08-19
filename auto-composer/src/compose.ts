import type { DrumType, InstrumentName } from "./instruments.ts";
import { type Rng, mulberry32, pick, randInt } from "./rng.ts";
import { STYLES, type StyleId } from "./styles.ts";
import {
  NOTE_NAMES,
  SCALES,
  SCALE_LABEL,
  chordTonePitchClasses,
  clampStepToRegister,
  diatonicChordSteps,
  nearestStepForPitchClass,
  romanForDegree,
  stepToMidi,
} from "./theory.ts";

export interface NoteEvent {
  time: number;
  duration: number;
  midi: number;
  velocity: number;
}

export interface Track {
  instrument: InstrumentName;
  notes: NoteEvent[];
}

export interface DrumHit {
  time: number;
  type: DrumType;
  velocity: number;
}

export interface ChordSymbol {
  time: number;
  duration: number;
  roman: string;
}

export interface Score {
  title: string;
  styleId: StyleId;
  styleLabel: string;
  tempo: number;
  keyName: string;
  totalDuration: number;
  totalBars: number;
  seed: number;
  melody: Track;
  chords: Track;
  bass: Track;
  drums: DrumHit[];
  chordSymbols: ChordSymbol[];
}

export interface ComposeOptions {
  styleId: StyleId;
  lengthSec: number;
  /** 0-11 のトニックのピッチクラス。省略時はランダム */
  keyPc?: number;
  seed: number;
}

type Section = "intro" | "main" | "outro";

function generateTitle(rng: Rng, style: (typeof STYLES)[StyleId]): string {
  // titleAdjectives は「静寂の」「透明な」のように、名詞に直接続けられる形で用意してある
  const adj = pick(rng, style.titleAdjectives);
  const noun = pick(rng, style.titleNouns);
  if (rng() < 0.3 && style.titleNouns.length > 1) {
    let noun2 = pick(rng, style.titleNouns);
    while (noun2 === noun) noun2 = pick(rng, style.titleNouns);
    return `${noun}、${adj}${noun2}`;
  }
  return `${adj}${noun}`;
}

function swingDelay(stepInGrid: number, swing: number, stepDur: number): number {
  // グリッドの「裏」だけを後ろに送ってスウィング感を出す
  const isOff = stepInGrid % 2 === 1;
  return isOff ? swing * stepDur * 0.5 : 0;
}

function sectionsForBars(totalBars: number): Section[] {
  const introBars = totalBars >= 16 ? 4 : totalBars >= 8 ? 2 : 0;
  const outroBars = totalBars >= 16 ? 4 : totalBars >= 8 ? 2 : 0;
  const sections: Section[] = [];
  for (let b = 0; b < totalBars; b++) {
    if (b < introBars) sections.push("intro");
    else if (b >= totalBars - outroBars) sections.push("outro");
    else sections.push("main");
  }
  return sections;
}

export function generateScore(opts: ComposeOptions): Score {
  const style = STYLES[opts.styleId];
  const rng = mulberry32(opts.seed);
  const scale = SCALES[style.scale];

  const tempo = randInt(rng, style.tempoMin, style.tempoMax);
  const tonicPc = opts.keyPc ?? randInt(rng, 0, 11);
  const baseMidi = 60 + tonicPc; // 参照トニック(スケールステップ0 相当、C4基準)

  const barDuration = (60 / tempo) * 4;
  const rawBars = Math.round(opts.lengthSec / barDuration / 4) * 4;
  const totalBars = Math.max(8, rawBars);
  const totalDuration = totalBars * barDuration;

  const progression = pick(rng, style.progressions);
  const sections = sectionsForBars(totalBars);

  const melodyNotes: NoteEvent[] = [];
  const chordNotes: NoteEvent[] = [];
  const bassNotes: NoteEvent[] = [];
  const drums: DrumHit[] = [];
  const chordSymbols: ChordSymbol[] = [];

  let prevMelodyStep: number | null = null;
  let barsSinceChordStart = 0;
  let lastDegree = -1;

  for (let bar = 0; bar < totalBars; bar++) {
    const section = sections[bar];
    const barStart = bar * barDuration;
    const chordIndex = Math.floor(bar / style.barsPerChord) % progression.length;
    const degree = progression[chordIndex];
    const isChordStartBar = degree !== lastDegree || barsSinceChordStart >= style.barsPerChord;
    barsSinceChordStart = isChordStartBar ? 1 : barsSinceChordStart + 1;
    lastDegree = degree;

    if (isChordStartBar) {
      chordSymbols.push({
        time: barStart,
        duration: barDuration * style.barsPerChord,
        roman: romanForDegree(style.scale, degree),
      });
    }

    // --- セクションごとのダイナミクス ---
    const introBars = sections.filter((s) => s === "intro").length;
    const outroStart = totalBars - sections.filter((s) => s === "outro").length;
    let energy = 1;
    let melodyOn = true;
    let drumsOn = true;
    if (section === "intro") {
      energy = 0.55 + 0.4 * (introBars > 0 ? bar / introBars : 1);
      drumsOn = false;
      melodyOn = introBars > 0 && bar >= introBars - 1;
    } else if (section === "outro") {
      const outroBars = totalBars - outroStart;
      const posInOutro = bar - outroStart;
      energy = 0.9 - 0.65 * (outroBars > 0 ? posInOutro / outroBars : 0);
      drumsOn = outroBars > 0 ? posInOutro < outroBars - 1 : true;
      melodyOn = outroBars > 0 ? posInOutro < Math.max(1, outroBars - 1) : true;
    }
    const phrasePos = bar % 4;
    // 4小節ごとの終わりはメロディを間引いて「呼吸」を作る（コール&レスポンス）
    const phraseBreath = phrasePos === 3 ? 0.55 : 1;

    // --- コード ---
    const chordSteps = diatonicChordSteps(degree, style.chordSize).map((s) => s + style.chordOctave);
    const chordMidis = chordSteps.map((s) => stepToMidi(baseMidi, scale, s));
    const chordSustain = style.chordInstrument === "pad";
    if (chordSustain) {
      if (isChordStartBar) {
        for (const m of chordMidis) {
          chordNotes.push({
            time: barStart,
            duration: barDuration * style.barsPerChord * 0.98,
            midi: m,
            velocity: 0.5 * energy,
          });
        }
      }
    } else {
      for (const m of chordMidis) {
        chordNotes.push({
          time: barStart,
          duration: barDuration * 0.9,
          midi: m,
          velocity: 0.42 * energy * (0.85 + rng() * 0.3),
        });
      }
    }

    // --- ベース ---
    const rootStep = chordSteps[0] + style.bassOctave - style.chordOctave;
    const fifthStep = rootStep + 4; // スケール上3つ上 = だいたい5度
    if (style.bassRhythm) {
      const stepDur = barDuration / 16;
      for (let i = 0; i < 16; i++) {
        const vel = style.bassRhythm[i];
        if (!vel) continue;
        const useFifth = style.bassFifthSteps?.includes(i);
        const midi = stepToMidi(baseMidi, scale, useFifth ? fifthStep : rootStep);
        const delay = swingDelay(i, style.swing, stepDur);
        bassNotes.push({
          time: barStart + i * stepDur + delay,
          duration: stepDur * 1.6,
          midi,
          velocity: vel * energy * (0.85 + rng() * 0.25),
        });
      }
    } else if (isChordStartBar) {
      bassNotes.push({
        time: barStart,
        duration: barDuration * style.barsPerChord * 0.97,
        midi: stepToMidi(baseMidi, scale, rootStep),
        velocity: 0.55 * energy,
      });
    }

    // --- ドラム ---
    if (drumsOn) {
      const isFillBar = phrasePos === 3 && !!style.drumFillPattern;
      const pattern = isFillBar ? style.drumFillPattern! : style.drumPattern;
      const stepDur = barDuration / 16;
      for (const type of Object.keys(pattern) as DrumType[]) {
        const arr = pattern[type]!;
        for (let i = 0; i < 16; i++) {
          const vel = arr[i];
          if (!vel) continue;
          const delay = swingDelay(i, style.swing, stepDur);
          const jitter = (rng() - 0.5) * 0.006;
          drums.push({
            time: barStart + i * stepDur + delay + jitter,
            type,
            velocity: vel * energy * (0.82 + rng() * 0.3),
          });
        }
      }
    }

    // --- メロディ ---
    if (melodyOn) {
      const grid = style.grid;
      const stepDur = barDuration / grid;
      const chordTonesMod = chordTonePitchClasses(scale, chordSteps.map((s) => s - style.chordOctave));
      const strongEvery = grid / 4;
      let i = 0;
      while (i < grid) {
        const isStrong = i % strongEvery === 0;
        const prob = (isStrong ? style.strongBeatDensity : style.weakBeatDensity) * phraseBreath;
        if (rng() < prob) {
          const maxLen = grid - i;
          let lenSteps = pick(rng, style.noteLengthChoices);
          if (lenSteps > maxLen) lenSteps = maxLen;

          let step: number;
          if (prevMelodyStep === null || isStrong) {
            const near = prevMelodyStep ?? style.melodyRegister[0] + 2;
            const candidates = chordTonesMod.map((pc) => nearestStepForPitchClass(pc, near, scale.length));
            candidates.sort((a, b) => Math.abs(a - near) - Math.abs(b - near));
            step = candidates[0];
            if (prevMelodyStep !== null && step === prevMelodyStep && candidates.length > 1 && rng() < 0.5) {
              step = candidates[1];
            }
          } else {
            const roll = rng();
            if (roll < 0.15) {
              const candidates = chordTonesMod.map((pc) => nearestStepForPitchClass(pc, prevMelodyStep!, scale.length));
              candidates.sort((a, b) => Math.abs(a - prevMelodyStep!) - Math.abs(b - prevMelodyStep!));
              step = candidates[0];
            } else {
              const walk = [-2, -1, -1, 1, 1, 2][Math.floor(rng() * 6)];
              step = prevMelodyStep + walk;
            }
          }
          step = clampStepToRegister(step, style.melodyRegister[0], style.melodyRegister[1], scale.length);

          const delay = swingDelay(i, style.swing, stepDur);
          const midi = stepToMidi(baseMidi, scale, step);
          melodyNotes.push({
            time: barStart + i * stepDur + delay,
            duration: lenSteps * stepDur * style.legato,
            midi,
            velocity: (isStrong ? 0.72 : 0.55) * energy * (0.85 + rng() * 0.25),
          });
          prevMelodyStep = step;
          i += lenSteps;
        } else {
          i += 1;
        }
      }
    }
  }

  const keyName = `${NOTE_NAMES[tonicPc]} ${SCALE_LABEL[style.scale]}`;
  const title = generateTitle(rng, style);

  return {
    title,
    styleId: style.id,
    styleLabel: style.label,
    tempo,
    keyName,
    totalDuration,
    totalBars,
    seed: opts.seed,
    melody: { instrument: style.melodyInstrument, notes: melodyNotes },
    chords: { instrument: style.chordInstrument, notes: chordNotes },
    bass: { instrument: style.bassInstrument, notes: bassNotes },
    drums,
    chordSymbols,
  };
}
