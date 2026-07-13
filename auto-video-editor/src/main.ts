import "./style.css";
import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg } from "./ffmpeg-client";
import { analyzeVideo, getDuration } from "./analysis";
import { renderHighlight, hasAudioStream } from "./edit";

const dropzone = document.querySelector<HTMLElement>("#dropzone")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const pickBtn = document.querySelector<HTMLButtonElement>("#pick-btn")!;
const workspace = document.querySelector<HTMLElement>("#workspace")!;
const srcVideo = document.querySelector<HTMLVideoElement>("#src-video")!;
const outVideo = document.querySelector<HTMLVideoElement>("#out-video")!;
const runBtn = document.querySelector<HTMLButtonElement>("#run-btn")!;
const resetBtn = document.querySelector<HTMLButtonElement>("#reset-btn")!;
const downloadLink = document.querySelector<HTMLAnchorElement>("#download-link")!;
const progressWrap = document.querySelector<HTMLElement>("#progress-wrap")!;
const progressFill = document.querySelector<HTMLElement>("#progress-fill")!;
const progressStep = document.querySelector<HTMLElement>("#progress-step")!;
const progressPct = document.querySelector<HTMLElement>("#progress-pct")!;
const statusLine = document.querySelector<HTMLElement>("#status-line")!;

let currentFile: File | null = null;
let outputUrl: string | null = null;

function setProgress(label: string, frac: number) {
  progressWrap.classList.remove("hidden");
  progressStep.textContent = label;
  progressFill.style.width = `${Math.round(frac * 100)}%`;
  progressPct.textContent = `${Math.round(frac * 100)}%`;
}

function loadFile(file: File) {
  currentFile = file;
  const url = URL.createObjectURL(file);
  srcVideo.src = url;
  outVideo.removeAttribute("src");
  downloadLink.classList.add("hidden");
  progressWrap.classList.add("hidden");
  statusLine.textContent = "";
  dropzone.classList.add("hidden");
  workspace.classList.remove("hidden");
  runBtn.disabled = false;
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
  currentFile = null;
  fileInput.value = "";
  workspace.classList.add("hidden");
  dropzone.classList.remove("hidden");
  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  }
});

runBtn.addEventListener("click", async () => {
  if (!currentFile) return;
  runBtn.disabled = true;
  resetBtn.disabled = true;
  statusLine.textContent = "";

  const inputName = "input" + (currentFile.name.match(/\.[a-zA-Z0-9]+$/)?.[0] || ".mp4");

  try {
    setProgress("エンジンを準備中…", 0);
    const ff = await getFFmpeg();

    setProgress("動画を読み込み中…", 0.05);
    await ff.writeFile(inputName, await fetchFile(currentFile));

    const duration = await getDuration(ff, inputName);
    if (!duration) {
      throw new Error("動画の長さを取得できませんでした");
    }
    const hasAudio = await hasAudioStream(ff, inputName);

    const segments = await analyzeVideo(ff, inputName, duration, (label, frac) => setProgress(label, 0.1 + frac * 0.3));

    setProgress("カッコよく編集中…", 0.4);
    const blob = await renderHighlight(ff, inputName, hasAudio, segments, (frac) => {
      setProgress("カッコよく編集中…", 0.4 + frac * 0.6);
    });

    await ff.deleteFile(inputName);

    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = URL.createObjectURL(blob);
    outVideo.src = outputUrl;
    downloadLink.href = outputUrl;
    downloadLink.classList.remove("hidden");

    setProgress("完成！", 1);
    statusLine.textContent = `${segments.length}カットのハイライトを自動生成しました 🎬`;
  } catch (err) {
    console.error(err);
    statusLine.textContent = "編集中にエラーが発生しました。別の動画で試してみてください。";
  } finally {
    runBtn.disabled = false;
    resetBtn.disabled = false;
  }
});
