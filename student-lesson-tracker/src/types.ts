export interface Student {
  id: string;
  name: string;
  focusPoints: string;
  createdAt: string;
  rowNumber: number;
}

export interface LessonEntry {
  date: string;
  transcript: string;
  summary: string;
}

export interface MatchEntry {
  matchDate: string;
  opponent: string;
  result: string;
  reflection: string;
  recordedAt: string;
}

export interface AppSettings {
  googleClientId: string;
  spreadsheetId: string;
  anthropicApiKey: string;
  anthropicModel: string;
}
