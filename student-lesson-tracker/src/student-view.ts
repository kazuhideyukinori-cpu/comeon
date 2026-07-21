import { addMatch, getStudent, isFirebaseReady, listLessons, listMatches } from "./firebase.ts";
import type { LessonEntry, MatchEntry, Student } from "./types.ts";

const SHELL = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">🏓</span><span class="brand-name" id="student-brand-name">卓球レッスンノート</span></div>
    <p class="tagline">あなた専用のレッスン記録ページです。</p>
  </header>
  <main class="stage" id="student-main">
    <p class="empty-note">読み込み中…</p>
  </main>
  <footer class="footer">
    <p>このページのURLは、あなた専用のリンクです。第三者に共有しないようご注意ください。</p>
  </footer>
`;

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export async function mountStudentView(root: HTMLElement, studentId: string): Promise<void> {
  root.innerHTML = SHELL;
  const main = root.querySelector<HTMLElement>("#student-main")!;

  if (!isFirebaseReady()) {
    main.innerHTML = `<div class="panel"><p class="empty-note">システムの準備が完了していません。コーチにお問い合わせください。</p></div>`;
    return;
  }

  let student: Student | null;
  try {
    student = await getStudent(studentId);
  } catch {
    main.innerHTML = `<div class="panel"><p class="empty-note">読み込みに失敗しました。リンクが正しいか確認してください。</p></div>`;
    return;
  }

  if (!student) {
    main.innerHTML = `<div class="panel"><p class="empty-note">ページが見つかりませんでした。リンクをコーチに確認してください。</p></div>`;
    return;
  }

  root.querySelector<HTMLElement>("#student-brand-name")!.textContent = `${student.name} さんのレッスンノート`;

  main.innerHTML = `
    <section class="panel">
      <h2>① 今、意識しているポイント</h2>
      <div id="focus-points" class="focus-points"></div>
    </section>

    <section class="panel">
      <h2>② レッスンのまとめ履歴</h2>
      <div id="lesson-history"></div>
    </section>

    <section class="panel">
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

  matchDateInput.value = todayIso();

  focusPointsEl.textContent = student.focusPoints.trim() || "まだ記録がありません。次のレッスンをお楽しみに！";

  function renderLessonHistory(lessons: LessonEntry[]): void {
    if (lessons.length === 0) {
      lessonHistoryEl.innerHTML = `<p class="empty-note">まだレッスンのまとめがありません。</p>`;
      return;
    }
    lessonHistoryEl.innerHTML = lessons
      .map(
        (l) => `
        <div class="card">
          <div class="card-header"><span class="card-date">${formatDateTime(l.createdAt)}</span></div>
          <div class="card-body">${escapeHtml(l.summary)}</div>
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
        <div class="card">
          <div class="card-header">
            <span class="card-date">${escapeHtml(m.matchDate || formatDateTime(m.createdAt))}</span>
            ${m.result ? `<span class="match-badge">${escapeHtml(m.result)}</span>` : ""}
          </div>
          ${m.opponent ? `<div class="card-body">対戦相手: ${escapeHtml(m.opponent)}</div>` : ""}
          <div class="card-body">${escapeHtml(m.reflection)}</div>
        </div>`,
      )
      .join("");
  }

  const [lessons, matches] = await Promise.all([listLessons(studentId), listMatches(studentId)]);
  renderLessonHistory(lessons);
  renderMatchHistory(matches);

  matchForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    matchSubmitBtn.disabled = true;
    matchStatus.textContent = "";
    try {
      await addMatch(studentId, {
        matchDate: matchDateInput.value,
        opponent: matchOpponentInput.value.trim(),
        result: matchResultInput.value.trim(),
        reflection: matchReflectionInput.value.trim(),
      });
      matchOpponentInput.value = "";
      matchResultInput.value = "";
      matchReflectionInput.value = "";
      matchDateInput.value = todayIso();
      matchStatus.textContent = "記録しました。";
      matchStatus.className = "status-line ok";
      renderMatchHistory(await listMatches(studentId));
    } catch (err) {
      matchStatus.textContent = `記録に失敗しました: ${err instanceof Error ? err.message : String(err)}`;
      matchStatus.className = "status-line error";
    } finally {
      matchSubmitBtn.disabled = false;
    }
  });
}
