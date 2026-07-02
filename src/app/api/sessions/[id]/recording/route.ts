import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { put } from '@vercel/blob'
import { requireParticipant, handleApiError } from '@/lib/api-auth'

// リクエストボディをそのまま Vercel Blob にストリーミングするため
// Next.js のデフォルトのボディパーサーを無効化
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params
    await requireParticipant(request, id)

    const session = await prisma.session.findUnique({ where: { id }, select: { id: true } })
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    if (!request.body) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400 })
    }

    // リクエストボディ（動画バイナリ）を Vercel Blob にストリーミングアップロード
    // @vercel/blob サーバーサイド put() はボディをそのまま Blob ストレージに流すため
    // サーバーレス関数の 4.5MB ボディ制限を回避できる
    const { url } = await put(`recordings/${id}.webm`, request.body, {
      access: 'public',
      contentType: 'video/webm',
      allowOverwrite: true,
    })

    await prisma.session.update({
      where: { id },
      data: { recordingUrl: url },
    })

    return NextResponse.json({ ok: true, url })
  } catch (err) {
    return handleApiError(err)
  }
}
