// 生成された楽曲をピアノロール風に可視化するcanvas描画。

import type { Score } from "./compose.ts";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** progress: 0..1 の再生位置。再生していないときは null */
export function renderPianoRoll(canvas: HTMLCanvasElement, score: Score, progress: number | null): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW === 0 || cssH === 0) return;
  const wantW = Math.round(cssW * dpr);
  const wantH = Math.round(cssH * dpr);
  if (canvas.width !== wantW || canvas.height !== wantH) {
    canvas.width = wantW;
    canvas.height = wantH;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const total = score.totalDuration;
  const barDur = total / score.totalBars;

  // 小節線
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 1;
  for (let b = 0; b <= score.totalBars; b++) {
    const x = ((b * barDur) / total) * cssW;
    const strong = b % 4 === 0;
    ctx.strokeStyle = strong ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssH);
    ctx.stroke();
  }

  const notes = score.melody.notes;
  if (notes.length > 0) {
    let minM = Infinity;
    let maxM = -Infinity;
    for (const n of notes) {
      if (n.midi < minM) minM = n.midi;
      if (n.midi > maxM) maxM = n.midi;
    }
    minM -= 2;
    maxM += 2;
    const span = Math.max(1, maxM - minM);
    const noteH = Math.max(3, Math.min(9, cssH / span));

    for (const n of notes) {
      const x = (n.time / total) * cssW;
      const w = Math.max(2, (n.duration / total) * cssW - 1);
      const y = cssH - ((n.midi - minM) / span) * cssH - noteH / 2;
      ctx.fillStyle = "#c98bff";
      ctx.globalAlpha = 0.5 + n.velocity * 0.5;
      roundRect(ctx, x, y, w, noteH, 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (progress !== null) {
    const x = Math.max(0, Math.min(1, progress)) * cssW;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssH);
    ctx.stroke();
  }
}
