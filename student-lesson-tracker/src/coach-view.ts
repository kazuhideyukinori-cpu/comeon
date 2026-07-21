import type { User } from "firebase/auth";
import {
  addLesson,
  createStudent,
  getStudent,
  isFirebaseReady,
  listLessons,
  listMatches,
  listStudents,
  signInWithGoogle,
  signOutCoach,
  updateFocusPoints,
  watchAuthState,
} from "./firebase.ts";
import { summarizeLesson, AiError } from "./ai.ts";
import { isSpeechRecognitionSupported, VoiceTranscriber } from "./speech.ts";
import { loadSettings, saveSettings } from "./settings.ts";
import type { LessonEntry, MatchEntry, Student } from "./types.ts";

const SHELL = `
  <header class="topbar">
    <div class="brand"><span class="brand-mark">🏓</span><span class="brand-name">卓球レッスンノート（コーチ用）</span></div>
    <p class="tagline">レッスンのまとめをAIが自動整理。生徒ごとに蓄積し、専用ページでいつでも振り返れます。</p>
  </header>
  <main class="stage">
    <section class="panel" id="settings">
      <button id="settings-toggle" class="settings-toggle" type="button">⚙ 接続設定</button>
      <div id="settings-body" class="settings-body hidden">
        <label class="form-field">
          Anthropic APIキー
          <input id="anthropic-key-input" type="password" placeholder="sk-ant-..." />
        </label>
        <label class="form-field">
          AIモデル
          <input id="anthropic-model-input" type="text" placeholder="claude-sonnet-5" />
        </label>
        <label class="form-field">
          コーチのGoogleメールアドレス（表示確認用・任意）
          <input id="coach-email-input" type="email" placeholder="you@gmail.com" />
        </label>
        <button id="save-settings-btn" class="btn btn-secondary" type="button">保存</button>
        <p class="option-note">
          この端末のブラウザにのみ保存され、どこにも送信されません（Anthropic APIキーはAI要約の呼び出し時のみ使用）。Firebaseの接続設定は
          <code>src/firebase-config.ts</code> に記載します（README参照）。
        </p>
      </div>
    </section>

    <section class="panel auth-panel" id="auth-section">
      <button id="login-btn" class="btn btn-primary btn-large" type="button">Googleでログイン</button>
      <button id="logout-btn" class="btn btn-ghost hidden" type="button">ログアウト</button>
      <p id="auth-status" class="status-line"></p>
    </section>

    <section class="panel hidden" id="main-section">
      <h2>生徒一覧</h2>
      <div class="form-row">
        <label class="form-field">
          新しい生徒の名前
          <input id="new-student-name" type="text" placeholder="例）山田 太郎" />
        </label>
        <button id="add-student-btn" class="btn btn-secondary" type="button" style="align-self:flex-end">＋ 生徒を追加</button>
      </div>
      <div id="student-list" class="student-list"></div>

      <div id="student-detail" class="hidden">
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
      </div>
    </section>
  </main>
  <footer class="footer">
    <p>コーチのGoogleアカウントでログインしている間のみ、生徒データの追加・編集ができます。生徒本人には個別リンクのみを共有してください。</p>
  </footer>
`;

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

export function mountCoachView(root: HTMLElement): void {
  root.innerHTML = SHELL;

  const settingsToggle = root.querySelector<HTMLButtonElement>("#settings-toggle")!;
  const settingsBody = root.querySelector<HTMLElement>("#settings-body")!;
  const anthropicKeyInput = root.querySelector<HTMLInputElement>("#anthropic-key-input")!;
  const anthropicModelInput = root.querySelector<HTMLInputElement>("#anthropic-model-input")!;
  const coachEmailInput = root.querySelector<HTMLInputElement>("#coach-email-input")!;
  const saveSettingsBtn = root.querySelector<HTMLButtonElement>("#save-settings-btn")!;

  const loginBtn = root.querySelector<HTMLButtonElement>("#login-btn")!;
  const logoutBtn = root.querySelector<HTMLButtonElement>("#logout-btn")!;
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

  let settings = loadSettings();
  let students: Student[] = [];
  let selectedStudent: Student | null = null;
  let recentLessons: LessonEntry[] = [];
  let transcriber: VoiceTranscriber | null = null;
  let isRecording = false;

  function fillSettingsForm(): void {
    anthropicKeyInput.value = settings.anthropicApiKey;
    anthropicModelInput.value = settings.anthropicModel;
    coachEmailInput.value = settings.coachEmail;
  }
  fillSettingsForm();

  settingsToggle.addEventListener("click", () => settingsBody.classList.toggle("hidden"));

  saveSettingsBtn.addEventListener("click", () => {
    settings = {
      ...settings,
      anthropicApiKey: anthropicKeyInput.value.trim(),
      anthropicModel: anthropicModelInput.value.trim() || "claude-sonnet-5",
      coachEmail: coachEmailInput.value.trim(),
    };
    saveSettings(settings);
    settingsBody.classList.add("hidden");
    authStatus.textContent = "設定を保存しました。";
    authStatus.className = "status-line ok";
  });

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
        <div class="card">
          <div class="card-header"><span class="card-date">${formatDateTime(l.createdAt)}</span></div>
          <div class="card-body">${escapeHtml(l.summary)}</div>
          <details class="card-transcript"><summary>元の書き起こしを見る</summary><pre>${escapeHtml(l.transcript)}</pre></details>
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
    lessonHistoryEl.innerHTML = `<p class="empty-note">読み込み中…</p>`;
    matchHistoryEl.innerHTML = `<p class="empty-note">読み込み中…</p>`;

    const [lessons, matches] = await Promise.all([listLessons(student.id), listMatches(student.id)]);
    recentLessons = lessons;
    renderLessonHistory(lessons);
    renderMatchHistory(matches);
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
      const student = await createStudent(name);
      students.push(student);
      students.sort((a, b) => a.name.localeCompare(b.name, "ja"));
      newStudentName.value = "";
      renderStudentList();
      await selectStudent(student);
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
      lessonStatus.textContent = "このブラウザは音声入力に対応していません（Chrome推奨）。テキストで直接入力してください。";
      lessonStatus.className = "status-line error";
      return;
    }
    isRecording = true;
    recordBtn.textContent = "⏹ 録音停止";
    recordBtn.classList.add("recording");
    lessonStatus.textContent = "録音中… 話し終えたら停止してください。";
    lessonStatus.className = "status-line";
    transcriber = new VoiceTranscriber(
      (finalText, interimText) => {
        transcriptInput.value = finalText + (interimText ? `\n${interimText}` : "");
      },
      () => stopRecording(),
      (message) => {
        lessonStatus.textContent = message;
        lessonStatus.className = "status-line error";
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
      lessonStatus.textContent = "書き起こしが空です。話すか入力してください。";
      lessonStatus.className = "status-line error";
      return;
    }
    summarizeBtn.disabled = true;
    lessonStatus.textContent = "AIがまとめています…";
    lessonStatus.className = "status-line";
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
      lessonStatus.textContent = "まとめを作成しました。内容を確認して保存してください。";
      lessonStatus.className = "status-line ok";
    } catch (err) {
      lessonStatus.textContent = err instanceof AiError ? err.message : `エラー: ${String(err)}`;
      lessonStatus.className = "status-line error";
    } finally {
      summarizeBtn.disabled = false;
    }
  });

  saveLessonBtn.addEventListener("click", async () => {
    if (!selectedStudent) return;
    saveLessonBtn.disabled = true;
    try {
      await addLesson(selectedStudent.id, transcriptInput.value.trim(), previewSummary.value.trim());
      await updateFocusPoints(selectedStudent.id, previewFocus.value.trim());
      focusPointsInput.value = previewFocus.value.trim();
      transcriptInput.value = "";
      aiPreview.classList.add("hidden");
      lessonStatus.textContent = "保存しました。";
      lessonStatus.className = "status-line ok";
      const lessons = await listLessons(selectedStudent.id);
      recentLessons = lessons;
      renderLessonHistory(lessons);
    } finally {
      saveLessonBtn.disabled = false;
    }
  });

  saveFocusBtn.addEventListener("click", async () => {
    if (!selectedStudent) return;
    saveFocusBtn.disabled = true;
    try {
      await updateFocusPoints(selectedStudent.id, focusPointsInput.value.trim());
      focusStatus.textContent = "保存しました。";
      focusStatus.className = "status-line ok";
    } finally {
      saveFocusBtn.disabled = false;
    }
  });

  async function refreshStudents(): Promise<void> {
    students = await listStudents();
    renderStudentList();
    if (selectedStudent) {
      const updated = await getStudent(selectedStudent.id);
      if (updated) selectedStudent = updated;
    }
  }

  function setupAuth(): void {
    if (!isFirebaseReady()) {
      authStatus.textContent = "⚙ 接続設定でFirebaseの設定を保存してください。";
      authStatus.className = "status-line";
      return;
    }
    loginBtn.addEventListener("click", () => {
      signInWithGoogle().catch((err) => {
        authStatus.textContent = `ログインに失敗しました: ${err instanceof Error ? err.message : String(err)}`;
        authStatus.className = "status-line error";
      });
    });
    logoutBtn.addEventListener("click", () => {
      void signOutCoach();
    });
    watchAuthState((user: User | null) => {
      if (user) {
        loginBtn.classList.add("hidden");
        logoutBtn.classList.remove("hidden");
        authStatus.textContent = `${user.email} としてログイン中`;
        authStatus.className = "status-line ok";
        mainSection.classList.remove("hidden");
        void refreshStudents();
      } else {
        loginBtn.classList.remove("hidden");
        logoutBtn.classList.add("hidden");
        authStatus.textContent = "";
        mainSection.classList.add("hidden");
        studentDetail.classList.add("hidden");
        selectedStudent = null;
      }
    });
  }

  setupAuth();
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
