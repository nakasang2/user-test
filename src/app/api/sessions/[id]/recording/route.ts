import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { put } from '@vercel/blob'
import { requireAuth, requireParticipantToken, handleApiError } from '@/lib/api-auth'
import { createSignedBlobUrl } from '@/lib/blob'

// リクエストボディをそのまま Vercel Blob にストリーミングするため
// Next.js のデフォルトのボディパーサーを無効化
export const runtime = 'nodejs'

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

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params
    await requireParticipantToken(id, request.headers.get('x-participant-token'))

    const session = await prisma.session.findUnique({ where: { id } })
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    // リクエストボディ（動画バイナリ）を Vercel Blob にストリーミングアップロード。
    // 録画は顔・音声を含むため access:'public' は使わず非公開（access:'private'）で保存し、
    // 閲覧は認可済みダッシュボード経由で署名付き URL を発行して行う。
    const { url } = await put(`recordings/${id}.webm`, request.body!, {
      access: 'private',
      contentType: 'video/webm',
      addRandomSuffix: true,
    })

    await prisma.session.update({
      where: { id },
      data: { recordingUrl: url },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
