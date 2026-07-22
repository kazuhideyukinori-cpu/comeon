import { appendRow, getSheetValues, updateRow } from "./sheets-api.ts";
import type { LessonEntry, MatchEntry, RatingEntry, Student } from "./types.ts";
import { generateId, nowDisplay } from "./util.ts";

export const SHEET_STUDENTS = "生徒";
export const SHEET_LESSONS = "レッスン";
export const SHEET_MATCHES = "試合結果";
export const SHEET_RATINGS = "レーティング";

interface Row {
  values: string[];
  rowNumber: number;
}

function toRows(values: string[][]): { headers: string[]; rows: Row[] } {
  const headers = values[0] ?? [];
  const rows = values.slice(1).map((v, i) => ({ values: v, rowNumber: i + 2 }));
  return { headers, rows };
}

function cell(headers: string[], row: string[], name: string): string {
  const idx = headers.indexOf(name);
  if (idx === -1) return "";
  const v = row[idx];
  return v === undefined || v === null ? "" : String(v);
}

export async function listStudents(token: string, spreadsheetId: string): Promise<Student[]> {
  const values = await getSheetValues(token, spreadsheetId, SHEET_STUDENTS);
  const { headers, rows } = toRows(values);
  return rows
    .map((r) => ({
      id: cell(headers, r.values, "ID"),
      name: cell(headers, r.values, "名前"),
      focusPoints: cell(headers, r.values, "意識するポイント"),
      createdAt: cell(headers, r.values, "作成日時"),
      rowNumber: r.rowNumber,
    }))
    .filter((s) => s.id)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

export async function createStudent(token: string, spreadsheetId: string, name: string): Promise<Student> {
  const id = generateId();
  const now = nowDisplay();
  const rowNumber = await appendRow(token, spreadsheetId, SHEET_STUDENTS, [id, name, "", now, now]);
  return { id, name, focusPoints: "", createdAt: now, rowNumber };
}

export async function updateFocusPoints(
  token: string,
  spreadsheetId: string,
  student: Student,
  focusPoints: string,
): Promise<void> {
  await updateRow(token, spreadsheetId, SHEET_STUDENTS, student.rowNumber, [
    student.id,
    student.name,
    focusPoints,
    student.createdAt,
    nowDisplay(),
  ]);
}

export async function listLessons(token: string, spreadsheetId: string, studentId: string): Promise<LessonEntry[]> {
  const values = await getSheetValues(token, spreadsheetId, SHEET_LESSONS);
  const { headers, rows } = toRows(values);
  return rows
    .filter((r) => cell(headers, r.values, "生徒ID") === studentId)
    .map((r) => ({
      date: cell(headers, r.values, "日時"),
      transcript: cell(headers, r.values, "書き起こし"),
      summary: cell(headers, r.values, "まとめ"),
    }))
    .reverse();
}

export async function addLesson(
  token: string,
  spreadsheetId: string,
  studentId: string,
  transcript: string,
  summary: string,
): Promise<void> {
  await appendRow(token, spreadsheetId, SHEET_LESSONS, [generateId(), studentId, nowDisplay(), transcript, summary]);
}

export async function listMatches(token: string, spreadsheetId: string, studentId: string): Promise<MatchEntry[]> {
  const values = await getSheetValues(token, spreadsheetId, SHEET_MATCHES);
  const { headers, rows } = toRows(values);
  return rows
    .filter((r) => cell(headers, r.values, "生徒ID") === studentId)
    .map((r) => ({
      recordedAt: cell(headers, r.values, "記録日時"),
      matchDate: cell(headers, r.values, "試合日"),
      opponent: cell(headers, r.values, "対戦相手"),
      result: cell(headers, r.values, "結果"),
      reflection: cell(headers, r.values, "反省・感想"),
    }))
    .reverse();
}

export async function listRatings(token: string, spreadsheetId: string, studentId: string): Promise<RatingEntry[]> {
  const values = await getSheetValues(token, spreadsheetId, SHEET_RATINGS);
  const { headers, rows } = toRows(values);
  return rows
    .filter((r) => cell(headers, r.values, "生徒ID") === studentId)
    .map((r) => ({
      recordedAt: cell(headers, r.values, "記録日時"),
      rating: Number(cell(headers, r.values, "レーティング")) || 0,
      memo: cell(headers, r.values, "メモ"),
    }))
    .reverse();
}

export async function addRating(
  token: string,
  spreadsheetId: string,
  studentId: string,
  rating: number,
  memo: string,
): Promise<void> {
  await appendRow(token, spreadsheetId, SHEET_RATINGS, [generateId(), studentId, nowDisplay(), rating, memo]);
}
