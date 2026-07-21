import type { AppSettings } from "./types.ts";

const STORAGE_KEY = "student-lesson-tracker:settings";

const DEFAULT_SETTINGS: AppSettings = {
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-5",
  coachEmail: "",
};

export function loadSettings(): AppSettings {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
