import type { FirebaseWebConfig } from "./types.ts";

// Firebase Console →「プロジェクトの設定」→「全般」→「マイアプリ」→「SDK の設定と構成」に
// 表示される firebaseConfig の中身をそのままここに貼り付けてください（キーは "..." で囲む）。
//
// このWeb設定はいわゆる「公開鍵」で、秘密情報ではありません（Firebase公式の想定どおり、
// アクセス制御はこの値を隠すことではなく Firestore のセキュリティルールで行います）。
// そのためリポジトリにコミットして問題ありません。詳しい手順はREADMEを参照してください。
export const FIREBASE_CONFIG: FirebaseWebConfig | null = {
  apiKey: "AIzaSyAmGYSipOvkD3pvxkvZzwAFPDYQVBXcj6g",
  authDomain: "come-on-table-tennis.firebaseapp.com",
  projectId: "come-on-table-tennis",
  storageBucket: "come-on-table-tennis.firebasestorage.app",
  messagingSenderId: "153621774843",
  appId: "1:153621774843:web:e143b7ec70161af9cf0b5e",
};
