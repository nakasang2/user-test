import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireParticipantToken, handleApiError } from '@/lib/api-auth'

/**
 * POST /api/sessions/[id]/progress — インタビュー進行中の逐次保存（被験者フロー）。
 * AI 分析は行わず、現時点の文字起こし（fullText + セグメント）を保存するだけの軽量版。
 * 被験者が途中で離脱しても、ここまでのデータが残るようにするための保険。
 * 最終的な要約・sentiment は終了時の /process が上書きする。
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await props.params
    await requireParticipantToken(id, req.headers.get('x-participant-token'))

    const body = await req.json()
    const { transcript: transcriptText, segments } = body
    if (typeof transcriptText !== 'string' || !Array.isArray(segments)) {
      return NextResponse.json({ error: 'transcript and segments are required' }, { status: 400 })
    }

    const transcript = await prisma.transcript.upsert({
      where: { sessionId: id },
      create: { sessionId: id, fullText: transcriptText },
      update: { fullText: transcriptText },
    })

    // セグメントを全置換（AI 分析・sentiment は付与しない）
    await prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } })
    await prisma.transcriptSegment.createMany({
      data: (segments as { speaker: string; text: string; start: number; end: number }[]).map((seg) => ({
        transcriptId: transcript.id,
        speaker: seg.speaker,
        text: seg.text,
        startTime: seg.start,
        endTime: seg.end ?? seg.start,
      })),
    })

    // 進行中であることを記録（pending のままにしない）
    await prisma.session.update({ where: { id }, data: { status: 'active' } }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err)
  }
}
