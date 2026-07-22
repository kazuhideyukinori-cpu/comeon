import {
  addLesson,
  addRating,
  createStudent,
  listLessons,
  listMatches,
  listRatings,
  listStudents,
  updateFocusPoints,
} from "./repo.ts";
import { SheetsApiError } from "./sheets-api.ts";
import { summarizeLesson, AiError } from "./ai.ts";
import { isSpeechRecognitionSupported, VoiceTranscriber } from "./speech.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import { escapeHtml } from "./util.ts";
import { renderRatingChart } from "./rating-chart.ts";
import type { LessonEntry, MatchEntry, RatingEntry, Student } from "./types.ts";

const SHELL = `
  <header class="topbar">
    <div class="brand"><span class="logo">🏓</span>卓球レッスンノート</div>
    <p class="tagline">コーチ用画面。レッスンのまとめをAIが自動整理し、生徒ごとに蓄積します。</p>
  </header>
  <main class="stage">
    <section class="card" id="settings">
      <button id="settings-toggle" class="settings-toggle" type="button">⚙ 接続設定</button>
      <div id="settings-body" class="settings-body hidden">
        <label class="form-field">
          Google OAuth クライアントID
          <input id="client-id-input" type="text" placeholder="xxxxxxxx.apps.googleusercontent.com" />
        </label>
        <label class="form-field">
          スプレッドシートID
          <input id="spreadsheet-id-input" type="text" placeholder="スプレッドシートIDを入力" />
        </label>
        <label class="form-field">
          Anthropic APIキー
          <input id="anthropic-key-input" type="password" placeholder="sk-ant-..." />
        </label>
        <label class="form-field">
          AIモデル
          <input id="anthropic-model-input" type="text" placeholder="claude-sonnet-5" />
        </label>
        <button id="save-settings-btn" class="btn btn-secondary" type="button">保存</button>
        <p class="option-note">
          この端末のブラウザにのみ保存され、どこにも送信されません。初回セットアップの手順はREADMEを参照してください。
        </p>
      </div>
    </section>

    <section class="card auth-panel" id="auth-section">
      <button id="login-btn" class="btn btn-primary btn-large" type="button">Googleでログイン</button>
      <p id="auth-status" class="status-line"></p>
    </section>

    <section class="card hidden" id="main-section">
      <h2>生徒一覧</h2>
      <div class="form-row">
        <label class="form-field">
          新しい生徒の名前
          <input id="new-student-name" type="text" placeholder="例）山田 太郎" />
        </label>
        <button id="add-student-btn" class="btn btn-secondary" type="button" style="align-self:flex-end">＋ 生徒を追加</button>
      </div>
      <div id="student-list" class="student-list"></div>
    </section>

    <section class="card hidden" id="student-detail">
      <h2 id="detail-name"></h2>
      <div class="link-box">
        <span id="detail-link"></span>
        <button id="copy-link-btn" class="btn btn-ghost btn-sm" type="button">コピー</button>
      </div>
      <p class="option-note">このリンクを生徒ご本人に送ってください（ログイン不要で本人専用ページが開きます）。</p>

      <h3>① 今日のレッスンを記録</h3>
      <label class="form-field">
        <textarea id="transcript-input" rows="6" placeholder="🎙で話すか、ここに直接、今日教えたことを入力してください"></textarea>
      </label>
      <div class="form-row">
        <button id="record-btn" class="btn btn-record" type="button">🎙 録音開始</button>
        <button id="summarize-btn" class="btn btn-primary" type="button">AIでまとめる</button>
      </div>
      <p id="lesson-status" class="status-line"></p>

      <div id="ai-preview" class="ai-preview hidden">
        <label class="form-field">
          今日のまとめ（生徒に表示されます。保存前に編集できます）
          <textarea id="preview-summary" rows="4"></textarea>
        </label>
        <label class="form-field">
          意識するポイント（更新版。保存前に編集できます）
          <textarea id="preview-focus" rows="6"></textarea>
        </label>
        <button id="save-lesson-btn" class="btn btn-primary" type="button">この内容で保存する</button>
      </div>

      <h3>② 練習・試合で意識するポイント（現在の内容）</h3>
      <label class="form-field">
        <textarea id="focus-points-input" rows="6"></textarea>
      </label>
      <button id="save-focus-btn" class="btn btn-ghost" type="button">この内容で保存</button>
      <p id="focus-status" class="status-line"></p>

      <h3>レッスン履歴</h3>
      <div id="lesson-history"></div>

      <h3>③ 試合結果・反省（生徒が個別ページから入力）</h3>
      <div id="match-history"></div>

      <h3>④ レーティング</h3>
      <div class="form-row">
        <label class="form-field">
          レーティング
          <input id="rating-value-input" type="number" step="1" inputmode="numeric" placeholder="例）1500" />
        </label>
        <label class="form-field">
          メモ（任意）
          <input id="rating-memo-input" type="text" placeholder="例）〇〇オープン大会" />
        </label>
        <button id="add-rating-btn" class="btn btn-ghost" type="button" style="align-self:flex-end">＋ 記録を追加</button>
      </div>
      <p id="rating-status" class="status-line"></p>
      <div id="rating-chart-wrap"></div>
      <div id="rating-history"></div>
    </section>
  </main>
  <footer class="footer">
    <p>データはあなたのGoogleスプレッドシートに保存されます。生徒本人には個別リンクのみを共有してください。</p>
  </footer>
`;

export function mountCoachView(root: HTMLElement): void {
  root.innerHTML = SHELL;

  const settingsToggle = root.querySelector<HTMLButtonElement>("#settings-toggle")!;
  const settingsBody = root.querySelector<HTMLElement>("#settings-body")!;
  const clientIdInput = root.querySelector<HTMLInputElement>("#client-id-input")!;
  const spreadsheetIdInput = root.querySelector<HTMLInputElement>("#spreadsheet-id-input")!;
  const anthropicKeyInput = root.querySelector<HTMLInputElement>("#anthropic-key-input")!;
  const anthropicModelInput = root.querySelector<HTMLInputElement>("#anthropic-model-input")!;
  const saveSettingsBtn = root.querySelector<HTMLButtonElement>("#save-settings-btn")!;

  const loginBtn = root.querySelector<HTMLButtonElement>("#login-btn")!;
  const authStatus = root.querySelector<HTMLElement>("#auth-status")!;

  const mainSection = root.querySelector<HTMLElement>("#main-section")!;
  const newStudentName = root.querySelector<HTMLInputElement>("#new-student-name")!;
  const addStudentBtn = root.querySelector<HTMLButtonElement>("#add-student-btn")!;
  const studentListEl = root.querySelector<HTMLElement>("#student-list")!;

  const studentDetail = root.querySelector<HTMLElement>("#student-detail")!;
  const detailName = root.querySelector<HTMLElement>("#detail-name")!;
  const detailLink = root.querySelector<HTMLElement>("#detail-link")!;
  const copyLinkBtn = root.querySelector<HTMLButtonElement>("#copy-link-btn")!;

  const transcriptInput = root.querySelector<HTMLTextAreaElement>("#transcript-input")!;
  const recordBtn = root.querySelector<HTMLButtonElement>("#record-btn")!;
  const summarizeBtn = root.querySelector<HTMLButtonElement>("#summarize-btn")!;
  const lessonStatus = root.querySelector<HTMLElement>("#lesson-status")!;

  const aiPreview = root.querySelector<HTMLElement>("#ai-preview")!;
  const previewSummary = root.querySelector<HTMLTextAreaElement>("#preview-summary")!;
  const previewFocus = root.querySelector<HTMLTextAreaElement>("#preview-focus")!;
  const saveLessonBtn = root.querySelector<HTMLButtonElement>("#save-lesson-btn")!;

  const focusPointsInput = root.querySelector<HTMLTextAreaElement>("#focus-points-input")!;
  const saveFocusBtn = root.querySelector<HTMLButtonElement>("#save-focus-btn")!;
  const focusStatus = root.querySelector<HTMLElement>("#focus-status")!;

  const lessonHistoryEl = root.querySelector<HTMLElement>("#lesson-history")!;
  const matchHistoryEl = root.querySelector<HTMLElement>("#match-history")!;

  const ratingValueInput = root.querySelector<HTMLInputElement>("#rating-value-input")!;
  const ratingMemoInput = root.querySelector<HTMLInputElement>("#rating-memo-input")!;
  const addRatingBtn = root.querySelector<HTMLButtonElement>("#add-rating-btn")!;
  const ratingStatus = root.querySelector<HTMLElement>("#rating-status")!;
  const ratingChartWrap = root.querySelector<HTMLElement>("#rating-chart-wrap")!;
  const ratingHistoryEl = root.querySelector<HTMLElement>("#rating-history")!;

  let settings = loadSettings();
  let accessToken: string | null = null;
  let tokenClient: TokenClient | null = null;
  let students: Student[] = [];
  let selectedStudent: Student | null = null;
  let recentLessons: LessonEntry[] = [];
  let recentRatings: RatingEntry[] = [];
  let transcriber: VoiceTranscriber | null = null;
  let isRecording = false;

  function fillSettingsForm(): void {
    clientIdInput.value = settings.googleClientId;
    spreadsheetIdInput.value = settings.spreadsheetId;
    anthropicKeyInput.value = settings.anthropicApiKey;
    anthropicModelInput.value = settings.anthropicModel;
  }
  fillSettingsForm();

  settingsToggle.addEventListener("click", () => settingsBody.classList.toggle("hidden"));

  saveSettingsBtn.addEventListener("click", () => {
    settings = {
      googleClientId: clientIdInput.value.trim(),
      spreadsheetId: spreadsheetIdInput.value.trim(),
      anthropicApiKey: anthropicKeyInput.value.trim(),
      anthropicModel: anthropicModelInput.value.trim() || "claude-sonnet-5",
    };
    saveSettings(settings);
    tokenClient = null;
    settingsBody.classList.add("hidden");
    authStatus.textContent = "設定を保存しました。ログインしてください。";
    authStatus.className = "status-line ok";
  });

  function setStatus(el: HTMLElement, message: string, kind: "" | "ok" | "error" = ""): void {
    el.textContent = message;
    el.className = "status-line" + (kind ? ` ${kind}` : "");
  }

  function ensureTokenClient(): TokenClient | null {
    const clientId = settings.googleClientId;
    if (!clientId) {
      setStatus(authStatus, "先に「⚙ 接続設定」でクライアントIDとスプレッドシートIDを保存してください。", "error");
      return null;
    }
    if (!window.google) {
      setStatus(authStatus, "Googleログインスクリプトの読み込みに失敗しました。再読み込みしてください。", "error");
      return null;
    }
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        callback: (response) => {
          if (response.error) {
            setStatus(authStatus, `ログインに失敗しました: ${response.error}`, "error");
            return;
          }
          accessToken = response.access_token;
          void onLoggedIn();
        },
        error_callback: (error) => {
          setStatus(authStatus, `ログインに失敗しました: ${error.type}`, "error");
        },
      });
    }
    return tokenClient;
  }

  loginBtn.addEventListener("click", () => {
    ensureTokenClient()?.requestAccessToken();
  });

  async function onLoggedIn(): Promise<void> {
    setStatus(authStatus, "ログインしました。", "ok");
    mainSection.classList.remove("hidden");
    await refreshStudents();
  }

  function handleApiError(err: unknown, el: HTMLElement): void {
    if (err instanceof SheetsApiError && err.status === 401) {
      accessToken = null;
      mainSection.classList.add("hidden");
      studentDetail.classList.add("hidden");
      setStatus(authStatus, "セッションが切れました。もう一度ログインしてください。", "error");
      return;
    }
    setStatus(el, `エラー: ${err instanceof Error ? err.message : String(err)}`, "error");
  }

  function requireToken(): string {
    if (!accessToken) throw new Error("ログインしていません。");
    return accessToken;
  }

  function renderStudentList(): void {
    if (students.length === 0) {
      studentListEl.innerHTML = `<p class="empty-note">まだ生徒が登録されていません。</p>`;
      return;
    }
    studentListEl.innerHTML = students
      .map(
        (s) => `
        <div class="student-row${selectedStudent?.id === s.id ? " active" : ""}" data-id="${s.id}">
          <span class="student-row-name">${escapeHtml(s.name)}</span>
        </div>`,
      )
      .join("");
    studentListEl.querySelectorAll<HTMLElement>(".student-row").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.id!;
        const student = students.find((s) => s.id === id);
        if (student) void selectStudent(student);
      });
    });
  }

  function studentLink(id: string): string {
    return `${location.origin}${location.pathname}#/s/${id}`;
  }

  function renderLessonHistory(lessons: LessonEntry[]): void {
    if (lessons.length === 0) {
      lessonHistoryEl.innerHTML = `<p class="empty-note">まだレッスン記録がありません。</p>`;
      return;
    }
    lessonHistoryEl.innerHTML = lessons
      .map(
        (l) => `
        <div class="entry-card">
          <div class="entry-card-header"><span class="entry-card-date">${escapeHtml(l.date)}</span></div>
          <div class="entry-card-body">${escapeHtml(l.summary)}</div>
          <details class="entry-transcript"><summary>元の書き起こしを見る</summary><pre>${escapeHtml(l.transcript)}</pre></details>
        </div>`,
      )
      .join("");
  }

  function renderMatchHistory(matches: MatchEntry[]): void {
    if (matches.length === 0) {
      matchHistoryEl.innerHTML = `<p class="empty-note">まだ試合結果の入力がありません。</p>`;
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

  async function selectStudent(student: Student): Promise<void> {
    stopRecording();
    selectedStudent = student;
    renderStudentList();
    studentDetail.classList.remove("hidden");
    detailName.textContent = student.name;
    detailLink.textContent = studentLink(student.id);
    focusPointsInput.value = student.focusPoints;
    transcriptInput.value = "";
    aiPreview.classList.add("hidden");
    lessonStatus.textContent = "";
    focusStatus.textContent = "";
    ratingStatus.textContent = "";
    ratingValueInput.value = "";
    ratingMemoInput.value = "";
    lessonHistoryEl.innerHTML = `<p class="empty-note">読み込み中…</p>`;
    matchHistoryEl.innerHTML = `<p class="empty-note">読み込み中…</p>`;
    ratingChartWrap.innerHTML = "";
    ratingHistoryEl.innerHTML = `<p class="empty-note">読み込み中…</p>`;

    try {
      const token = requireToken();
      const [lessons, matches, ratings] = await Promise.all([
        listLessons(token, settings.spreadsheetId, student.id),
        listMatches(token, settings.spreadsheetId, student.id),
        listRatings(token, settings.spreadsheetId, student.id),
      ]);
      recentLessons = lessons;
      recentRatings = ratings;
      renderLessonHistory(lessons);
      renderMatchHistory(matches);
      renderRatingHistory(ratings);
    } catch (err) {
      handleApiError(err, lessonStatus);
    }
  }

  copyLinkBtn.addEventListener("click", async () => {
    if (!selectedStudent) return;
    await navigator.clipboard.writeText(studentLink(selectedStudent.id));
    copyLinkBtn.textContent = "コピーしました";
    setTimeout(() => (copyLinkBtn.textContent = "コピー"), 1500);
  });

  addStudentBtn.addEventListener("click", async () => {
    const name = newStudentName.value.trim();
    if (!name) return;
    addStudentBtn.disabled = true;
    try {
      const token = requireToken();
      const student = await createStudent(token, settings.spreadsheetId, name);
      students.push(student);
      students.sort((a, b) => a.name.localeCompare(b.name, "ja"));
      newStudentName.value = "";
      renderStudentList();
      await selectStudent(student);
    } catch (err) {
      handleApiError(err, authStatus);
    } finally {
      addStudentBtn.disabled = false;
    }
  });

  recordBtn.addEventListener("click", () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    if (!isSpeechRecognitionSupported()) {
      setStatus(lessonStatus, "このブラウザは音声入力に対応していません（Chrome推奨）。テキストで直接入力してください。", "error");
      return;
    }
    isRecording = true;
    recordBtn.textContent = "⏹ 録音停止";
    recordBtn.classList.add("recording");
    setStatus(lessonStatus, "録音中… 話し終えたら停止してください。");
    transcriber = new VoiceTranscriber(
      (finalText, interimText) => {
        transcriptInput.value = finalText + (interimText ? `\n${interimText}` : "");
      },
      () => stopRecording(),
      (message) => {
        setStatus(lessonStatus, message, "error");
        stopRecording();
      },
    );
    transcriber.start(transcriptInput.value ? transcriptInput.value + "\n" : "");
  });

  function stopRecording(): void {
    if (!isRecording) return;
    transcriber?.stop();
    transcriber = null;
    isRecording = false;
    recordBtn.textContent = "🎙 録音開始";
    recordBtn.classList.remove("recording");
  }

  summarizeBtn.addEventListener("click", async () => {
    if (!selectedStudent) return;
    stopRecording();
    const transcript = transcriptInput.value.trim();
    if (!transcript) {
      setStatus(lessonStatus, "書き起こしが空です。話すか入力してください。", "error");
      return;
    }
    summarizeBtn.disabled = true;
    setStatus(lessonStatus, "AIがまとめています…");
    try {
      const result = await summarizeLesson(
        settings.anthropicApiKey,
        settings.anthropicModel,
        selectedStudent.name,
        focusPointsInput.value,
        recentLessons.slice(0, 3).map((l) => l.summary),
        transcript,
      );
      previewSummary.value = result.summary;
      previewFocus.value = result.focusPoints;
      aiPreview.classList.remove("hidden");
      setStatus(lessonStatus, "まとめを作成しました。内容を確認して保存してください。", "ok");
    } catch (err) {
      setStatus(lessonStatus, err instanceof AiError ? err.message : `エラー: ${String(err)}`, "error");
    } finally {
      summarizeBtn.disabled = false;
    }
  });

  saveLessonBtn.addEventListener("click", async () => {
    if (!selectedStudent) return;
    saveLessonBtn.disabled = true;
    try {
      const token = requireToken();
      await addLesson(token, settings.spreadsheetId, selectedStudent.id, transcriptInput.value.trim(), previewSummary.value.trim());
      await updateFocusPoints(token, settings.spreadsheetId, selectedStudent, previewFocus.value.trim());
      selectedStudent.focusPoints = previewFocus.value.trim();
      focusPointsInput.value = selectedStudent.focusPoints;
      transcriptInput.value = "";
      aiPreview.classList.add("hidden");
      setStatus(lessonStatus, "保存しました。", "ok");
      recentLessons = await listLessons(token, settings.spreadsheetId, selectedStudent.id);
      renderLessonHistory(recentLessons);
    } catch (err) {
      handleApiError(err, lessonStatus);
    } finally {
      saveLessonBtn.disabled = false;
    }
  });

  saveFocusBtn.addEventListener("click", async () => {
    if (!selectedStudent) return;
    saveFocusBtn.disabled = true;
    try {
      const token = requireToken();
      await updateFocusPoints(token, settings.spreadsheetId, selectedStudent, focusPointsInput.value.trim());
      selectedStudent.focusPoints = focusPointsInput.value.trim();
      setStatus(focusStatus, "保存しました。", "ok");
    } catch (err) {
      handleApiError(err, focusStatus);
    } finally {
      saveFocusBtn.disabled = false;
    }
  });

  addRatingBtn.addEventListener("click", async () => {
    if (!selectedStudent) return;
    const rating = Number(ratingValueInput.value);
    if (!Number.isFinite(rating) || ratingValueInput.value.trim() === "") {
      setStatus(ratingStatus, "レーティングの値を入力してください。", "error");
      return;
    }
    addRatingBtn.disabled = true;
    try {
      const token = requireToken();
      await addRating(token, settings.spreadsheetId, selectedStudent.id, rating, ratingMemoInput.value.trim());
      ratingValueInput.value = "";
      ratingMemoInput.value = "";
      setStatus(ratingStatus, "記録しました。", "ok");
      recentRatings = await listRatings(token, settings.spreadsheetId, selectedStudent.id);
      renderRatingHistory(recentRatings);
    } catch (err) {
      handleApiError(err, ratingStatus);
    } finally {
      addRatingBtn.disabled = false;
    }
  });

  async function refreshStudents(): Promise<void> {
    try {
      const token = requireToken();
      students = await listStudents(token, settings.spreadsheetId);
      renderStudentList();
    } catch (err) {
      handleApiError(err, authStatus);
    }
  }

  if (!settings.googleClientId || !settings.spreadsheetId) {
    setStatus(authStatus, "初回セットアップが必要です。⚙ 接続設定を開いてください。");
  }
}
