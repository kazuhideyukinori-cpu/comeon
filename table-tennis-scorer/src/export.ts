import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { MatchConfig, MatchSnapshot, PointEvent, Side } from "./scoring";
import { replayMatch } from "./scoring";

export interface PlayerLabels {
  A: string;
  B: string;
}

function toAsciiLabel(name: string, fallback: string): string {
  // 動画への焼き込み文字は同梱フォント（Anton, 欧文専用）の対応範囲に合わせて半角英数記号のみ使用する。
  const ascii = name.replace(/[^\x20-\x7E]/g, "").trim();
  return ascii.length > 0 ? ascii.slice(0, 14) : fallback;
}

export function asciiPlayerLabels(nameA: string, nameB: string): PlayerLabels {
  return { A: toAsciiLabel(nameA, "A"), B: toAsciiLabel(nameB, "B") };
}

let fontWritten = false;

async function ensureFont(ff: FFmpeg) {
  if (fontWritten) return;
  const fontResp = await fetch(`${import.meta.env.BASE_URL}Anton.ttf`);
  await ff.writeFile("Anton.ttf", new Uint8Array(await fontResp.arrayBuffer()));
  fontWritten = true;
}

function escapeDrawtext(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function scoreboardText(labels: PlayerLabels, snap: MatchSnapshot): string {
  const { currentGame, gamesWon, matchWinner } = snap;
  const gameNo = snap.gameIndex + 1;
  if (matchWinner) {
    const winnerLabel: Side = matchWinner;
    return `${labels[winnerLabel]} WINS THE MATCH  (${gamesWon.A}-${gamesWon.B})`;
  }
  return `${labels.A} ${currentGame.A} - ${currentGame.B} ${labels.B}   GAME ${gameNo} (${gamesWon.A}-${gamesWon.B})`;
}

interface Interval {
  start: number;
  end: number;
  text: string;
}

function buildIntervals(points: PointEvent[], snapshots: MatchSnapshot[], labels: PlayerLabels, duration: number): Interval[] {
  const intervals: Interval[] = [];
  const initialText = `${labels.A} 0 - 0 ${labels.B}   GAME 1 (0-0)`;
  const firstTime = points.length > 0 ? Math.min(points[0].time, duration) : duration;
  if (firstTime > 0) {
    intervals.push({ start: 0, end: firstTime, text: initialText });
  }

  points.forEach((pt, i) => {
    const start = Math.min(pt.time, duration);
    const end = Math.min(i + 1 < points.length ? points[i + 1].time : duration, duration);
    if (end <= start) return;
    intervals.push({ start, end, text: scoreboardText(labels, snapshots[i]) });
  });

  if (intervals.length === 0) {
    intervals.push({ start: 0, end: duration, text: initialText });
  }
  return intervals;
}

/**
 * 確定したポイント履歴からスコア推移を計算し、動画にスコアボードを焼き込んだ
 * mp4 を書き出す。ドロー位置は上部中央固定、区間ごとの表示切り替えは
 * drawtext の enable='between(t,start,end)' をチェーンして実現する。
 */
export async function renderScoredVideo(
  ff: FFmpeg,
  inputName: string,
  hasAudio: boolean,
  duration: number,
  points: PointEvent[],
  config: MatchConfig,
  labels: PlayerLabels,
  onProgress: (frac: number) => void
): Promise<Blob> {
  await ensureFont(ff);

  const sorted = [...points].sort((a, b) => a.time - b.time);
  const snapshots = replayMatch(sorted, config);
  const intervals = buildIntervals(sorted, snapshots, labels, duration);

  const parts: string[] = [];
  let prevLabel = "[0:v]";
  intervals.forEach((iv, i) => {
    const label = `sb${i}`;
    const text = escapeDrawtext(iv.text);
    parts.push(
      `${prevLabel}drawtext=fontfile=Anton.ttf:text='${text}':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.55:` +
        `boxborderw=14:x=(w-text_w)/2:y=26:enable='between(t,${iv.start.toFixed(3)},${iv.end.toFixed(3)})'[${label}]`
    );
    prevLabel = `[${label}]`;
  });
  parts.push(`${prevLabel}null[vout]`);

  const mapArgs = ["-map", "[vout]"];
  if (hasAudio) mapArgs.push("-map", "0:a");

  const progressHandler = ({ progress }: { progress: number }) => {
    onProgress(Math.min(1, Math.max(0, progress)));
  };
  ff.on("progress", progressHandler);

  try {
    await ff.exec([
      "-i",
      inputName,
      "-filter_complex",
      parts.join(";"),
      ...mapArgs,
      "-c:v",
      "libx264",
      "-preset",
      duration > 180 ? "ultrafast" : "veryfast",
      "-crf",
      "23",
      ...(hasAudio ? ["-c:a", "aac", "-b:a", "160k"] : []),
      "-movflags",
      "+faststart",
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
