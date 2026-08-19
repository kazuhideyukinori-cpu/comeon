// スコアからスタンダードMIDIファイル(SMF, format 1)を組み立てる。
// 外部ライブラリなしで、DAWに読み込める最小限のMIDIバイト列を自前で書き出す。

import type { DrumType, InstrumentName } from "./instruments.ts";
import type { NoteEvent, Score } from "./compose.ts";

const PPQ = 480;

const GM_PROGRAM: Record<InstrumentName, number> = {
  piano: 0, // Acoustic Grand Piano
  epiano: 4, // Electric Piano 1
  pad: 89, // Pad 2 (warm)
  bass: 33, // Electric Bass (finger)
  pluck: 45, // Pizzicato Strings
  brass: 61, // Brass Section
};

const GM_DRUM_NOTE: Record<DrumType, number> = {
  kick: 36,
  snare: 38,
  hihat: 42,
  openhat: 46,
  clap: 39,
  tom: 45,
  shaker: 70,
};

interface RawEvent {
  tick: number;
  bytes: number[];
}

function secToTick(sec: number, bpm: number): number {
  return Math.max(0, Math.round(sec * PPQ * (bpm / 60)));
}

function velocityToMidi(v: number): number {
  return Math.max(1, Math.min(127, Math.round(v * 100 + 15)));
}

function writeVarLen(value: number): number[] {
  let buffer = value & 0x7f;
  const bytes: number[] = [];
  let v = value >> 7;
  while (v > 0) {
    buffer <<= 8;
    buffer |= (v & 0x7f) | 0x80;
    v >>= 7;
  }
  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

function buildTrackChunk(events: RawEvent[]): number[] {
  const sorted = events.slice().sort((a, b) => a.tick - b.tick);
  const data: number[] = [];
  let lastTick = 0;
  for (const ev of sorted) {
    const delta = Math.max(0, ev.tick - lastTick);
    data.push(...writeVarLen(delta));
    data.push(...ev.bytes);
    lastTick = ev.tick;
  }
  data.push(...writeVarLen(0), 0xff, 0x2f, 0x00); // End of Track

  const header = [0x4d, 0x54, 0x72, 0x6b]; // "MTrk"
  const len = data.length;
  const lenBytes = [(len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff];
  return [...header, ...lenBytes, ...data];
}

function noteTrackEvents(notes: NoteEvent[], channel: number, program: number, bpm: number): RawEvent[] {
  const events: RawEvent[] = [{ tick: 0, bytes: [0xc0 | channel, program] }];
  for (const n of notes) {
    const onTick = secToTick(n.time, bpm);
    const offTick = Math.max(onTick + 1, secToTick(n.time + n.duration, bpm));
    const vel = velocityToMidi(n.velocity);
    const key = Math.max(0, Math.min(127, Math.round(n.midi)));
    events.push({ tick: onTick, bytes: [0x90 | channel, key, vel] });
    events.push({ tick: offTick, bytes: [0x80 | channel, key, 0] });
  }
  return events;
}

export function buildMidiFile(score: Score): Uint8Array {
  const bpm = score.tempo;
  const microsPerQuarter = Math.round(60000000 / bpm);

  const conductor: RawEvent[] = [
    {
      tick: 0,
      bytes: [
        0xff,
        0x51,
        0x03,
        (microsPerQuarter >> 16) & 0xff,
        (microsPerQuarter >> 8) & 0xff,
        microsPerQuarter & 0xff,
      ],
    },
    { tick: 0, bytes: [0xff, 0x58, 0x04, 4, 2, 24, 8] }, // 4/4拍子
  ];

  const melodyEvents = noteTrackEvents(score.melody.notes, 0, GM_PROGRAM[score.melody.instrument], bpm);
  const chordEvents = noteTrackEvents(score.chords.notes, 1, GM_PROGRAM[score.chords.instrument], bpm);
  const bassEvents = noteTrackEvents(score.bass.notes, 2, GM_PROGRAM[score.bass.instrument], bpm);

  const drumChannel = 9;
  const drumEvents: RawEvent[] = [];
  for (const hit of score.drums) {
    const note = GM_DRUM_NOTE[hit.type];
    const onTick = secToTick(hit.time, bpm);
    const vel = velocityToMidi(hit.velocity);
    drumEvents.push({ tick: onTick, bytes: [0x90 | drumChannel, note, vel] });
    drumEvents.push({ tick: onTick + 20, bytes: [0x80 | drumChannel, note, 0] });
  }

  const chunks = [
    buildTrackChunk(conductor),
    buildTrackChunk(melodyEvents),
    buildTrackChunk(chordEvents),
    buildTrackChunk(bassEvents),
    buildTrackChunk(drumEvents),
  ];

  const header = [
    0x4d,
    0x54,
    0x68,
    0x64, // "MThd"
    0,
    0,
    0,
    6, // header length = 6
    0,
    1, // format 1
    0,
    chunks.length, // number of tracks
    (PPQ >> 8) & 0xff,
    PPQ & 0xff,
  ];

  return new Uint8Array([...header, ...chunks.flat()]);
}
