import { google } from 'googleapis'
import { prisma } from '@/lib/db'
import { encryptSecret, decryptSecret, isTokenEncryptionConfigured } from './token-crypto'

/**
 * スライド資料の自動生成用。サービスアカウント（会社の共有ドライブ）方式ではなく、
 * 利用者ごとに自分のGoogleアカウントをOAuthで接続する方式にしている。
 * 生成したスライドは接続した本人のGoogle Driveに保存されるため、
 * 特定組織（HJ）の環境に依存せず、誰でも自分のアカウントで使える。
 */

// アプリが作成したファイルのみにアクセス（drive.file）。Drive全体への広い権限は要求しない
export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
]

/** クライアントID/シークレットに加え、トークン暗号化鍵も揃っているかを見る（平文保存はしない前提のため） */
export function isGoogleOAuthConfigured(): boolean {
  return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET && isTokenEncryptionConfigured())
}

function getRedirectUri(origin: string): string {
  // Google 側には本番URLしか登録していないため、常に本番URLを使う
  // （プレビューデプロイ等の別オリジンでは Google がリダイレクトURI不一致で弾く＝想定内）
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? origin).replace(/\/+$/, '')
  return `${base}/api/auth/google/callback`
}

export function createOAuthClient(origin: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri(origin))
}

export function buildAuthUrl(origin: string, state: string): string | null {
  if (!isGoogleOAuthConfigured()) return null
  const client = createOAuthClient(origin)
  if (!client) return null
  return client.generateAuthUrl({
    access_type: 'offline', // refresh_token をもらうために必須
    prompt: 'consent', // 再接続時にも毎回 refresh_token を発行させる
    scope: GOOGLE_OAUTH_SCOPES,
    state,
  })
}

/**
 * 認可コードをトークンに交換し、本人のメールアドレスと合わせて返す。
 * refresh_token はここで暗号化する（呼び出し側は平文を扱わない）
 */
export async function exchangeCodeForTokens(origin: string, code: string) {
  if (!isGoogleOAuthConfigured()) throw new Error('Google OAuth is not configured')
  const client = createOAuthClient(origin)
  if (!client) throw new Error('Google OAuth is not configured')
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    // prompt=consent を付けているので通常は発行されるが、
    // 同一ブラウザで直近に同意済みだと省略されることがある
    throw new Error('refresh_token を取得できませんでした。もう一度接続をお試しください')
  }
  client.setCredentials(tokens)
  const oauth2 = google.oauth2({ auth: client, version: 'v2' })
  const { data } = await oauth2.userinfo.get()
  return { encryptedRefreshToken: encryptSecret(tokens.refresh_token), email: data.email ?? null }
}

/**
 * 指定ユーザーの Google 認可済みクライアントを返す。未接続なら null。
 * アクセストークンは呼び出しのたびに refresh_token から取り直す
 * （DBに保存しているのは暗号化した refresh_token のみ。有効期限管理が要らずシンプル）
 */
export async function getAuthorizedClientForUser(userId: string, origin: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleRefreshToken: true },
  })
  if (!user?.googleRefreshToken) return null
  const client = createOAuthClient(origin)
  if (!client) return null
  client.setCredentials({ refresh_token: decryptSecret(user.googleRefreshToken) })
  return client
}
