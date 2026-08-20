import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { prisma } from '@/lib/db'
import { requireRole, handleApiError } from '@/lib/api-auth'
import { deleteOwnedBlob } from '@/lib/blob-cleanup'

export const runtime = 'nodejs'

/**
 * POST — 調査者が手元の録画ファイルをアップロードするためのトークン発行ハンドラ。
 *
 * 参加者側のアップロードが失敗したセッション（通信断・容量オーバー等）では、
 * 参加者が完了画面からダウンロードしたファイルを受け取って共有してもらうことがある。
 * それをダッシュボードから登録できるようにする。
 *
 * 参加者用（`../route.ts` の POST）とは**認可の経路が違う**ため、あえて別ルートに
 * 分けている。同じルートで両方を受けると、参加者トークンの検証を緩めることになり、
 * 他人のセッションへ書き込める穴を作りやすい。
 *
 * ⚠️ 認可は必ず `onBeforeGenerateToken` の中で行う。
 *    このルートは2種類のリクエストを受ける:
 *      1. ブラウザからのトークン発行要求（Cookie あり）
 *      2. アップロード完了通知（Vercel Blob からのサーバー間 POST。**Cookie は無い**）
 *    ハンドラの外で `requireAuth()` すると 2 が必ず 401 になり、
 *    `onUploadCompleted` が一度も実行されない（＝保存されない）。
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params
    const body = (await request.json()) as HandleUploadBody

    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // 閲覧のみのメンバーに既存の録画を差し替えさせない（削除と同じ権限に揃える）
        const { orgId } = await requireRole('editor')
        // 自組織のセッションであることを確かめる（他組織のセッションに書き込めないように）
        const session = await prisma.session.findFirst({
          where: { id, interview: { organizationId: orgId } },
          select: { id: true },
        })
        if (!session) throw new Error('Not found')
        // 任意のパスへ書き込めないようにする（録画の置き場所に限定する）
        if (!pathname.startsWith(`recordings/${id}`)) {
          throw new Error('invalid pathname')
        }
        return {
          // 参加者の録画と同じ形式に揃える。再生・Whisper 文字起こしの経路を
          // 共通にするため、他の形式は受け付けない（lib/whisper.ts は webm 前提）
          allowedContentTypes: ['video/webm'],
          addRandomSuffix: true,
          maximumSizeInBytes: 1024 * 1024 * 1024, // 1GB
          tokenPayload: id,
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const sessionId = tokenPayload ?? id
        const before = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { recordingUrl: true },
        })
        await prisma.session.update({
          where: { id: sessionId },
          data: { recordingUrl: blob.url },
        })
        // 差し替えた場合、元の録画は参照を失う。放置すると顔・音声を含む Blob が
        // 削除経路（セッション削除・被験者の削除請求）から永久に漏れるため、ここで消す
        if (before?.recordingUrl && before.recordingUrl !== blob.url) {
          try {
            await deleteOwnedBlob(before.recordingUrl)
          } catch (e) {
            console.error('差し替え前の録画の削除に失敗しました:', e)
          }
        }
      },
    })

    return NextResponse.json(json)
  } catch (err) {
    return handleApiError(err)
  }
}
