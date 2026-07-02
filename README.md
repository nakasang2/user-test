# UserVoice — ユーザーインタビュー自動化ツール

インタビュアー不在でユーザーインタビューを自動実施。AI が進行・感情分析・文字起こし・分析まで一気通貫で行います。

---

## 機能概要

| 機能 | 説明 |
|------|------|
| 🎥 セッション録画 | 被験者のカメラ映像を録画し、完了時に Vercel Blob へ自動アップロード |
| 🤖 AI インタビュアー | 設定した質問を TTS で読み上げ、回答に応じて AI が深掘り質問を生成（最大2回） |
| 🎙️ 音声認識 | ブラウザの Speech Recognition API でリアルタイム文字起こし（テキスト入力フォールバックあり） |
| 😊 表情・感情分析 | face-api.js によるブラウザ内感情検出（5秒間隔・7感情） |
| 📝 AI サマリー | インタビュー全体の要約・テーマ抽出・センチメント分析 |
| 📊 ダッシュボード | 被験者ごとの文字起こし・感情グラフ・録画同期再生・CSV 出力 |
| 💬 AI エージェント | 「誰が最も困惑していた？」などを自然言語で質問・回答 |
| 🧪 テストモード | 通常インタビュー / 印象テスト（画像刺激） / ユーザビリティテスト（プロトタイプ・実サービス） |
| 🏢 マルチテナント | 組織・メンバー管理（owner / admin / editor / viewer）、招待リンク |

---

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router, Turbopack)
- **言語**: TypeScript
- **DB**: PostgreSQL (Prisma ORM)
- **認証**: JWT (jose) + httpOnly Cookie。被験者はセッション限定トークンで認証
- **AI**: OpenAI `gpt-4o`（分析・深掘り判断・Q&A・質問生成）、`tts-1`（質問読み上げ）
- **感情分析**: `@vladmandic/face-api`（ブラウザ内 ML、モデルは `public/models/`）
- **録画ストレージ**: Vercel Blob
- **ビデオルーム**: Daily.co REST API（オプション、`DAILY_API_KEY` 設定時のみ）
- **グラフ**: Recharts
- **スタイル**: Tailwind CSS v4

---

## セットアップ

### 1. 環境変数を設定

`.env` に API キーを設定：

```env
DATABASE_URL="postgresql://..."
JWT_SECRET="ランダムな長い文字列"            # 認証トークンの署名に必須
OPENAI_API_KEY="your_openai_api_key"         # AI 分析・TTS・深掘りに必須
BLOB_READ_WRITE_TOKEN="vercel_blob_token"    # 録画アップロードに必須（Vercel 上では自動注入）
DAILY_API_KEY="your_daily_co_api_key"        # オプション（未設定でも動作）
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### 2. 依存関係のインストール

```bash
npm install
```

### 3. データベースの初期化

```bash
npx prisma db push
npx prisma generate
```

### 4. 開発サーバーの起動

```bash
npm run dev
```

http://localhost:3000 にアクセスし、`/register` で組織とアカウントを作成。

---

## 使い方

### Step 1: インタビューを作成

- ダッシュボード → 「AIで質問設計」: AI と対話しながらプロットを生成
- または「手動で作成」: タイプ（インタビュー / 印象テスト / ユーザビリティ）と質問を直接入力

### Step 2: 参加者を招待

インタビューの「参加者を招待」で共有リンク（`/join/[interviewId]`）をコピーして被験者に送る。
同じリンクを複数人に送れます。被験者は名前を入力し、**録画・分析への同意**（DB に記録）
にチェックするとセッションが自動作成されます。

### Step 3: 被験者がインタビューに参加

1. カメラ・マイクを許可（拒否した場合はテキスト回答モードで続行可能）
2. AI が質問を読み上げ → 被験者が話す → AI が深掘り or 次の質問へ
3. 回答・感情データはインタビュー中に逐次保存（途中離脱してもそれまでの分は残る）
4. 完了時に録画がサーバーへ自動アップロードされ、AI 分析が実行される

### Step 4: 結果を確認

- **セッション詳細**: AI サマリー・テーマ・会話ログ・感情グラフ（録画と同期再生）・CSV 出力（会話 / 感情）
- **インタビュー詳細**: 参加者比較テーブル・感情レーダー・AI 共通インサイト（キャッシュされ、対象セッションが変わると再生成）
- **AI アシスタント**: 右下のフローティングチャットで自然言語の質問

---

## アーキテクチャ

```
src/
├── proxy.ts                             # /dashboard/* の認証ガード
├── app/
│   ├── page.tsx                         # トップページ（静的・DB 非参照）
│   ├── login / register / invite/[token]# 認証・招待受諾
│   ├── join/[interviewId]/page.tsx      # 被験者の参加登録（同意取得）
│   ├── interview/[roomName]/page.tsx    # インタビュールーム（被験者トークン発行）
│   ├── interview/widget/page.tsx        # ユーザビリティテスト用タスクウィジェット（PiP）
│   ├── dashboard/                       # ダッシュボード・セッション詳細・比較・AI設計・メンバー管理
│   └── api/
│       ├── auth/                        # login / register / logout
│       ├── interviews/                  # テンプレート CRUD・比較（要ログイン + 組織スコープ）
│       ├── sessions/[id]/               # 詳細(要ログイン) / ステータス(被験者トークン)
│       │   ├── transcript/             # 逐次保存ドラフト（被験者トークン）
│       │   ├── process/                # AI 分析・確定（被験者トークン or ログイン）
│       │   └── recording/              # 録画アップロード（被験者トークン）
│       ├── emotions/                    # 感情データ逐次保存（被験者トークン）
│       ├── tts / interviewer/           # 読み上げ・深掘り判断（被験者トークン）
│       ├── agent/                       # AI Q&A（要ログイン + 組織スコープ）
│       ├── join / invite/               # 公開エンドポイント
│       └── organizations/               # メンバー・招待管理（admin+）
├── components/
│   ├── InterviewRoom.tsx                # インタビュー進行（録画・TTS・音声認識・フェーズ管理）
│   ├── interview/                       # RealtimeEmotionGraph / RatingQuestion / NpsQuestion
│   ├── FloatingAgentChat.tsx            # AI エージェント チャット
│   ├── EmotionChart.tsx / TranscriptView.tsx / StatusBadge.tsx
│   └── CreateInterviewModal.tsx
├── hooks/useEmotionDetection.ts         # face-api.js 感情検出
└── lib/
    ├── db.ts                            # Prisma クライアント（シングルトン）
    ├── jwt.ts                           # ユーザー JWT + 被験者セッショントークン
    ├── api-auth.ts                      # requireAuth / requireRole / requireParticipant
    ├── permissions.ts                   # ロール階層
    ├── ai.ts                            # OpenAI（分析・Q&A・質問生成・共通インサイト）
    └── daily.ts                         # Daily.co ルーム作成（オプション）
```

---

## API エンドポイントと認証

| 認証 | エンドポイント |
|------|------|
| 公開 | `GET/POST /api/join/[interviewId]`, `GET/POST /api/invite/[token]`, `POST /api/auth/*` |
| 被験者トークン（`x-session-token`） | `PATCH /api/sessions/[id]`, `POST .../transcript`, `POST .../recording`, `POST /api/emotions`, `POST /api/tts`, `POST /api/interviewer` |
| ログイン + 組織スコープ | `GET/POST /api/interviews*`, `GET /api/sessions*`, `DELETE /api/sessions/[id]`, `POST /api/agent` |
| ログイン or 被験者トークン | `POST /api/sessions/[id]/process` |
| admin 以上 | `/api/organizations/*` |

被験者トークンはインタビュールームのサーバーコンポーネントが発行するセッション限定 JWT（24時間有効）。

---

## 既知の制限・今後の課題

- [ ] 画面録画（ユーザビリティテスト）はローカルダウンロードのみ（サーバー保存先が未実装）
- [ ] 話者識別は「Interviewer / Participant」の2者固定（diarization 未実装）
- [ ] `processing` のまま失敗したセッションの自動リカバリなし（「AI 再分析」で手動再実行は可能）
- [ ] transcript の全文検索は未実装（ダッシュボードの検索は参加者名のみ）
- [ ] `npm run build` が `prisma db push` を実行する（本来は `prisma migrate deploy` が望ましい）
- [ ] Next.js 16 + Turbopack は開発マシンへの負荷が高い場合あり
  → `next dev --webpack` で Webpack モードに切り替え可
