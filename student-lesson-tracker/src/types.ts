export interface Student {
  id: string;
  name: string;
  focusPoints: string;
  createdAt: number;
  updatedAt: number;
}

export interface LessonEntry {
  id: string;
  createdAt: number;
  transcript: string;
  summary: string;
}

export interface MatchEntry {
  id: string;
  createdAt: number;
  matchDate: string;
  opponent: string;
  result: string;
  reflection: string;
}

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

export interface AppSettings {
  anthropicApiKey: string;
  anthropicModel: string;
  coachEmail: string;
}
