import { z } from 'zod'

/**
 * 環境変数のスキーマ。必須項目が欠けている場合は起動時/初回アクセス時に明示的に失敗させる。
 * 任意項目（AI・録画・ビデオ）は未設定でもアプリは起動し、該当機能のみ無効化される。
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  OPENAI_API_KEY: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // 質問画像専用の公開Blobストア用トークン。既定ストアは private 設定で
  // public な blob を作れないため分離している（詳細: api/uploads/question-image/route.ts）
  PUBLIC_IMAGES_READ_WRITE_TOKEN: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
  // スライド資料の自動生成（Googleアカウント連携）用。未設定なら接続ボタンは出るが失敗する
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  // Googleの refresh token を暗号化してDBに保存するための鍵（base64・32バイト）。
  // 未設定だと Google 連携機能自体を無効化する（平文保存はしない）
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
})

type Env = z.infer<typeof schema>

let cached: Env | null = null

/** 検証済みの環境変数を取得する（初回に検証し、以降はキャッシュ） */
export function getEnv(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env)
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join(', ')
      throw new Error(`Invalid environment variables: ${msg}`)
    }
    cached = parsed.data
  }
  return cached
}

/** 起動時に必須 env を検証し、任意項目の未設定は警告する */
export function validateEnv(): void {
  getEnv()
  const missing: string[] = []
  if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY（AI 分析・要約・TTS・Whisper が無効）')
  if (!process.env.BLOB_READ_WRITE_TOKEN) missing.push('BLOB_READ_WRITE_TOKEN（録画の保存・配信が無効）')
  if (!process.env.PUBLIC_IMAGES_READ_WRITE_TOKEN) missing.push('PUBLIC_IMAGES_READ_WRITE_TOKEN（質問画像のアップロードが無効）')
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    missing.push('UPSTASH_REDIS_REST_URL/TOKEN（レート制限がインメモリ＝サーバーレスでは不完全）')
  }
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    missing.push('GOOGLE_OAUTH_CLIENT_ID/SECRET（スライド資料生成のGoogleアカウント連携が無効）')
  }
  if (!process.env.TOKEN_ENCRYPTION_KEY) {
    missing.push('TOKEN_ENCRYPTION_KEY（Google連携のトークン暗号化ができないため機能を無効化）')
  }
  if (missing.length) console.warn('[env] 任意の環境変数が未設定:', missing.join(' / '))
}
