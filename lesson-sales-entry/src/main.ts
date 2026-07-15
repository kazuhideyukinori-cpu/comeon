import "./style.css";
import {
  SheetsApiError,
  clearRowsFrom,
  copyFormat,
  duplicateSheet,
  getSheetValues,
  listSheets,
  updateRow,
  type SheetTab,
} from "./sheets-api";

const DEFAULT_SPREADSHEET_ID = "1SF-aTsDFXzeoxL94NE-lA0RbUVVwA1Ef";
const MONTH_SHEET_RE = /^レッスン売上(\d+)月$/;
const KNOWN_HEADERS = ["日付", "場所", "人", "時間", "売上", "場所代", "交通費", "出発駅", "到着駅", "往復・片道"];

const settingsToggle = document.querySelector<HTMLButtonElement>("#settings-toggle")!;
const settingsBody = document.querySelector<HTMLElement>("#settings-body")!;
const clientIdInput = document.querySelector<HTMLInputElement>("#client-id-input")!;
const spreadsheetIdInput = document.querySelector<HTMLInputElement>("#spreadsheet-id-input")!;
const saveSettingsBtn = document.querySelector<HTMLButtonElement>("#save-settings-btn")!;

const loginBtn = document.querySelector<HTMLButtonElement>("#login-btn")!;
const authStatus = document.querySelector<HTMLElement>("#auth-status")!;

const mainSection = document.querySelector<HTMLElement>("#main-section")!;
const monthSelect = document.querySelector<HTMLSelectElement>("#month-select")!;
const newMonthBtn = document.querySelector<HTMLButtonElement>("#new-month-btn")!;
const reloadBtn = document.querySelector<HTMLButtonElement>("#reload-btn")!;
const sheetStatus = document.querySelector<HTMLElement>("#sheet-status")!;

const entryForm = document.querySelector<HTMLFormElement>("#entry-form")!;
const fDate = document.querySelector<HTMLInputElement>("#f-date")!;
const fVenue = document.querySelector<HTMLInputElement>("#f-venue")!;
const fPeople = document.querySelector<HTMLInputElement>("#f-people")!;
const fHours = document.querySelector<HTMLInputElement>("#f-hours")!;
const fSales = document.querySelector<HTMLInputElement>("#f-sales")!;
const fVenueFee = document.querySelector<HTMLInputElement>("#f-venue-fee")!;
const fTransport = document.querySelector<HTMLInputElement>("#f-transport")!;
const fFromStation = document.querySelector<HTMLInputElement>("#f-from-station")!;
const fToStation = document.querySelector<HTMLInputElement>("#f-to-station")!;
const fTripType = document.querySelector<HTMLSelectElement>("#f-trip-type")!;
const submitBtn = document.querySelector<HTMLButtonElement>("#submit-btn")!;
const submitStatus = document.querySelector<HTMLElement>("#submit-status")!;

const venueList = document.querySelector<HTMLDataListElement>("#venue-list")!;
const peopleList = document.querySelector<HTMLDataListElement>("#people-list")!;
const stationList = document.querySelector<HTMLDataListElement>("#station-list")!;

const recentHead = document.querySelector<HTMLElement>("#recent-head")!;
const recentBody = document.querySelector<HTMLElement>("#recent-body")!;

interface VenueDefault {
  fee: string | number;
  from: string;
  to: string;
  tripType: string;
}

interface HistoryRow {
  venue: string;
  people: string;
  fee: string;
  from: string;
  to: string;
  tripType: string;
  transport: number;
}

let accessToken: string | null = null;
let tokenClient: TokenClient | null = null;
let spreadsheetId = "";
let sheets: SheetTab[] = [];
let currentSheet: SheetTab | null = null;
let headers: string[] = [];
let headerIndex: Record<string, number> = {};
let dataRows: any[][] = [];
let lastRowNumber = 1;
let lastDate: string | null = null;
let venueDefaults = new Map<string, VenueDefault>();
let fareByRoute = new Map<string, number>();
/** Aggregated across every レッスン売上◯月 tab, so autofill/autocomplete works even in a brand-new month sheet. */
let historyRows: HistoryRow[] = [];
const dirtyFields = new Set<string>();

function loadSettings() {
  clientIdInput.value = localStorage.getItem("lse.clientId") ?? "";
  spreadsheetIdInput.value = localStorage.getItem("lse.spreadsheetId") ?? DEFAULT_SPREADSHEET_ID;
  spreadsheetId = spreadsheetIdInput.value.trim();
}

function setStatus(el: HTMLElement, message: string, kind: "" | "ok" | "error" = "") {
  el.textContent = message;
  el.className = "status-line" + (kind ? ` ${kind}` : "");
}

function ensureTokenClient() {
  const clientId = clientIdInput.value.trim();
  if (!clientId) {
    setStatus(authStatus, "先に「⚙ 接続設定」でクライアントIDを保存してください。", "error");
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
        onLoggedIn();
      },
      error_callback: (error) => {
        setStatus(authStatus, `ログインに失敗しました: ${error.type}`, "error");
      },
    });
  }
  return tokenClient;
}

settingsToggle.addEventListener("click", () => {
  settingsBody.classList.toggle("hidden");
});

saveSettingsBtn.addEventListener("click", () => {
  localStorage.setItem("lse.clientId", clientIdInput.value.trim());
  localStorage.setItem("lse.spreadsheetId", spreadsheetIdInput.value.trim());
  spreadsheetId = spreadsheetIdInput.value.trim();
  tokenClient = null;
  setStatus(authStatus, "設定を保存しました。ログインしてください。", "ok");
});

loginBtn.addEventListener("click", () => {
  const client = ensureTokenClient();
  client?.requestAccessToken();
});

async function onLoggedIn() {
  setStatus(authStatus, "ログインしました。", "ok");
  mainSection.classList.remove("hidden");
  try {
    await refreshSheetList();
  } catch (err) {
    handleApiError(err);
  }
}

function handleApiError(err: unknown) {
  if (err instanceof SheetsApiError && (err as any).status === 401) {
    accessToken = null;
    mainSection.classList.add("hidden");
    setStatus(authStatus, "セッションが切れました。もう一度ログインしてください。", "error");
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  setStatus(sheetStatus, `エラー: ${message}`, "error");
  console.error(err);
}

function requireToken(): string {
  if (!accessToken) throw new Error("not logged in");
  return accessToken;
}

async function refreshSheetList() {
  const token = requireToken();
  sheets = await listSheets(token, spreadsheetId);
  const monthSheets = sheets.filter((s) => MONTH_SHEET_RE.test(s.title));
  monthSheets.sort((a, b) => a.index - b.index);

  const currentMonth = new Date().getMonth() + 1;
  const currentTitle = `レッスン売上${currentMonth}月`;

  monthSelect.innerHTML = "";
  for (const s of monthSheets) {
    const opt = document.createElement("option");
    opt.value = s.title;
    opt.textContent = s.title;
    monthSelect.appendChild(opt);
  }
  const preferred = monthSheets.find((s) => s.title === currentTitle) ?? monthSheets[monthSheets.length - 1];
  if (preferred) {
    monthSelect.value = preferred.title;
    await loadSheetData(preferred.title);
  } else {
    setStatus(sheetStatus, "「レッスン売上◯月」という名前のシートが見つかりません。", "error");
  }
}

monthSelect.addEventListener("change", async () => {
  try {
    await loadSheetData(monthSelect.value);
  } catch (err) {
    handleApiError(err);
  }
});

reloadBtn.addEventListener("click", async () => {
  try {
    await refreshSheetList();
  } catch (err) {
    handleApiError(err);
  }
});

async function loadSheetData(title: string) {
  const token = requireToken();
  currentSheet = sheets.find((s) => s.title === title) ?? null;
  if (!currentSheet) return;
  setStatus(sheetStatus, "読み込み中…", "");

  const values = await getSheetValues(token, spreadsheetId, title);
  headers = values[0] ?? KNOWN_HEADERS;
  dataRows = values.slice(1);
  lastRowNumber = Math.max(values.length, 1);

  headerIndex = {};
  headers.forEach((h, i) => {
    headerIndex[h] = i;
  });

  computeLastDate();
  await loadHistoryAcrossMonths(token);
  buildAutofillData();
  renderDatalists();
  renderRecentTable();
  setStatus(sheetStatus, `${title}：${dataRows.length} 件のデータを読み込みました。`, "ok");
}

function cell(row: any[], header: string): string {
  const idx = headerIndex[header];
  if (idx === undefined) return "";
  const v = row[idx];
  return v === undefined || v === null ? "" : String(v);
}

function computeLastDate() {
  lastDate = null;
  for (const row of dataRows) {
    const date = cell(row, "日付");
    if (date) lastDate = date;
  }
}

/** Pulls every レッスン売上◯月 tab so autofill/autocomplete has data even in a month sheet that's still empty. */
async function loadHistoryAcrossMonths(token: string) {
  const monthSheets = sheets.filter((s) => MONTH_SHEET_RE.test(s.title)).sort((a, b) => a.index - b.index);
  const all: HistoryRow[] = [];
  for (const s of monthSheets) {
    try {
      const values = s.title === currentSheet?.title ? [headers, ...dataRows] : await getSheetValues(token, spreadsheetId, s.title);
      const hdr = values[0] ?? [];
      const idx: Record<string, number> = {};
      hdr.forEach((h: string, i: number) => (idx[h] = i));
      const get = (row: any[], name: string) => {
        const i = idx[name];
        if (i === undefined) return "";
        const v = row[i];
        return v === undefined || v === null ? "" : String(v);
      };
      for (const row of values.slice(1)) {
        all.push({
          venue: get(row, "場所"),
          people: get(row, "人"),
          fee: get(row, "場所代"),
          from: get(row, "出発駅"),
          to: get(row, "到着駅"),
          tripType: get(row, "往復・片道") || "片道",
          transport: Number(get(row, "交通費")) || 0,
        });
      }
    } catch (err) {
      console.warn(`failed to load history from ${s.title}`, err);
    }
  }
  historyRows = all;
}

function buildAutofillData() {
  venueDefaults = new Map();
  fareByRoute = new Map();

  for (const r of historyRows) {
    if (r.venue) {
      // Merge per-field so a recent row with a blank station/fee doesn't blank out an earlier good value.
      const existing = venueDefaults.get(r.venue) ?? { fee: "", from: "", to: "", tripType: "片道" };
      venueDefaults.set(r.venue, {
        fee: r.fee || existing.fee,
        from: r.from || existing.from,
        to: r.to || existing.to,
        tripType: r.tripType || existing.tripType,
      });
    }
    if (r.from && r.to && r.transport > 0) {
      const oneWayFare = r.tripType === "往復" ? r.transport / 2 : r.transport;
      fareByRoute.set(`${r.from}→${r.to}`, oneWayFare);
      fareByRoute.set(`${r.to}→${r.from}`, oneWayFare);
    }
  }
}

/** Fills 交通費 from fares learned from sheet history, keyed purely by 出発駅→到着駅 (not tied to 場所). */
function applyTransportAutofill() {
  if (dirtyFields.has("transport")) return;
  const from = fFromStation.value.trim();
  const to = fToStation.value.trim();
  if (!from || !to) return;
  const oneWayFare = fareByRoute.get(`${from}→${to}`);
  if (oneWayFare === undefined) return;
  const amount = fTripType.value === "往復" ? oneWayFare * 2 : oneWayFare;
  fTransport.value = String(Math.round(amount));
}

function renderDatalists() {
  const venues = new Set<string>();
  const people = new Set<string>();
  const stations = new Set<string>();
  for (const r of historyRows) {
    if (r.venue) venues.add(r.venue);
    if (r.people) people.add(r.people);
    if (r.from) stations.add(r.from);
    if (r.to) stations.add(r.to);
  }
  fillDatalist(venueList, venues);
  fillDatalist(peopleList, people);
  fillDatalist(stationList, stations);
}

function fillDatalist(list: HTMLDataListElement, values: Set<string>) {
  list.innerHTML = "";
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    list.appendChild(opt);
  }
}

function renderRecentTable() {
  recentHead.innerHTML = "";
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    recentHead.appendChild(th);
  }
  recentBody.innerHTML = "";
  const recent = dataRows.slice(-5).reverse();
  for (const row of recent) {
    const tr = document.createElement("tr");
    for (let i = 0; i < headers.length; i++) {
      const td = document.createElement("td");
      td.textContent = row[i] === undefined || row[i] === null ? "" : String(row[i]);
      tr.appendChild(td);
    }
    recentBody.appendChild(tr);
  }
}

fVenue.addEventListener("input", () => {
  const def = venueDefaults.get(fVenue.value.trim());
  if (def) {
    if (!dirtyFields.has("fee")) fVenueFee.value = String(def.fee || 0);
    if (!dirtyFields.has("from")) fFromStation.value = def.from;
    if (!dirtyFields.has("to")) fToStation.value = def.to;
    if (!dirtyFields.has("trip")) fTripType.value = def.tripType || "片道";
  }
  applyTransportAutofill();
});

fVenueFee.addEventListener("input", () => dirtyFields.add("fee"));
fFromStation.addEventListener("input", () => {
  dirtyFields.add("from");
  applyTransportAutofill();
});
fToStation.addEventListener("input", () => {
  dirtyFields.add("to");
  applyTransportAutofill();
});
fTripType.addEventListener("input", () => {
  dirtyFields.add("trip");
  applyTransportAutofill();
});
fTransport.addEventListener("input", () => dirtyFields.add("transport"));

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

fDate.value = todayIso();

entryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentSheet) return;
  submitBtn.disabled = true;
  setStatus(submitStatus, "書き込み中…", "");
  try {
    const token = requireToken();
    const dateStr = fDate.value.replaceAll("-", "/");
    const sameDay = lastDate !== null && lastDate === dateStr;
    const hasData = dataRows.length > 0;

    let targetRow: number;
    let dateCell: string;
    if (sameDay) {
      targetRow = lastRowNumber + 1;
      dateCell = "";
    } else if (hasData) {
      targetRow = lastRowNumber + 2; // leave one blank spacer row between days
      dateCell = dateStr;
    } else {
      targetRow = lastRowNumber + 1;
      dateCell = dateStr;
    }

    const row = new Array(headers.length).fill("");
    const set = (name: string, value: string | number) => {
      const idx = headerIndex[name];
      if (idx !== undefined) row[idx] = value;
    };
    set("日付", dateCell);
    set("場所", fVenue.value.trim());
    set("人", fPeople.value.trim());
    set("時間", Number(fHours.value));
    set("売上", Number(fSales.value));
    set("場所代", Number(fVenueFee.value || 0));
    set("交通費", Number(fTransport.value || 0));
    set("出発駅", fFromStation.value.trim());
    set("到着駅", fToStation.value.trim());
    set("往復・片道", fTripType.value);

    await updateRow(token, spreadsheetId, currentSheet.title, targetRow, row);

    if (hasData) {
      try {
        await copyFormat(token, spreadsheetId, currentSheet.sheetId, lastRowNumber, targetRow, headers.length);
      } catch (err) {
        console.warn("copyFormat failed (non-fatal)", err);
      }
    }

    setStatus(submitStatus, `✅ ${currentSheet.title} の ${targetRow} 行目に追加しました。`, "ok");
    await loadSheetData(currentSheet.title);
    resetFormForNextEntry();
  } catch (err) {
    handleApiError(err);
    setStatus(submitStatus, "書き込みに失敗しました。上のエラーを確認してください。", "error");
  } finally {
    submitBtn.disabled = false;
  }
});

function resetFormForNextEntry() {
  fVenue.value = "";
  fPeople.value = "";
  fHours.value = "1";
  fSales.value = "";
  fVenueFee.value = "0";
  fTransport.value = "0";
  fFromStation.value = "";
  fToStation.value = "";
  fTripType.value = "片道";
  dirtyFields.clear();
  fVenue.focus();
}

newMonthBtn.addEventListener("click", async () => {
  try {
    const token = requireToken();
    const input = prompt("作成する月を数字で入力してください（例: 6）");
    if (!input) return;
    const month = Number(input);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      alert("1〜12の数字を入力してください。");
      return;
    }
    const newTitle = `レッスン売上${month}月`;
    if (sheets.some((s) => s.title === newTitle)) {
      alert(`${newTitle} は既に存在します。`);
      return;
    }
    const monthSheets = sheets.filter((s) => MONTH_SHEET_RE.test(s.title)).sort((a, b) => a.index - b.index);
    const template = monthSheets[monthSheets.length - 1];
    if (!template) {
      alert("テンプレートにする既存の月シートが見つかりません。");
      return;
    }
    setStatus(sheetStatus, `${newTitle} を作成中…`, "");
    const newSheetId = await duplicateSheet(token, spreadsheetId, template.sheetId, template.index + 1, newTitle);
    await clearRowsFrom(token, spreadsheetId, newTitle, 2);
    await refreshSheetList();
    monthSelect.value = newTitle;
    await loadSheetData(newTitle);
    setStatus(sheetStatus, `${newTitle} を作成しました（sheetId=${newSheetId}）。`, "ok");
  } catch (err) {
    handleApiError(err);
  }
});

loadSettings();
