# UserVoice — ユーザーインタビュー自動化ツール

インタビュアー不在でユーザーインタビューを自動実施。AI が進行・感情分析・文字起こし・分析まで一気通貫で行います。

---

## 機能概要

| 機能 | 説明 |
|------|------|
| 🎥 ビデオ会議 | URL を共有するだけで被験者がブラウザから参加 |
| 🤖 AI インタビュアー | 設定した質問を Web Speech API (TTS) で自動読み上げ・進行 |
| 🎙️ 音声認識 | ブラウザの Speech Recognition API でリアルタイム文字起こし |
| 😊 表情・感情分析 | カメラ映像からリアルタイムで感情データを収集（5秒間隔） |
| 📝 AI サマリー | Claude がインタビュー全体を要約・テーマ抽出 |
| 📊 ダッシュボード | 被験者ごとの文字起こし・感情グラフを一覧表示 |
| 💬 AI エージェント | 「誰が最も困惑していた？」などを自然言語で質問・回答 |

---

## 技術スタック

- **フレームワーク**: Next.js 16 (App Router, Turbopack)
- **言語**: TypeScript
- **DB**: SQLite (Prisma ORM) → 本番では PostgreSQL を推奨
- **ビデオ**: [Daily.co](https://daily.co) REST API（オプション）
- **AI 文字起こし**: OpenAI Whisper API（録音ファイルがある場合）
- **AI 分析**: Anthropic Claude API (`claude-sonnet-4-6`)
- **感情分析**: ブラウザ内でシミュレーション（本番は AWS Rekognition / Azure Face API へ差し替え可）
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
# 絶対パスで指定すること（Turbopack のワークスペース検出対策）
DATABASE_URL="file:///absolute/path/to/user-interview-tool/prisma/dev.db"
DAILY_API_KEY="your_daily_co_api_key"       # オプション（未設定でも動作）
ANTHROPIC_API_KEY="your_anthropic_api_key"   # AI 分析・Q&A に必要
OPENAI_API_KEY="your_openai_api_key"         # Whisper 文字起こしに必要
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

http://localhost:3000 にアクセス。

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
- **感情分析タブ**: 時系列グラフ・平均感情分布
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
    ├── anthropic.ts                     # Claude API（分析・Q&A・質問生成）
    └── whisper.ts                       # OpenAI Whisper（録音ファイル文字起こし）
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
| POST | `/api/sessions/[id]/process` | 文字起こし・感情データ保存・AI 分析実行 |
| POST | `/api/emotions` | 感情データ保存（インタビュー中に自動呼び出し） |
| POST | `/api/agent` | AI エージェントへの質問 |

---

## 本番環境への展開

### データベース
SQLite → PostgreSQL へ変更：

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### ビデオ録画（Daily.co）
`DAILY_API_KEY` を設定すると：
- クラウド録画が自動で有効化
- 録画完了後に `/api/sessions/[id]/process` を Webhook で呼び出し、Whisper で文字起こし

### 感情分析の精度向上
`InterviewRoom.tsx` の `simulateEmotionDetection()` を以下に差し替え：
- **AWS Rekognition**: `DetectFaces` API でフレームごとに解析
- **Azure Face API**: `Face - Detect` API
- **face-api.js**: ブラウザ内 ML（サーバー不要・プライバシー重視の場合）

---

## 既知の制限・今後の課題

- [ ] Google Meet 連携（現状は独自 URL のみ）
- [ ] 感情分析は現状シミュレーション → 本番 API への差し替えが必要
- [ ] Whisper 文字起こしは Daily.co の録音ファイルダウンロード後に動作
- [ ] 話者識別は「Interviewer / Participant」の2者固定（diarization 未実装）
- [ ] 認証・アクセス制御なし（本番前に要追加）
- [ ] Next.js 16 + Turbopack は開発マシンへの負荷が高い場合あり  
  → `next dev --webpack` で Webpack モードに切り替え可
