import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { analyzeTranscript } from '@/lib/ai'
import { requireAuth, requireParticipant, handleApiError, AuthError } from '@/lib/api-auth'

const bodySchema = z.object({
  transcript: z.string().max(500_000),
  segments: z.array(z.object({
    speaker:   z.string().max(50),
    text:      z.string().max(20_000),
    start:     z.number(),
    end:       z.number(),
    sentiment: z.string().max(50).optional(),
  })).max(5_000).default([]),
  // 感情データはダッシュボードの再分析時に DB 行がそのまま渡ってくるため、緩く受けて数値のみ拾う
  emotions: z.array(z.record(z.string(), z.unknown())).max(50_000).optional(),
})

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * 被験者トークン（当該セッション限定）またはログイン済みメンバー（自組織のセッションのみ）
 * のどちらかで認可する。process は被験者の結果送信とダッシュボードの再分析の両方から呼ばれる。
 */
async function authorize(req: NextRequest, sessionId: string) {
  if (req.headers.get('x-session-token')) {
    await requireParticipant(req, sessionId)
    return
  }
  const { orgId } = await requireAuth()
  const session = await prisma.session.findFirst({
    where: { id: sessionId, interview: { organizationId: orgId } },
    select: { id: true },
  })
  if (!session) throw new AuthError()
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params
    await authorize(req, id)

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { transcript: transcriptText, segments, emotions: emotionData } = parsed.data

    const session = await prisma.session.findUnique({
      where: { id },
      include: { interview: { include: { questions: true } } },
    })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.session.update({
      where: { id },
      data: { status: 'processing' },
    })

    const questions = session.interview.questions.map((q) => q.text)
    let summary = ''
    let themes = ''
    let sentiment = 'neutral'
    try {
      const result = await analyzeTranscript(transcriptText, questions)
      summary = result.summary
      themes = result.themes
      sentiment = result.sentiment
    } catch (err) {
      console.error('analyzeTranscript failed:', err)
      summary = '分析に失敗しました。'
    }

    // 逐次保存で作られたドラフトを最終データで置き換える（segments も毎回作り直す）
    const transcript = await prisma.$transaction(async (tx) => {
      const t = await tx.transcript.upsert({
        where: { sessionId: id },
        create: { sessionId: id, fullText: transcriptText, summary, themes },
        update: { fullText: transcriptText, summary, themes },
      })
      await tx.transcriptSegment.deleteMany({ where: { transcriptId: t.id } })
      if (segments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: segments.map((seg) => ({
            transcriptId: t.id,
            speaker:      seg.speaker,
            text:         seg.text,
            startTime:    seg.start,
            endTime:      seg.end,
            sentiment:    seg.sentiment ?? sentiment,
          })),
        })
      }
      return t
    })

    if (emotionData && emotionData.length > 0) {
      await prisma.emotionResult.deleteMany({ where: { sessionId: id } })
      await prisma.emotionResult.createMany({
        data: emotionData.map((e) => ({
          sessionId: id,
          timestamp: num(e.timestamp),
          happy:     num(e.happy),
          sad:       num(e.sad),
          angry:     num(e.angry),
          fearful:   num(e.fearful),
          disgusted: num(e.disgusted),
          surprised: num(e.surprised),
          neutral:   num(e.neutral),
        })),
      })
    }

    await prisma.session.update({
      where: { id },
      data: { status: 'done' },
    })

    return NextResponse.json({ transcript, ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
