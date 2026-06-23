# UserVoice — ユーザーインタビュー自動化ツール

インタビュアー不在でユーザーインタビューを自動実施。AI が進行・表情エンゲージメント計測・文字起こし・分析まで一気通貫で行います。

---

## 機能概要

| 機能 | 説明 |
|------|------|
| 🎥 ビデオ会議 | URL を共有するだけで被験者がブラウザから参加 |
| 🤖 AI インタビュアー | 設定した質問を Web Speech API (TTS) で自動読み上げ・進行 |
| 🎙️ 音声認識 | ブラウザの Speech Recognition API でリアルタイム文字起こし |
| 😊 表情エンゲージメント指標 | カメラ映像の表情から参考指標を収集（5秒間隔・補助シグナル） |
| 📝 AI サマリー | OpenAI gpt-4o がインタビュー全体を要約・テーマ抽出 |
| 📊 ダッシュボード | 被験者ごとの文字起こし・感情グラフを一覧表示 |
| 💬 AI エージェント | 「誰が最も困惑していた？」などを自然言語で質問・回答 |

---

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router, Turbopack)
- **言語**: TypeScript
- **DB**: PostgreSQL (Prisma ORM)
- **ビデオ**: [Daily.co](https://daily.co) REST API（オプション）
- **文字起こし**: ブラウザの Speech Recognition API（ライブ）。OpenAI Whisper API は録音ファイル用のユーティリティとして同梱（現状の処理フローでは未使用）
- **AI 分析・要約・Q&A**: OpenAI gpt-4o
- **音声合成 (TTS)**: OpenAI tts-1
- **表情エンゲージメント指標**: ブラウザ内 face-api（`@vladmandic/face-api`）による表情推定。実際の感情とは異なる場合がある補助シグナルであり、断定的な感情判定には用いない
- **グラフ**: Recharts
- **スタイル**: Tailwind CSS v4

---

## セットアップ

### 1. 環境変数を設定

`.env.example` をコピーして `.env` を作成：

```bash
cp .env.example .env
```

`.env` に API キーを設定：

```env
# DB（Supabase 推奨）: Session pooler（5432, IPv4対応）1本でOK
DATABASE_URL="postgresql://postgres.xxxx:[PASSWORD]@aws-0-region.pooler.supabase.com:5432/postgres"
JWT_SECRET="your_long_random_secret"         # 認証トークンの署名に必要
OPENAI_API_KEY="your_openai_api_key"         # AI 分析・要約・Q&A・TTS に必要
DAILY_API_KEY="your_daily_co_api_key"        # オプション（未設定でも動作）
BLOB_READ_WRITE_TOKEN="your_vercel_blob_token" # 録画の非公開保存・署名URL配信に必要
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

> **Supabase の接続文字列**: ダッシュボード → Project Settings → Database → Connection string →
> **Session pooler（ポート 5432, IPv4 対応）** を選ぶ。これ1本で実行時・migration・`db push` すべてに使える。
> （Transaction pooler 6543 は `db push` の DDL と相性が悪いため避ける。）
>
> 環境変数はサーバー起動時に検証されます（`src/lib/env.ts` / `src/instrumentation.ts`）。
> `DATABASE_URL`・`JWT_SECRET` が未設定だと起動に失敗し、任意項目（OpenAI / Blob / Daily）が未設定の場合は警告のうえ該当機能のみ無効化されます。

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

http://localhost:3000 にアクセス。

### 5. データ捕捉の結合テスト（任意）

被験者フロー（逐次保存 `progress` / 感情 `emotions` / 最終保存 `process`）でデータが確実に
永続化され、`participantToken` の認可が効いていることを検証します。dev サーバー起動中に別シェルで:

```bash
npm run test:data
# プレビュー環境に対して実行する場合:
# BASE_URL=https://your-preview.vercel.app npm run test:data
```

PostgreSQL（サーバーと同じ DB）と最新スキーマ（`prisma db push` 済み）が前提です。
OPENAI_API_KEY 未設定でも実行可（AI 要約は失敗扱いでも文字起こし・感情は保存されます）。

---

## 使い方

### Step 1: インタビューテンプレートを作成

1. ダッシュボード → 「インタビュー作成」
2. タイトル・質問を入力、または「AI で自動生成」でトピックを入力するだけ

### Step 2: セッション（インタビューURL）を発行

1. 作成したテンプレートの「セッション作成」をクリック
2. 参加者名・メールを入力 → URL が発行される
3. URL を被験者に共有する

### Step 3: 被験者がインタビューに参加

1. 被験者がブラウザで URL を開く
2. カメラ・マイクを許可
3. 「インタビューを開始する」をクリック
4. AI が質問を読み上げ → 被験者が話す → 次の質問へ
5. 完了後、自動的に結果が処理される

### Step 4: 結果を確認

ダッシュボード → セッションをクリック：

- **文字起こしタブ**: AI サマリー・テーマ・会話ログ
- **表情エンゲージメント指標タブ**: 時系列グラフ・平均分布（参考・補助シグナル）
- **AI に質問タブ**: チャットで分析（「主な不満点は？」等）

---

## アーキテクチャ

```
src/
├── app/
│   ├── page.tsx                         # トップページ
│   ├── dashboard/page.tsx               # ダッシュボード
│   ├── dashboard/sessions/[id]/page.tsx # セッション詳細
│   ├── interview/[roomName]/page.tsx    # インタビュールーム（被験者用）
│   └── api/
│       ├── interviews/                  # テンプレート CRUD
│       ├── sessions/                    # セッション管理・URL発行
│       ├── sessions/[id]/process/       # 処理パイプライン（文字起こし＋AI分析）
│       ├── emotions/                    # 感情データ保存
│       └── agent/                       # AI Q&A
├── components/
│   ├── InterviewRoom.tsx                # ビデオ + AI 進行 + 感情収集
│   ├── AgentChat.tsx                    # AI エージェント チャット UI
│   ├── EmotionChart.tsx                 # 感情グラフ（Recharts）
│   ├── TranscriptView.tsx               # 文字起こし・サマリー表示
│   ├── CreateInterviewModal.tsx         # インタビュー作成モーダル
│   └── CreateSessionModal.tsx           # セッション作成・URL 発行モーダル
└── lib/
    ├── db.ts                            # Prisma クライアント（シングルトン）
    ├── daily.ts                         # Daily.co REST API ラッパー
    ├── ai.ts                            # OpenAI gpt-4o（分析・要約・Q&A・質問生成）
    ├── anthropic.ts                     # 互換シム（ai.ts を再エクスポート。新規利用は ai.ts を直接 import）
    ├── llm-safety.ts                    # プロンプトインジェクション対策（入力長制限・デリミタ）
    ├── blob.ts                          # 録画 Blob の署名付き URL 発行
    ├── api-auth.ts                      # 認証・認可（requireAuth / requireRole / participantToken）
    └── whisper.ts                       # OpenAI Whisper（録音ファイル文字起こし・現状未配線）
```

---

## API エンドポイント

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/interviews` | テンプレート一覧 |
| POST | `/api/interviews` | テンプレート作成（AI 自動生成オプションあり） |
| GET | `/api/interviews/[id]` | テンプレート詳細 |
| DELETE | `/api/interviews/[id]` | テンプレート削除 |
| GET | `/api/sessions` | セッション一覧 |
| POST | `/api/sessions` | セッション作成・URL 発行 |
| GET | `/api/sessions/[id]` | セッション詳細（文字起こし・感情含む） |
| PATCH | `/api/sessions/[id]` | ステータス更新（`status`, `recordingId`, `recordingUrl`） |
| GET | `/api/sessions/[id]/recording` | 録画の署名付き URL を発行（認証＋組織所有権） |
| POST | `/api/sessions/[id]/recording` | 録画のクライアント直アップロード用トークン発行（participantToken） |
| POST | `/api/sessions/[id]/transcribe` | 録画から Whisper で再文字起こし＋分析（認証＋組織所有権） |
| POST/DELETE | `/api/sessions/[id]/share` | 読み取り専用共有リンクの発行・失効（認証＋組織所有権） |
| POST | `/api/sessions/[id]/process` | 文字起こし・指標保存・AI 分析実行（participantToken or 認証） |
| POST | `/api/emotions` | 表情指標データ保存（participantToken・インタビュー中に呼び出し） |
| POST | `/api/agent` | AI エージェントへの質問（認証＋組織所有権） |
| DELETE | `/api/participants/[id]` | 被験者データの削除（DSR 対応・admin 権限） |

> 認可方針: ダッシュボード系 API は認証（`requireAuth`）＋組織所有権を要求。被験者フロー（未認証）はセッション作成時に発行する `participantToken` で自分のセッションに限定。

---

## 本番環境への展開

### データベース
本番・開発ともに PostgreSQL を使用します（`prisma/schema.prisma` の `provider = "postgresql"`）。

ビルド（`npm run build`）は **`prisma generate && next build`** で、**DB に接続しません**
（ビルド時に `db push` を実行すると Supabase プーラで `P1017 Server has closed the connection` を起こすため）。

> ⚠️ **スキーマを変更したら、デプロイ前に手動でスキーマ同期が必要です**：
> ```bash
> DATABASE_URL="<Session pooler 5432 の接続文字列>" npm run db:push
> ```
> （`Session pooler 5432` を使うこと。Transaction pooler 6543 は DDL に不向き。）

### ビデオ録画（Daily.co / Vercel Blob）
- `DAILY_API_KEY` を設定するとクラウド録画が有効化されます。
- 録画は Vercel Blob に**非公開（private）**で保存し、ダッシュボードからは短命の署名付き URL 経由でのみ再生します（`BLOB_READ_WRITE_TOKEN` が必要）。

### 表情エンゲージメント指標
ブラウザ内 face-api（`@vladmandic/face-api`）で表情を推定します。実際の感情とは異なる場合がある補助シグナルであり、
より高精度・サーバー側解析が必要な場合は AWS Rekognition / Azure Face API への差し替えを検討してください。

---

## 既知の制限・今後の課題

- [ ] Google Meet 連携（現状は独自 URL のみ）
- [ ] 表情エンゲージメント指標は表情推定ベースの補助シグナル（科学的に断定的な感情判定ではない）
- [x] ライブ文字起こしはブラウザ Speech Recognition（Chrome/Edge 中心）。録画から Whisper で再文字起こしする経路をダッシュボードに用意（`/api/sessions/[id]/transcribe`）
- [ ] 話者識別: ライブはAI/参加者を区別。Whisper 経路は diarization 非対応のため話者は「Unknown」（高精度な話者分離には Deepgram 等が必要）
- [ ] プロダクト分析は `lib/analytics.ts` の `track()` で主要イベントを計測（被験者ファネル等）。送信先ベンダーは未選定（既定は dev で console 出力、本番 no-op。`NEXT_PUBLIC_ANALYTICS_ENABLED=1` で有効化）
- [ ] AI エンドポイントのレート制限は未実装（インジェクション対策・入力長制限は実装済み）
- [x] 録画は Vercel Blob クライアント直アップロードで非公開保存（被験者ローカルDLはフォールバック）
- [ ] Next.js 16 + Turbopack は開発マシンへの負荷が高い場合あり  
  → `next dev --webpack` で Webpack モードに切り替え可
