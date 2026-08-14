import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

/**
 * サードパーティのOAuthリフレッシュトークンなど、平文のままDBに置きたくない
 * 値を暗号化して保存するための汎用ヘルパー。
 *
 * passwordHash と違ってトークンは復号して使う必要があるためハッシュ化はできない。
 * DBが漏えいしても TOKEN_ENCRYPTION_KEY（DBとは別の場所＝Vercelの環境変数）が
 * 無ければ復号できない、という一段の防御にする。
 */
const ALGO = 'aes-256-gcm'

function getKey(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) return null
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) return null
  return key
}

export function isTokenEncryptionConfigured(): boolean {
  return getKey() !== null
}

export function encryptSecret(plain: string): string {
  const key = getKey()
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is not configured')
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // iv.tag.暗号文 をそれぞれ base64 にしてドットで連結（1カラムに収める）
  return [iv, tag, encrypted].map((b) => b.toString('base64')).join('.')
}

export function decryptSecret(payload: string): string {
  const key = getKey()
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY is not configured')
  const [ivB64, tagB64, dataB64] = payload.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Invalid encrypted payload')
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
