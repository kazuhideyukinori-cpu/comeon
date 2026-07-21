const API_URL = "https://api.anthropic.com/v1/messages";

export class AiError extends Error {}

export interface SummarizeResult {
  summary: string;
  focusPoints: string;
}

const SYSTEM_PROMPT = `あなたは卓球コーチのアシスタントです。コーチが話した「今日のレッスンの振り返り」の書き起こしをもとに、生徒本人が後で読み返すための文章を作成します。

出力は必ず次のJSON形式のみを返してください。説明文やコードブロックの記号（\`\`\`など）は一切付けないでください。
{"summary": "今日のレッスンのまとめ。生徒本人に語りかけるような、具体的で分かりやすい文章。2〜5文程度。", "focusPoints": "今後の練習や試合でいつも意識すべきポイントの箇条書き。「・」で始まる行を改行区切りで5〜8項目程度。"}

focusPoints には、これまで蓄積されている「意識するポイント」リストも渡します。今日の内容をただ追記するのではなく、重複を整理し、もう十分身についた/古くなった項目は控えめにするか外し、全体として「今のこの生徒に最も役立つ最新版のリスト」に練り直してください。回を重ねるほど、その生徒専用に磨かれたリストになるようにしてください。`;

function buildUserPrompt(
  studentName: string,
  currentFocusPoints: string,
  recentSummaries: string[],
  transcript: string,
): string {
  const recent =
    recentSummaries.length > 0 ? recentSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n") : "(まだなし)";
  return `生徒名: ${studentName}

これまでの「意識するポイント」リスト（無ければ「まだなし」）:
${currentFocusPoints.trim() || "(まだなし)"}

直近のレッスンまとめ（新しい順、参考情報）:
${recent}

今日のレッスンの書き起こし（コーチの発言そのまま。音声認識のため多少の誤字があるかもしれません）:
${transcript.trim()}`;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

export async function summarizeLesson(
  apiKey: string,
  model: string,
  studentName: string,
  currentFocusPoints: string,
  recentSummaries: string[],
  transcript: string,
): Promise<SummarizeResult> {
  if (!apiKey) throw new AiError("Anthropic APIキーが設定されていません。⚙ 接続設定で入力してください。");
  if (!transcript.trim()) throw new AiError("書き起こしが空です。");

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: buildUserPrompt(studentName, currentFocusPoints, recentSummaries, transcript) },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error?.message ?? `${res.status} ${res.statusText}`;
    throw new AiError(`AI呼び出しに失敗しました: ${message}`);
  }

  const data = await res.json();
  const text = data?.content?.[0]?.text;
  if (typeof text !== "string") throw new AiError("AIの応答を読み取れませんでした。");

  try {
    const parsed = JSON.parse(extractJson(text));
    if (typeof parsed.summary !== "string" || typeof parsed.focusPoints !== "string") {
      throw new Error("形式不正");
    }
    return { summary: parsed.summary, focusPoints: parsed.focusPoints };
  } catch {
    // AIがJSON以外を返した場合は、まとめ欄にそのまま出して手動編集してもらう
    return { summary: text.trim(), focusPoints: currentFocusPoints };
  }
}
