import { fetchStudentData, isConfigured, submitMatch, submitRating, StudentApiError } from "./student-api.ts";
import type { StudentPageData } from "./student-api.ts";
import type { LessonEntry, MatchEntry, RatingEntry } from "./types.ts";
import { escapeHtml, nowDisplay, todayIso } from "./util.ts";
import { renderRatingChart } from "./rating-chart.ts";

const SHELL = `
  <header class="topbar">
    <div class="brand"><span class="logo">🏓</span><span id="student-brand-name">卓球レッスンノート</span></div>
    <p class="tagline">あなた専用のレッスン記録ページです。</p>
  </header>
  <main class="stage" id="student-main">
    <div class="card"><p class="empty-note">読み込み中…</p></div>
  </main>
  <footer class="footer">
    <p>このページのURLは、あなた専用のリンクです。第三者に共有しないようご注意ください。</p>
  </footer>
`;

export async function mountStudentView(root: HTMLElement, studentId: string): Promise<void> {
  root.innerHTML = SHELL;
  const main = root.querySelector<HTMLElement>("#student-main")!;

  if (!isConfigured()) {
    main.innerHTML = `<div class="card"><p class="empty-note">システムの準備が完了していません。コーチにお問い合わせください。</p></div>`;
    return;
  }

  let data: StudentPageData;
  try {
    data = await fetchStudentData(studentId);
  } catch (err) {
    const message = err instanceof StudentApiError ? err.message : "読み込みに失敗しました。リンクが正しいか確認してください。";
    main.innerHTML = `<div class="card"><p class="empty-note">${escapeHtml(message)}</p></div>`;
    return;
  }

  root.querySelector<HTMLElement>("#student-brand-name")!.textContent = `${data.name} さんのレッスンノート`;

  main.innerHTML = `
    <section class="card">
      <h2>① 今、意識しているポイント</h2>
      <div id="focus-points" class="focus-points"></div>
    </section>

    <section class="card">
      <h2>② レッスンのまとめ履歴</h2>
      <div id="lesson-history"></div>
    </section>

    <section class="card">
      <h2>③ 試合結果を記録する</h2>
      <form id="match-form">
        <div class="form-row">
          <label class="form-field">
            試合日
            <input id="match-date" type="date" required />
          </label>
          <label class="form-field">
            対戦相手（任意）
            <input id="match-opponent" type="text" placeholder="例）〇〇さん" />
          </label>
          <label class="form-field">
            結果（任意）
            <input id="match-result" type="text" placeholder="例）〇 3-1、△ 惜敗 など自由に" />
          </label>
        </div>
        <label class="form-field">
          反省点・感想
          <textarea id="match-reflection" rows="4" placeholder="試合の内容、良かった点、次に向けての反省など" required></textarea>
        </label>
        <button id="match-submit-btn" class="btn btn-primary btn-large" type="submit">記録する</button>
      </form>
      <p id="match-status" class="status-line"></p>

      <h3>過去の試合結果</h3>
      <div id="match-history"></div>
    </section>

    <section class="card">
      <h2>④ レーティングを記録する</h2>
      <p class="option-note">大会や卓球場の測定などで分かった最新のレーティングを記録して、成長の推移を見返せます。</p>
      <form id="rating-form">
        <div class="form-row">
          <label class="form-field">
            レーティング
            <input id="rating-value" type="number" step="1" inputmode="numeric" placeholder="例）1500" required />
          </label>
          <label class="form-field">
            メモ（任意）
            <input id="rating-memo" type="text" placeholder="例）〇〇オープン大会" />
          </label>
        </div>
        <button id="rating-submit-btn" class="btn btn-primary btn-large" type="submit">記録する</button>
      </form>
      <p id="rating-status" class="status-line"></p>

      <div id="rating-chart-wrap"></div>
      <h3>レーティングの履歴</h3>
      <div id="rating-history"></div>
    </section>
  `;

  const focusPointsEl = main.querySelector<HTMLElement>("#focus-points")!;
  const lessonHistoryEl = main.querySelector<HTMLElement>("#lesson-history")!;
  const matchForm = main.querySelector<HTMLFormElement>("#match-form")!;
  const matchDateInput = main.querySelector<HTMLInputElement>("#match-date")!;
  const matchOpponentInput = main.querySelector<HTMLInputElement>("#match-opponent")!;
  const matchResultInput = main.querySelector<HTMLInputElement>("#match-result")!;
  const matchReflectionInput = main.querySelector<HTMLTextAreaElement>("#match-reflection")!;
  const matchSubmitBtn = main.querySelector<HTMLButtonElement>("#match-submit-btn")!;
  const matchStatus = main.querySelector<HTMLElement>("#match-status")!;
  const matchHistoryEl = main.querySelector<HTMLElement>("#match-history")!;

  const ratingForm = main.querySelector<HTMLFormElement>("#rating-form")!;
  const ratingValueInput = main.querySelector<HTMLInputElement>("#rating-value")!;
  const ratingMemoInput = main.querySelector<HTMLInputElement>("#rating-memo")!;
  const ratingSubmitBtn = main.querySelector<HTMLButtonElement>("#rating-submit-btn")!;
  const ratingStatus = main.querySelector<HTMLElement>("#rating-status")!;
  const ratingChartWrap = main.querySelector<HTMLElement>("#rating-chart-wrap")!;
  const ratingHistoryEl = main.querySelector<HTMLElement>("#rating-history")!;

  matchDateInput.value = todayIso();
  focusPointsEl.textContent = data.focusPoints.trim() || "まだ記録がありません。次のレッスンをお楽しみに！";

  function renderLessonHistory(lessons: LessonEntry[]): void {
    if (lessons.length === 0) {
      lessonHistoryEl.innerHTML = `<p class="empty-note">まだレッスンのまとめがありません。</p>`;
      return;
    }
    lessonHistoryEl.innerHTML = lessons
      .map(
        (l) => `
        <div class="entry-card">
          <div class="entry-card-header"><span class="entry-card-date">${escapeHtml(l.date)}</span></div>
          <div class="entry-card-body">${escapeHtml(l.summary)}</div>
        </div>`,
      )
      .join("");
  }

  function renderMatchHistory(matches: MatchEntry[]): void {
    if (matches.length === 0) {
      matchHistoryEl.innerHTML = `<p class="empty-note">まだ試合結果の記録がありません。</p>`;
      return;
    }
    matchHistoryEl.innerHTML = matches
      .map(
        (m) => `
        <div class="entry-card">
          <div class="entry-card-header">
            <span class="entry-card-date">${escapeHtml(m.matchDate || m.recordedAt)}</span>
            ${m.result ? `<span class="match-badge">${escapeHtml(m.result)}</span>` : ""}
          </div>
          ${m.opponent ? `<div class="entry-card-body">対戦相手: ${escapeHtml(m.opponent)}</div>` : ""}
          <div class="entry-card-body">${escapeHtml(m.reflection)}</div>
        </div>`,
      )
      .join("");
  }

  function renderRatingHistory(ratings: RatingEntry[]): void {
    if (ratings.length === 0) {
      ratingChartWrap.innerHTML = "";
      ratingHistoryEl.innerHTML = `<p class="empty-note">まだレーティングの記録がありません。</p>`;
      return;
    }
    ratingChartWrap.innerHTML = renderRatingChart(ratings);
    ratingHistoryEl.innerHTML = ratings
      .map(
        (r) => `
        <div class="entry-card">
          <div class="entry-card-header">
            <span class="entry-card-date">${escapeHtml(r.recordedAt)}</span>
            <span class="match-badge">${r.rating}</span>
          </div>
          ${r.memo ? `<div class="entry-card-body">${escapeHtml(r.memo)}</div>` : ""}
        </div>`,
      )
      .join("");
  }

  renderLessonHistory(data.lessons);
  renderMatchHistory(data.matches);
  renderRatingHistory(data.ratings);

  matchForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    matchSubmitBtn.disabled = true;
    matchStatus.textContent = "";
    try {
      await submitMatch(studentId, {
        matchDate: matchDateInput.value,
        opponent: matchOpponentInput.value.trim(),
        result: matchResultInput.value.trim(),
        reflection: matchReflectionInput.value.trim(),
      });
      const newMatch: MatchEntry = {
        matchDate: matchDateInput.value,
        opponent: matchOpponentInput.value.trim(),
        result: matchResultInput.value.trim(),
        reflection: matchReflectionInput.value.trim(),
        recordedAt: "",
      };
      data.matches = [newMatch, ...data.matches];
      matchOpponentInput.value = "";
      matchResultInput.value = "";
      matchReflectionInput.value = "";
      matchDateInput.value = todayIso();
      matchStatus.textContent = "記録しました。";
      matchStatus.className = "status-line ok";
      renderMatchHistory(data.matches);
    } catch (err) {
      matchStatus.textContent = `記録に失敗しました: ${err instanceof Error ? err.message : String(err)}`;
      matchStatus.className = "status-line error";
    } finally {
      matchSubmitBtn.disabled = false;
    }
  });

  ratingForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const rating = Number(ratingValueInput.value);
    if (!Number.isFinite(rating)) return;
    ratingSubmitBtn.disabled = true;
    ratingStatus.textContent = "";
    try {
      const memo = ratingMemoInput.value.trim();
      await submitRating(studentId, { rating, memo });
      const newRating: RatingEntry = { recordedAt: nowDisplay(), rating, memo };
      data.ratings = [newRating, ...data.ratings];
      ratingValueInput.value = "";
      ratingMemoInput.value = "";
      ratingStatus.textContent = "記録しました。";
      ratingStatus.className = "status-line ok";
      renderRatingHistory(data.ratings);
    } catch (err) {
      ratingStatus.textContent = `記録に失敗しました: ${err instanceof Error ? err.message : String(err)}`;
      ratingStatus.className = "status-line error";
    } finally {
      ratingSubmitBtn.disabled = false;
    }
  });
}
