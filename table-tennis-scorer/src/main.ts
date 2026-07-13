import "./style.css";
import { fetchFile } from "@ffmpeg/util";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { getFFmpeg } from "./ffmpeg-client";
import { detectRallies, getDuration, type RallyCandidate } from "./analysis";
import { replayMatch, type MatchConfig, type PointEvent, type Side } from "./scoring";
import { asciiPlayerLabels, hasAudioStream, renderScoredVideo } from "./export";

type CandidateStatus = "pending" | "confirmed" | "skipped";

interface Candidate extends RallyCandidate {
  id: string;
  status: CandidateStatus;
  winner: Side | null;
}

const dropzone = document.querySelector<HTMLElement>("#dropzone")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const pickBtn = document.querySelector<HTMLButtonElement>("#pick-btn")!;
const matchForm = document.querySelector<HTMLFormElement>("#match-form")!;
const playerANameInput = document.querySelector<HTMLInputElement>("#player-a-name")!;
const playerBNameInput = document.querySelector<HTMLInputElement>("#player-b-name")!;
const firstServerSelect = document.querySelector<HTMLSelectElement>("#first-server")!;
const pointsToWinSelect = document.querySelector<HTMLSelectElement>("#points-to-win")!;
const bestOfSelect = document.querySelector<HTMLSelectElement>("#best-of")!;
const startAnalyzeBtn = document.querySelector<HTMLButtonElement>("#start-analyze-btn")!;
const sizeWarning = document.querySelector<HTMLElement>("#size-warning")!;

const setupSection = document.querySelector<HTMLElement>("#setup")!;
const reviewSection = document.querySelector<HTMLElement>("#review")!;
const progressWrap = document.querySelector<HTMLElement>("#progress-wrap")!;
const progressFill = document.querySelector<HTMLElement>("#progress-fill")!;
const progressStep = document.querySelector<HTMLElement>("#progress-step")!;
const progressPct = document.querySelector<HTMLElement>("#progress-pct")!;
const statusLine = document.querySelector<HTMLElement>("#status-line")!;

const video = document.querySelector<HTMLVideoElement>("#video")!;
const timeline = document.querySelector<HTMLElement>("#timeline")!;
const playhead = document.querySelector<HTMLElement>("#playhead")!;

const scoreNameA = document.querySelector<HTMLElement>("#score-name-a")!;
const scoreNameB = document.querySelector<HTMLElement>("#score-name-b")!;
const scoreValueA = document.querySelector<HTMLElement>("#score-value-a")!;
const scoreValueB = document.querySelector<HTMLElement>("#score-value-b")!;
const serveDotA = document.querySelector<HTMLElement>("#serve-dot-a")!;
const serveDotB = document.querySelector<HTMLElement>("#serve-dot-b")!;
const gameLabel = document.querySelector<HTMLElement>("#game-label")!;
const gamesWonEl = document.querySelector<HTMLElement>("#games-won")!;
const matchWinnerBanner = document.querySelector<HTMLElement>("#match-winner-banner")!;

const candidateIndexEl = document.querySelector<HTMLElement>("#candidate-index")!;
const candidateTotalEl = document.querySelector<HTMLElement>("#candidate-total")!;
const candidateTimeEl = document.querySelector<HTMLElement>("#candidate-time")!;
const candidateStatusEl = document.querySelector<HTMLElement>("#candidate-status")!;
const previewBtn = document.querySelector<HTMLButtonElement>("#preview-btn")!;
const assignABtn = document.querySelector<HTMLButtonElement>("#assign-a-btn")!;
const assignBBtn = document.querySelector<HTMLButtonElement>("#assign-b-btn")!;
const skipBtn = document.querySelector<HTMLButtonElement>("#skip-btn")!;
const undoCandidateBtn = document.querySelector<HTMLButtonElement>("#undo-candidate-btn")!;
const prevCandidateBtn = document.querySelector<HTMLButtonElement>("#prev-candidate-btn")!;
const nextCandidateBtn = document.querySelector<HTMLButtonElement>("#next-candidate-btn")!;

const manualAddABtn = document.querySelector<HTMLButtonElement>("#manual-add-a-btn")!;
const manualAddBBtn = document.querySelector<HTMLButtonElement>("#manual-add-b-btn")!;

const pointLogList = document.querySelector<HTMLElement>("#point-log-list")!;

const exportJsonBtn = document.querySelector<HTMLButtonElement>("#export-json-btn")!;
const exportCsvBtn = document.querySelector<HTMLButtonElement>("#export-csv-btn")!;
const exportVideoBtn = document.querySelector<HTMLButtonElement>("#export-video-btn")!;
const exportProgressWrap = document.querySelector<HTMLElement>("#export-progress-wrap")!;
const exportProgressFill = document.querySelector<HTMLElement>("#export-progress-fill")!;
const exportProgressStep = document.querySelector<HTMLElement>("#export-progress-step")!;
const exportProgressPct = document.querySelector<HTMLElement>("#export-progress-pct")!;
const outVideo = document.querySelector<HTMLVideoElement>("#out-video")!;
const downloadLink = document.querySelector<HTMLAnchorElement>("#download-link")!;

const resetBtn = document.querySelector<HTMLButtonElement>("#reset-btn")!;

let currentFile: File | null = null;
let videoURL: string | null = null;
let outputURL: string | null = null;
let duration = 0;
let hasAudio = false;
let ff: FFmpeg | null = null;
let inputName = "";

let candidates: Candidate[] = [];
let manualPoints: PointEvent[] = [];
let reviewIndex = 0;
let manualIdSeq = 0;

let names = { A: "選手A", B: "選手B" };
let config: MatchConfig = { pointsToWin: 11, bestOf: 5, firstServer: "A" };

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function setProgress(label: string, frac: number) {
  progressWrap.classList.remove("hidden");
  progressStep.textContent = label;
  progressFill.style.width = `${Math.round(frac * 100)}%`;
  progressPct.textContent = `${Math.round(frac * 100)}%`;
}

function setExportProgress(label: string, frac: number) {
  exportProgressWrap.classList.remove("hidden");
  exportProgressStep.textContent = label;
  exportProgressFill.style.width = `${Math.round(frac * 100)}%`;
  exportProgressPct.textContent = `${Math.round(frac * 100)}%`;
}

function getAllPoints(): PointEvent[] {
  const fromCandidates: PointEvent[] = candidates
    .filter((c) => c.status === "confirmed" && c.winner)
    .map((c) => ({ id: c.id, time: c.end, winner: c.winner as Side, auto: true }));
  return [...fromCandidates, ...manualPoints].sort((a, b) => a.time - b.time);
}

function renderScoreboard() {
  scoreNameA.textContent = names.A;
  scoreNameB.textContent = names.B;

  const points = getAllPoints();
  const snapshots = replayMatch(points, config);
  const last = snapshots[snapshots.length - 1];

  const current = last?.currentGame ?? { A: 0, B: 0 };
  const gamesWon = last?.gamesWon ?? { A: 0, B: 0 };
  const gameNo = (last?.gameIndex ?? 0) + 1;
  const server = last?.server ?? config.firstServer;
  const matchWinner = last?.matchWinner ?? null;

  scoreValueA.textContent = String(current.A);
  scoreValueB.textContent = String(current.B);
  gameLabel.textContent = `GAME ${gameNo}`;
  gamesWonEl.textContent = `${gamesWon.A} - ${gamesWon.B}`;

  serveDotA.classList.toggle("hidden", server !== "A" || !!matchWinner);
  serveDotB.classList.toggle("hidden", server !== "B" || !!matchWinner);

  if (matchWinner) {
    matchWinnerBanner.textContent = `🏆 ${names[matchWinner]} の勝利！（${gamesWon.A} - ${gamesWon.B}）`;
    matchWinnerBanner.classList.remove("hidden");
  } else {
    matchWinnerBanner.classList.add("hidden");
  }
}

function renderTimeline() {
  timeline.querySelectorAll(".marker").forEach((el) => el.remove());

  candidates.forEach((cand, i) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `marker marker-${cand.status}`;
    if (i === reviewIndex) marker.classList.add("marker-active");
    marker.style.left = `${duration > 0 ? (cand.end / duration) * 100 : 0}%`;
    marker.title = `${formatTime(cand.end)} 付近`;
    marker.addEventListener("click", () => {
      reviewIndex = i;
      seekToCandidate(i);
      renderCandidateCard();
      renderTimeline();
    });
    timeline.appendChild(marker);
  });

  manualPoints.forEach((pt) => {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "marker marker-manual";
    marker.style.left = `${duration > 0 ? (pt.time / duration) * 100 : 0}%`;
    marker.title = `${formatTime(pt.time)} 手動追加（${names[pt.winner]}）`;
    marker.addEventListener("click", () => {
      video.currentTime = Math.max(0, pt.time - 1);
    });
    timeline.appendChild(marker);
  });
}

function renderCandidateCard() {
  if (candidates.length === 0) {
    candidateIndexEl.textContent = "0";
    candidateTotalEl.textContent = "0";
    candidateTimeEl.textContent = "0:00";
    candidateStatusEl.textContent = "ラリー候補が検出されませんでした。下の「手動で追加」から得点を記録してください。";
    [previewBtn, assignABtn, assignBBtn, skipBtn, undoCandidateBtn, prevCandidateBtn, nextCandidateBtn].forEach(
      (b) => (b.disabled = true)
    );
    return;
  }

  [previewBtn, assignABtn, assignBBtn, skipBtn, prevCandidateBtn, nextCandidateBtn].forEach((b) => (b.disabled = false));

  const cand = candidates[reviewIndex];
  candidateIndexEl.textContent = String(reviewIndex + 1);
  candidateTotalEl.textContent = String(candidates.length);
  candidateTimeEl.textContent = formatTime(cand.end);

  const statusLabels: Record<CandidateStatus, string> = {
    pending: "未確認",
    confirmed: `確定：${cand.winner ? names[cand.winner] : ""}の得点`,
    skipped: "得点ではないとして除外済み",
  };
  candidateStatusEl.textContent = statusLabels[cand.status];
  undoCandidateBtn.disabled = cand.status === "pending";

  assignABtn.classList.toggle("btn-selected", cand.status === "confirmed" && cand.winner === "A");
  assignBBtn.classList.toggle("btn-selected", cand.status === "confirmed" && cand.winner === "B");
  skipBtn.classList.toggle("btn-selected", cand.status === "skipped");
}

function renderPointLog() {
  const points = getAllPoints();
  pointLogList.innerHTML = "";
  if (points.length === 0) {
    const li = document.createElement("li");
    li.className = "point-log-empty";
    li.textContent = "まだ得点がありません";
    pointLogList.appendChild(li);
    return;
  }
  const snapshots = replayMatch(points, config);
  points.forEach((pt, i) => {
    const snap = snapshots[i];
    const li = document.createElement("li");
    li.className = "point-log-row";
    li.innerHTML = `
      <span class="point-log-time">${formatTime(pt.time)}</span>
      <span class="point-log-winner">${names[pt.winner]}</span>
      <span class="point-log-score">${snap.currentGame.A}-${snap.currentGame.B}（G${snap.gameIndex + 1}）</span>
      <span class="point-log-source">${pt.auto ? "AI" : "手動"}</span>
      <button type="button" class="point-log-delete" title="削除">✕</button>
    `;
    li.querySelector(".point-log-delete")!.addEventListener("click", () => deletePoint(pt));
    pointLogList.appendChild(li);
  });
}

function renderAll() {
  renderScoreboard();
  renderTimeline();
  renderCandidateCard();
  renderPointLog();
}

function deletePoint(pt: PointEvent) {
  if (pt.auto) {
    const cand = candidates.find((c) => c.id === pt.id);
    if (cand) {
      cand.status = "pending";
      cand.winner = null;
    }
  } else {
    manualPoints = manualPoints.filter((p) => p.id !== pt.id);
  }
  renderAll();
}

function seekToCandidate(i: number) {
  const cand = candidates[i];
  video.currentTime = Math.max(0, cand.end - 2);
}

function advanceToNextPending(fromIdx: number) {
  for (let i = fromIdx + 1; i < candidates.length; i++) {
    if (candidates[i].status === "pending") {
      reviewIndex = i;
      seekToCandidate(i);
      return;
    }
  }
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].status === "pending") {
      reviewIndex = i;
      seekToCandidate(i);
      return;
    }
  }
  reviewIndex = Math.min(fromIdx + 1, candidates.length - 1);
  statusLine.textContent = "すべての候補を確認しました。得点ログを確認し、必要なら書き出してください。";
}

function assignCurrent(side: Side) {
  if (candidates.length === 0) return;
  const cand = candidates[reviewIndex];
  cand.status = "confirmed";
  cand.winner = side;
  const idx = reviewIndex;
  renderAll();
  advanceToNextPending(idx);
  renderAll();
}

function skipCurrent() {
  if (candidates.length === 0) return;
  const cand = candidates[reviewIndex];
  cand.status = "skipped";
  cand.winner = null;
  const idx = reviewIndex;
  renderAll();
  advanceToNextPending(idx);
  renderAll();
}

function undoCurrent() {
  if (candidates.length === 0) return;
  const cand = candidates[reviewIndex];
  cand.status = "pending";
  cand.winner = null;
  renderAll();
}

function addManualPoint(side: Side) {
  manualPoints.push({ id: `manual-${manualIdSeq++}`, time: video.currentTime, winner: side, auto: false });
  renderAll();
}

assignABtn.addEventListener("click", () => assignCurrent("A"));
assignBBtn.addEventListener("click", () => assignCurrent("B"));
skipBtn.addEventListener("click", () => skipCurrent());
undoCandidateBtn.addEventListener("click", () => undoCurrent());
manualAddABtn.addEventListener("click", () => addManualPoint("A"));
manualAddBBtn.addEventListener("click", () => addManualPoint("B"));

prevCandidateBtn.addEventListener("click", () => {
  if (candidates.length === 0) return;
  reviewIndex = (reviewIndex - 1 + candidates.length) % candidates.length;
  seekToCandidate(reviewIndex);
  renderAll();
});
nextCandidateBtn.addEventListener("click", () => {
  if (candidates.length === 0) return;
  reviewIndex = (reviewIndex + 1) % candidates.length;
  seekToCandidate(reviewIndex);
  renderAll();
});

let previewTimeoutHandler: (() => void) | null = null;
previewBtn.addEventListener("click", () => {
  if (candidates.length === 0) return;
  const cand = candidates[reviewIndex];
  if (previewTimeoutHandler) video.removeEventListener("timeupdate", previewTimeoutHandler);
  video.currentTime = Math.max(0, cand.start - 1);
  video.play();
  previewTimeoutHandler = () => {
    if (video.currentTime >= cand.end + 0.8) {
      video.pause();
      video.removeEventListener("timeupdate", previewTimeoutHandler!);
      previewTimeoutHandler = null;
    }
  };
  video.addEventListener("timeupdate", previewTimeoutHandler);
});

video.addEventListener("timeupdate", () => {
  if (duration > 0) {
    playhead.style.left = `${(video.currentTime / duration) * 100}%`;
  }
});

document.addEventListener("keydown", (e) => {
  if (reviewSection.classList.contains("hidden")) return;
  const target = e.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;

  switch (e.key.toLowerCase()) {
    case "a":
      assignCurrent("A");
      break;
    case "b":
      assignCurrent("B");
      break;
    case "s":
      skipCurrent();
      break;
    case "arrowleft":
      e.preventDefault();
      prevCandidateBtn.click();
      break;
    case "arrowright":
      e.preventDefault();
      nextCandidateBtn.click();
      break;
    case " ":
      e.preventDefault();
      if (video.paused) video.play();
      else video.pause();
      break;
  }
});

const LARGE_FILE_WARN_BYTES = 300 * 1024 * 1024; // 300MB

function loadFile(file: File) {
  currentFile = file;
  if (videoURL) URL.revokeObjectURL(videoURL);
  videoURL = URL.createObjectURL(file);
  video.src = videoURL;
  matchForm.classList.remove("hidden");
  statusLine.textContent = "";
  dropzone.classList.add("hidden");

  if (file.size > LARGE_FILE_WARN_BYTES) {
    const mb = Math.round(file.size / (1024 * 1024));
    sizeWarning.textContent =
      `⚠ 動画サイズが約${mb}MBと大きめです。ブラウザ内で解析するため、処理に時間がかかったり、` +
      `特にSafariやスマートフォンではメモリ不足で解析が止まる場合があります。短く分割する、` +
      `解像度を下げてエクスポートする、またはPCのChromeなどで試すと安定しやすいです。`;
    sizeWarning.classList.remove("hidden");
  } else {
    sizeWarning.classList.add("hidden");
  }
}

pickBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});
dropzone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
  });
});
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});

resetBtn.addEventListener("click", () => {
  (async () => {
    if (ff && inputName) {
      try {
        await ff.deleteFile(inputName);
      } catch {
        // already removed
      }
    }
  })();
  currentFile = null;
  inputName = "";
  candidates = [];
  manualPoints = [];
  reviewIndex = 0;
  fileInput.value = "";
  dropzone.classList.remove("hidden");
  matchForm.classList.add("hidden");
  reviewSection.classList.add("hidden");
  setupSection.classList.remove("hidden");
  progressWrap.classList.add("hidden");
  exportProgressWrap.classList.add("hidden");
  downloadLink.classList.add("hidden");
  outVideo.classList.add("hidden");
  statusLine.textContent = "";
  if (videoURL) {
    URL.revokeObjectURL(videoURL);
    videoURL = null;
  }
  if (outputURL) {
    URL.revokeObjectURL(outputURL);
    outputURL = null;
  }
});

startAnalyzeBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  startAnalyzeBtn.disabled = true;
  statusLine.textContent = "";

  names = {
    A: playerANameInput.value.trim() || "選手A",
    B: playerBNameInput.value.trim() || "選手B",
  };
  config = {
    pointsToWin: parseInt(pointsToWinSelect.value, 10),
    bestOf: parseInt(bestOfSelect.value, 10),
    firstServer: firstServerSelect.value as Side,
  };

  try {
    setProgress("エンジンを準備中…", 0);
    ff = await getFFmpeg();

    setProgress("動画を読み込み中…", 0.05);
    inputName = "input" + (currentFile.name.match(/\.[a-zA-Z0-9]+$/)?.[0] || ".mp4");
    await ff.writeFile(inputName, await fetchFile(currentFile));

    duration = await getDuration(ff, inputName);
    if (!duration) {
      throw new Error("動画の長さを取得できませんでした");
    }
    hasAudio = await hasAudioStream(ff, inputName);

    const rallies = await detectRallies(ff, inputName, duration, (label, frac) => setProgress(label, 0.1 + frac * 0.85));

    candidates = rallies.map((r, i) => ({ ...r, id: `cand-${i}`, status: "pending" as CandidateStatus, winner: null }));
    manualPoints = [];
    reviewIndex = candidates.findIndex((c) => c.status === "pending");
    if (reviewIndex < 0) reviewIndex = 0;

    setProgress("完了", 1);
    setupSection.classList.add("hidden");
    reviewSection.classList.remove("hidden");
    statusLine.textContent = "";

    if (candidates.length > 0) {
      seekToCandidate(reviewIndex);
      statusLine.textContent = `${candidates.length}件のラリー候補を検出しました。ひとつずつ確認してください。`;
    } else {
      statusLine.textContent = "ラリー候補を自動検出できませんでした。手動で得点を追加してください。";
    }
    renderAll();
  } catch (err) {
    console.error(err);
    statusLine.textContent =
      "解析中にエラーが発生しました。動画が大きい場合はメモリ不足が原因のことがあります。" +
      "動画を短く分割する、解像度を下げる、またはPCのChromeなどで試してみてください。";
  } finally {
    startAnalyzeBtn.disabled = false;
  }
});

function downloadBlob(content: BlobPart, type: string, filename: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

exportJsonBtn.addEventListener("click", () => {
  const points = getAllPoints();
  const snapshots = replayMatch(points, config);
  const data = {
    players: names,
    config,
    points: points.map((p, i) => ({
      time: p.time,
      winner: p.winner,
      winnerName: names[p.winner],
      source: p.auto ? "auto" : "manual",
      game: snapshots[i].gameIndex + 1,
      scoreAfter: snapshots[i].currentGame,
      gamesWonAfter: snapshots[i].gamesWon,
    })),
    finishedGames: snapshots[snapshots.length - 1]?.finishedGames ?? [],
    matchWinner: snapshots[snapshots.length - 1]?.matchWinner ?? null,
  };
  downloadBlob(JSON.stringify(data, null, 2), "application/json", "table-tennis-score.json");
});

exportCsvBtn.addEventListener("click", () => {
  const points = getAllPoints();
  const snapshots = replayMatch(points, config);
  const rows = ["time,winner,source,game,scoreA,scoreB,gamesWonA,gamesWonB"];
  points.forEach((p, i) => {
    const s = snapshots[i];
    rows.push(
      [formatTime(p.time), names[p.winner], p.auto ? "AI" : "手動", s.gameIndex + 1, s.currentGame.A, s.currentGame.B, s.gamesWon.A, s.gamesWon.B].join(
        ","
      )
    );
  });
  downloadBlob(rows.join("\n"), "text/csv", "table-tennis-score.csv");
});

exportVideoBtn.addEventListener("click", async () => {
  if (!ff || !inputName) return;
  exportVideoBtn.disabled = true;
  try {
    setExportProgress("スコアボードを焼き込み中…", 0);
    const points = getAllPoints();
    const labels = asciiPlayerLabels(names.A, names.B);
    const blob = await renderScoredVideo(ff, inputName, hasAudio, duration, points, config, labels, (frac) =>
      setExportProgress("スコアボードを焼き込み中…", frac)
    );
    if (outputURL) URL.revokeObjectURL(outputURL);
    outputURL = URL.createObjectURL(blob);
    outVideo.src = outputURL;
    outVideo.classList.remove("hidden");
    downloadLink.href = outputURL;
    downloadLink.classList.remove("hidden");
    setExportProgress("完成！", 1);
  } catch (err) {
    console.error(err);
    statusLine.textContent = "動画の書き出し中にエラーが発生しました。";
  } finally {
    exportVideoBtn.disabled = false;
  }
});
