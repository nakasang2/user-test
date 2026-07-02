import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireParticipant, handleApiError } from '@/lib/api-auth'

const bodySchema = z.object({
  transcript: z.string().max(500_000),
  segments: z.array(z.object({
    speaker: z.string().max(50),
    text:    z.string().max(20_000),
    start:   z.number(),
    end:     z.number(),
  })).max(5_000),
})

/**
 * POST /api/sessions/[id]/transcript — インタビュー進行中の逐次保存（被験者トークン必須）
 *
 * 途中離脱・クラッシュでもそれまでの会話が残るよう、回答のたびにドラフトを上書き保存する。
 * AI 分析やステータス変更は行わない（最終確定は /process が行う）。
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params
    await requireParticipant(req, id)

    const parsed = bodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const session = await prisma.session.findUnique({ where: { id }, select: { id: true } })
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.$transaction(async (tx) => {
      const t = await tx.transcript.upsert({
        where: { sessionId: id },
        create: { sessionId: id, fullText: parsed.data.transcript },
        update: { fullText: parsed.data.transcript },
      })
      await tx.transcriptSegment.deleteMany({ where: { transcriptId: t.id } })
      if (parsed.data.segments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: parsed.data.segments.map((s) => ({
            transcriptId: t.id,
            speaker:      s.speaker,
            text:         s.text,
            startTime:    s.start,
            endTime:      s.end,
          })),
        })
      }
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
