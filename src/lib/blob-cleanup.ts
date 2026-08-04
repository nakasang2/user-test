import { del } from '@vercel/blob'

/**
 * DB 行を消す前に、紐づく Blob（録画・質問画像）を削除するためのヘルパー。
 *
 * このリポジトリには用途が異なる2つの Blob ストアがある。
 * - 録画: 既定ストア（private）。process.env.BLOB_READ_WRITE_TOKEN
 * - 質問画像・全体刺激画像: 公開ストア（public）。process.env.PUBLIC_IMAGES_READ_WRITE_TOKEN
 *   （録画用ストアは private 設定で作成されており public な blob を作れないため分離した。
 *   DECISIONS.md「2026-08-03 質問画像アップロードが失敗する問題」参照）
 * 誤った方のトークンで del() すると失敗するので、ホスト名からどちらのストアか判定する。
 *
 * ユーザーが「URLで指定」で貼った外部の画像URL（このストアの外にあるもの）は、
 * 所有していないリソースなので削除しない。
 */
export async function deleteOwnedBlob(url: string | null | undefined): Promise<void> {
  if (!url) return
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return
  }
  if (hostname.endsWith('.public.blob.vercel-storage.com')) {
    await del(url, { token: process.env.PUBLIC_IMAGES_READ_WRITE_TOKEN })
  } else if (hostname.endsWith('.private.blob.vercel-storage.com') || hostname.endsWith('.blob.vercel-storage.com')) {
    await del(url) // 既定トークン（BLOB_READ_WRITE_TOKEN）
  }
  // それ以外（外部URL）は何もしない
}

/**
 * 複数の Blob をまとめて削除する。1件でも失敗したら例外を投げて呼び出し側に中断させる
 * （DB 行を消してしまうと URL が分からなくなり、二度と消せなくなるため）。
 */
export async function deleteOwnedBlobs(urls: (string | null | undefined)[]): Promise<void> {
  for (const url of urls) {
    await deleteOwnedBlob(url)
  }
}
