import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { put } from '@vercel/blob'

// リクエストボディをそのまま Vercel Blob にストリーミングするため
// Next.js のデフォルトのボディパーサーを無効化
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id } = await props.params

  const session = await prisma.session.findUnique({ where: { id } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // リクエストボディ（動画バイナリ）を Vercel Blob にストリーミングアップロード
  // @vercel/blob サーバーサイド put() はボディをそのまま Blob ストレージに流すため
  // サーバーレス関数の 4.5MB ボディ制限を回避できる
  const { url } = await put(`recordings/${id}.webm`, request.body!, {
    access: 'public',
    contentType: 'video/webm',
  })

  await prisma.session.update({
    where: { id },
    data: { recordingUrl: url },
  })

  return NextResponse.json({ ok: true, url })
}
