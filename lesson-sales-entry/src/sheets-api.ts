const API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsApiError extends Error {}

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
    (err as any).status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export interface SheetTab {
  sheetId: number;
  title: string;
  index: number;
}

export async function listSheets(token: string, spreadsheetId: string): Promise<SheetTab[]> {
  const data = await call(token, `/${spreadsheetId}?fields=sheets.properties`);
  return (data.sheets ?? []).map((s: any) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
    index: s.properties.index,
  }));
}

/** Returns raw grid values: numbers stay numbers, dates come back as "YYYY/MM/DD" strings. */
export async function getSheetValues(token: string, spreadsheetId: string, sheetTitle: string): Promise<any[][]> {
  const range = encodeURIComponent(`${quoteSheetTitle(sheetTitle)}!A1:Z5000`);
  const data = await call(
    token,
    `/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
  );
  return data.values ?? [];
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
    body: JSON.stringify({ range: `${sheetTitle}!A${rowNumber1Indexed}:${lastCol}${rowNumber1Indexed}`, values: [values] }),
  });
}

export async function copyFormat(
  token: string,
  spreadsheetId: string,
  sheetId: number,
  sourceRow1Indexed: number,
  destRow1Indexed: number,
  numCols: number,
): Promise<void> {
  await call(token, `/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          copyPaste: {
            source: {
              sheetId,
              startRowIndex: sourceRow1Indexed - 1,
              endRowIndex: sourceRow1Indexed,
              startColumnIndex: 0,
              endColumnIndex: numCols,
            },
            destination: {
              sheetId,
              startRowIndex: destRow1Indexed - 1,
              endRowIndex: destRow1Indexed,
              startColumnIndex: 0,
              endColumnIndex: numCols,
            },
            pasteType: "PASTE_FORMAT",
          },
        },
      ],
    }),
  });
}

export async function duplicateSheet(
  token: string,
  spreadsheetId: string,
  sourceSheetId: number,
  insertIndex: number,
  newTitle: string,
): Promise<number> {
  const data = await call(token, `/${spreadsheetId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          duplicateSheet: {
            sourceSheetId,
            insertSheetIndex: insertIndex,
            newSheetName: newTitle,
          },
        },
      ],
    }),
  });
  return data.replies[0].duplicateSheet.properties.sheetId;
}

export async function clearRowsFrom(
  token: string,
  spreadsheetId: string,
  sheetTitle: string,
  fromRow1Indexed: number,
): Promise<void> {
  const range = encodeURIComponent(`${quoteSheetTitle(sheetTitle)}!A${fromRow1Indexed}:Z5000`);
  await call(token, `/${spreadsheetId}/values/${range}:clear`, { method: "POST" });
}
