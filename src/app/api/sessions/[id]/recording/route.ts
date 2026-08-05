import { NextRequest, NextResponse, after } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { prisma } from '@/lib/db'
import { requireAuth, requireParticipantToken, handleApiError } from '@/lib/api-auth'
import { createSignedBlobUrl } from '@/lib/blob'
import { reanalyzeFromRecording } from '@/lib/reanalyze-recording'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

export const runtime = 'nodejs'
// ユーザビリティテストは録画保存後に自動でWhisper再文字起こし＋AI分析を行う（after()）。
// その分の実行時間を確保する
export const maxDuration = 300

/** GET — 認可済みダッシュボード向けに録画の短命署名付き URL を発行する */
export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const session = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      select: { recordingUrl: true },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!session.recordingUrl) return NextResponse.json({ error: 'No recording' }, { status: 404 })
    const url = await createSignedBlobUrl(session.recordingUrl)
    return NextResponse.json({ url })
  } catch (err) {
    return handleApiError(err)
  }
}

/**
 * POST — Vercel Blob クライアント直アップロードのトークン発行ハンドラ。
 * ブラウザから直接 Blob ストレージへアップロードさせることで、サーバーレス関数の
 * 4.5MB ボディ制限を回避する。録画は顔・音声を含むため非公開（access:'private'）で保存し、
 * 認可は被験者の participantToken（clientPayload 経由）で行う。
 * 完了後 onUploadCompleted で recordingUrl を永続化する（本番では Vercel の Webhook で発火）。
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params
    if (!(await rateLimit(`recording:${id}:${getClientIp(request)}`, 20, 60))) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const body = (await request.json()) as HandleUploadBody

    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // clientPayload = participantToken。当該セッションの被験者本人のみアップロードを許可
        await requireParticipantToken(id, clientPayload)
        return {
          allowedContentTypes: ['video/webm'],
          addRandomSuffix: true,
          maximumSizeInBytes: 1024 * 1024 * 1024, // 1GB
          tokenPayload: id,
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const sessionId = tokenPayload ?? id
        const updated = await prisma.session.update({
          where: { id: sessionId },
          data: { recordingUrl: blob.url },
          select: { interview: { select: { type: true } } },
        })
        // ユーザビリティテストは、タスク中の思考発話がライブでは音量判定のみで
        // 文字化されない（useSilenceNudge）ため、録画の音声から拾い直さないと
        // 不満やつぶやきが分析対象に入らない。録画保存完了を機に自動で行う。
        // 参加者を待たせないよう after() でレスポンス送信後に実行する。
        if (updated.interview.type === 'usability') {
          after(() => reanalyzeFromRecording(sessionId).catch((err) => {
            console.error('録画からの自動文字起こしに失敗しました:', err)
          }))
        }
      },
    })

    return NextResponse.json(json)
  } catch (err) {
    return handleApiError(err)
  }
}
