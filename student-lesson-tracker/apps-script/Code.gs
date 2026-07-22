/**
 * 卓球レッスンノート - 生徒ページ用の公開API
 *
 * このスプレッドシートに紐づく Apps Script として、Extensions（拡張機能）→ Apps Script から
 * このファイルの中身をそのまま貼り付けてください。手順の詳細はREADMEを参照してください。
 *
 * ウェブアプリとして導入（デプロイ）すると、生徒はログインせずにこのURLを通じて
 * ・自分の生徒IDに該当するデータだけを読み取り（GET）
 * ・自分の試合結果だけを追記（POST）
 * できるようになります。スプレッドシート自体は非公開のままで構いません
 * （このスクリプトは「自分（コーチ）として実行」で導入するため、コーチの権限で読み書きします）。
 */

var SHEET_STUDENTS = "生徒";
var SHEET_LESSONS = "レッスン";
var SHEET_MATCHES = "試合結果";

function doGet(e) {
  var studentId = e.parameter.studentId;
  if (!studentId) {
    return jsonResponse_({ error: "生徒IDが指定されていません。" });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var student = findRowById_(ss.getSheetByName(SHEET_STUDENTS), studentId);
  if (!student) {
    return jsonResponse_({ error: "ページが見つかりませんでした。リンクをコーチに確認してください。" });
  }

  var lessons = filterRowsByStudentId_(ss.getSheetByName(SHEET_LESSONS), studentId).map(function (row) {
    return { date: row["日時"], transcript: row["書き起こし"], summary: row["まとめ"] };
  });
  var matches = filterRowsByStudentId_(ss.getSheetByName(SHEET_MATCHES), studentId).map(function (row) {
    return {
      recordedAt: row["記録日時"],
      matchDate: row["試合日"],
      opponent: row["対戦相手"],
      result: row["結果"],
      reflection: row["反省・感想"],
    };
  });

  return jsonResponse_({
    name: student["名前"],
    focusPoints: student["意識するポイント"] || "",
    lessons: lessons,
    matches: matches,
  });
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse_({ error: "リクエストの形式が正しくありません。" });
  }

  if (!data.studentId || !data.reflection) {
    return jsonResponse_({ error: "必須項目（生徒ID・反省点/感想）が不足しています。" });
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var student = findRowById_(ss.getSheetByName(SHEET_STUDENTS), data.studentId);
  if (!student) {
    return jsonResponse_({ error: "生徒が見つかりませんでした。リンクをコーチに確認してください。" });
  }

  var sheet = ss.getSheetByName(SHEET_MATCHES);
  var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "yyyy/MM/dd HH:mm");
  sheet.appendRow([Utilities.getUuid(), data.studentId, now, data.matchDate || "", data.opponent || "", data.result || "", data.reflection]);

  return jsonResponse_({ ok: true });
}

function findRowById_(sheet, id) {
  var rows = sheetToObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]["ID"] === id) return rows[i];
  }
  return null;
}

function filterRowsByStudentId_(sheet, studentId) {
  return sheetToObjects_(sheet).filter(function (row) {
    return row["生徒ID"] === studentId;
  });
}

function sheetToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  return values.slice(1).map(function (row) {
    var obj = {};
    for (var i = 0; i < headers.length; i++) {
      obj[headers[i]] = row[i];
    }
    return obj;
  });
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
