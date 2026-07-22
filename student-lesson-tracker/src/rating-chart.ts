import type { RatingEntry } from "./types.ts";
import { escapeHtml } from "./util.ts";

const WIDTH = 560;
const HEIGHT = 160;
const PAD = 24;

/** Renders a simple SVG line chart of rating over time. `ratings` is newest-first (display order). */
export function renderRatingChart(ratings: RatingEntry[]): string {
  const chronological = ratings.slice().reverse();
  if (chronological.length === 0) return "";

  const values = chronological.map((r) => r.rating);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = chronological.map((r, i) => {
    const x = chronological.length === 1 ? WIDTH / 2 : PAD + (i / (chronological.length - 1)) * (WIDTH - PAD * 2);
    const y = HEIGHT - PAD - ((r.rating - min) / range) * (HEIGHT - PAD * 2);
    return { x, y, rating: r.rating, recordedAt: r.recordedAt };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const dots = points
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#4f7cff"><title>${escapeHtml(p.recordedAt)}: ${p.rating}</title></circle>`,
    )
    .join("");

  return `
    <svg class="rating-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="レーティングの推移">
      <path d="${path}" fill="none" stroke="#4f7cff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
    </svg>`;
}
