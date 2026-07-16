import { issueSignedToken, presignUrl } from '@vercel/blob'

/**
 * 非公開（access:'private'）で保存した録画 Blob に対し、短命の署名付き GET URL を生成する。
 * 録画は顔・音声を含むため公開 URL では配信せず、認可済みダッシュボードからこの関数で
 * 一時 URL を発行して再生する。
 */
export async function createSignedBlobUrl(blobUrl: string, ttlMs = 5 * 60 * 1000): Promise<string> {
  const pathname = new URL(blobUrl).pathname.replace(/^\/+/, '')
  const validUntil = Date.now() + ttlMs
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil })
  const { presignedUrl } = await presignUrl(token, {
    operation: 'get',
    access: 'private',
    pathname,
    validUntil,
  })
  return presignedUrl
}
