import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { del } from '@vercel/blob'
import { requireAuth, requireParticipant, handleApiError } from '@/lib/api-auth'

/** GET /api/sessions/[id] — セッション詳細（ダッシュボード用・要ログイン + 自組織のみ） */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json(session)
  } catch (err) {
    return handleApiError(err)
  }
}

// 被験者が PATCH できるステータス遷移のみ許可する
const PARTICIPANT_STATUSES = ['active', 'completed'] as const

/** PATCH /api/sessions/[id] — ステータス更新（被験者トークン必須） */
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params
    await requireParticipant(req, id)
    const body = await req.json()

    const status = body.status
    if (typeof status !== 'string' || !PARTICIPANT_STATUSES.includes(status as typeof PARTICIPANT_STATUSES[number])) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const session = await prisma.session.update({
      where: { id },
      data: { status },
      select: { id: true, status: true },
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
