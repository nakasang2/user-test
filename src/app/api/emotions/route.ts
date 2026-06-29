import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireParticipantToken, handleApiError } from '@/lib/api-auth'

function clamp(v: unknown): number {
  const n = typeof v === 'number' ? v : 0
  return Math.max(0, Math.min(1, n))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sessionId, timestamp } = body
    if (!sessionId || typeof timestamp !== 'number') {
      return NextResponse.json({ error: 'sessionId and timestamp are required' }, { status: 400 })
    }

    // 被験者フロー専用: 当該セッションの participantToken を要求する
    await requireParticipantToken(sessionId, req.headers.get('x-participant-token'))

    // 最終処理後（process が感情を全置換した後）の遅延書き込みは弾く
    const current = await prisma.session.findUnique({ where: { id: sessionId }, select: { status: true } })
    if (current && ['processing', 'done', 'completed'].includes(current.status)) {
      return NextResponse.json({ ok: true, skipped: true }, { status: 202 })
    }

    const emotion = await prisma.emotionResult.create({
      data: {
        sessionId,
        timestamp,
        happy: clamp(body.happy),
        sad: clamp(body.sad),
        angry: clamp(body.angry),
        fearful: clamp(body.fearful),
        disgusted: clamp(body.disgusted),
        surprised: clamp(body.surprised),
        neutral: clamp(body.neutral),
      },
    })

    return NextResponse.json(emotion, { status: 201 })
  } catch (err) {
    return handleApiError(err)
  }
}
