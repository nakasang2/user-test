import { z } from 'zod'

/**
 * 環境変数のスキーマ。必須項目が欠けている場合は起動時/初回アクセス時に明示的に失敗させる。
 * 任意項目（AI・録画・ビデオ）は未設定でもアプリは起動し、該当機能のみ無効化される。
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  OPENAI_API_KEY: z.string().optional(),
  DAILY_API_KEY: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().optional(),
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
  if (!process.env.DAILY_API_KEY) missing.push('DAILY_API_KEY（Daily.co クラウド録画が無効）')
  if (missing.length) console.warn('[env] 任意の環境変数が未設定:', missing.join(' / '))
}
