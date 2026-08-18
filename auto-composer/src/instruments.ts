// 楽器・パーカッションの種類の定義（synth.ts と styles.ts の両方から参照する）

export type InstrumentName = "piano" | "epiano" | "pad" | "bass" | "pluck" | "brass";

export type DrumType = "kick" | "snare" | "hihat" | "openhat" | "clap" | "tom" | "shaker";

export const DRUM_TYPES: DrumType[] = ["kick", "snare", "hihat", "openhat", "clap", "tom", "shaker"];
