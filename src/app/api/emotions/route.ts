import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireParticipant, AuthError, ForbiddenError, handleApiError } from '@/lib/api-auth'

function clamp(v: unknown): number {
  const n = typeof v === 'number' ? v : 0
  return Math.max(0, Math.min(1, n))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sessionId, timestamp } = body
    if (typeof sessionId !== 'string' || typeof timestamp !== 'number') {
      return NextResponse.json({ error: 'sessionId and timestamp are required' }, { status: 400 })
    }
    // トークンが対象セッション専用であることを検証（他セッションへのデータ混入を防ぐ）
    await requireParticipant(req, sessionId)

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
    if (err instanceof AuthError || err instanceof ForbiddenError) return handleApiError(err)
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
