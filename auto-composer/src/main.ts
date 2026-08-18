import "./style.css";
import { type ComposeOptions, type Score, generateScore } from "./compose.ts";
import { buildMidiFile } from "./midi.ts";
import { getPlaybackSeconds, isPlaying, playScore, renderScoreOffline, stopPlayback } from "./player.ts";
import { makeSeed } from "./rng.ts";
import { STYLE_LIST, type StyleId } from "./styles.ts";
import { NOTE_NAMES } from "./theory.ts";
import { renderPianoRoll } from "./viz.ts";
import { audioBufferToWav } from "./wav.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const setupSection = $<HTMLElement>("setup");
const workspaceSection = $<HTMLElement>("workspace");
const styleGrid = $<HTMLDivElement>("style-grid");
const lengthGrid = $<HTMLDivElement>("length-grid");
const keySelect = $<HTMLSelectElement>("key-select");
const composeBtn = $<HTMLButtonElement>("compose-btn");

const trackTitle = $<HTMLHeadingElement>("track-title");
const trackChips = $<HTMLDivElement>("track-chips");
const canvas = $<HTMLCanvasElement>("piano-roll");
const playBtn = $<HTMLButtonElement>("play-btn");
const timeLabel = $<HTMLSpanElement>("time-label");
const exportWavBtn = $<HTMLButtonElement>("export-wav-btn");
const exportMidiBtn = $<HTMLButtonElement>("export-midi-btn");
const progressWrap = $<HTMLDivElement>("progress-wrap");
const progressStep = $<HTMLSpanElement>("progress-step");
const statusLine = $<HTMLParagraphElement>("status-line");
const regenerateBtn = $<HTMLButtonElement>("regenerate-btn");
const backBtn = $<HTMLButtonElement>("back-btn");

const LENGTH_OPTIONS: { label: string; sub: string; seconds: number }[] = [
  { label: "30秒", sub: "ショート", seconds: 30 },
  { label: "1分", sub: "スタンダード", seconds: 60 },
  { label: "2分", sub: "ロング", seconds: 120 },
];

let selectedStyleId: StyleId = STYLE_LIST[0].id;
let selectedLength = LENGTH_OPTIONS[1].seconds;
let selectedKeyPc: number | undefined;
let currentScore: Score | null = null;
let rafHandle: number | null = null;

function buildSetupUI(): void {
  for (const style of STYLE_LIST) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "style-card";
    btn.dataset.style = style.id;
    btn.innerHTML = `
      <span class="style-emoji">${style.emoji}</span>
      <span class="style-name">${style.label}</span>
      <span class="style-desc">${style.description}</span>
    `;
    btn.addEventListener("click", () => {
      selectedStyleId = style.id;
      syncStyleButtons();
    });
    styleGrid.appendChild(btn);
  }
  syncStyleButtons();

  for (const opt of LENGTH_OPTIONS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-btn";
    btn.dataset.seconds = String(opt.seconds);
    btn.innerHTML = `<span class="chip-title">${opt.label}</span><span class="chip-sub">${opt.sub}</span>`;
    btn.addEventListener("click", () => {
      selectedLength = opt.seconds;
      syncLengthButtons();
    });
    lengthGrid.appendChild(btn);
  }
  syncLengthButtons();

  const autoOpt = document.createElement("option");
  autoOpt.value = "";
  autoOpt.textContent = "🎲 おまかせ（ランダム）";
  keySelect.appendChild(autoOpt);
  NOTE_NAMES.forEach((name, pc) => {
    const opt = document.createElement("option");
    opt.value = String(pc);
    opt.textContent = name;
    keySelect.appendChild(opt);
  });
  keySelect.addEventListener("change", () => {
    selectedKeyPc = keySelect.value === "" ? undefined : Number(keySelect.value);
  });
}

function syncStyleButtons(): void {
  for (const el of styleGrid.querySelectorAll<HTMLButtonElement>(".style-card")) {
    el.classList.toggle("active", el.dataset.style === selectedStyleId);
  }
}

function syncLengthButtons(): void {
  for (const el of lengthGrid.querySelectorAll<HTMLButtonElement>(".chip-btn")) {
    el.classList.toggle("active", Number(el.dataset.seconds) === selectedLength);
  }
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function stopAnimation(): void {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
}

function resetPlayUI(): void {
  stopAnimation();
  playBtn.textContent = "▶ 再生";
  if (currentScore) {
    timeLabel.textContent = `0:00 / ${formatTime(currentScore.totalDuration)}`;
    renderPianoRoll(canvas, currentScore, null);
  }
}

function animate(): void {
  if (!currentScore) return;
  const sec = getPlaybackSeconds();
  if (sec === null || !isPlaying()) {
    resetPlayUI();
    return;
  }
  const total = currentScore.totalDuration;
  const progress = Math.min(1, Math.max(0, sec / total));
  renderPianoRoll(canvas, currentScore, progress);
  timeLabel.textContent = `${formatTime(Math.min(sec, total))} / ${formatTime(total)}`;
  rafHandle = requestAnimationFrame(animate);
}

function renderScoreToUI(score: Score): void {
  const style = STYLE_LIST.find((s) => s.id === score.styleId)!;
  trackTitle.textContent = `${style.emoji} ${score.title}`;
  trackChips.innerHTML = "";
  const chips = [
    `スタイル: ${score.styleLabel}`,
    `キー: ${score.keyName}`,
    `テンポ: ${score.tempo} BPM`,
    `長さ: ${formatTime(score.totalDuration)}`,
  ];
  for (const text of chips) {
    const span = document.createElement("span");
    span.className = "chip";
    span.textContent = text;
    trackChips.appendChild(span);
  }
  timeLabel.textContent = `0:00 / ${formatTime(score.totalDuration)}`;
  renderPianoRoll(canvas, score, null);
  statusLine.textContent = "";
}

function composeNew(seed: number): void {
  stopPlayback();
  resetPlayUI();
  const opts: ComposeOptions = {
    styleId: selectedStyleId,
    lengthSec: selectedLength,
    keyPc: selectedKeyPc,
    seed,
  };
  currentScore = generateScore(opts);
  renderScoreToUI(currentScore);
  setupSection.classList.add("hidden");
  workspaceSection.classList.remove("hidden");
}

function togglePlay(): void {
  if (!currentScore) return;
  if (isPlaying()) {
    stopPlayback();
    resetPlayUI();
    return;
  }
  playScore(currentScore, () => {
    resetPlayUI();
  });
  playBtn.textContent = "■ 停止";
  stopAnimation();
  rafHandle = requestAnimationFrame(animate);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportWav(): Promise<void> {
  if (!currentScore) return;
  exportWavBtn.disabled = true;
  exportMidiBtn.disabled = true;
  progressWrap.classList.remove("hidden");
  progressStep.textContent = "WAVを書き出し中…（数秒かかることがあります）";
  statusLine.textContent = "";
  try {
    const buffer = await renderScoreOffline(currentScore);
    const blob = audioBufferToWav(buffer);
    downloadBlob(blob, `auto-compose-${currentScore.styleId}.wav`);
    statusLine.textContent = "✅ WAVファイルをダウンロードしました。";
  } catch (err) {
    console.error(err);
    statusLine.textContent = "⚠️ WAVの書き出し中にエラーが発生しました。";
  } finally {
    progressWrap.classList.add("hidden");
    exportWavBtn.disabled = false;
    exportMidiBtn.disabled = false;
  }
}

function exportMidi(): void {
  if (!currentScore) return;
  try {
    const bytes = buildMidiFile(currentScore);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/midi" });
    downloadBlob(blob, `auto-compose-${currentScore.styleId}.mid`);
    statusLine.textContent = "✅ MIDIファイルをダウンロードしました。DAWに読み込んで編集できます。";
  } catch (err) {
    console.error(err);
    statusLine.textContent = "⚠️ MIDIの書き出し中にエラーが発生しました。";
  }
}

function init(): void {
  buildSetupUI();

  composeBtn.addEventListener("click", () => composeNew(makeSeed()));
  regenerateBtn.addEventListener("click", () => composeNew(makeSeed()));
  backBtn.addEventListener("click", () => {
    stopPlayback();
    resetPlayUI();
    workspaceSection.classList.add("hidden");
    setupSection.classList.remove("hidden");
  });
  playBtn.addEventListener("click", togglePlay);
  exportWavBtn.addEventListener("click", () => void exportWav());
  exportMidiBtn.addEventListener("click", exportMidi);

  window.addEventListener("resize", () => {
    if (currentScore && !isPlaying()) renderPianoRoll(canvas, currentScore, null);
  });
}

init();
