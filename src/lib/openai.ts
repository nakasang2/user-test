import OpenAI from 'openai'

// ビルド時のモジュール評価でキーエラーが出ないよう遅延初期化し、以降は使い回す
let client: OpenAI | null = null

/** OpenAI クライアントを取得する（シングルトン） */
export function getOpenAI(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return client
}
