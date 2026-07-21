# 卓球レッスンノート

生徒さん専用の、卓球レッスン記録アプリです。

- **① レッスンのまとめ**：レッスンの終わりにコーチが話す（またはテキストで書く）「今日教えたこと」を、AIが生徒向けの文章に自動でまとめます。
- **② 意識するポイント**：「練習や試合でいつも意識すべきポイント」をAIが管理。回を重ねるたびに、これまでの内容を踏まえて練り直され、その生徒専用にカスタマイズされていきます。
- **③ 試合結果**：生徒本人が、自分専用のページから試合結果と反省点・感想を記録できます。

コーチはGoogleアカウントでログインして生徒を管理し、生徒には**個別リンク**（ログイン不要）を渡します。サーバーは持たず、ブラウザから直接 [Firebase](https://firebase.google.com/)（データ保存・コーチのログイン）と [Anthropic API](https://console.anthropic.com/)（AIによる要約）を呼び出します。

## できること

- 生徒ごとにページを作成し、追跡専用のURL（`.../#/s/ランダムID`）を発行
- コーチがレッスン後に話した内容をブラウザの音声認識でテキスト化 → AIが要約 → 「今日のまとめ」と「意識するポイント（最新版）」を生成
  - 「意識するポイント」は単なる追記ではなく、これまでの蓄積内容も踏まえてAIが毎回練り直すので、使うほどその生徒に合った内容になっていきます
  - 音声認識に対応していないブラウザでも、テキストを直接入力すれば同じようにAI要約できます
- 生成された内容は保存前に自由に編集可能
- 生徒は個別リンクを開くだけで、意識するポイント・レッスン履歴を閲覧し、試合結果と反省点・感想を自分で記録できます

## セットアップ（初回のみ）

### 1. Firebase プロジェクトを作成

1. [Firebase Console](https://console.firebase.google.com/) で新しいプロジェクトを作成（無料の Spark プランでOK）
2. 「Authentication」→「Sign-in method」で **Google** ログインを有効化
3. 「Firestore Database」で **本番環境モード** でデータベースを作成（リージョンは `asia-northeast1`（東京）などお好みで）
4. 「プロジェクトの設定」（⚙アイコン）→「全般」→「マイアプリ」で「ウェブアプリを追加」し、表示された `firebaseConfig` の中身をコピー

### 2. Firestore のセキュリティルールを設定

「Firestore Database」→「ルール」タブで、以下を貼り付けて公開してください。

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isCoach() {
      return request.auth != null && request.auth.token.email == 'kazuhide.yukinori@gmail.com';
    }

    match /students/{studentId} {
      allow get: if true;       // 個別リンクを知っていれば閲覧可能
      allow list: if isCoach(); // 全生徒の一覧はコーチのみ
      allow create, update, delete: if isCoach();

      match /lessons/{lessonId} {
        allow get, list: if true;   // studentId（個別リンク）を知っていれば閲覧可能
        allow create, update, delete: if isCoach();
      }

      match /matches/{matchId} {
        allow get, list: if true;      // 同上
        allow create: if true;         // 生徒本人が自分のページから記録できる
        allow update, delete: if isCoach();
      }
    }
  }
}
```

**この方式のセキュリティについて**：生徒ページのURL（`#/s/ランダムID`）はパスワード代わりです。生徒一覧を横断検索する手段はルール上ふさがっていますが、URLを知っている人は誰でもそのページを閲覧・試合結果の追記ができます。URLは本人以外に共有しないよう伝えてください。より厳密な認証（生徒ごとのログイン）が必要な場合はご相談ください。

### 3. `src/firebase-config.ts` を編集

手順1でコピーした `firebaseConfig` を貼り付けます。

```ts
export const FIREBASE_CONFIG: FirebaseWebConfig | null = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

この値は公開されて問題ない設定値です（Firebase公式の想定どおり、アクセス制御は上記のセキュリティルールで行います）ので、そのままコミットしてください。

### 4. Google OAuth の承認済みドメインを確認

Firebase Authentication は Google ログインのために、公開するURLのドメイン（例: `kazuhideyukinori-cpu.github.io`）が「承認済みドメイン」に入っている必要があります。通常、同じFirebaseプロジェクトなら自動で使えますが、エラーが出る場合は Authentication →「設定」→「承認済みドメイン」に追加してください。

### 5. Anthropic APIキーを取得

1. [Anthropic Console](https://console.anthropic.com/) でAPIキーを発行
2. アプリを開き、右上の「⚙ 接続設定」で **Anthropic APIキー** を貼り付けて保存
   - これはコーチ本人の端末のブラウザにのみ保存され、レッスンのまとめ生成時にのみ使われます（生徒側の画面では使用しません）
   - AIモデル名は初期値 `claude-sonnet-5` のままで問題ありません

### 6. Googleでログイン

アプリを開いて「Googleでログイン」→ 手順2で指定したメールアドレスのアカウントでログインすれば、生徒の追加・レッスン記録ができるようになります。

## 使い方の流れ

1. コーチ画面で生徒を追加し、発行された個別リンクを生徒に共有（LINEなどで送るだけでOK、ログイン不要）
2. レッスン後、その生徒を選んで「🎙 録音開始」→ 今日教えたことを話す → 「⏹ 録音停止」
   - （音声認識非対応ブラウザの場合は、テキストエリアに直接入力）
3. 「AIでまとめる」→ 内容を確認・必要なら編集 →「保存する」
   - 「今日のまとめ」がレッスン履歴に追加され、「意識するポイント」も最新版に更新されます
4. 生徒は個別リンクを開けば、いつでも「意識するポイント」とレッスン履歴を見返せます
5. 生徒は試合の後、同じページから試合結果と反省点・感想を記録できます

## 開発

```bash
npm install
npm run dev      # ローカルで確認
npm run build    # 本番ビルド（dist/ に出力）
```

## 注意点

- 生徒の個別リンク・音声入力・AI要約はすべてブラウザから直接 Firebase / Anthropic API を呼び出します。専用サーバーは使っていません。
- Anthropic APIの利用料金はAPIキーの発行者（コーチ）に発生します。
- 音声認識は Web Speech API を使用しており、Chrome など対応ブラウザでのみ動作します（対応状況はブラウザに依存します）。非対応の場合はテキスト入力で代用できます。
