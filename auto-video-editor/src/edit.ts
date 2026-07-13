import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { Segment } from "./analysis";

export type BgmStyle = "energetic" | "chill" | "epic";

export interface AudioOptions {
  bgm: BgmStyle | null; // null = BGMなし
  se: boolean; // 効果音（whoosh/impact）を入れるか
}

interface BgmPreset {
  freqs: number[];
  weights: number[];
  tremoloHz: number;
  tremoloDepth: number;
  lowpass: number;
  volume: number;
}

const BGM_PRESETS: Record<BgmStyle, BgmPreset> = {
  energetic: {
    freqs: [261.63, 329.63, 392.0, 523.25],
    weights: [0.9, 0.7, 0.6, 0.5],
    tremoloHz: 6,
    tremoloDepth: 0.4,
    lowpass: 4200,
    volume: 0.16,
  },
  chill: {
    freqs: [220.0, 261.63, 329.63],
    weights: [0.9, 0.6, 0.5],
    tremoloHz: 2.5,
    tremoloDepth: 0.25,
    lowpass: 2200,
    volume: 0.12,
  },
  epic: {
    freqs: [130.81, 196.0, 261.63, 329.63],
    weights: [1.0, 0.7, 0.55, 0.45],
    tremoloHz: 3,
    tremoloDepth: 0.3,
    lowpass: 3200,
    volume: 0.19,
  },
};

let fontWritten = false;

async function ensureFont(ff: FFmpeg) {
  if (fontWritten) return;
  const fontResp = await fetch(`${import.meta.env.BASE_URL}Anton.ttf`);
  await ff.writeFile("Anton.ttf", new Uint8Array(await fontResp.arrayBuffer()));
  fontWritten = true;
}

export async function hasAudioStream(ff: FFmpeg, inputName: string): Promise<boolean> {
  await ff.ffprobe([
    "-v",
    "error",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=index",
    "-of",
    "csv=p=0",
    inputName,
    "-o",
    "has_audio.txt",
  ]);
  const data = (await ff.readFile("has_audio.txt")) as Uint8Array;
  await ff.deleteFile("has_audio.txt");
  return new TextDecoder().decode(data).trim().length > 0;
}

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

interface SeCue {
  time: number; // オフセット（書き出しタイムライン上、秒）
  kind: "whoosh" | "impact";
}

interface BuiltGraph {
  filterComplex: string;
  totalDuration: number;
  seCues: SeCue[];
}

function buildFilterGraph(segments: Segment[], audioSourceLabel: string, seEnabled: boolean): BuiltGraph {
  const parts: string[] = [];
  let totalDuration = 0;
  const seCues: SeCue[] = [];

  segments.forEach((seg, i) => {
    const speed = seg.isClimax ? 2.0 : 1.0; // setpts multiplier: 2.0 = half speed (slow-mo)
    const outDur = (seg.end - seg.start) * speed;
    if (seEnabled && seg.caption) {
      seCues.push({ time: totalDuration, kind: seg.isClimax ? "impact" : "whoosh" });
    }
    totalDuration += outDur;

    const vChainParts = [
      `[0:v]trim=start=${seg.start}:end=${seg.end}`,
      `setpts=(PTS-STARTPTS)*${speed}`,
      `scale='min(1280,iw)':-2`,
      `format=yuv420p`,
      `setsar=1`,
      `eq=contrast=1.16:saturation=1.4:brightness=0.02`,
      `vignette=PI/4`,
    ];

    if (seg.caption) {
      const capText = escapeDrawtext(seg.caption);
      const fadeIn = 0.15;
      const holdEnd = Math.max(fadeIn, Math.min(outDur - 0.3, 1.1));
      const fadeOutStart = holdEnd;
      const fadeOutEnd = Math.max(fadeOutStart + 0.01, Math.min(outDur, holdEnd + 0.3));
      vChainParts.push(
        `drawtext=fontfile=Anton.ttf:text='${capText}':fontsize=52:fontcolor=white:borderw=4:bordercolor=black@0.7:x=(w-text_w)/2:y=h-150:alpha='if(lt(t\\,${fadeIn})\\,t/${fadeIn}\\,if(lt(t\\,${fadeOutStart})\\,1\\,if(lt(t\\,${fadeOutEnd})\\,(${fadeOutEnd}-t)/${(fadeOutEnd - fadeOutStart).toFixed(3)}\\,0)))'`
      );
    }

    parts.push(`${vChainParts.join(",")}[v${i}]`);

    const aChain = [
      `${audioSourceLabel}atrim=start=${seg.start}:end=${seg.end}`,
      `asetpts=PTS-STARTPTS`,
      seg.isClimax ? `atempo=0.5` : null,
    ]
      .filter(Boolean)
      .join(",");
    parts.push(`${aChain}[a${i}]`);
  });

  const concatInputs = segments.map((_, i) => `[v${i}][a${i}]`).join("");
  parts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=1[vcat][acat]`);

  const fadeOutStart = Math.max(0, totalDuration - 0.5);
  parts.push(`[vcat]fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOutStart}:d=0.5[vout]`);

  return { filterComplex: parts.join(";"), totalDuration, seCues };
}

function escapeExprQuote(expr: string): string {
  return expr.replace(/'/g, "\\'");
}

interface AudioAsset {
  inputArgs: string[];
  filterChain: string;
  label: string;
}

function buildBgmAsset(inputIndex: number, style: BgmStyle, duration: number): AudioAsset {
  const p = BGM_PRESETS[style];
  const expr = p.freqs.map((f, i) => `${p.weights[i]}*sin(2*PI*${f}*t)`).join("+");
  const dur = Math.max(0.6, duration);
  const fadeOutStart = Math.max(0, dur - 1.2);
  const label = "bgm";
  const filterChain =
    `[${inputIndex}:a]tremolo=f=${p.tremoloHz}:d=${p.tremoloDepth},lowpass=f=${p.lowpass},` +
    `aformat=channel_layouts=stereo:sample_rates=44100,volume=${p.volume},` +
    `afade=t=in:st=0:d=1.2,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=1.2[${label}]`;
  return {
    inputArgs: ["-f", "lavfi", "-i", `aevalsrc=exprs='${escapeExprQuote(expr)}':s=44100:d=${dur.toFixed(3)}`],
    filterChain,
    label,
  };
}

function buildSeAsset(inputIndex: number, cue: SeCue, label: string): AudioAsset {
  const delayMs = Math.max(0, Math.round(cue.time * 1000));
  if (cue.kind === "impact") {
    const expr = `0.5*sin(2*PI*(900-2200*t)*t)*exp(-14*t)+0.7*sin(2*PI*130*t)*exp(-18*t)`;
    const filterChain =
      `[${inputIndex}:a]aformat=channel_layouts=stereo:sample_rates=44100,volume=0.7,` +
      `adelay=${delayMs}|${delayMs}[${label}]`;
    return {
      inputArgs: ["-f", "lavfi", "-i", `aevalsrc=exprs='${escapeExprQuote(expr)}':s=44100:d=0.35`],
      filterChain,
      label,
    };
  }
  const filterChain =
    `[${inputIndex}:a]bandpass=f=1800:width_type=h:w=1600,aformat=channel_layouts=stereo:sample_rates=44100,` +
    `volume=0.55,afade=t=in:st=0:d=0.04,afade=t=out:st=0.06:d=0.2,adelay=${delayMs}|${delayMs}[${label}]`;
  return {
    inputArgs: ["-f", "lavfi", "-i", "anoisesrc=color=pink:duration=0.3:sample_rate=44100"],
    filterChain,
    label,
  };
}

export async function renderHighlight(
  ff: FFmpeg,
  inputName: string,
  hasAudio: boolean,
  segments: Segment[],
  audioOptions: AudioOptions,
  onProgress: (frac: number) => void
): Promise<Blob> {
  await ensureFont(ff);

  const inputArgs = ["-i", inputName];
  if (!hasAudio) {
    inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  }
  const audioSourceLabel = hasAudio ? "[0:a]" : "[1:a]";
  let nextInputIndex = hasAudio ? 1 : 2;

  const { filterComplex, totalDuration, seCues } = buildFilterGraph(segments, audioSourceLabel, audioOptions.se);

  const extraInputArgs: string[] = [];
  const extraFilterParts: string[] = [];
  const mixLabels: string[] = [];

  if (audioOptions.bgm) {
    const bgm = buildBgmAsset(nextInputIndex, audioOptions.bgm, totalDuration);
    nextInputIndex += 1;
    extraInputArgs.push(...bgm.inputArgs);
    extraFilterParts.push(bgm.filterChain);
    mixLabels.push(bgm.label);
  }

  seCues.forEach((cue, i) => {
    const label = `se${i}`;
    const se = buildSeAsset(nextInputIndex, cue, label);
    nextInputIndex += 1;
    extraInputArgs.push(...se.inputArgs);
    extraFilterParts.push(se.filterChain);
    mixLabels.push(label);
  });

  const fadeOutStart = Math.max(0, totalDuration - 0.5);
  let finalFilterComplex = filterComplex;
  if (mixLabels.length > 0) {
    const mixInputs = [`[acat]`, ...mixLabels.map((l) => `[${l}]`)].join("");
    finalFilterComplex = [
      filterComplex,
      ...extraFilterParts,
      `${mixInputs}amix=inputs=${mixLabels.length + 1}:duration=longest:normalize=0,` +
        `alimiter=limit=0.95:attack=5:release=50,` +
        `afade=t=in:st=0:d=0.25,afade=t=out:st=${fadeOutStart}:d=0.5[aout]`,
    ].join(";");
  } else {
    finalFilterComplex = [filterComplex, `[acat]afade=t=in:st=0:d=0.25,afade=t=out:st=${fadeOutStart}:d=0.5[aout]`].join(
      ";"
    );
  }

  // single-threaded ffmpeg.wasm has no realtime headroom on long timelines,
  // so trade a bit of quality for speed once the edit itself runs long
  const preset = totalDuration > 180 ? "ultrafast" : "veryfast";

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress(Math.min(1, Math.max(0, progress)));
  };
  ff.on("progress", progressHandler);

  try {
    await ff.exec([
      ...inputArgs,
      ...extraInputArgs,
      "-filter_complex",
      finalFilterComplex,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-preset",
      preset,
      "-crf",
      "24",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-t",
      `${totalDuration}`,
      "output.mp4",
    ]);
  } finally {
    ff.off("progress", progressHandler);
  }

  const data = (await ff.readFile("output.mp4")) as Uint8Array;
  const bytes = new Uint8Array(data);
  await ff.deleteFile("output.mp4");
  return new Blob([bytes], { type: "video/mp4" });
}
