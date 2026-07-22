import { APPS_SCRIPT_URL } from "./public-config.ts";
import type { LessonEntry, MatchEntry, RatingEntry } from "./types.ts";

export class StudentApiError extends Error {}

export interface StudentPageData {
  name: string;
  focusPoints: string;
  lessons: LessonEntry[];
  matches: MatchEntry[];
  ratings: RatingEntry[];
}

export function isConfigured(): boolean {
  return APPS_SCRIPT_URL.trim().length > 0;
}

export async function fetchStudentData(studentId: string): Promise<StudentPageData> {
  const url = `${APPS_SCRIPT_URL}?studentId=${encodeURIComponent(studentId)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => null);
  if (!data) throw new StudentApiError("サーバーからの応答を読み取れませんでした。");
  if (data.error) throw new StudentApiError(data.error);
  return {
    name: data.name ?? "",
    focusPoints: data.focusPoints ?? "",
    lessons: ((data.lessons ?? []) as LessonEntry[]).slice().reverse(),
    matches: ((data.matches ?? []) as MatchEntry[]).slice().reverse(),
    ratings: ((data.ratings ?? []) as RatingEntry[]).slice().reverse(),
  };
}

export async function submitMatch(
  studentId: string,
  data: { matchDate: string; opponent: string; result: string; reflection: string },
): Promise<void> {
  await postToAppsScript({ studentId, type: "match", ...data });
}

export async function submitRating(studentId: string, data: { rating: number; memo: string }): Promise<void> {
  await postToAppsScript({ studentId, type: "rating", ...data });
}

async function postToAppsScript(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    // text/plain avoids a CORS preflight against the Apps Script web app (which doesn't
    // implement doOptions); the payload is still parsed as JSON server-side.
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const responseData = await res.json().catch(() => null);
  if (!responseData || responseData.error) {
    throw new StudentApiError(responseData?.error ?? "送信に失敗しました。");
  }
}
