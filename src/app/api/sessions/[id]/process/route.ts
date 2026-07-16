import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { analyzeTranscript } from '@/lib/ai'
import { requireAuth, requireParticipantToken, handleApiError } from '@/lib/api-auth'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
 try {
  const { id } = await props.params
  if (!(await rateLimit(`process:${id}:${getClientIp(req)}`, 10, 60))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // 二経路認可: 被験者フローは participantToken、ダッシュボードの再分析は認証＋組織所有権
  const participantToken = req.headers.get('x-participant-token')
  if (participantToken) {
    await requireParticipantToken(id, participantToken)
  } else {
    const { orgId } = await requireAuth()
    const owned = await prisma.session.findFirst({
      where: { id, interview: { organizationId: orgId } },
      select: { id: true },
    })
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const { transcript: transcriptText, segments, emotions: emotionData } = body

  if (typeof transcriptText !== 'string' || !Array.isArray(segments)) {
    return NextResponse.json({ error: 'transcript and segments are required' }, { status: 400 })
  }

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
  // 発言の時刻 [mm:ss] を含むトランスクリプトを組み立て、AI 要約が根拠を引用できるようにする
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  const timestampedTranscript = (segments as { speaker: string; text: string; start: number }[])
    .map((s) => `[${fmt(s.start ?? 0)}] ${s.speaker}: ${s.text}`)
    .join('\n') || transcriptText
  let summary = ''
  let themes = ''
  let sentiment = 'neutral'
  try {
    const result = await analyzeTranscript(timestampedTranscript, questions)
    summary = result.summary
    themes = result.themes
    sentiment = result.sentiment
  } catch (err) {
    console.error('analyzeTranscript failed:', err)
    summary = '分析に失敗しました。'
  }

  // インクリメンタル保存で既にトランスクリプトが存在し得るため、upsert 後に
  // セグメントを常に「全置換」して最終結果（sentiment 付き）を確実に反映する。
  const transcript = await prisma.transcript.upsert({
    where: { sessionId: id },
    create: { sessionId: id, fullText: transcriptText, summary, themes },
    update: { fullText: transcriptText, summary, themes },
  })
  await prisma.$transaction([
    prisma.transcriptSegment.deleteMany({ where: { transcriptId: transcript.id } }),
    prisma.transcriptSegment.createMany({
      data: (segments as { speaker: string; text: string; start: number; end: number; sentiment?: string }[]).map((seg) => ({
        transcriptId: transcript.id,
        speaker: seg.speaker,
        text: seg.text,
        startTime: seg.start,
        endTime: seg.end,
        sentiment: seg.sentiment ?? sentiment,
      })),
    }),
  ])

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
 } catch (err) {
   return handleApiError(err)
 }
}
