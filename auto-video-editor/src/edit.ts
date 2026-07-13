import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { Segment } from "./analysis";

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

interface BuiltGraph {
  filterComplex: string;
  totalDuration: number;
}

function buildFilterGraph(segments: Segment[], audioSourceLabel: string): BuiltGraph {
  const parts: string[] = [];
  let totalDuration = 0;

  segments.forEach((seg, i) => {
    const speed = seg.isClimax ? 2.0 : 1.0; // setpts multiplier: 2.0 = half speed (slow-mo)
    const outDur = (seg.end - seg.start) * speed;
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
  parts.push(`[acat]afade=t=in:st=0:d=0.25,afade=t=out:st=${fadeOutStart}:d=0.5[aout]`);

  return { filterComplex: parts.join(";"), totalDuration };
}

export async function renderHighlight(
  ff: FFmpeg,
  inputName: string,
  hasAudio: boolean,
  segments: Segment[],
  onProgress: (frac: number) => void
): Promise<Blob> {
  await ensureFont(ff);

  const inputArgs = ["-i", inputName];
  if (!hasAudio) {
    inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
  }
  const audioSourceLabel = hasAudio ? "[0:a]" : "[1:a]";

  const { filterComplex, totalDuration } = buildFilterGraph(segments, audioSourceLabel);

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
      "-filter_complex",
      filterComplex,
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
