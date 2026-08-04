import { prisma } from '@/lib/db'
import { deleteOwnedBlobs } from '@/lib/blob-cleanup'

/**
 * インタビュー1件を削除する。配下のセッション録画・全体刺激画像・質問ごとの画像を
 * すべて Blob ストレージから削除してから DB 行を消す（DB のカスケード削除は
 * Blob までは届かないため）。1件でも Blob 削除に失敗したら中断する
 * （DB を消してしまうと URL が分からなくなり、二度と消せなくなるため）。
 *
 * 単体削除（DELETE /api/interviews/[id]）・一括削除（bulk-delete）の両方から呼ぶ。
 * 呼び出し側で組織所有権（organizationId）を確認済みの orgId を渡すこと。
 */
export async function deleteInterviewWithBlobs(
  id: string,
  orgId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const interview = await prisma.interview.findFirst({
    where: { id, organizationId: orgId },
    select: {
      id: true,
      stimulusUrl: true,
      sessions: { select: { recordingUrl: true } },
      questions: { select: { imageUrl: true } },
    },
  })
  if (!interview) return { ok: false, error: 'Not found' }

  const urls = [
    interview.stimulusUrl,
    ...interview.sessions.map((s) => s.recordingUrl),
    ...interview.questions.map((q) => q.imageUrl),
  ]

  try {
    await deleteOwnedBlobs(urls)
  } catch (e) {
    console.error('Blob deletion failed (aborting interview delete):', e)
    return { ok: false, error: '録画・画像データの削除に失敗したため、中断しました。時間をおいて再度お試しください。' }
  }

  await prisma.interview.delete({ where: { id } })
  return { ok: true }
}

/**
 * セッション1件を削除する。録画を Blob ストレージから削除してから DB 行を消す。
 * こちらは既存の単体削除と同じく、Blob 削除の失敗をログに残すだけで処理は続行する
 * （セッション単位は影響範囲が小さく、参加者側の理由で削除したい操作を
 * ストレージの一時的な不調でブロックしたくないため）。
 */
export async function deleteSessionWithBlob(id: string, orgId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await prisma.session.findFirst({
    where: { id, interview: { organizationId: orgId } },
    select: { recordingUrl: true },
  })
  if (!session) return { ok: false, error: 'Not found' }

  try {
    await deleteOwnedBlobs([session.recordingUrl])
  } catch (e) {
    console.error('Blob deletion failed (continuing):', e)
  }

  await prisma.session.delete({ where: { id } })
  return { ok: true }
}
