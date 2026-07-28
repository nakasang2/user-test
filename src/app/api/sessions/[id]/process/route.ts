import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { analyzeAndSaveSession } from '@/lib/analyze-session'
import { requireAuth, requireParticipantToken, handleApiError } from '@/lib/api-auth'
import { rateLimit, getClientIp } from '@/lib/ratelimit'

// AI 呼び出しを2回行うため、既定の実行時間上限では足りないことがある
export const maxDuration = 300

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

  // 分析と保存の本体は lib/analyze-session に集約している
  // （一括再分析からも同じ処理を呼ぶため）
  const transcript = await analyzeAndSaveSession({
    sessionId: id,
    transcriptText,
    segments: segments as { speaker: string; text: string; start: number; end?: number }[],
    emotions: emotionData ?? null,
    questions: session.interview.questions.map((q) => q.text),
  })

  return NextResponse.json({ transcript, ok: true })
 } catch (err) {
   return handleApiError(err)
 }
}
