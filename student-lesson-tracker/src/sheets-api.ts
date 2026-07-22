const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsApiError extends Error {
  status?: number;
}

function quoteSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function call(token: string, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error?.message ?? `${res.status} ${res.statusText}`;
    const err = new SheetsApiError(message);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Raw grid values: numbers stay numbers, dates come back as formatted strings. */
export async function getSheetValues(token: string, spreadsheetId: string, sheetTitle: string): Promise<string[][]> {
  const range = encodeURIComponent(`${quoteSheetTitle(sheetTitle)}!A1:Z5000`);
  const data = await call(
    token,
    `/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
  );
  return data.values ?? [];
}

/** Appends a row after the sheet's last row and returns the 1-indexed row number it landed on. */
export async function appendRow(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
  values: (string | number)[],
): Promise<number> {
  const range = encodeURIComponent(`${quoteSheetTitle(sheetTitle)}!A1`);
  const data = await call(
    token,
    `/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [values] }) },
  );
  const updatedRange: string = data?.updates?.updatedRange ?? "";
  const match = updatedRange.match(/![A-Z]+(\d+):/);
  return match ? Number(match[1]) : -1;
}

export async function updateRow(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
  rowNumber1Indexed: number,
  values: (string | number)[],
): Promise<void> {
  const lastCol = String.fromCharCode("A".charCodeAt(0) + values.length - 1);
  const range = encodeURIComponent(`${quoteSheetTitle(sheetTitle)}!A${rowNumber1Indexed}:${lastCol}${rowNumber1Indexed}`);
  await call(token, `/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values: [values] }),
  });
}
