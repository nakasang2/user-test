import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { del } from '@vercel/blob'
import { requireAuth, requireParticipantToken, handleApiError } from '@/lib/api-auth'

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params
    const session = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      include: {
        interview: { include: { questions: { orderBy: { order: 'asc' } } } },
        participant: true,
        transcript: { include: { segments: true } },
        emotions: { orderBy: { timestamp: 'asc' } },
      },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // 被験者フローの書き込み資格情報・共有トークンはダッシュボードに返さない
    const { participantToken: _pt, shareToken: _st, ...safe } = session
    void _pt; void _st
    return NextResponse.json(safe)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params
    const body = await req.json()

    // 認可: 被験者フロー（participantToken）は status のみ更新可。
    // それ以外（recordingId/recordingUrl）はダッシュボードの認証＋組織所有権を要求する。
    const participantToken = req.headers.get('x-participant-token')
    const wantsRestrictedFields =
      typeof body.recordingId === 'string' || typeof body.recordingUrl === 'string'

    if (!wantsRestrictedFields && participantToken) {
      await requireParticipantToken(id, participantToken)
    } else {
      const { orgId } = await requireAuth()
      const owned = await prisma.session.findFirst({
        where: { id, interview: { organizationId: orgId } },
        select: { id: true },
      })
      if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // 許可されたフィールドのみ更新（マスアサインメント攻撃対策）
    const allowed: Record<string, string | undefined> = {}
    if (typeof body.status === 'string') allowed.status = body.status
    if (typeof body.recordingId === 'string') allowed.recordingId = body.recordingId
    if (typeof body.recordingUrl === 'string') allowed.recordingUrl = body.recordingUrl

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const session = await prisma.session.update({
      where: { id },
      data: allowed,
      include: {
        interview: { include: { questions: { orderBy: { order: 'asc' } } } },
        participant: true,
      },
    })
    return NextResponse.json(session)
  } catch (err) {
    return handleApiError(err)
  }
}

export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { orgId } = await requireAuth()
    const { id } = await props.params

    const session = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      select: { recordingUrl: true },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (session.recordingUrl) {
      try { await del(session.recordingUrl) } catch (e) {
        console.error('Blob deletion failed (continuing):', e)
      }
    }

    await prisma.session.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
