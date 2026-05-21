import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'

/**
 * POST /api/sessions/[id]/recording
 *
 * @vercel/blob のクライアントアップロード用ハンドラ。
 * 1. ブラウザが handleUploadUrl に clientPayload を POST → アップロード用トークンを返す
 * 2. ブラウザが Vercel Blob へ直接アップロード
 * 3. Vercel Blob が onUploadCompleted を呼び出す → DB に recordingUrl を保存
 *
 * この方式を採ることで Vercel サーバーレス関数の 4.5 MB ボディ制限を回避できる。
 */
export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await props.params

  const session = await prisma.session.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const body = (await request.json()) as HandleUploadBody

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        // 全 webm 系 MIME タイプを許可（vp9/vp8 コーデック指定も含む）
        allowedContentTypes: ['video/webm', 'audio/webm'],
        tokenPayload: JSON.stringify({ sessionId: id }),
      }),
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const { sessionId } = JSON.parse(tokenPayload ?? '{}') as { sessionId: string }
        await prisma.session.update({
          where: { id: sessionId },
          data: { recordingUrl: blob.url },
        })
      },
    })
    return NextResponse.json(jsonResponse)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
