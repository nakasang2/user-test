import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { analyzeTranscript } from '@/lib/ai'

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const body = await req.json()
  const { transcript: transcriptText, segments, emotions: emotionData } = body

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

  const transcript = await prisma.transcript.upsert({
    where: { sessionId: id },
    create: {
      sessionId: id,
      fullText: transcriptText,
      summary,
      themes,
      segments: {
        create: segments.map((seg: { speaker: string; text: string; start: number; end: number; sentiment?: string }) => ({
          speaker: seg.speaker,
          text: seg.text,
          startTime: seg.start,
          endTime: seg.end,
          sentiment: seg.sentiment ?? sentiment,
        })),
      },
    },
    update: {
      fullText: transcriptText,
      summary,
      themes,
    },
  })

  if (emotionData && emotionData.length > 0) {
    await prisma.emotionResult.deleteMany({ where: { sessionId: id } })
    await prisma.emotionResult.createMany({
      data: emotionData.map((e: Record<string, number>) => ({
        sessionId: id,
        timestamp: e.timestamp,
        happy: e.happy ?? 0,
        sad: e.sad ?? 0,
        angry: e.angry ?? 0,
        fearful: e.fearful ?? 0,
        disgusted: e.disgusted ?? 0,
        surprised: e.surprised ?? 0,
        neutral: e.neutral ?? 0,
      })),
    })
  }

  await prisma.session.update({
    where: { id },
    data: { status: 'done' },
  })

  return NextResponse.json({ transcript, ok: true })
}
